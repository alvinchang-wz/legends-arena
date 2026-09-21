"""Draft C: clean, symmetric map geometry from the Mobile Legends survey.

Reads docs/mlbb-handoff (labels.json, map_photo.json), keeps the layout,
and rebuilds every element as deliberate geometry:

  lanes    straight edge roads with one rounded corner, mid dead straight,
           all three the same width; turrets snapped onto them
  walls    the classified wall pixels, symmetrised (the surveyed ally half
           wins), de-noised, gap-closed, corridor-widened, then skeletonised
           into thick polylines (the engine's wall type: points + radius)
  bushes   the classified bush pixels, cleaned and fitted as circles or
           capsules, kept off walls and off lane centres
  camps    the labelled positions (already symmetric in the survey)
  pits     Lord and Turtle circles on the river

Frame: the survey's "map px", re-centred on its 180-degree symmetry centre
(250.5, 222.0) with a 436 px playable square. The engine scales that square
onto WORLD. Everything is authored on the ally half and rotated, so the two
sides are exact mirrors.

Outputs: js/map-data.js (MAP_DATA for the engine) and docs/drafts/draft-c.png
(blockout for inspection).  usage: python docs/drafts/mlbb-clean.py
"""
import json, math
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

import os as _os
# The survey handoff lives in the workspace dataset; a private local copy in
# docs/mlbb-handoff/ (gitignored) is used when the game is checked out alone.
H = next((p for p in ['../dataset/world/handoff/', 'docs/mlbb-handoff/'] if _os.path.exists(p + 'labels.json')), 'docs/mlbb-handoff/')
labels = json.load(open(H + 'labels.json'))
photo = json.load(open(H + 'map_photo.json'))
places = {p['id']: p for p in labels['places']}

CX, CY = labels['symmetry_center']           # (250.5, 222.0)
HALF = 218.0                                  # playable half-size in map px
X0, Y0 = CX - HALF, CY - HALF                 # rect origin (32.5, 4.0)
SIDE = 2 * HALF
R = 2                                         # raster px per map px
N = int(SIDE * R)                             # raster size

rot = lambda x, y: (2 * CX - x, 2 * CY - y)
to_r = lambda x, y: ((x - X0) * R, (y - Y0) * R)     # map px -> raster
from_r = lambda i, j: (i / R + X0, j / R + Y0)        # raster -> map px

# ---------------------------------------------------------------- lanes
LANE_W = 20.0                 # map px, full width
BASE_A = tuple(places['allied_base']['position'])      # (66.9, 404.4)
BASE_B = rot(*BASE_A)
def toward_corner(p, d):
    ux, uy = p[0] - CX, p[1] - CY; n = math.hypot(ux, uy)
    return (p[0] + ux / n * d, p[1] + uy / n * d)
FOUNTAIN_A = toward_corner(BASE_A, 25.0)
FOUNTAIN_B = rot(*FOUNTAIN_A)

EDGE_L = 45.0                 # top lane runs up x = 45 then along y = 14
EDGE_T = 2 * CY - 430.0       # = 14; bottom lane along y = 430 then up x = 456
CORNER_R = 34.0
def arc(cx, cy, r, a0, a1, n=8):
    return [(cx + math.cos(a0 + (a1 - a0) * i / n) * r, cy + math.sin(a0 + (a1 - a0) * i / n) * r) for i in range(n + 1)]
TOP = [BASE_A, (EDGE_L, BASE_A[1] - 22), (EDGE_L, EDGE_T + CORNER_R)]
TOP += arc(EDGE_L + CORNER_R, EDGE_T + CORNER_R, CORNER_R, math.pi, 1.5 * math.pi)
TOP += [(BASE_B[0] - 22, EDGE_T), BASE_B]
MID = [BASE_A, (CX, CY), BASE_B]
BOT = [rot(*p) for p in reversed(TOP)]
LANES = {'top': TOP, 'mid': MID, 'bot': BOT}

def resample(pts, step=4.0):
    out = [pts[0]]
    for i in range(1, len(pts)):
        a, b = pts[i - 1], pts[i]
        d = math.hypot(b[0] - a[0], b[1] - a[1]); n = max(1, round(d / step))
        for k in range(1, n + 1): out.append((a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n))
    return out
