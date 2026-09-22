"""Draft D: the 5v5 map rebuilt from the reference minimap.

Walls and bushes come from the 512 px top-down minimap of the Land of Dawn
(dataset/world/reference/Minimap.png), aligned onto the survey's map-px
frame by docs/drafts/ref-align.py (-> minimap_layers.npz). Lanes, turrets,
camps and pits keep the survey's measured positions; the lane geometry
(width 38, edge roads at x = 51 / y = 24, chamfered corners, river channel
half-width 10 with a pond of radius 30 at the mid crossing) was measured on
the aligned minimap.

Walls are capsule chains with a radius per point: the blob's medial axis
with the distance-transform radius, sampled every SPACING map px, so fat
rock stays fat and C-shaped rock stays C-shaped. The board is made exactly
point-symmetric (the ally half wins, the enemy half is its rotation).

usage: python docs/drafts/draft-d.py            (from legends-arena/)
writes js/map-data.js, docs/drafts/draft-d.json, docs/drafts/draft-d.png
"""
import json, math, os
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

REF = next((p for p in ['../dataset/world/reference/', 'docs/reference/'] if os.path.exists(p + 'minimap_layers.npz')), None)
H = next((p for p in ['../dataset/world/handoff/', 'docs/mlbb-handoff/'] if os.path.exists(p + 'labels.json')), None)
assert REF and H, 'need the aligned minimap layers and the survey labels'
labels = json.load(open(H + 'labels.json'))
places = {p['id']: p for p in labels['places']}
LAY = np.load(REF + 'minimap_layers.npz')

CX, CY = labels['symmetry_center']           # (250.5, 222.0)
HALF = 218.0
X0, Y0 = CX - HALF, CY - HALF
SIDE = 2 * HALF
R = 2                                         # raster px per map px
N = int(SIDE * R)
assert tuple(int(v) for v in LAY['frame'][2:]) == (R, N) and abs(float(LAY['frame'][0]) - X0) < 1e-6

rot = lambda x, y: (2 * CX - x, 2 * CY - y)
to_r = lambda x, y: ((x - X0) * R, (y - Y0) * R)
from_r = lambda i, j: (i / R + X0, j / R + Y0)

# ---------------------------------------------------------------- lanes (measured on the minimap)
LANE_W = 38.0
EDGE_L = 51.25                 # left road centreline x
EDGE_T = 24.0                  # top road centreline y
CHAMFER_A = (EDGE_L, 78.4)     # where the left road starts its diagonal corner
CHAMFER_B = (121.8, EDGE_T)    # where the diagonal meets the top road
BASE_A = tuple(places['allied_base']['position'])      # (66.9, 404.4)
BASE_B = rot(*BASE_A)
def toward_corner(p, d):
    ux, uy = p[0] - CX, p[1] - CY; n = math.hypot(ux, uy)
    return (p[0] + ux / n * d, p[1] + uy / n * d)
FOUNTAIN_A = toward_corner(BASE_A, 25.0)
FOUNTAIN_B = rot(*FOUNTAIN_A)

def fillet(pts, r, n=6):
    """round every interior corner with an arc of radius r (quadratic approximation)"""
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        p0, p1, p2 = (np.array(pts[i - 1], float), np.array(pts[i], float), np.array(pts[i + 1], float))
        d0 = (p0 - p1) / np.linalg.norm(p0 - p1); d2 = (p2 - p1) / np.linalg.norm(p2 - p1)
        ang = math.acos(max(-1.0, min(1.0, float(np.dot(d0, d2)))))
        if ang > math.radians(176): out.append(tuple(p1)); continue
        t = min(r / math.tan(ang / 2), 0.45 * np.linalg.norm(p0 - p1), 0.45 * np.linalg.norm(p2 - p1))
        a = p1 + d0 * t; b = p1 + d2 * t
        for k in range(n + 1):
            s = k / n; q = (1 - s) ** 2 * a + 2 * (1 - s) * s * p1 + s ** 2 * b
            out.append((float(q[0]), float(q[1])))
    out.append(pts[-1]); return out

TOP = fillet([BASE_A, (EDGE_L, BASE_A[1] - 22), CHAMFER_A, CHAMFER_B, (BASE_B[0] - 22, EDGE_T), BASE_B], 14.0)
MID = [BASE_A, (CX, CY), BASE_B]
BOT = [rot(*p) for p in reversed(TOP)]
LANES = {'top': TOP, 'mid': MID, 'bot': BOT}

