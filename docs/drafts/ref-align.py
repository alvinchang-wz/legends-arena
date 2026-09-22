"""Align the wiki minimap (dataset/world/reference/Minimap.png) to the survey's
map-px frame and compare its wall layer with the survey's classified walls.
Writes dataset/world/reference/minimap_layers.npz (wall/bush/river masks in the
survey frame at 2 px per map px) and an overlay for inspection."""
import json, math, sys
import numpy as np, cv2
from PIL import Image


def minimize(f, x0, method=None, options=None):
    """minimal Nelder-Mead (numpy only)"""
    x0 = np.asarray(x0, float); n = len(x0)
    simplex = [x0] + [x0 + np.eye(n)[i] * (0.01 if i < 2 else 2.0) for i in range(n)]
    vals = [f(x) for x in simplex]
    for _ in range(options.get('maxiter', 300)):
        order = np.argsort(vals); simplex = [simplex[i] for i in order]; vals = [vals[i] for i in order]
        if abs(vals[-1] - vals[0]) < options.get('fatol', 1e-5): break
        c = np.mean(simplex[:-1], 0)
        xr = c + (c - simplex[-1]); fr = f(xr)
        if fr < vals[0]:
            xe = c + 2 * (c - simplex[-1]); fe = f(xe)
            simplex[-1], vals[-1] = (xe, fe) if fe < fr else (xr, fr)
        elif fr < vals[-2]:
            simplex[-1], vals[-1] = xr, fr
        else:
            xc = c + 0.5 * (simplex[-1] - c); fc = f(xc)
            if fc < vals[-1]: simplex[-1], vals[-1] = xc, fc
            else:
                simplex = [simplex[0]] + [simplex[0] + 0.5 * (x - simplex[0]) for x in simplex[1:]]
                vals = [vals[0]] + [f(x) for x in simplex[1:]]
    i = int(np.argmin(vals))
    class Res: pass
    r = Res(); r.x = simplex[i]; r.fun = vals[i]; return r

REF = 'dataset/world/reference/'
H = 'dataset/world/handoff/'
labels = json.load(open(H + 'labels.json')); photo = json.load(open(H + 'map_photo.json'))
places = {p['id']: p for p in labels['places']}
CX, CY = labels['symmetry_center']; HALF = 218.0; X0, Y0 = CX - HALF, CY - HALF; R = 2; N = int(2 * HALF * R)
to_r = lambda x, y: ((x - X0) * R, (y - Y0) * R)

im = np.array(Image.open(REF + 'Minimap.png').convert('RGB')).astype(np.int16)
lab = np.load(REF + 'minimap_labels.npy'); cen = np.load(REF + 'minimap_centers.npy')
# layers by cluster (see minimap_clusters.png): 2 = wall blobs, 8 = outer border,
# 4/6 = river, 3/7/0 = lanes, base ring, bushes, glyphs
wall_m = (lab == 2).astype(np.uint8)
dark = (lab == 8).astype(np.uint8)                      # border + the drop shadows under every rock
corner = np.zeros_like(dark); h_, w_ = dark.shape
cv2.fillPoly(corner, [np.array([[0, 0], [150, 0], [0, 150]], np.int32)], 1)
cv2.fillPoly(corner, [np.array([[w_, h_], [w_ - 150, h_], [w_, h_ - 150]], np.int32)], 1)
wall_m |= dark & corner
river_m = ((lab == 4) | (lab == 6)).astype(np.uint8)
light_m = ((lab == 3) | (lab == 7) | (lab == 0)).astype(np.uint8)
# lanes + ring road = big light component touching the border; bushes = the rest, opened
n, cl, st, _ = cv2.connectedComponentsWithStats(light_m, 8)
big = np.zeros(n, bool)
for i in range(1, n):
    x, y, w, h, a = st[i]
    big[i] = a > 4000
