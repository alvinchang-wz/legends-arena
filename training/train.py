#!/usr/bin/env python3
"""Behavior cloning for the Legends Arena neural bot (v1: target selection).

Trains a small candidate-scoring MLP to imitate the hand-coded heuristic bot's
target choices, then exports weights as JSON for the game's hand-written
JavaScript inference runtime.

  python3 training/train.py --data training/data/dataset.jsonl
  python3 training/train.py --device mps --epochs 30
  python3 training/train.py --resume            # continue from last checkpoint

Runs on CPU or Apple MPS. No CUDA, no cloud, no large dependencies.
"""
import argparse
import json
import os
import random
import sys
import time

import torch
import torch.nn as nn
import torch.nn.functional as F

OBS_VERSION = 1          # must match NEURAL_OBSERVATION_VERSION in js/ai/observation.js
MODEL_SCHEMA = 1         # must match NEURAL_MODEL_SCHEMA in js/ai/neural-runtime.js
SELF_DIM, CAND_DIM, K = 30, 16, 16
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# --------------------------------------------------------------------------- device
def pick_device(pref):
    if pref == 'cpu':
        return torch.device('cpu')
    if pref == 'mps':
        if not torch.backends.mps.is_available():
            print('  ! MPS requested but unavailable; using CPU')
            return torch.device('cpu')
        return torch.device('mps')
    # auto: this model is tiny, so CPU usually wins on transfer overhead alone.
    return torch.device('cpu')


# --------------------------------------------------------------------------- data
def load_jsonl(path, limit=None):
    rows = []
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if r.get('v') != OBS_VERSION:
                raise SystemExit(f'observation version {r.get("v")} != {OBS_VERSION} — regenerate the dataset')
            rows.append(r)
            if limit and len(rows) >= limit:
                break
    if not rows:
        raise SystemExit(f'no rows in {path}')
    return rows


def to_tensors(rows):
    n = len(rows)
    xs = torch.zeros(n, SELF_DIM, dtype=torch.float32)
    xc = torch.zeros(n, K, CAND_DIM, dtype=torch.float32)
    xm = torch.zeros(n, K, dtype=torch.float32)
    y = torch.zeros(n, dtype=torch.long)
    for i, r in enumerate(rows):
        xs[i] = torch.tensor(r['self'], dtype=torch.float32)
        cnt = int(r['n'])
        if cnt:
            flat = torch.tensor(r['cand'], dtype=torch.float32)
            xc[i, :cnt] = flat.view(cnt, CAND_DIM)
        xm[i, :cnt] = 1.0
        y[i] = int(r['y_target'])
    return xs, xc, xm, y


def split_by_match(rows, seed=0, val_frac=0.15, test_frac=0.15):
    """Split by whole match so adjacent think ticks never straddle splits."""
    ids = sorted({r['m'] for r in rows})
    rng = random.Random(seed)
    rng.shuffle(ids)
    n_val = max(1, int(round(len(ids) * val_frac)))
    n_test = max(1, int(round(len(ids) * test_frac)))
    if len(ids) < 3:
        raise SystemExit(f'need at least 3 matches to split, got {len(ids)}')
    val, test = set(ids[:n_val]), set(ids[n_val:n_val + n_test])
    train = set(ids[n_val + n_test:])
    buckets = {'train': [], 'val': [], 'test': []}
    for r in rows:
        buckets['val' if r['m'] in val else 'test' if r['m'] in test else 'train'].append(r)
    return buckets, {'train': sorted(train), 'val': sorted(val), 'test': sorted(test)}


# --------------------------------------------------------------------------- model
class TargetPolicy(nn.Module):
    """Per-candidate scoring; mirrors the JS runtime exactly."""

    def __init__(self, hidden=32):
        super().__init__()
        h = hidden
        self.se0, self.se1 = nn.Linear(SELF_DIM, h), nn.Linear(h, h)
        self.ce0, self.ce1 = nn.Linear(CAND_DIM, h), nn.Linear(h, h)
        self.sc0, self.sc1 = nn.Linear(2 * h, h), nn.Linear(h, 1)
        self.nt0, self.nt1 = nn.Linear(h, h), nn.Linear(h, 1)

    def forward(self, xs, xc, xm):
        s = F.relu(self.se1(F.relu(self.se0(xs))))              # (B,H)
        c = F.relu(self.ce1(F.relu(self.ce0(xc))))              # (B,K,H)
        pair = torch.cat([s.unsqueeze(1).expand(-1, c.size(1), -1), c], dim=-1)
        cand = self.sc1(F.relu(self.sc0(pair))).squeeze(-1)     # (B,K)
        cand = cand.masked_fill(xm == 0, -1e9)
        no_target = self.nt1(F.relu(self.nt0(s)))               # (B,1)
        return torch.cat([cand, no_target], dim=-1)             # (B,K+1)