LANE_PTS = {k: resample(v) for k, v in LANES.items()}

def proj_on_lane(lane, p):
    """closest point on a lane polyline and its arc-length fraction"""
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

# ---------------------------------------------------------------- turrets
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
RIVER_HALF = 15.0

def side_of_river(x, y):
    """negative = ally (bottom-left) half, positive = enemy half"""
    dx, dy = TURTLE[0] - LORD[0], TURTLE[1] - LORD[1]
    return (x - LORD[0]) * dy - (y - LORD[1]) * dx

# ---------------------------------------------------------------- raster helpers
def disk(r_px):
    k = int(round(r_px * R)) * 2 + 1
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
def fill_poly(mask, pts, val=1):
    cv2.fillPoly(mask, [np.array([to_r(*q) for q in pts], dtype=np.int32)], val)
def stroke(mask, pts, half_w, val=1):
    p = np.array([to_r(*q) for q in pts], dtype=np.int32)
    cv2.polylines(mask, [p], False, val, thickness=int(round(half_w * 2 * R)), lineType=cv2.LINE_8)
def circle(mask, c, r, val=1):
    cv2.circle(mask, tuple(int(round(v)) for v in to_r(*c)), int(round(r * R)), val, -1)
def symmetrise(mask):
    """the ally half is the surveyed one; the enemy half becomes its rotation"""
    yy, xx = np.mgrid[0:N, 0:N]
    mx, my = xx / R + X0, yy / R + Y0
    ally = side_of_river(mx, my) < 0
    rotm = mask[::-1, ::-1]
    out = np.where(ally, mask, rotm)
    # the river line itself: both must agree, so OR the two there
    line = np.abs(side_of_river(mx, my)) < 1.5 * math.hypot(TURTLE[0] - LORD[0], TURTLE[1] - LORD[1])
    out[line] = mask[line] | rotm[line]
    return out.astype(np.uint8)

# ---------------------------------------------------------------- walls
wall = np.zeros((N, N), np.uint8)
for reg in photo['regions']:
    if reg['kind'] != 'wall': continue
    one = np.zeros((N, N), np.uint8); fill_poly(one, reg['points']); wall ^= one   # even-odd
# carve the open ground the design guarantees
free_fixed = np.zeros((N, N), np.uint8)
for pts in LANES.values(): stroke(free_fixed, pts, LANE_W / 2 + 1.5)
stroke(free_fixed, RIVER, 9.0)
for c in (LORD, TURTLE): circle(free_fixed, c, PIT_R - 3)
for c in (BASE_A, BASE_B): circle(free_fixed, c, 30)
for c in (FOUNTAIN_A, FOUNTAIN_B): circle(free_fixed, c, 22)
for cp in CAMPS: circle(free_fixed, (cp['x'], cp['y']), 11 if cp['kind'] in ('blueBuff', 'redBuff') else 9)
for t in TOWERS: circle(free_fixed, (t['x'], t['y']), 9)
wall &= 1 - free_fixed
wall = symmetrise(wall)

def remove_small(mask, min_area_px2):
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    keep = np.zeros(n, bool); keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area_px2 * R * R
    return keep[lab].astype(np.uint8)

wall = remove_small(wall, 30)
wall = cv2.morphologyEx(wall, cv2.MORPH_CLOSE, disk(2.5))     # fuse near-touching rock
wall = cv2.morphologyEx(wall, cv2.MORPH_OPEN, disk(2.0))      # drop spurs and hairs
wall = (cv2.GaussianBlur(wall.astype(np.float32), (0, 0), 1.6 * R) > 0.5).astype(np.uint8)  # round the corners
wall = remove_small(wall, 45)
wall &= 1 - free_fixed
# fill unreachable free pockets inside rock, then guarantee corridor width
free = (1 - wall).astype(np.uint8)
n, lab, stats, _ = cv2.connectedComponentsWithStats(free, 4)
main = lab[tuple(int(v) for v in reversed(to_r(*BASE_A)))]
pocket = (lab != main) & (lab != 0)
for i in range(1, n):
    if i != main and stats[i, cv2.CC_STAT_AREA] < 400 * R * R: wall[lab == i] = 1
