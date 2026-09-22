"""Pixel-exact outlines of rock and bush from the reference minimap.

Runs in the picture's own 512 px grid. For every pixel a 'wallness' (and a
'bushness') is the position of its colour between the jungle-ground colour and
the rock (bush) colour, 0..1, so the anti-aliased edge pixels of the picture
carry the sub-pixel edge the artist drew. The 0.5 iso-line of that field,
traced at 4x, is the outline. The picture's own drop shadow (bottom-right of
every rock, not part of the rock) is cancelled by taking the minimum of the
field and its 180-degree rotation about the picture's symmetry centre; that
also makes the result exactly point-symmetric.

Nothing else touches the shapes: no morphology, no speck removal, no corridor
widening, no carving. The only edit is the two void corners of the board.

Check: the outlines are rasterised back into the picture grid and compared
pixel by pixel with the hard mask (field > 0.5); mismatches are counted and
drawn. Output: dataset/world/reference/exact_polys.json (survey map px).

    python docs/drafts/exact-trace.py            (from legends-arena/)
"""
import json, math
import numpy as np, cv2
from PIL import Image

REF = '../dataset/world/reference/'
im = np.array(Image.open(REF + 'Minimap.png').convert('RGB')).astype(np.float32)
H, W = im.shape[:2]
lab = np.load(REF + 'minimap_labels.npy'); cen = np.load(REF + 'minimap_centers.npy')
L = np.load(REF + 'minimap_layers.npz'); sx, sy, tx, ty = [float(v) for v in L['transform']]
CX, CY = 250.5, 222.0                                  # survey symmetry centre
MCX, MCY = (CX - tx) / sx, (CY - ty) / sy              # ... in picture px (the alignment pinned them together)
print('picture centre (%.2f, %.2f)  transform survey = %.4f*x + %.2f, %.4f*y + %.2f' % (MCX, MCY, sx, tx, sy, ty))

# ---------------------------------------------------------------- colour axes
GROUND, ROCK, BUSH, LANE = cen[1], cen[2], cen[7], cen[3]      # clusters from minimap_clusters.png
def field(a, b):
    """0 at colour a, 1 at colour b, projected along the a->b axis, clipped"""
    d = b - a; t = ((im - a) @ d) / float(d @ d)
    return np.clip(t, 0, 1).astype(np.float32)
rockness = field(GROUND, ROCK)
bushness = field(GROUND, BUSH)
# the lane band, base rings and river are not bush: mask them out of the bush field
light = ((lab == 3) | (lab == 7) | (lab == 0)).astype(np.uint8)
n, cl, st, _ = cv2.connectedComponentsWithStats(light, 8)
big = np.zeros(n, bool); big[1:] = st[1:, cv2.CC_STAT_AREA] > 4000
laneband = cv2.dilate(big[cl].astype(np.uint8), np.ones((3, 3), np.uint8))
river = ((lab == 4) | (lab == 6)).astype(np.uint8)
bushness[(laneband > 0) | (river > 0)] = 0
# glyph lines (the bright arrows on the lanes) are cluster 0, never bush
bushness[lab == 0] = 0

# ---------------------------------------------------------------- rotate about the picture centre, take the consensus
def rot_field(f):
    M = np.array([[-1, 0, 2 * MCX], [0, -1, 2 * MCY]], np.float32)
    return cv2.warpAffine(f, M, (W, H), flags=cv2.INTER_LINEAR, borderValue=0)
rock_s = np.minimum(rockness, rot_field(rockness))
bush_s = np.maximum(bushness, rot_field(bushness))     # bushes carry no shadow; union keeps both halves
# the void corners (survey px -> picture px)
def to_pic(pts): return [((x - tx) / sx, (y - ty) / sy) for x, y in pts]
VOID = json.load(open('docs/drafts/draft-d.json'))['void']
void = np.zeros((H, W), np.uint8)
for v in VOID: cv2.fillPoly(void, [np.array(to_pic(v), np.float32).round().astype(np.int32)], 1)
void = cv2.dilate(void, np.ones((3, 3), np.uint8))
rock_s[void > 0] = 0; bush_s[void > 0] = 0
# outside the board (the HUD frame around the octagon) is not rock either
board = np.zeros((H, W), np.uint8)
inner_dark = (lab == 8).astype(np.uint8)                # the octagon border
rock_s[inner_dark > 0] = 0