def proj_on_lane(lane, p):
    best, bd, acc, bestacc = None, 1e9, 0.0, 0.0
    total = sum(math.dist(lane[i - 1], lane[i]) for i in range(1, len(lane)))
    for i in range(1, len(lane)):
        a, b = lane[i - 1], lane[i]
        vx, vy = b[0] - a[0], b[1] - a[1]; L2 = vx * vx + vy * vy or 1e-9
        t = max(0, min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2))
        c = (a[0] + vx * t, a[1] + vy * t); d = math.dist(p, c)
        if d < bd: bd, best, bestacc = d, c, acc + math.sqrt(L2) * t
        acc += math.sqrt(L2)
    return best, bestacc / total

# ---------------------------------------------------------------- turrets (survey, snapped onto the lanes)
TIER = {'outer': 0.40, 'inner': 0.27, 'inhibitor': 0.13}
TOWERS = []
for p in labels['places']:
    if p['kind'] != 'turret' or p['side'] != 'ally': continue
    lane = p['lane']; snapped, frac = proj_on_lane(LANES[lane], p['position'])
    TOWERS.append({'x': snapped[0], 'y': snapped[1], 'team': 0, 'lane': lane, 'frac': TIER[p['tier']], 'posFrac': frac})
    q = rot(*snapped)
    TOWERS.append({'x': q[0], 'y': q[1], 'team': 1, 'lane': lane, 'frac': TIER[p['tier']], 'posFrac': 1 - frac})

# ---------------------------------------------------------------- camps, pits, river
KIND = {'camp_buff': None, 'camp': 'normal', 'neutral_camp': None}
CAMPS = []
for p in labels['places']:
    if p['kind'] not in KIND: continue
    k = 'blueBuff' if 'purple' in p['id'] else 'redBuff' if 'orange' in p['id'] else 'crab' if 'crab' in p['id'] else 'litho' if 'litho' in p['id'] else 'normal'
    CAMPS.append({'x': p['position'][0], 'y': p['position'][1], 'kind': k, 'name': p['common_name']})
LORD = tuple(places['lord']['position']); TURTLE = rot(*LORD)
PIT_R = float(labels['river_pits']['radius'])          # 25
RIVER = [LORD, (CX, CY), TURTLE]
RIVER_HALF = 10.0
POOLS = [{'x': LORD[0], 'y': LORD[1], 'r': PIT_R}, {'x': TURTLE[0], 'y': TURTLE[1], 'r': PIT_R}, {'x': CX, 'y': CY, 'r': 30.0}]

def side_of_river(x, y):
    dx, dy = TURTLE[0] - LORD[0], TURTLE[1] - LORD[1]
    return (x - LORD[0]) * dy - (y - LORD[1]) * dx

# ---------------------------------------------------------------- raster helpers
def disk(r_px):
    k = int(round(r_px * R)) * 2 + 1
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
def stroke(mask, pts, half_w, val=1):
    p = np.array([to_r(*q) for q in pts], dtype=np.int32)
    cv2.polylines(mask, [p], False, val, thickness=max(1, int(round(half_w * 2 * R))), lineType=cv2.LINE_8)
def circle(mask, c, r, val=1):
    cv2.circle(mask, tuple(int(round(v)) for v in to_r(*c)), int(round(r * R)), val, -1)
def symmetrise(mask):
    yy, xx = np.mgrid[0:N, 0:N]
    mx, my = xx / R + X0, yy / R + Y0
    ally = side_of_river(mx, my) < 0
    rotm = mask[::-1, ::-1]
    out = np.where(ally, mask, rotm)
    line = np.abs(side_of_river(mx, my)) < 1.5 * math.hypot(TURTLE[0] - LORD[0], TURTLE[1] - LORD[1])
    out[line] = mask[line] | rotm[line]
    return out.astype(np.uint8)
def remove_small(mask, min_area_px2):
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    keep = np.zeros(n, bool); keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area_px2 * R * R
    return keep[lab].astype(np.uint8)

