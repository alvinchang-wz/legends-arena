"""Render draft-a.json exactly, optionally hiding the loose walls.
usage: python docs/drafts/render.py [--camp-walls-only] [--no-bushes] [--no-cross] [--no-slice-labels] out.png"""
import json, math, sys
from PIL import Image, ImageDraw, ImageFont

d = json.load(open('docs/drafts/draft-a.json'))
camp_walls_only = '--camp-walls-only' in sys.argv
no_bushes = '--no-bushes' in sys.argv
no_cross = '--no-cross' in sys.argv
no_slices = '--no-slice-labels' in sys.argv
out = [a for a in sys.argv[1:] if not a.startswith('--')][0]
W, H = d['size']
img = Image.new('RGB', (W, H), (24, 24, 24))
dr = ImageDraw.Draw(img, 'RGBA')
BG = (24, 24, 24)

def region(regs, col):
    for r in regs:
        dr.polygon([tuple(p) for p in r['outer']], fill=col)
        for h in r['holes']: dr.polygon([tuple(p) for p in h], fill=BG)

region(d['lanes'], (71, 71, 71))        # lanes first: their holes are painted background
if 'diagonal' in d:                       # the second diagonal as a clean band
    dg = d['diagonal']
    dr.line([tuple(dg['from']), tuple(dg['to'])], fill=(42, 42, 42), width=int(round(dg['width'])))
    region([c for c in d['connections'] if c.get('kind') == 'cross' and not no_cross], (42, 42, 42))
else:
    region([c for c in d['connections'] if not (no_cross and c.get('kind') == 'cross')], (42, 42, 42))
if 'midLane' in d:                        # mid is a clean straight band, over the diagonal
    m = d['midLane']
    dr.line([tuple(m['from']), tuple(m['to'])], fill=(71, 71, 71), width=int(round(m['width'])))
TEAM = {'A': (221, 157, 98), 'B': (151, 210, 145)}
for team, ts in d['towers'].items():
    col = TEAM[team]
    for t in ts:
        x, y, R = t['x'], t['y'], t['range']
        dr.ellipse([x - R, y - R, x + R, y + R], fill=col + (28,))
        n = 40
        for k in range(n):
            if k % 2: continue
            a0, a1 = k / n * 360, (k + 1) / n * 360
            dr.arc([x - R, y - R, x + R, y + R], a0, a1, fill=col + (200,), width=2)
for team, b in d['bases'].items():
    fill = (68, 54, 41) if team == 'A' else (52, 65, 51)
    dr.ellipse([b['x'] - b['r'], b['y'] - b['r'], b['x'] + b['r'], b['y'] + b['r']], fill=fill, outline=TEAM[team], width=3)
for c in d['camps']:
    x, y, R = c['x'], c['y'], c['r']
    dr.ellipse([x - R, y - R, x + R, y + R], fill=(40, 44, 51))
    n = 36
    for k in range(0, n, 2):
        dr.arc([x - R + 2, y - R + 2, x + R - 2, y + R - 2], k / n * 360, (k + 1) / n * 360, fill=(110, 120, 150), width=2)
for w in d['walls']:
    if camp_walls_only and not w['nearCamp']: continue
    dr.polygon([tuple(p) for p in w['poly']], fill=(143, 143, 143))
for bsh in ([] if no_bushes else d['bushes']):
    poly = [tuple(p) for p in bsh['poly']]
    dr.polygon(poly, fill=(48, 66, 48))
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    for xx in range(int(x0), int(x1), 6):
        dr.line([xx, y0, xx + 6, y1], fill=(120, 190, 110), width=1)
    dr.polygon(poly, outline=(90, 150, 90))
for team, ts in d['towers'].items():
    for t in ts:
        dr.rectangle([t['x'] - 10, t['y'] - 10, t['x'] + 10, t['y'] + 10], fill=TEAM[team], outline=(24, 24, 24), width=2)
try: font = ImageFont.truetype('segoeuib.ttf', 22)
except Exception: font = ImageFont.load_default()
for text, x, y in d['labels']:
    if no_slices and text.startswith('Slice'): continue
    dr.text((x, y), text, fill=(238, 238, 238), font=font, anchor='mm')
for team, b in d['bases'].items():
    dr.text((b['x'], b['y']), team, fill=(238, 238, 238), font=font, anchor='mm')
img.save(out)
print('wrote', out)
