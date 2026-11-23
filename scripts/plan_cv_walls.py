"""אב-טיפוס: חילוץ קירות מתמונת תוכנית, numpy בלבד (כדי שיהיה קל להעביר ל-TS)."""
import os, sys, json, numpy as np
from PIL import Image
OUT=os.path.join(os.environ.get('PLAN_OUT','/tmp/plan_cv'),os.path.splitext(os.path.basename(sys.argv[1]))[0]); os.makedirs(os.path.dirname(OUT),exist_ok=True)
im=np.array(Image.open(sys.argv[1]).convert('RGB')).astype(int)
r,g,b=im[...,0],im[...,1],im[...,2]
mx=np.maximum(np.maximum(r,g),b); mn=np.minimum(np.minimum(r,g),b)
H,W=mx.shape; SZ=max(W,H)
# צבע הקיר נקבע מהתמונה: השיא של הפיקסלים הכהים והניטרליים (קיר אפור בתוכנית אחת, כמעט שחור באחרת)
neutral=(mx-mn)<16
hist=np.histogram(mx[neutral&(mx>20)&(mx<150)],bins=26,range=(20,150))[0]
sm=np.convolve(hist,[1,2,1],'same'); peak=20+5*int(np.argmax(sm))+2
LO,HI=max(15,peak-28),min(160,peak+28)
print('wall tone',peak,'range',LO,HI,'size',W,H)
mask=neutral&(mx>LO)&(mx<HI)
def runs(m, minlen):
    """לכל שורה: רצפים באורך minlen ומעלה -> מסכה של פיקסלים ששייכים לרצף ארוך"""
    out=np.zeros_like(m)
    for y in range(m.shape[0]):
        row=m[y]; x=0; n=row.shape[0]
        d=np.diff(np.concatenate(([0],row.astype(np.int8),[0])))
        s=np.where(d==1)[0]; e=np.where(d==-1)[0]
        for a,bb in zip(s,e):
            if bb-a>=minlen: out[y,a:bb]=True
    return out
def bands(m, minlen, maxth):
    """רצפים ארוכים -> פסים: קבוצות של שורות סמוכות עם חפיפה. מחזיר [line,a,b,th]"""
    long=runs(m,minlen); segs=[]
    # סריקה: לכל שורה רצפים; מאחדים עם פס פתוח שחופף
    open_=[]
    for y in range(long.shape[0]+1):
        row=long[y] if y<long.shape[0] else np.zeros(long.shape[1],bool)
        d=np.diff(np.concatenate(([0],row.astype(np.int8),[0])))
        cur=list(zip(np.where(d==1)[0],np.where(d==-1)[0])); nxt=[]
        used=[False]*len(cur)
        for o in open_:
            hit=None
            for i,(a,bb) in enumerate(cur):
                if not used[i] and min(bb,o['b'])-max(a,o['a'])>=0.5*min(bb-a,o['b']-o['a']): hit=i;break
            if hit is None:
                segs.append(o)
            else:
                a,bb=cur[hit]; used[hit]=True
                o['y1']=y; o['a']=min(o['a'],a); o['b']=max(o['b'],bb); nxt.append(o)
        for i,(a,bb) in enumerate(cur):
            if not used[i]: nxt.append({'y0':y,'y1':y,'a':int(a),'b':int(bb)})
        open_=nxt
    out=[]
    for s in segs:
        th=s['y1']-s['y0']+1
        if th<=maxth: out.append([ (s['y0']+s['y1'])/2, int(s['a']), int(s['b']), th])
    return out
# כל הספים ביחס לגודל התמונה: עובי קיר של 16 פיקסלים בתמונה של 1080 הוא 24 בתמונה של 1600
MINLEN=round(SZ*0.02); MAXTH=round(SZ*0.024); THICK=max(6,round(SZ*0.0065))
hz=bands(mask,MINLEN,MAXTH); vt=bands(mask.T,MINLEN,MAXTH)
print('horizontal',len(hz),'vertical',len(vt))
json.dump({'h':hz,'v':vt,'W':W,'H':H,'thick':THICK},open(OUT+'.cv.json','w'))
# ציור
from PIL import ImageDraw
vis=Image.open(sys.argv[1]).convert('RGB'); vis=Image.blend(vis,Image.new('RGB',vis.size,(255,255,255)),.6); d=ImageDraw.Draw(vis)
for l,a,bb,th in hz: d.line([a,l,bb,l],fill=(220,30,30) if th>=THICK else (30,90,230),width=3)
for l,a,bb,th in vt: d.line([l,a,l,bb],fill=(220,30,30) if th>=THICK else (30,90,230),width=3)
vis.resize((W*3//2,H*3//2)).save(OUT+'.cv.png')