# ---------------------------------------------------------------- walls (minimap layer)
wall = LAY['wall'].astype(np.uint8).copy()
wall = symmetrise(wall)
# the two cut-off corners beyond the lane chamfers are not rock blobs but the
# board's edge: a ridge along the chamfer with a plateau behind it (painted)
_u = np.array([CHAMFER_B[0] - CHAMFER_A[0], CHAMFER_B[1] - CHAMFER_A[1]]); _u /= np.linalg.norm(_u)
_n = np.array([-_u[1], _u[0]])
if np.dot(_n, [CX - CHAMFER_A[0], CY - CHAMFER_A[1]]) > 0: _n = -_n          # outward = away from the centre
RIDGE_OFF = LANE_W / 2 + 6.0
_p0 = np.array(CHAMFER_A) + _n * RIDGE_OFF
_t_left = (X0 - _p0[0]) / _u[0]; _t_top = (Y0 - _p0[1]) / _u[1]
RIDGE_A = tuple(_p0 + _u * (_t_left - 6)); RIDGE_B = tuple(_p0 + _u * (_t_top + 6))     # runs a little past both edges
CORNER_POLY = [(X0, Y0), (float(_p0[0] + _u[0] * _t_top), Y0), (X0, float(_p0[1] + _u[1] * _t_left))]
corner_zone = np.zeros((N, N), np.uint8)
cv2.fillPoly(corner_zone, [np.array([to_r(*q) for q in [(X0, Y0), (X0 + 170, Y0), (X0, Y0 + 170)]], np.int32)], 1)
corner_zone |= corner_zone[::-1, ::-1]
wall &= 1 - corner_zone
free_fixed = np.zeros((N, N), np.uint8)
for pts in LANES.values(): stroke(free_fixed, pts, LANE_W / 2 - 1.0)
for c in (BASE_A, BASE_B): circle(free_fixed, c, 30)
for c in (FOUNTAIN_A, FOUNTAIN_B): circle(free_fixed, c, 22)
for cp in CAMPS: circle(free_fixed, (cp['x'], cp['y']), 6 if cp['kind'] in ('blueBuff', 'redBuff') else 5)
for t in TOWERS: circle(free_fixed, (t['x'], t['y']), 8)
wall &= 1 - free_fixed
wall = remove_small(wall, 12)
wall = cv2.morphologyEx(wall, cv2.MORPH_CLOSE, disk(1.0))
wall = cv2.morphologyEx(wall, cv2.MORPH_OPEN, disk(1.0))
wall = remove_small(wall, 20)
# unreachable pockets become rock; every corridor gets at least MIN_CORRIDOR
free = (1 - wall).astype(np.uint8)
n, lab, stats, _ = cv2.connectedComponentsWithStats(free, 4)
main = lab[tuple(int(v) for v in reversed(to_r(*BASE_A)))]
for i in range(1, n):
    if i != main and stats[i, cv2.CC_STAT_AREA] < 400 * R * R: wall[lab == i] = 1
free = (1 - wall).astype(np.uint8)
MIN_CORRIDOR = 6.0
narrow = free & (1 - cv2.morphologyEx(free, cv2.MORPH_OPEN, disk(MIN_CORRIDOR / 2)))
wall &= 1 - cv2.dilate(narrow, disk(1.5))
wall = remove_small(wall, 20)
wall = symmetrise(wall)
wall_src = wall.copy()

# ---------------------------------------------------------------- medial axis -> capsule chains
def zhang_suen(img):
    img = img.copy().astype(np.uint8)
    while True:
        changed = False
        for step in (0, 1):
            Pd = np.pad(img, 1)
            p2 = Pd[:-2, 1:-1]; p3 = Pd[:-2, 2:]; p4 = Pd[1:-1, 2:]; p5 = Pd[2:, 2:]
            p6 = Pd[2:, 1:-1]; p7 = Pd[2:, :-2]; p8 = Pd[1:-1, :-2]; p9 = Pd[:-2, :-2]
            B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
            seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
            A = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(np.uint8) for i in range(8))
            cond = (p2 * p4 * p6 == 0) & (p4 * p6 * p8 == 0) if step == 0 else (p2 * p4 * p8 == 0) & (p2 * p6 * p8 == 0)
            m = (img == 1) & (B >= 2) & (B <= 6) & (A == 1) & cond
            if m.any(): img[m] = 0; changed = True
        if not changed: break
    return img

NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
RING = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
def crossing(p, pts):
    ring = [((p[0] + a, p[1] + b) in pts) for a, b in RING]
    return sum(1 for i in range(8) if not ring[i] and ring[(i + 1) % 8])