lane_m = big[cl].astype(np.uint8)
bush_m = light_m & (1 - lane_m)
# bushes that touch a lane were swallowed by the lane component: they are the
# small protrusions left when the band is opened with a lane-wide disc
core = cv2.morphologyEx(lane_m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (35, 35)))
prot = lane_m & (1 - core)
prot = cv2.morphologyEx(prot, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
np_, cp_, sp_, _ = cv2.connectedComponentsWithStats(prot, 8)
for i in range(1, np_):
    if 40 <= sp_[i, cv2.CC_STAT_AREA] <= 400: bush_m[cp_ == i] = 1        # the big arcs are the base rims
lane_m = lane_m & (1 - bush_m)
bush_m = cv2.morphologyEx(bush_m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
bush_m = cv2.morphologyEx(bush_m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
# pits: the two large river discs -> distance-transform peaks
pit_src = (lab == 4).astype(np.uint8); pit_src[:, :40] = 0; pit_src[:, -40:] = 0; pit_src[:40] = 0; pit_src[-40:] = 0
dt = cv2.distanceTransform(cv2.morphologyEx(pit_src, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))), cv2.DIST_L2, 5)
pk = []
d = dt.copy()
for _ in range(2):
    j, i = np.unravel_index(np.argmax(d), d.shape); pk.append((i, j, d[j, i])); cv2.circle(d, (int(i), int(j)), 60, 0, -1)
pk.sort(key=lambda p: p[0])
print('minimap pits (px, r):', [(int(p[0]), int(p[1]), round(float(p[2]), 1)) for p in pk])
LORD = places['lord']['position']; TURTLE = places['turtle']['position']
print('survey pits:', LORD, TURTLE, 'r', labels['river_pits']['radius'])

# survey wall raster (map px frame, R px per map px)
sw = np.zeros((N, N), np.uint8)
for reg in photo['regions']:
    if reg['kind'] != 'wall': continue
    one = np.zeros((N, N), np.uint8)
    cv2.fillPoly(one, [np.array([to_r(*q) for q in reg['points']], dtype=np.int32)], 1); sw ^= one

def warp(mask, sx, sy, tx, ty):
    """minimap px -> raster px: X = (sx*x + tx - X0)*R"""
    M = np.array([[sx * R, 0, (tx - X0) * R], [0, sy * R, (ty - Y0) * R]], np.float32)
    return cv2.warpAffine(mask.astype(np.float32), M, (N, N), flags=cv2.INTER_LINEAR)

# the minimap's own point-symmetry centre (walls, inner region)
Wi = wall_m.copy(); Wi[:60] = 0; Wi[-60:] = 0; Wi[:, :60] = 0; Wi[:, -60:] = 0
bestc = None
for cx_ in np.arange(250, 262, 0.5):
    for cy_ in np.arange(250, 262, 0.5):
        Mrot = np.array([[-1, 0, 2 * cx_], [0, -1, 2 * cy_]], np.float32)
        rr_ = cv2.warpAffine(Wi, Mrot, Wi.shape[::-1], flags=cv2.INTER_NEAREST)
        iou_ = (rr_ & Wi).sum() / max((rr_ | Wi).sum(), 1)
        if bestc is None or iou_ > bestc[0]: bestc = (iou_, cx_, cy_)
MCX, MCY = bestc[1], bestc[2]
print('minimap symmetry centre (%.1f, %.1f), self IoU %.3f' % (MCX, MCY, bestc[0]))
inner = np.zeros((N, N), np.uint8); cv2.rectangle(inner, (int(30 * R), int(30 * R)), (int((2 * HALF - 30) * R), int((2 * HALF - 30) * R)), 1, -1)
sw_in = sw * inner
def params(sx_, sy_):
    """scales only: the minimap centre lands on the survey centre"""
    return [sx_, sy_, CX - sx_ * MCX, CY - sy_ * MCY]
def loss(p):
    w = warp(wall_m, *p) > 0.5
    w = w & (inner > 0)
    inter = (w & (sw_in > 0)).sum(); uni = (w | (sw_in > 0)).sum()
    return -inter / max(uni, 1)
grid = []
for sx_ in np.arange(0.88, 0.98, 0.01):
    for sy_ in np.arange(0.88, 0.98, 0.01):
        grid.append((loss(params(sx_, sy_)), sx_, sy_))
grid.sort(); print('best grid cells:', [(round(-g[0], 3), round(g[1], 3), round(g[2], 3)) for g in grid[:3]])
best = None
for _, sx_, sy_ in grid[:3]:
    r = minimize(lambda q: loss(params(*q)), [sx_, sy_], method='Nelder-Mead', options={'xatol': 0.001, 'fatol': 1e-4, 'maxiter': 200})
    if best is None or r.fun < best.fun: best = r
best.x = params(*best.x)
sx, sy, tx, ty = best.x
print('refined: sx=%.4f sy=%.4f tx=%.2f ty=%.2f  wall IoU=%.3f' % (sx, sy, tx, ty, -best.fun))
W = warp(wall_m, sx, sy, tx, ty) > 0.5; B = warp(bush_m, sx, sy, tx, ty) > 0.5;
RV = warp(river_m, sx, sy, tx, ty) > 0.5; LN = warp(lane_m, sx, sy, tx, ty) > 0.5
# rock must agree with its own rotation (cancels the one-sided drop shadows); bushes take the union
W = W & W[::-1, ::-1]; B = B | B[::-1, ::-1]
np.savez_compressed(REF + 'minimap_layers.npz', wall=W.astype(np.uint8), bush=B.astype(np.uint8), river=RV.astype(np.uint8), lane=LN.astype(np.uint8),
                    transform=np.array([sx, sy, tx, ty]), frame=np.array([X0, Y0, R, N]))
# symmetry check of the aligned wall layer around the survey centre
rotW = W[::-1, ::-1]
print('aligned wall self-symmetry IoU: %.3f' % ((W & rotW).sum() / max((W | rotW).sum(), 1)))
# overlay: survey walls red, minimap walls green, both yellow; bushes cyan dots; camps/turrets/pits marked
ov = np.zeros((N, N, 3), np.uint8); ov[...] = 28
ov[sw > 0] = (170, 60, 60); ov[W] = (60, 170, 60); ov[(sw > 0) & W] = (220, 220, 80)
ov[B & ~W] = (60, 160, 190)
for p in labels['places']:
    if p['kind'] in ('turret', 'camp_buff', 'camp', 'neutral_camp', 'base') or p['id'] in ('lord', 'turtle'):
        c = tuple(int(round(v)) for v in to_r(*p['position'])); r = {'turret': 4, 'base': 10}.get(p['kind'], 6)
        cv2.circle(ov, c, r * R, (255, 255, 255), 2)
Image.fromarray(ov).save(REF + 'align_overlay.png'); print('wrote', REF + 'align_overlay.png')