free = (1 - wall).astype(np.uint8)
MIN_CORRIDOR = 9.0
narrow = free & (1 - cv2.morphologyEx(free, cv2.MORPH_OPEN, disk(MIN_CORRIDOR / 2)))
wall &= 1 - cv2.dilate(narrow, disk(2.0))
wall = remove_small(wall, 45)
wall = symmetrise(wall)

# camps and pits get deliberate ring walls synthesised from the data's angular
# coverage, so carve their annuli out of the mask before skeletonising
wall_pre = wall.copy()
RING_ZONES = [((cp['x'], cp['y']), 11 if cp['kind'] in ('blueBuff', 'redBuff') else 9, 3.8) for cp in CAMPS if cp['kind'] not in ('crab', 'litho')]
RING_ZONES += [(LORD, PIT_R, 4.5), (TURTLE, PIT_R, 4.5)]
for c, clear, thick in RING_ZONES: circle(wall, c, clear + 16, 0)
wall = symmetrise(wall)

# ---------------------------------------------------------------- skeleton
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

skel = zhang_suen(wall)
dt = cv2.distanceTransform(wall, cv2.DIST_L2, 5) / R          # map px to the nearest free pixel

NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
RING = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]   # clockwise
def crossing(p, pts):
    """number of distinct branches meeting at p: 0->1 transitions around it.
    A raw neighbour count over-counts at staircase corners; this does not."""
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
            # staircase: a neighbour adjacent to another candidate is the same branch
            cand = [q for q in cand if not any(o != q and max(abs(o[0] - q[0]), abs(o[1] - q[1])) == 1 and
                                                 max(abs(o[0] - prev[0]), abs(o[1] - prev[1])) <= 1 for o in cand)] or cand
            if not cand: break
            nx_ = cand[0]
            for o in nbrs(cur):
                if o != prev and o != nx_ and max(abs(o[0] - nx_[0]), abs(o[1] - nx_[1])) == 1:
                    mark(cur, o); mark(o, nx_)          # skip the redundant diagonal
            mark(cur, nx_); chain.append(nx_); prev, cur = cur, nx_
            if cur == start: break
        return chain
    for p in pts:
        if deg[p] == 2: continue
        for q in nbrs(p):
            if (p, q) not in used: branches.append(walk(p, q))
    for p in pts:                                        # closed rings have no junctions
        if deg[p] == 2 and not any((p, q) in used for q in nbrs(p)):
            branches.append(walk(p, nbrs(p)[0]))
    return branches, deg

def prune(sk, min_len_px):
    branches, deg = trace_branches(sk)
    out = sk.copy(); removed = 0
    for br in branches:
        ends = (deg[br[0]] == 1) + (deg[br[-1]] == 1)
        if ends >= 1 and len(br) < min_len_px * R:
            for p in br[1:-1] if ends == 1 else br: out[p] = 0
            if deg[br[0]] == 1: out[br[0]] = 0
            if deg[br[-1]] == 1: out[br[-1]] = 0
            removed += 1
    return out, removed

skel, n1 = prune(skel, 4.0)
skel, n2 = prune(skel, 3.0)
branches, deg = trace_branches(skel)

WALLS = []
for br in branches:
    rs = np.array([dt[p] for p in br])
    if len(br) < 2: continue
    # split the branch where its thickness changes a lot
    rs_s = np.convolve(rs, np.ones(7) / 7, mode='same') if len(rs) >= 7 else rs
    runs, start = [], 0
    for i in range(1, len(br)):
        if abs(math.log(max(rs_s[i], 0.5) / max(np.median(rs_s[start:i]), 0.5))) > 0.35 and i - start >= 6 * R:
            runs.append((start, i)); start = i
    runs.append((start, len(br)))
    merged = []
    for a, b in runs:
        if merged and b - a < 4 * R: merged[-1] = (merged[-1][0], b)
        else: merged.append((a, b))
    for a, b in merged:
        seg = br[a:b + 1 if b < len(br) else b]
        if len(seg) < 2: continue
        r = float(np.median(rs[a:b]))
        if r < 1.4: continue
        arr = np.array([[p[1], p[0]] for p in seg], dtype=np.float32).reshape(-1, 1, 2)
        simp = cv2.approxPolyDP(arr, 1.4 * R, False).reshape(-1, 2)
        pts = [from_r(float(x), float(y)) for x, y in simp]
        length = sum(math.dist(pts[i - 1], pts[i]) for i in range(1, len(pts)))
        if length < 2.5 and r < 3: continue
        WALLS.append({'pts': [[round(x, 1), round(y, 1)] for x, y in pts], 'r': round(r, 1)})