def trace_branches(sk):
    pts = set(zip(*np.nonzero(sk)))
    deg = {p: crossing(p, pts) for p in pts}
    nbrs = lambda p: [(p[0] + a, p[1] + b) for a, b in NB if (p[0] + a, p[1] + b) in pts]
    used = set(); branches = []
    def mark(a, b): used.add((a, b)); used.add((b, a))
    def walk(start, nxt):
        chain = [start, nxt]; mark(start, nxt)
        cur, prev = nxt, start
        while deg[cur] == 2:
            cand = [q for q in nbrs(cur) if q != prev and (cur, q) not in used]
            cand = [q for q in cand if not any(o != q and max(abs(o[0] - q[0]), abs(o[1] - q[1])) == 1 and
                                                 max(abs(o[0] - prev[0]), abs(o[1] - prev[1])) <= 1 for o in cand)] or cand
            if not cand: break
            nx_ = cand[0]
            for o in nbrs(cur):
                if o != prev and o != nx_ and max(abs(o[0] - nx_[0]), abs(o[1] - nx_[1])) == 1:
                    mark(cur, o); mark(o, nx_)
            mark(cur, nx_); chain.append(nx_); prev, cur = cur, nx_
            if cur == start: break
        return chain
    for p in pts:
        if deg[p] == 2: continue
        for q in nbrs(p):
            if (p, q) not in used: branches.append(walk(p, q))
    for p in pts:
        if deg[p] == 2 and not any((p, q) in used for q in nbrs(p)):
            branches.append(walk(p, nbrs(p)[0]))
    return branches, deg

def prune_spurs(sk, dt, min_len_px):
    """drop side branches (one free end) shorter than min_len or than the rock's
    own radius at their junction: they are skeleton noise from blob bumps"""
    branches, deg = trace_branches(sk)
    out = sk.copy(); removed = 0
    at = {}
    for br in branches:
        at.setdefault(br[0], []).append(len(br)); at.setdefault(br[-1], []).append(len(br))
    for br in branches:
        e0, e1 = deg[br[0]] == 1, deg[br[-1]] == 1
        if e0 == e1: continue
        junction = br[-1] if e0 else br[0]
        limit = max(min_len_px, 0.9 * dt[junction]) * R
        # only a side branch of a longer trunk is a spur; a small rock whose
        # whole skeleton is short keeps every branch
        if len(br) < limit and any(L >= limit for L in at[junction] if L != len(br)):
            for p in br[1:-1]: out[p] = 0
            out[br[0] if e0 else br[-1]] = 0
            removed += 1
    return out, removed

dt = cv2.distanceTransform(wall, cv2.DIST_L2, 5) / R          # map px to the nearest free pixel
skel = zhang_suen(wall)
skel, n1 = prune_spurs(skel, dt, 3.0)
skel, n2 = prune_spurs(skel, dt, 2.5)
branches, deg = trace_branches(skel)

SPACING = 3.0                 # map px between capsule centres along a chain
MIN_R = 1.6
WALLS = []
for br in branches:
    if len(br) < 2:
        continue
    # arc-length resample every SPACING map px, endpoints kept
    acc = [0.0]
    for i in range(1, len(br)):
        acc.append(acc[-1] + math.dist(br[i - 1], br[i]) / R)
    total = acc[-1]
    nseg = max(1, int(round(total / SPACING)))
    targets = [total * k / nseg for k in range(nseg + 1)]
    samples = []
    j = 0
    for tgt in targets:
        while j < len(br) - 1 and acc[j + 1] < tgt: j += 1
        samples.append(br[min(j, len(br) - 1)])
    pts = [from_r(float(p[1]), float(p[0])) for p in samples]
    rs = [max(MIN_R, float(dt[p])) for p in samples]
    # trim the near-zero-radius tails the medial axis grows into acute corners
    while len(pts) > 2 and rs[0] < 2.2: pts.pop(0); rs.pop(0)
    while len(pts) > 2 and rs[-1] < 2.2: pts.pop(); rs.pop()
    total = sum(math.dist(pts[i - 1], pts[i]) for i in range(1, len(pts)))
    if max(rs) < 2.6: continue                        # a hair, not a rock
    if total < 1.0:                                  # a dot of rock: give it a length to stroke
        x, y = pts[0]; pts = [(x - 0.5, y), (x + 0.5, y)]; rs = [rs[0], rs[0]]
    WALLS.append({'pts': [[round(x, 1), round(y, 1)] for x, y in pts], 'rs': [round(r, 1) for r in rs], 'r': round(max(rs), 1)})