# ---------------------------------------------------------------- trace the 0.5 iso-line at 4x
UP = 4
def trace(f, min_area):
    big_ = cv2.resize(f, (W * UP, H * UP), interpolation=cv2.INTER_CUBIC)
    hi = (big_ > 0.5).astype(np.uint8)
    cnts, hier = cv2.findContours(hi, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    for i, c in enumerate(cnts):
        if hier[0][i][3] != -1: continue                 # holes: an enclosed pocket is not walkable anyway
        if cv2.contourArea(c) < min_area * UP * UP: continue
        # lossless-ish simplification: 0.15 picture px
        simp = cv2.approxPolyDP(c, 0.15 * UP, True).reshape(-1, 2).astype(np.float64)
        if len(simp) < 3: continue
        pts = (simp + 0.5) / UP - 0.5                    # 4x pixel centres -> picture coordinates (pixel index = pixel centre, as OpenCV's warp/resize use)
        out.append(pts)
    return out
# a symmetric half-pixel blur removes single-pixel jaggies of the anti-aliasing
# without moving an edge (the 0.5 iso-line of a blurred straight edge stays put)
rock_s = cv2.GaussianBlur(rock_s, (0, 0), 0.6)
bush_s = cv2.GaussianBlur(bush_s, (0, 0), 0.7)
rock_polys = trace(rock_s, 3.0)
bush_polys = trace(bush_s, 6.0)
print('rocks %d (%d vertices), bushes %d (%d vertices)' % (len(rock_polys), sum(len(p) for p in rock_polys), len(bush_polys), sum(len(p) for p in bush_polys)))

# ---------------------------------------------------------------- pixel-by-pixel check in the picture grid
def raster(polys, up=UP):
    m = np.zeros((H * up, W * up), np.uint8)
    for p in polys: cv2.fillPoly(m, [(((p + 0.5) * up) - 0.5).round().astype(np.int32)], 1)
    return cv2.resize(m.astype(np.float32), (W, H), interpolation=cv2.INTER_AREA) > 0.5
for name, polys, f in (('rock', rock_polys, rock_s), ('bush', bush_polys, bush_s)):
    hard = f > 0.5
    back = raster(polys)
    mism = hard ^ back
    print('%s: picture pixels %d, outline pixels %d, mismatched pixels %d (%.2f%%)' % (name, hard.sum(), back.sum(), mism.sum(), 100 * mism.sum() / max(hard.sum(), 1)))
    vis = (im * 0.45).astype(np.uint8)
    vis[hard & back] = (150, 150, 150) if name == 'rock' else (110, 190, 110)
    vis[hard & ~back] = (255, 60, 60); vis[~hard & back] = (60, 120, 255)
    Image.fromarray(vis).resize((W * 2, H * 2), Image.NEAREST).save(REF + 'exact_check_%s.png' % name)

# ---------------------------------------------------------------- to survey map px
to_map = lambda p: [[round(float(x * sx + tx), 2), round(float(y * sy + ty), 2)] for x, y in p]
def stats(p):
    q = np.array(p, np.float32); m = cv2.moments(q.reshape(-1, 1, 2)); one = np.zeros((H * UP, W * UP), np.uint8)
    cv2.fillPoly(one, [(((q + 0.5) * UP) - 0.5).round().astype(np.int32)], 1); d = cv2.distanceTransform(one, cv2.DIST_L2, 5)
    return m['m10'] / m['m00'], m['m01'] / m['m00'], float(d.max()) / UP, cv2.contourArea(q)
walls, bushes = [], []
for p in rock_polys:
    cx_, cy_, r_, a_ = stats(p)
    walls.append({'poly': to_map(p), 'x': round(cx_ * sx + tx, 1), 'y': round(cy_ * sy + ty, 1), 'r': round(r_ * sx, 1), 'area': round(a_ * sx * sy, 1)})
for p in bush_polys:
    cx_, cy_, r_, a_ = stats(p)
    bushes.append({'poly': to_map(p), 'x': round(cx_ * sx + tx, 1), 'y': round(cy_ * sy + ty, 1), 'r': round(max(3.0, math.sqrt(a_ * sx * sy / math.pi)), 1), 'area': round(a_ * sx * sy, 1)})
json.dump({'source': 'Minimap.png 0.5 iso-line of the ground->rock / ground->bush colour field, 4x, rotational consensus',
           'transform': {'sx': sx, 'sy': sy, 'tx': tx, 'ty': ty}, 'walls': walls, 'bushes': bushes},
          open(REF + 'exact_polys.json', 'w'))
print('wrote', REF + 'exact_polys.json')