def ring_arcs(mask, center, r_in, r_out):
    """angular runs where the surveyed rock sits in the annulus around a camp"""
    cx, cy = to_r(*center)
    cov = np.zeros(360, bool); rad = np.zeros(360)
    for ang in range(360):
        a = math.radians(ang); hits = []
        for rr in np.arange(r_in, r_out, 0.5):
            x = int(round(cx + math.cos(a) * rr * R)); y = int(round(cy + math.sin(a) * rr * R))
            if 0 <= x < N and 0 <= y < N and mask[y, x]: hits.append(rr)
        if len(hits) >= 4: cov[ang] = True; rad[ang] = float(np.mean(hits))
    # close gaps under 10 degrees, then keep runs of at least 24 degrees
    cov2 = cov.copy()
    for ang in range(360):
        if not cov[ang]:
            k = 1
            while k < 10 and not cov[(ang + k) % 360]: k += 1
            if k < 10 and cov[(ang - 1) % 360]: cov2[ang] = True
    runs, start = [], None
    order = list(range(360)) * 2
    seen = set()
    for i in order:
        if cov2[i] and start is None: start = i
        if not cov2[i] and start is not None:
            if start not in seen:
                runs.append((start, i)); seen.add(start)
            start = None
    if start is not None and not runs: runs.append((0, 360))
    arcs = []
    for a0, a1 in runs:
        span = (a1 - a0) % 360 or 360
        if span < 24: continue
        rs = [rad[i % 360] for i in range(a0, a0 + span) if cov[i % 360]]
        arcs.append((a0, a0 + span, float(np.median(rs)) if rs else r_in + 6))
    return arcs

for c, clear, thick in RING_ZONES:
    for a0, a1, rr in ring_arcs(wall_pre, c, clear + 1, clear + 15):
        rr = max(clear + thick + 1.5, rr)
        n = max(2, int((a1 - a0) / 8))
        pts = [(c[0] + math.cos(math.radians(a0 + (a1 - a0) * i / n)) * rr, c[1] + math.sin(math.radians(a0 + (a1 - a0) * i / n)) * rr) for i in range(n + 1)]
        WALLS.append({'pts': [[round(x, 1), round(y, 1)] for x, y in pts], 'r': thick, 'ring': True})

RADII = [2.5, 3.5, 5.0, 6.5, 8.0, 10.0, 12.0]
def lane_dist(p):
    return min(proj_on_lane(LANES[k], p)[0] and math.dist(p, proj_on_lane(LANES[k], p)[0]) for k in LANES)
cleaned = []
for w in WALLS:
    if w.get('ring'): cleaned.append(w); continue
    pts = w['pts']; r = min(RADII, key=lambda v: abs(v - w['r']))
    length = sum(math.dist(pts[i - 1], pts[i]) for i in range(1, len(pts)))
    if length < 5 and r < 4.5: continue                         # speck
    if length < 12 and all(lane_dist(p) < LANE_W / 2 + r + 4 for p in pts): continue   # lump on a lane edge
    if len(pts) > 6:                                              # keep ridges simple
        arr = np.array(pts, dtype=np.float32).reshape(-1, 1, 2)
        pts = [[round(float(x), 1), round(float(y), 1)] for x, y in cv2.approxPolyDP(arr, 2.4, False).reshape(-1, 2)]
    cleaned.append({'pts': pts, 'r': r})
WALLS = cleaned

# the corner outside the top lane's bend is rock (the bottom-right corner
# is its rotation); nothing walks there and it closes the board's silhouette
corner_c = (EDGE_L + CORNER_R, EDGE_T + CORNER_R)
corner_pts = [(corner_c[0] + math.cos(math.radians(a)) * (CORNER_R + 21), corner_c[1] + math.sin(math.radians(a)) * (CORNER_R + 21)) for a in range(176, 275, 12)]
WALLS.append({'pts': [[round(x, 1), round(y, 1)] for x, y in corner_pts], 'r': 8.0, 'ring': True})
WALLS.append({'pts': [[round(2 * CX - x, 1), round(2 * CY - y, 1)] for x, y in corner_pts], 'r': 8.0, 'ring': True})