# corner ridges: straight capsule chains along both chamfers, then hidden
# chains that fill the plateau behind them (solid for collision, painted flat)
for depth, r_, hidden in ((0.0, 6.0, False), (14.0, 8.0, True), (28.0, 8.0, True), (42.0, 8.0, True), (56.0, 8.0, True)):
    a = np.array(RIDGE_A) + _n * depth; b = np.array(RIDGE_B) + _n * depth
    for a_, b_ in ((tuple(a), tuple(b)), (rot(*a), rot(*b))):
        n_ = max(2, int(math.dist(a_, b_) / 8))
        pts = [(a_[0] + (b_[0] - a_[0]) * k / n_, a_[1] + (b_[1] - a_[1]) * k / n_) for k in range(n_ + 1)]
        w = {'pts': [[round(x, 1), round(y, 1)] for x, y in pts], 'rs': [r_] * len(pts), 'r': r_, 'ring': True}
        if hidden: w['hidden'] = True
        WALLS.append(w)

# ---------------------------------------------------------------- what the engine will see
built = np.zeros((N, N), np.uint8)
for w in WALLS:
    for i in range(1, len(w['pts'])):
        a, b = w['pts'][i - 1], w['pts'][i]; r = (w['rs'][i - 1] + w['rs'][i]) / 2
        cv2.line(built, tuple(int(round(v)) for v in to_r(*a)), tuple(int(round(v)) for v in to_r(*b)), 1, max(1, int(round(r * 2 * R))))
    for p, r in zip(w['pts'], w['rs']): circle(built, p, r)
# rock the medial axis lost (a blob whose skeleton collapsed) becomes one round boulder
nsrc, lsrc, ssrc, _ = cv2.connectedComponentsWithStats(wall_src, 8)
for i in range(1, nsrc):
    comp = (lsrc == i).astype(np.uint8)
    missing = comp & (1 - built)
    if missing.sum() < 25 * R * R or (comp & built).sum() > 0.5 * comp.sum(): continue
    d = cv2.distanceTransform(comp, cv2.DIST_L2, 5)
    j, k = np.unravel_index(np.argmax(d), d.shape); r = max(MIN_R, float(d[j, k]) / R)
    x, y = from_r(float(k), float(j))
    WALLS.append({'pts': [[round(x - 0.5, 1), round(y, 1)], [round(x + 0.5, 1), round(y, 1)]], 'rs': [round(r, 1)] * 2, 'r': round(r, 1)})
    circle(built, (x, y), r)
_in = 1 - corner_zone
fidelity = ((built & wall_src) & _in).sum() / max(((built | wall_src) & _in).sum(), 1)   # the corners are ridges + plateau by design
np.savez_compressed(REF + 'draftd_masks.npz', wall_src=wall_src, built=built, skel=skel)

# ---------------------------------------------------------------- bushes (minimap layer)
bush = LAY['bush'].astype(np.uint8).copy()
bush = symmetrise(bush)
bush &= 1 - cv2.dilate(built, disk(1.0))
lane_core = np.zeros((N, N), np.uint8)
for pts in LANES.values(): stroke(lane_core, pts, 6.0)
for c in (BASE_A, BASE_B): circle(lane_core, c, 34)
for c in (LORD, TURTLE): circle(lane_core, c, PIT_R)
for cp in CAMPS: circle(lane_core, (cp['x'], cp['y']), 9)
bush &= 1 - lane_core
bush = remove_small(bush, 40)
bush = cv2.morphologyEx(bush, cv2.MORPH_OPEN, disk(1.5))
bush = remove_small(bush, 50)
bush = symmetrise(bush)
BUSHES = []
n, lab, stats, cents = cv2.connectedComponentsWithStats(bush, 8)
for i in range(1, n):
    ys, xs = np.nonzero(lab == i)
    pts = np.stack([xs, ys], 1).astype(float) / R
    pts[:, 0] += X0; pts[:, 1] += Y0
    mean = pts.mean(0); _, sv, vt = np.linalg.svd(pts - mean, full_matrices=False)
    axis, norm = vt[0], vt[1]
    along = (pts - mean) @ axis; across = (pts - mean) @ norm
    L = np.percentile(along, 98) - np.percentile(along, 2); Wd = np.percentile(across, 98) - np.percentile(across, 2)
    area = stats[i, cv2.CC_STAT_AREA] / (R * R)
    if L / max(Wd, 1) < 1.5:
        r = max(3.5, min(11.0, math.sqrt(area / math.pi)))
        BUSHES.append({'x': round(mean[0], 1), 'y': round(mean[1], 1), 'r': round(r, 1)})
    else:
        r = max(3.5, min(9.0, Wd / 2))
        h = max(0.0, L / 2 - r)
        a = mean + axis * (-h); b = mean + axis * h
        BUSHES.append({'x': round(mean[0], 1), 'y': round(mean[1], 1), 'r': round(r, 1),
                       'ax': round(a[0], 1), 'ay': round(a[1], 1), 'bx': round(b[0], 1), 'by': round(b[1], 1)})

