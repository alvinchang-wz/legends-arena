"""Difference map: reference minimap layers vs the current draft. Writes
dataset/world/reference/overlay_diff.png and prints agreement counts."""
import numpy as np, cv2, json
from PIL import Image
REF='../dataset/world/reference/'
L=np.load(REF+'minimap_layers.npz'); X0,Y0,R,N=L['frame']; R=int(R); N=int(N); sx,sy,tx,ty=L['transform']
im=np.array(Image.open(REF+'Minimap.png').convert('RGB')).astype(np.float32)
S=3.0; side=int(436*S)
M=np.array([[sx*S,0,(tx-X0)*S],[0,sy*S,(ty-Y0)*S]],np.float32)
ref=cv2.warpAffine(im,M,(side,side),flags=cv2.INTER_CUBIC,borderValue=(24,24,24)).clip(0,255).astype(np.uint8)
D=json.load(open('docs/drafts/draft-d.json'))
P=lambda poly:(np.array(poly,np.float32)-(X0,Y0))*S
wall_ref=cv2.resize(L['wall'].astype(np.uint8),(side,side),interpolation=cv2.INTER_NEAREST)>0
bush_ref=cv2.resize(L['bush'].astype(np.uint8),(side,side),interpolation=cv2.INTER_NEAREST)>0
wd=np.zeros((side,side),np.uint8); bd=np.zeros((side,side),np.uint8)
for w in D['walls']:
    if not w.get('hidden'): cv2.fillPoly(wd,[P(w['poly']).round().astype(np.int32)],1)
for b in D['bushes']: cv2.fillPoly(bd,[P(b['poly']).round().astype(np.int32)],1)
diff=(ref*0.35).astype(np.uint8)
diff[(wall_ref)&(wd>0)]=(150,150,150); diff[(wall_ref)&(wd==0)]=(255,60,60); diff[(~wall_ref)&(wd>0)]=(60,120,255)
diff[(bush_ref)&(bd>0)]=(120,200,120); diff[(bush_ref)&(bd==0)]=(255,255,0); diff[(~bush_ref)&(bd>0)]=(255,0,255)
cv2.putText(diff,'grey/green = agree   red = rock only in picture   blue = rock only in draft   yellow = bush only in picture   magenta = bush only in draft',(10,side-12),cv2.FONT_HERSHEY_SIMPLEX,0.45,(255,255,255),1)
Image.fromarray(diff).save(REF+'overlay_diff.png')
ov=ref.copy()
for w in D['walls']:
    if not w.get('hidden'): cv2.polylines(ov,[P(w['poly']).round().astype(np.int32)],True,(255,60,60),2)
for b in D['bushes']: cv2.polylines(ov,[P(b['poly']).round().astype(np.int32)],True,(255,255,0),2)
Image.fromarray(ov).save(REF+'overlay_outlines.png')
tot=lambda m:int(m.sum()/(S*S))
print('rock px: agree %d, only picture %d, only draft %d | bush px: agree %d, only picture %d, only draft %d'%(tot(wall_ref&(wd>0)),tot(wall_ref&(wd==0)),tot(~wall_ref&(wd>0)),tot(bush_ref&(bd>0)),tot(bush_ref&(bd==0)),tot(~bush_ref&(bd>0))))
# systematic shift between the draft fill and the reference layer, at the layer's own resolution
wl=L['wall']>0; bl=np.zeros((N,N),np.uint8)
for w in D['walls']:
    if not w.get('hidden'): cv2.fillPoly(bl,[((np.array(w['poly'],np.float32)-(X0,Y0))*R).round().astype(np.int32)],1)
def _iou(dx,dy):
    m=np.roll(np.roll(bl,dy,0),dx,1)>0; return (m&wl).sum()/max((m|wl).sum(),1)
best=max((_iou(dx,dy),dx,dy) for dx in range(-3,4) for dy in range(-3,4))
print('best IoU %.3f at draft shift (%d,%d) raster px = (%.1f,%.1f) map px'%(best[0],best[1],best[2],best[1]/R,best[2]/R))