# ---------------------------------------------------------------- bushes
bush = np.zeros((N, N), np.uint8)
for reg in photo['regions']:
    if reg['kind'] == 'bush': fill_poly(bush, reg['points'])
bush &= 1 - cv2.dilate(wall, disk(1.0))
lane_core = np.zeros((N, N), np.uint8)
for pts in LANES.values(): stroke(lane_core, pts, 5.0)
for c in (BASE_A, BASE_B): circle(lane_core, c, 34)
for c in (LORD, TURTLE): circle(lane_core, c, PIT_R)
for cp in CAMPS: circle(lane_core, (cp['x'], cp['y']), 12)
bush &= 1 - lane_core
bush = symmetrise(bush)
bush = remove_small(bush, 25)
bush = cv2.morphologyEx(bush, cv2.MORPH_CLOSE, disk(2.0))
bush = cv2.morphologyEx(bush, cv2.MORPH_OPEN, disk(2.5))
bush = remove_small(bush, 40)
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
    if L / max(Wd, 1) < 1.6:
        r = max(3.5, min(8.0, math.sqrt(area / math.pi)))
        BUSHES.append({'x': round(mean[0], 1), 'y': round(mean[1], 1), 'r': round(r, 1)})
    else:
        r = max(3.5, min(7.0, Wd / 2))
        h = max(0.0, L / 2 - r)
        a = mean + axis * (-h); b = mean + axis * h
        BUSHES.append({'x': round(mean[0], 1), 'y': round(mean[1], 1), 'r': round(r, 1),
                       'ax': round(a[0], 1), 'ay': round(a[1], 1), 'bx': round(b[0], 1), 'by': round(b[1], 1)})

# ---------------------------------------------------------------- reachability check
free = (1 - wall).astype(np.uint8)
n, lab, stats, _ = cv2.connectedComponentsWithStats(free, 4)
main = lab[tuple(int(v) for v in reversed(to_r(*BASE_A)))]
unreach = [cp['name'] for cp in CAMPS if lab[tuple(int(v) for v in reversed(to_r(cp['x'], cp['y'])))] != main]
unreachT = sum(1 for t in TOWERS if lab[tuple(int(v) for v in reversed(to_r(t['x'], t['y'])))] != main)

# ---------------------------------------------------------------- output
data = {
    'frame': {'cx': CX, 'cy': CY, 'half': HALF, 'unit': 'map px (Mobile Legends survey minimap crop)', 'heroSpeedPxPerSec': 22.5},
    'laneWidth': LANE_W, 'lanes': {k: [[round(x, 1), round(y, 1)] for x, y in v] for k, v in LANES.items()},
    'bases': [list(BASE_A), list(BASE_B)], 'fountains': [list(FOUNTAIN_A), list(FOUNTAIN_B)],
    'towers': [{**t, 'x': round(t['x'], 1), 'y': round(t['y'], 1), 'posFrac': round(t['posFrac'], 3)} for t in TOWERS],
    'camps': CAMPS, 'pits': {'lord': list(LORD), 'turtle': list(TURTLE), 'r': PIT_R},
    'river': [list(p) for p in RIVER], 'riverHalf': RIVER_HALF,
    'walls': WALLS, 'bushes': BUSHES,
}
js = "'use strict';\n/* Generated by docs/drafts/mlbb-clean.py — do not edit by hand. */\nconst MAP_DATA = " + json.dumps(data, separators=(',', ':')) + ";\n"
open('js/map-data.js', 'w').write(js)
json.dump(data, open('docs/drafts/draft-c.json', 'w'))
print(f'walls {len(WALLS)} (segments {sum(len(w["pts"]) - 1 for w in WALLS)}), bushes {len(BUSHES)} '
      f'(capsules {sum(1 for b in BUSHES if "ax" in b)}), camps {len(CAMPS)}, towers {len(TOWERS)}, pruned spurs {n1 + n2}')
print('wall area px2', int(wall.sum() / (R * R)), '| unreachable camps:', unreach or 'none', '| unreachable towers:', unreachT)