# ---------------------------------------------------------------- reachability
free = (1 - built).astype(np.uint8)
n, lab, stats, _ = cv2.connectedComponentsWithStats(free, 4)
main = lab[tuple(int(v) for v in reversed(to_r(*BASE_A)))]
unreach = [cp['name'] for cp in CAMPS if lab[tuple(int(v) for v in reversed(to_r(cp['x'], cp['y'])))] != main]
unreachT = sum(1 for t in TOWERS if lab[tuple(int(v) for v in reversed(to_r(t['x'], t['y'])))] != main)
enclosed = sum(1 for i in range(1, n) if i != main and stats[i, cv2.CC_STAT_AREA] > 50 * R * R)

# ---------------------------------------------------------------- output
data = {
    'frame': {'cx': CX, 'cy': CY, 'half': HALF, 'unit': 'map px (Mobile Legends survey minimap crop)', 'heroSpeedPxPerSec': 22.5},
    'laneWidth': LANE_W, 'lanes': {k: [[round(x, 1), round(y, 1)] for x, y in v] for k, v in LANES.items()},
    'bases': [list(BASE_A), list(BASE_B)], 'fountains': [list(FOUNTAIN_A), list(FOUNTAIN_B)],
    'towers': [{**t, 'x': round(t['x'], 1), 'y': round(t['y'], 1), 'posFrac': round(t['posFrac'], 3)} for t in TOWERS],
    'camps': CAMPS, 'pits': {'lord': list(LORD), 'turtle': list(TURTLE), 'r': PIT_R},
    'river': [list(p) for p in RIVER], 'riverHalf': RIVER_HALF,
    'pools': [{'x': round(p['x'], 1), 'y': round(p['y'], 1), 'r': p['r']} for p in POOLS],
    'walls': WALLS, 'bushes': BUSHES,
    'corners': [[[round(x, 1), round(y, 1)] for x, y in CORNER_POLY], [[round(2 * CX - x, 1), round(2 * CY - y, 1)] for x, y in CORNER_POLY]],
}
js = "'use strict';\n/* Generated by docs/drafts/draft-d.py - do not edit by hand. */\nconst MAP_DATA = " + json.dumps(data, separators=(',', ':')) + ";\n"
open('js/map-data.js', 'w', encoding='utf-8', newline='\n').write(js)
json.dump(data, open('docs/drafts/draft-d.json', 'w', encoding='utf-8'))
print(f'walls {len(WALLS)} (segments {sum(len(w["pts"]) - 1 for w in WALLS)}, points {sum(len(w["pts"]) for w in WALLS)}), '
      f'bushes {len(BUSHES)} (capsules {sum(1 for b in BUSHES if "ax" in b)}), camps {len(CAMPS)}, towers {len(TOWERS)}, pruned spurs {n1 + n2}')
print(f'wall fidelity to the reference mask (IoU) {fidelity:.3f} | unreachable camps: {unreach or "none"} | unreachable towers: {unreachT} | enclosed pockets: {enclosed}')

