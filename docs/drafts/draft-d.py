"""Draft D: the 5v5 map rebuilt from the reference minimap.

Walls and bushes come from the 512 px top-down minimap of the Land of Dawn
(dataset/world/reference/Minimap.png), aligned onto the survey's map-px
frame by docs/drafts/ref-align.py (-> minimap_layers.npz). Lanes, turrets,
camps and pits keep the survey's measured positions; the lane geometry
(width 38, edge roads at x = 51 / y = 24, chamfered corners, river channel
half-width 10 with a pond of radius 30 at the mid crossing) was measured on
the aligned minimap.

Walls and bushes are exact polygons: the outline of each blob in the aligned
layer, traced at 2 raster px per map px and simplified by a third of a map
px, so the shapes are the reference's shapes. The two cut-off corners beyond
the lane chamfers are void: nothing is drawn there and a hidden polygon
keeps units out. The board is exactly point-symmetric.

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
def fill_poly(mask, pts, val=1):
    cv2.fillPoly(mask, [np.array([to_r(*q) for q in pts], dtype=np.int32)], val)
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
def polygons(mask, eps_raster_px, min_area_px2):
    """outlines of every blob, in map px, simplified; holes are filled"""
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cnts:
        if cv2.contourArea(c) < min_area_px2 * R * R: continue
        simp = cv2.approxPolyDP(c, eps_raster_px, True).reshape(-1, 2)
        if len(simp) < 3: continue
        one = np.zeros((N, N), np.uint8); cv2.drawContours(one, [c], -1, 1, -1)
        d = cv2.distanceTransform(one, cv2.DIST_L2, 5)
        m = cv2.moments(c)
        cxr, cyr = m['m10'] / m['m00'], m['m01'] / m['m00']
        out.append({'poly': [[round(x, 1), round(y, 1)] for x, y in (from_r(float(px), float(py)) for px, py in simp)],
                    'x': round(from_r(cxr, cyr)[0], 1), 'y': round(from_r(cxr, cyr)[1], 1),
                    'r': round(float(d.max()) / R, 1), 'area': round(cv2.contourArea(c) / (R * R), 1)})
    return out

# ---------------------------------------------------------------- corners: void beyond the chamfers
_u = np.array([CHAMFER_B[0] - CHAMFER_A[0], CHAMFER_B[1] - CHAMFER_A[1]]); _u /= np.linalg.norm(_u)
_n = np.array([-_u[1], _u[0]])
if np.dot(_n, [CX - CHAMFER_A[0], CY - CHAMFER_A[1]]) > 0: _n = -_n          # outward = away from the centre
_p0 = np.array(CHAMFER_A) + _n * (LANE_W / 2 + 1.0)                            # just past the lane band's outer edge
_t_left = (X0 - _p0[0]) / _u[0]; _t_top = (Y0 - _p0[1]) / _u[1]
VOID_A = [(X0 - 40, Y0 - 40), (float(_p0[0] + _u[0] * _t_top), Y0 - 40), (float(_p0[0] + _u[0] * _t_top), Y0),
          (X0, float(_p0[1] + _u[1] * _t_left)), (X0 - 40, float(_p0[1] + _u[1] * _t_left))]
VOID_B = [rot(*p) for p in VOID_A]
corner_zone = np.zeros((N, N), np.uint8)          # only the void itself (plus 2 px), nothing inside the board
for v in (VOID_A, VOID_B): fill_poly(corner_zone, v)
corner_zone = cv2.dilate(corner_zone, disk(2.0))

# ---------------------------------------------------------------- walls (minimap layer)
wall = LAY['wall'].astype(np.uint8).copy()
wall = symmetrise(wall)
wall &= 1 - corner_zone
free_fixed = np.zeros((N, N), np.uint8)          # the picture already keeps lanes and turret pads clear; only guarantee the plazas and camp floors
for c in (BASE_A, BASE_B): circle(free_fixed, c, 30)
for c in (FOUNTAIN_A, FOUNTAIN_B): circle(free_fixed, c, 22)
for cp in CAMPS: circle(free_fixed, (cp['x'], cp['y']), 6 if cp['kind'] in ('blueBuff', 'redBuff') else 5)
wall &= 1 - free_fixed
wall = remove_small(wall, 12)
# unreachable pockets become rock; every corridor gets at least MIN_CORRIDOR
free = (1 - wall).astype(np.uint8)
n, lab, stats, _ = cv2.connectedComponentsWithStats(free, 4)
main = lab[tuple(int(v) for v in reversed(to_r(*BASE_A)))]
for i in range(1, n):
    if i != main and stats[i, cv2.CC_STAT_AREA] < 400 * R * R: wall[lab == i] = 1
free = (1 - wall).astype(np.uint8)
MIN_CORRIDOR = 5.5
narrow = free & (1 - cv2.morphologyEx(free, cv2.MORPH_OPEN, disk(MIN_CORRIDOR / 2)))
wall &= 1 - cv2.dilate(narrow, disk(1.0))
wall = remove_small(wall, 12)
wall = symmetrise(wall)
wall_src = wall.copy()

WALLS = [{'poly': w['poly'], 'r': w['r'], 'x': w['x'], 'y': w['y']} for w in polygons(wall, 0.7, 12)]
for v in (VOID_A, VOID_B):
    WALLS.append({'poly': [[round(x, 1), round(y, 1)] for x, y in v], 'r': 20.0, 'hidden': True})

# ---------------------------------------------------------------- what the engine will see
built = np.zeros((N, N), np.uint8)
for w in WALLS:
    if not w.get('hidden'): fill_poly(built, w['poly'])
_in = 1 - corner_zone
fidelity = ((built & wall_src) & _in).sum() / max(((built | wall_src) & _in).sum(), 1)

# ---------------------------------------------------------------- bushes (minimap layer)
bush = LAY['bush'].astype(np.uint8).copy()
bush = symmetrise(bush)
bush &= 1 - corner_zone
bush &= 1 - cv2.dilate(built, disk(0.5))
for c in (BASE_A, BASE_B): circle(bush, c, 30, 0)
bush = remove_small(bush, 25)
bush = symmetrise(bush)
BUSHES = [{'poly': b['poly'], 'x': b['x'], 'y': b['y'], 'r': round(max(3.0, math.sqrt(b['area'] / math.pi)), 1)} for b in polygons(bush, 0.7, 25)]

# ---------------------------------------------------------------- measured corrections (phone survey)
# walls_measured.json: per-rock translation fitted from wall-contact marks (mlbb_survey.reconcile);
# bushes_measured.json: bush polygons from the in-bush icon walk (mlbb_survey.bushfit).
# Rocks are paired with their 180-degree partners so both halves share the evidence.
MEAS_W, MEAS_B = REF + 'walls_measured.json', REF + 'bushes_measured.json'
MEASURED = {'rocks_shifted': 0, 'bushes_added': 0, 'bushes_shifted': 0}
def _rot_poly(poly): return [[round(2 * CX - x, 1), round(2 * CY - y, 1)] for x, y in poly]
def _shift_poly(poly, dx, dy): return [[round(x + dx, 1), round(y + dy, 1)] for x, y in poly]
def _centroid(poly):
    m = cv2.moments(np.array(poly, np.float32).reshape(-1, 1, 2)); return (m['m10'] / m['m00'], m['m01'] / m['m00'])
if os.path.exists(MEAS_W):
    mw = json.load(open(MEAS_W))
    per = {r['rock']: r for r in mw['rocks'] if 'shift' in r and r['n'] >= 25 and r['rms_after'] <= 3.0}
    vis = [i for i, w in enumerate(WALLS) if not w.get('hidden')]
    cents = {i: _centroid(WALLS[i]['poly']) for i in vis}
    done = set()
    for i in vis:
        if i in done: continue
        cx_, cy_ = cents[i]; rx, ry = 2 * CX - cx_, 2 * CY - cy_
        j = min(vis, key=lambda k: (cents[k][0] - rx) ** 2 + (cents[k][1] - ry) ** 2)
        a_, b_ = per.get(i), per.get(j if j != i else -1)
        if a_ is None and b_ is None: done.update({i, j}); continue
        # a shift measured on the partner appears rotated on this rock
        if a_ and b_:
            wa, wb = a_['n'], b_['n']
            dx = (a_['shift'][0] * wa - b_['shift'][0] * wb) / (wa + wb); dy = (a_['shift'][1] * wa - b_['shift'][1] * wb) / (wa + wb)
        elif a_: dx, dy = a_['shift']
        else: dx, dy = -b_['shift'][0], -b_['shift'][1]
        WALLS[i]['poly'] = _shift_poly(WALLS[i]['poly'], dx, dy); MEASURED['rocks_shifted'] += 1
        if j != i: WALLS[j]['poly'] = _shift_poly(WALLS[j]['poly'], -dx, -dy); MEASURED['rocks_shifted'] += 1
        done.update({i, j})
    built[:] = 0
    for w in WALLS:
        if not w.get('hidden'): fill_poly(built, w['poly'])
if os.path.exists(MEAS_B):
    mb = json.load(open(MEAS_B))
    def _mask(poly):
        m_ = np.zeros((N, N), np.uint8); fill_poly(m_, poly); return m_
    measured = []
    for b in mb['bushes']:
        measured.append(b['poly']); measured.append(_rot_poly(b['poly']))     # both halves
    for poly in measured:
        mm = _mask(poly)
        best, bi = 0.0, None
        for k, b in enumerate(BUSHES):
            bm = _mask(b['poly']); inter = (mm & bm).sum(); uni = (mm | bm).sum()
            if uni and inter / uni > best: best, bi = inter / uni, k
        if bi is not None and best >= 0.25:
            # the minimap shape is cleaner; move it onto the measured position
            mx_, my_ = _centroid(poly); bx_, by_ = _centroid(BUSHES[bi]['poly'])
            dx, dy = mx_ - bx_, my_ - by_
            if abs(dx) + abs(dy) > 0.6:
                BUSHES[bi]['poly'] = _shift_poly(BUSHES[bi]['poly'], dx, dy); BUSHES[bi]['x'] = round(BUSHES[bi]['x'] + dx, 1); BUSHES[bi]['y'] = round(BUSHES[bi]['y'] + dy, 1)
                MEASURED['bushes_shifted'] += 1
        elif (mm & (1 - built)).sum() >= 12 * R * R:
            # a bush no minimap draws (lane bushes): take the measured outline, clipped to free ground
            cnts, _ = cv2.findContours(mm & (1 - built), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            c = max(cnts, key=cv2.contourArea); simp = cv2.approxPolyDP(c, 1.0, True).reshape(-1, 2)
            if len(simp) >= 3:
                pts = [[round(x, 1), round(y, 1)] for x, y in (from_r(float(px), float(py)) for px, py in simp)]
                cx_, cy_ = _centroid(pts)
                BUSHES.append({'poly': pts, 'x': round(cx_, 1), 'y': round(cy_, 1), 'r': round(max(3.0, math.sqrt(cv2.contourArea(c) / (R * R) / math.pi)), 1), 'measured': True})
                MEASURED['bushes_added'] += 1
print('measured corrections:', MEASURED)

# ---------------------------------------------------------------- reachability
free = (1 - built).astype(np.uint8)
for v in (VOID_A, VOID_B): fill_poly(free, v, 0)
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
    'void': [[[round(x, 1), round(y, 1)] for x, y in VOID_A], [[round(x, 1), round(y, 1)] for x, y in VOID_B]],
}
js = "'use strict';\n/* Generated by docs/drafts/draft-d.py - do not edit by hand. */\nconst MAP_DATA = " + json.dumps(data, separators=(',', ':')) + ";\n"
open('js/map-data.js', 'w', encoding='utf-8', newline='\n').write(js)
json.dump(data, open('docs/drafts/draft-d.json', 'w', encoding='utf-8'))
print(f'walls {sum(1 for w in WALLS if not w.get("hidden"))} polygons ({sum(len(w["poly"]) for w in WALLS)} vertices), '
      f'bushes {len(BUSHES)} polygons, camps {len(CAMPS)}, towers {len(TOWERS)}')
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
    if w.get('hidden'): continue
    dr.polygon([Pm(*p) for p in w['poly']], fill=(143, 143, 143))
for b in BUSHES:
    dr.polygon([Pm(*p) for p in b['poly']], fill=(48, 66, 48), outline=(90, 150, 90))
for v in (VOID_A, VOID_B):
    dr.polygon([Pm(*p) for p in v], fill=(24, 24, 24))
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
dr.text((PAD, img.size[1] - 14), 'Draft D: walls and bushes traced as exact polygons from the reference minimap; lanes measured on it; turrets, camps and pits from the survey.', fill=(150, 150, 150), font=small, anchor='lm')
img.save('docs/drafts/draft-d.png'); print('wrote docs/drafts/draft-d.png', img.size)
