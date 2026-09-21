"""Read the user's drawing (draft-a-original.png) and turn every element into
exact coordinates (draft-a.json). Nothing is redrawn by hand: walls, camps,
bushes, lanes and turrets are found by their colour and stored as polygons or
circles, so later edits are edits to numbers."""
import json, math, cv2, numpy as np
from PIL import Image

SRC = 'docs/drafts/draft-a-original.png'
im = np.array(Image.open(SRC).convert('RGB')).astype(int)
H, W, _ = im.shape
r, g, b = im[..., 0], im[..., 1], im[..., 2]
gray = (abs(r - g) <= 8) & (abs(g - b) <= 8)
v = (r + g + b) // 3

def regions(mask, min_area):
    m = (mask.astype(np.uint8) * 255)
    cs, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    if hier is None: return out
    hier = hier[0]
    for i, c in enumerate(cs):
        if hier[i][3] != -1 or cv2.contourArea(c) < min_area: continue
        holes = [cv2.approxPolyDP(cs[j], 1.5, True).reshape(-1, 2).tolist() for j in range(len(cs)) if hier[j][3] == i and cv2.contourArea(cs[j]) > 50]
        out.append({'outer': cv2.approxPolyDP(c, 1.5, True).reshape(-1, 2).tolist(), 'holes': holes})
    return out

def contours(mask, min_area):
    m = (mask.astype(np.uint8) * 255)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in cs:
        a = cv2.contourArea(c)
        if a < min_area: continue
        poly = cv2.approxPolyDP(c, 1.5, True).reshape(-1, 2).tolist()
        M = cv2.moments(c); cx, cy = M['m10'] / M['m00'], M['m01'] / M['m00']
        out.append({'poly': poly, 'cx': round(cx, 1), 'cy': round(cy, 1), 'area': int(a)})
    return out

# camps: dark blue-gray discs
camp_mask = (abs(r - 40) <= 6) & (abs(g - 44) <= 6) & (abs(b - 51) <= 6)
camps = []
for c in contours(camp_mask, 300):
    (x, y), rad = cv2.minEnclosingCircle(np.array(c['poly'], dtype=np.float32))
    camps.append({'x': round(x, 1), 'y': round(y, 1), 'r': round(rad, 1), 'big': rad > 32})

# walls: solid light gray
wall_mask = gray & (abs(v - 143) <= 28)
walls = []
for c in contours(wall_mask, 120):
    pts = np.array(c['poly'], dtype=float)
    # an arc that SURROUNDS a camp keeps a near-constant distance from its centre,
    # just outside the disc; a slab that merely sits nearby does not
    surrounds = False
    for cp in camps:
        dd = np.hypot(pts[:, 0] - cp['x'], pts[:, 1] - cp['y'])
        inner, outer = dd.min(), dd.max()
        if cp['r'] + 2 <= inner <= cp['r'] + 40 and outer - inner <= 42:
            surrounds = True; break
    walls.append({**c, 'nearCamp': surrounds})

# bushes: green hatch
bush_mask = (g > r + 10) & (g > b + 10) & (v > 30) & (v < 140)
bushes = []
for c in contours(cv2.morphologyEx(bush_mask.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8)) > 0, 150):
    if c['area'] > 2500: continue          # the team base discs are green/brown too
    bushes.append({'x': c['cx'], 'y': c['cy'], 'poly': c['poly']})

# turrets: saturated squares; range = distance to the dashed ring of the same hue
def turrets(color, hue_ok):
    out = []
    mask = (abs(r - color[0]) <= 30) & (abs(g - color[1]) <= 30) & (abs(b - color[2]) <= 30)
    for c in contours(mask, 200):
        cx, cy = c['cx'], c['cy']
        dists = []
        for k in range(16):
            a = k / 16 * 2 * math.pi
            for dd in range(40, 130):
                x, y = int(cx + math.cos(a) * dd), int(cy + math.sin(a) * dd)
                if 0 <= x < W and 0 <= y < H and hue_ok(im[y, x]):
                    dists.append(dd); break
        rad = float(np.median(dists)) if dists else 0
        if rad > 55: out.append({'x': cx, 'y': cy, 'range': round(rad, 1)})
    return out
orange = lambda p: p[0] - p[2] > 40 and p[0] > 90 and abs(p[0] - p[1]) > 15
green = lambda p: p[1] - p[0] > 25 and p[1] - p[2] > 25 and p[1] > 90
towers = {'A': turrets((221, 157, 98), orange), 'B': turrets((151, 210, 145), green)}

# bases: the two large team discs
def base(color, near):
    mask = (abs(r - color[0]) <= 10) & (abs(g - color[1]) <= 10) & (abs(b - color[2]) <= 10)
    cs = contours(mask, 800)
    c = min(cs, key=lambda q: math.hypot(q['cx'] - near[0], q['cy'] - near[1]))
    (x, y), rad = cv2.minEnclosingCircle(np.array(c['poly'], dtype=np.float32))
    return {'x': round(x, 1), 'y': round(y, 1), 'r': round(rad, 1)}
bases = {'A': base((68, 54, 41), (190, 1312)), 'B': base((52, 65, 51), (1335, 170))}

# lanes and connections: mid-gray bands (also where they pass through range tints)
lane_mask = gray & (v >= 55) & (v <= 80)
lane_mask |= (abs(r - 63) <= 6) & (abs(g - 60) <= 6) & (abs(b - 58) <= 6)
lane_mask = cv2.morphologyEx(lane_mask.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)) > 0
near_lane = cv2.dilate(lane_mask.astype(np.uint8), np.ones((41, 41), np.uint8)) > 0
loose = np.zeros((H, W), np.uint8)
for w in walls:
    if not w['nearCamp']: cv2.fillPoly(loose, [np.array(w['poly'], dtype=np.int32)], 1)
loose = cv2.dilate(loose, np.ones((9, 9), np.uint8)) > 0
lane_mask |= loose & near_lane
lanes = regions(lane_mask, 3000)
conn_mask = (abs(r - g) <= 6) & (abs(g - b) <= 6) & (v >= 36) & (v <= 50)
# open first: the anti-aliased rim of every lane is this gray too, and as a
# closed ring it would swallow the roads inside it as nested contours
conn_mask = cv2.morphologyEx(conn_mask.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
conn_mask = cv2.morphologyEx(conn_mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)) > 0
connections = [{'outer': c['poly'], 'holes': []} for c in contours(conn_mask, 1500)]

labels = [['TOP', 762, 82], ['BOTTOM', 762, 1400], ['MID', 762, 740], ['Base A', 190, 1410], ['Base B', 1335, 68],
          ['Slice 1', 868, 355], ['Slice 2', 1145, 632], ['Slice 3', 982, 845], ['Slice 4', 868, 957],
          ['Slice 5', 658, 1122], ['Slice 6', 380, 845], ['Slice 7', 545, 632], ['Slice 8', 658, 520]]
data = {'size': [W, H], 'bases': bases, 'lanes': lanes, 'connections': connections, 'towers': towers,
        'camps': camps, 'walls': walls, 'bushes': bushes, 'labels': labels}
json.dump(data, open('docs/drafts/draft-a.json', 'w'))
print('camps', len(camps), 'big', sum(c['big'] for c in camps), '| walls', len(walls), 'near camps', sum(w['nearCamp'] for w in walls),
      '| bushes', len(bushes), '| towers', {k: len(v) for k, v in towers.items()}, 'ranges', sorted({t['range'] for t in towers['A'] + towers['B']}),
      '| lanes', len(lanes), 'connections', len(connections), '| bases', bases)