# ---------------------------------------------------------------- blockout
S = 3.0; PAD = 24
img = Image.new('RGB', (int(SIDE * S) + PAD * 2, int(SIDE * S) + PAD * 2), (24, 24, 24))
dr = ImageDraw.Draw(img, 'RGBA')
Pm = lambda x, y: ((x - X0) * S + PAD, (y - Y0) * S + PAD)
dr.line([Pm(*p) for p in RIVER], fill=(38, 62, 70), width=int(RIVER_HALF * 2 * S))
for c in (LORD, TURTLE):
    x, y = Pm(*c); rr = PIT_R * S; dr.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(40, 44, 51))
for pts in LANES.values():
    dr.line([Pm(*p) for p in pts], fill=(71, 71, 71), width=int(LANE_W * S), joint='curve')
    for p in (pts[0], pts[-1]): x, y = Pm(*p); rr = LANE_W * S / 2; dr.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(71, 71, 71))
TEAM = [(221, 157, 98), (151, 210, 145)]
for t in TOWERS:
    x, y = Pm(t['x'], t['y']); rr = 30 * S; col = TEAM[t['team']]
    dr.ellipse([x - rr, y - rr, x + rr, y + rr], fill=col + (24,))
    for k in range(0, 40, 2): dr.arc([x - rr, y - rr, x + rr, y + rr], k * 9, (k + 1) * 9, fill=col + (200,), width=2)
for w in WALLS:
    pl = [Pm(*p) for p in w['pts']]; wd = max(2, int(w['r'] * 2 * S))
    if len(pl) >= 2: dr.line(pl, fill=(143, 143, 143), width=wd, joint='curve')
    for p in pl: dr.ellipse([p[0] - wd / 2, p[1] - wd / 2, p[0] + wd / 2, p[1] + wd / 2], fill=(143, 143, 143))
for b in BUSHES:
    rr = b['r'] * S
    if 'ax' in b:
        a, c = Pm(b['ax'], b['ay']), Pm(b['bx'], b['by'])
        dr.line([a, c], fill=(48, 66, 48), width=int(rr * 2))
        for p in (a, c): dr.ellipse([p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr], fill=(48, 66, 48))
    else:
        x, y = Pm(b['x'], b['y']); dr.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(48, 66, 48))
for cp in CAMPS:
    big = cp['kind'] in ('blueBuff', 'redBuff'); x, y = Pm(cp['x'], cp['y']); rr = (11 if big else 8) * S
    dr.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(40, 44, 51))
    for k in range(0, 30, 2): dr.arc([x - rr, y - rr, x + rr, y + rr], k * 12, (k + 1) * 12, fill=(110, 120, 150), width=2)
    if big: dr.ellipse([x - 4 * S, y - 4 * S, x + 4 * S, y + 4 * S], fill=(110, 160, 255) if cp['kind'] == 'blueBuff' else (255, 150, 80))
for t in TOWERS:
    x, y = Pm(t['x'], t['y']); dr.rectangle([x - 9, y - 9, x + 9, y + 9], fill=TEAM[t['team']], outline=(24, 24, 24), width=2)
for i, (b, f) in enumerate([(BASE_A, FOUNTAIN_A), (BASE_B, FOUNTAIN_B)]):
    x, y = Pm(*b); rr = 11 * S; dr.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(68, 54, 41) if i == 0 else (52, 65, 51), outline=TEAM[i], width=3)
    x, y = Pm(*f); dr.ellipse([x - 6, y - 6, x + 6, y + 6], outline=TEAM[i], width=2)
try: font = ImageFont.truetype('segoeuib.ttf', 20)
except Exception: font = ImageFont.load_default()
for text, p in [('TOP', (CX, EDGE_T - 9)), ('BOTTOM', (CX, 2 * CY - EDGE_T + 9)), ('MID', (CX, CY - 8)), ('Lord', (LORD[0], LORD[1] - 32)), ('Turtle', (TURTLE[0], TURTLE[1] + 32)), ('A', BASE_A), ('B', BASE_B)]:
    dr.text(Pm(*p), text, fill=(238, 238, 238), font=font, anchor='mm')
img.save('docs/drafts/draft-c.png'); print('wrote docs/drafts/draft-c.png', img.size)