# ---------------------------------------------------------------- blockout
S = 3.0; PAD = 24
img = Image.new('RGB', (int(SIDE * S) + PAD * 2, int(SIDE * S) + PAD * 2), (24, 24, 24))
dr = ImageDraw.Draw(img, 'RGBA')
Pm = lambda x, y: ((x - X0) * S + PAD, (y - Y0) * S + PAD)
dr.line([Pm(*p) for p in RIVER], fill=(38, 62, 70), width=int(RIVER_HALF * 2 * S))
for p in POOLS:
    x, y = Pm(p['x'], p['y']); rr = p['r'] * S; dr.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(38, 62, 70) if p['r'] > PIT_R else (40, 44, 51))
for pts in LANES.values():
    pl = [Pm(*p) for p in pts]
    for i in range(1, len(pl)): dr.line([pl[i - 1], pl[i]], fill=(71, 71, 71), width=int(LANE_W * S))
    for x, y in pl: rr = LANE_W * S / 2; dr.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(71, 71, 71))
TEAM = [(221, 157, 98), (151, 210, 145)]
for t in TOWERS:
    x, y = Pm(t['x'], t['y']); rr = 30 * S; col = TEAM[t['team']]
    dr.ellipse([x - rr, y - rr, x + rr, y + rr], fill=col + (24,))
    for k in range(0, 40, 2): dr.arc([x - rr, y - rr, x + rr, y + rr], k * 9, (k + 1) * 9, fill=col + (200,), width=2)
for w in WALLS:
    pl = [Pm(*p) for p in w['pts']]
    for i in range(1, len(pl)):
        wd = max(2, int((w['rs'][i - 1] + w['rs'][i]) * S))
        dr.line([pl[i - 1], pl[i]], fill=(143, 143, 143), width=wd)
    for p, r in zip(pl, w['rs']):
        wd = r * S; dr.ellipse([p[0] - wd, p[1] - wd, p[0] + wd, p[1] + wd], fill=(143, 143, 143))
for b in BUSHES:
    rr = b['r'] * S
    if 'ax' in b:
        a, c = Pm(b['ax'], b['ay']), Pm(b['bx'], b['by'])
        dr.line([a, c], fill=(48, 66, 48), width=int(rr * 2))
        for p in (a, c): dr.ellipse([p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr], fill=(48, 66, 48))
    else:
        x, y = Pm(b['x'], b['y']); dr.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(48, 66, 48))
for cp in CAMPS:
    big = cp['kind'] in ('blueBuff', 'redBuff'); x, y = Pm(cp['x'], cp['y']); rr = (9 if big else 7) * S
    dr.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(40, 44, 51))
    for k in range(0, 30, 2): dr.arc([x - rr, y - rr, x + rr, y + rr], k * 12, (k + 1) * 12, fill=(110, 120, 150), width=2)
    if big: dr.ellipse([x - 4 * S, y - 4 * S, x + 4 * S, y + 4 * S], fill=(110, 160, 255) if cp['kind'] == 'blueBuff' else (255, 150, 80))
for t in TOWERS:
    x, y = Pm(t['x'], t['y']); dr.rectangle([x - 9, y - 9, x + 9, y + 9], fill=TEAM[t['team']], outline=(24, 24, 24), width=2)
for i, (b, f) in enumerate([(BASE_A, FOUNTAIN_A), (BASE_B, FOUNTAIN_B)]):
    x, y = Pm(*b); rr = 11 * S; dr.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(68, 54, 41) if i == 0 else (52, 65, 51), outline=TEAM[i], width=3)
    x, y = Pm(*f); dr.ellipse([x - 6, y - 6, x + 6, y + 6], outline=TEAM[i], width=2)
try: font = ImageFont.truetype('segoeuib.ttf', 20); small = ImageFont.truetype('segoeui.ttf', 14)
except Exception: font = small = ImageFont.load_default()
for text, p in [('TOP', (CX, EDGE_T - 19)), ('BOTTOM', (CX, 2 * CY - EDGE_T + 19)), ('MID', (CX, CY - 8)), ('Lord', (LORD[0], LORD[1] - 32)), ('Turtle', (TURTLE[0], TURTLE[1] + 32)), ('A', BASE_A), ('B', BASE_B)]:
    dr.text(Pm(*p), text, fill=(238, 238, 238), font=font, anchor='mm')
dr.text((PAD, img.size[1] - 14), 'Draft D: walls and bushes from the reference minimap, lanes measured on it, turrets/camps/pits from the survey.', fill=(150, 150, 150), font=small, anchor='lm')
img.save('docs/drafts/draft-d.png'); print('wrote docs/drafts/draft-d.png', img.size)