def export_json(model, hidden, meta, path):
    p = {}
    pairs = [('se0', model.se0), ('se1', model.se1), ('ce0', model.ce0), ('ce1', model.ce1),
             ('sc0', model.sc0), ('sc1', model.sc1), ('nt0', model.nt0), ('nt1', model.nt1)]
    for name, layer in pairs:
        p[name + 'w'] = layer.weight.detach().cpu().flatten().tolist()   # row-major [out,in]
        p[name + 'b'] = layer.bias.detach().cpu().flatten().tolist()
    obj = {
        'schemaVersion': MODEL_SCHEMA,
        'obsVersion': OBS_VERSION,
        'config': {'K': K, 'selfDim': SELF_DIM, 'candDim': CAND_DIM, 'hidden': hidden},
        'heads': ['target'],
        'meta': meta,
        'params': p,
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as fh:
        json.dump(obj, fh)
    n_params = sum(len(v) for v in p.values())
    return n_params, os.path.getsize(path)


# --------------------------------------------------------------------------- metrics
@torch.no_grad()
def evaluate(model, data, device, batch=4096):
    model.eval()
    xs, xc, xm, y = data
    correct = tot = 0
    c_tgt = n_tgt = c_no = n_no = 0
    loss_sum = 0.0
    for i in range(0, len(y), batch):
        b = slice(i, i + batch)
        logits = model(xs[b].to(device), xc[b].to(device), xm[b].to(device))
        yb = y[b].to(device)
        loss_sum += F.cross_entropy(logits, yb, reduction='sum').item()
        pred = logits.argmax(-1)
        hit = (pred == yb)
        correct += hit.sum().item()
        tot += len(yb)
        is_t = yb != K
        n_tgt += is_t.sum().item()
        c_tgt += (hit & is_t).sum().item()
        n_no += (~is_t).sum().item()
        c_no += (hit & ~is_t).sum().item()
    return {
        'loss': loss_sum / max(1, tot),
        'acc': correct / max(1, tot),
        'acc_when_target': c_tgt / max(1, n_tgt),
        'acc_when_no_target': c_no / max(1, n_no),
        'n': tot, 'n_target': n_tgt, 'n_no_target': n_no,
    }


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default='training/data/dataset.jsonl')
    ap.add_argument('--out', default='models/neural-bot-v1/model.json')
    ap.add_argument('--ckpt', default='training/checkpoints/target_v1.pt')
    ap.add_argument('--device', default='auto', choices=['auto', 'cpu', 'mps'])
    ap.add_argument('--hidden', type=int, default=32)
    ap.add_argument('--epochs', type=int, default=30)
    ap.add_argument('--batch', type=int, default=256)
    ap.add_argument('--lr', type=float, default=2e-3)
    ap.add_argument('--patience', type=int, default=6)
    ap.add_argument('--no-target-weight', type=float, default=0.4,
                    help='loss weight for the "no target" class (it is over-represented)')
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--resume', action='store_true')
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    device = pick_device(args.device)
    data_path = args.data if os.path.isabs(args.data) else os.path.join(ROOT, args.data)

    print(f'device: {device.type}  (mps available: {torch.backends.mps.is_available()})')
    print(f'loading {data_path}')
    rows = load_jsonl(data_path, args.limit or None)
    buckets, split_ids = split_by_match(rows, seed=args.seed)
    print(f'  {len(rows)} examples from {len(split_ids["train"]) + len(split_ids["val"]) + len(split_ids["test"])} matches')
    print(f'  train {len(buckets["train"])} | val {len(buckets["val"])} | test {len(buckets["test"])}')
    print(f'  match split: train={split_ids["train"]} val={split_ids["val"]} test={split_ids["test"]}')

    train = to_tensors(buckets['train'])
    val = to_tensors(buckets['val'])
    test = to_tensors(buckets['test'])

    y_train = train[3]
    n_no = int((y_train == K).sum())
    print(f'  label balance: with-target {len(y_train) - n_no}  no-target {n_no}')

    model = TargetPolicy(args.hidden).to(device)
    n_trainable = sum(p.numel() for p in model.parameters())
    print(f'  trainable parameters: {n_trainable}')
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)

    weights = torch.ones(K + 1, device=device)
    weights[K] = args.no_target_weight

    start_epoch, best_val, bad = 0, float('inf'), 0
    ckpt_path = os.path.join(ROOT, args.ckpt)
    if args.resume and os.path.exists(ckpt_path):
        ck = torch.load(ckpt_path, map_location=device, weights_only=False)
        if ck.get('obsVersion') != OBS_VERSION:
            raise SystemExit('checkpoint observation version mismatch')
        model.load_state_dict(ck['model'])
        opt.load_state_dict(ck['opt'])
        start_epoch, best_val = ck['epoch'], ck['best_val']
        print(f'  resumed from epoch {start_epoch} (best val loss {best_val:.4f})')

    xs, xc, xm, y = train
    n = len(y)
    best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
    t0 = time.time()
    for epoch in range(start_epoch, args.epochs):
        model.train()
        perm = torch.randperm(n)
        total = 0.0
        for i in range(0, n, args.batch):
            idx = perm[i:i + args.batch]
            logits = model(xs[idx].to(device), xc[idx].to(device), xm[idx].to(device))
            loss = F.cross_entropy(logits, y[idx].to(device), weight=weights)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            total += loss.item() * len(idx)
        vm = evaluate(model, val, device)
        print(f'  epoch {epoch + 1:3d}/{args.epochs}  train {total / n:.4f}  '
              f'val {vm["loss"]:.4f}  acc {vm["acc"]:.3f}  '
              f'acc|target {vm["acc_when_target"]:.3f}  acc|none {vm["acc_when_no_target"]:.3f}')
        if vm['loss'] < best_val - 1e-4:
            best_val, bad = vm['loss'], 0
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
            os.makedirs(os.path.dirname(ckpt_path), exist_ok=True)
            torch.save({'model': best_state, 'opt': opt.state_dict(), 'epoch': epoch + 1,
                        'best_val': best_val, 'obsVersion': OBS_VERSION,
                        'config': {'hidden': args.hidden, 'K': K,
                                   'selfDim': SELF_DIM, 'candDim': CAND_DIM}},
                       ckpt_path)
        else:
            bad += 1
            if bad >= args.patience:
                print(f'  early stopping at epoch {epoch + 1}')
                break

    model.load_state_dict(best_state)
    secs = time.time() - t0
    tm = evaluate(model, test, device)
    vm = evaluate(model, val, device)
    print(f'\ntrained in {secs:.1f}s')
    print(f'  val : acc {vm["acc"]:.3f}  acc|target {vm["acc_when_target"]:.3f}  '
          f'acc|none {vm["acc_when_no_target"]:.3f}  (n={vm["n"]})')
    print(f'  test: acc {tm["acc"]:.3f}  acc|target {tm["acc_when_target"]:.3f}  '
          f'acc|none {tm["acc_when_no_target"]:.3f}  (n={tm["n"]})')

    meta = {
        'trainedAt': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'device': device.type, 'epochsRun': epoch + 1, 'hidden': args.hidden,
        'examples': len(rows), 'matchSplit': split_ids,
        'val': vm, 'test': tm, 'trainSeconds': round(secs, 1),
        'noTargetWeight': args.no_target_weight,
    }
    out_path = os.path.join(ROOT, args.out)
    n_params, size = export_json(model, args.hidden, meta, out_path)
    print(f'\nexported {out_path}')
    print(f'  {n_params} weights, {size / 1024:.1f} KB')
    with open(os.path.join(ROOT, 'training/data/last_metrics.json'), 'w') as fh:
        json.dump(meta, fh, indent=2)


if __name__ == '__main__':
    sys.exit(main())
