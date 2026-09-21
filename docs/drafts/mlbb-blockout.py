"""Draft B: the Mobile Legends map, drawn from the survey handoff in
docs/mlbb-handoff, in the same blockout style as Draft A.

Everything is in the handoff's "map px" frame (the 520 x 478 minimap crop;
the playable square is x 11.2..495.2, y -2.7..467.5). We render at SCALE
image px per map px. Nothing here is guessed except the turret range
(the handoff does not measure it) and the lane width (read off the photo).

usage: python docs/drafts/mlbb-blockout.py out.png
"""
import json, math, sys
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

import os as _os
# The survey handoff lives in the workspace dataset; a private local copy in
# docs/mlbb-handoff/ (gitignored) is used when the game is checked out alone.
H = next((p for p in ['../dataset/world/handoff/', 'docs/mlbb-handoff/'] if _os.path.exists(p + 'labels.json')), 'docs/mlbb-handoff/')
labels = json.load(open(H + 'labels.json'))
photo = json.load(open(H + ('map.json' if '--contact' in sys.argv else 'map_photo.json')))
SQ = photo['meta']['map_square']            # [x0, y0, x1, y1] in map px
SCALE = 3.0
PAD = 24
X0, Y0 = SQ[0], SQ[1]
W = int((SQ[2] - SQ[0]) * SCALE + PAD * 2)
Hh = int((SQ[3] - SQ[1]) * SCALE + PAD * 2)
P = lambda x, y: ((x - X0) * SCALE + PAD, (y - Y0) * SCALE + PAD)
S = lambda v: v * SCALE

LANE_W = 20          # map px, read off the photo (roads are ~20 px wide)
TURRET_RANGE = 30    # map px, provisional: the handoff does not measure it

img = Image.new('RGB', (W, Hh), (24, 24, 24))
dr = ImageDraw.Draw(img, 'RGBA')

places = {p['id']: p for p in labels['places']}

# river band (neutral ground) under everything
riv = places['river']['polygon']
dr.polygon([P(*q) for q in riv], fill=(38, 62, 70))

# lanes: polylines through the turrets, as bands
for pid in ['ally_top_lane', 'enemy_top_lane', 'ally_mid_lane', 'enemy_mid_lane', 'ally_bot_lane', 'enemy_bot_lane']:
    pl = [P(*q) for q in places[pid]['polyline']]
    dr.line(pl, fill=(71, 71, 71), width=int(S(LANE_W)), joint='curve')
    for q in pl: dr.ellipse([q[0] - S(LANE_W) / 2, q[1] - S(LANE_W) / 2, q[0] + S(LANE_W) / 2, q[1] + S(LANE_W) / 2], fill=(71, 71, 71))

# turret ranges (provisional), pits
TEAM = {'ally': (221, 157, 98), 'enemy': (151, 210, 145)}
for p in labels['places']:
    if p['kind'] == 'turret':
        x, y = P(*p['position']); R = S(TURRET_RANGE); col = TEAM[p['side']]
        dr.ellipse([x - R, y - R, x + R, y + R], fill=col + (26,))
        n = 40
        for k in range(0, n, 2):
            dr.arc([x - R, y - R, x + R, y + R], k / n * 360, (k + 1) / n * 360, fill=col + (200,), width=2)
for pid in ['lord', 'turtle']:
    x, y = P(*places[pid]['position']); R = S(labels['river_pits']['radius'])
    dr.ellipse([x - R, y - R, x + R, y + R], fill=(40, 44, 51))
    n = 48
    for k in range(0, n, 2):
        dr.arc([x - R, y - R, x + R, y + R], k / n * 360, (k + 1) / n * 360, fill=(120, 170, 190), width=3)

# walls (keyhole polygons: even-odd) and bushes
# walls: keyhole polygons need an even-odd fill, which PIL lacks; rasterise
# each with OpenCV (scanline, handles the zero-width bridges) and composite.
wall_mask = np.zeros((Hh, W), np.uint8)
for r in photo['regions']:
    if r['kind'] != 'wall': continue
    pts = np.array([P(*q) for q in r['points']], dtype=np.int32)
    one = np.zeros((Hh, W), np.uint8)
    cv2.fillPoly(one, [pts], 1, lineType=cv2.LINE_8)
    wall_mask ^= one          # XOR = even-odd across overlapping rings
# keep only walls inside the playable square (classifier noise sits outside)
sq = np.zeros((Hh, W), np.uint8); cv2.rectangle(sq, (PAD, PAD), (W - PAD, Hh - PAD), 1, -1)
wall_mask &= sq
arr = np.array(img); arr[wall_mask > 0] = (143, 143, 143); img = Image.fromarray(arr); dr = ImageDraw.Draw(img, 'RGBA')
for r in photo['regions']:
    if r['kind'] == 'bush':
        poly = [P(*q) for q in r['points']]
        dr.polygon(poly, fill=(48, 66, 48), outline=(90, 150, 90))
        xs = [q[0] for q in poly]; ys = [q[1] for q in poly]


# camps
CAMP = {'camp_buff': (12, True), 'camp': (8, False), 'neutral_camp': (8, False)}
for p in labels['places']:
    if p['kind'] in CAMP:
        rr, big = CAMP[p['kind']]
        x, y = P(*p['position']); R = S(rr)
        dr.ellipse([x - R, y - R, x + R, y + R], fill=(40, 44, 51))
        n = 30
        for k in range(0, n, 2):
            dr.arc([x - R, y - R, x + R, y + R], k / n * 360, (k + 1) / n * 360, fill=(110, 120, 150), width=2)
        if big:
            col = (110, 160, 255) if 'purple' in p['id'] else (255, 150, 80)
            dr.ellipse([x - R * 0.35, y - R * 0.35, x + R * 0.35, y + R * 0.35], fill=col)

# turrets and bases on top
for p in labels['places']:
    if p['kind'] == 'turret':
        x, y = P(*p['position']); col = TEAM[p['side']]
        dr.rectangle([x - 9, y - 9, x + 9, y + 9], fill=col, outline=(24, 24, 24), width=2)
    if p['kind'] == 'base':
        x, y = P(*p['position']); R = S(photo['radii']['base']); col = TEAM[p['side']]
        dr.ellipse([x - R, y - R, x + R, y + R], fill=(68, 54, 41) if p['side'] == 'ally' else (52, 65, 51), outline=col, width=3)

# labels
try: font = ImageFont.truetype('segoeuib.ttf', 20); small = ImageFont.truetype('segoeui.ttf', 14)
except Exception: font = small = ImageFont.load_default()
for text, (x, y) in [('TOP', (250, 6)), ('BOTTOM', (250, 462)), ('MID', (250.5, 214)), ('Lord', (166.5, 100)), ('Turtle', (334.5, 344)),
                     ('A', places['allied_base']['position']), ('B', places['enemy_base']['position'])]:
    dr.text(P(x, y), text, fill=(238, 238, 238), font=font, anchor='mm')
for p in labels['places']:
    if p['kind'] in ('camp_buff', 'camp', 'neutral_camp'):
        x, y = P(*p['position']); dr.text((x, y + S(12)), p['common_name'], fill=(200, 200, 200), font=small, anchor='mm')
dr.text((PAD, Hh - 16), f'Draft B ({"contact walls" if "--contact" in sys.argv else "photo walls"}): Mobile Legends map from the survey handoff. Lane width {LANE_W} and turret range {TURRET_RANGE} map px are provisional.', fill=(150, 150, 150), font=small, anchor='lm')

out = [a for a in sys.argv[1:] if not a.startswith('--')][0]
img.save(out); print('wrote', out, img.size)
