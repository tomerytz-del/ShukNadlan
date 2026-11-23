"""אב-טיפוס: חילוץ קירות מתמונת תוכנית, numpy בלבד (כדי שיהיה קל להעביר ל-TS)."""
import os, sys, json, numpy as np
from PIL import Image
OUT=os.path.join(os.environ.get('PLAN_OUT','/tmp/plan_cv'),os.path.splitext(os.path.basename(sys.argv[1]))[0]); os.makedirs(os.path.dirname(OUT),exist_ok=True)
im=np.array(Image.open(sys.argv[1]).convert('RGB')).astype(int)
r,g,b=im[...,0],im[...,1],im[...,2]
mx=np.maximum(np.maximum(r,g),b); mn=np.minimum(np.minimum(r,g),b)
H,W=mx.shape; SZ=max(W,H)
neutral=(mx-mn)<16
MINLEN=round(SZ*0.02); MAXTH=round(SZ*0.024); THICK=max(6,round(SZ*0.0065))
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
# צבע הקיר נקבע מהתמונה ולא מראש: קיר אפור בתוכנית אחת, כמעט שחור באחרת, ולפעמים הרקע עצמו אפור כהה.
# לכן לא לוקחים את הגוון השכיח (זה יכול להיות הרקע) אלא בודקים כל שיא בהיסטוגרמה, ובוחרים את הגוון
# שנותן הכי הרבה פסים ארוכים בעובי של קיר. רקע הוא כתם ולא פס, ולכן הוא מפסיד
hist=np.histogram(mx[neutral&(mx<150)],bins=30,range=(0,150))[0]
sm=np.convolve(hist,[1,2,1],'same')
cands=[i for i in range(30) if sm[i]>=0.004*4*W*H and sm[i]>=sm[max(0,i-1)] and sm[i]>=sm[min(29,i+1)]]
best=None
for i in cands:
    pk=5*i+2; lo=max(-1,pk-28)
    # הגבול העליון בעמק שאחרי השיא ולא במרחק קבוע: בתמונה דחוסה שולי קיר שחור הם 45-60, ובסף קבוע הקיר נמדד בעובי 2
    j=min(range(i+3,min(30,i+13)),key=lambda t:sm[t]) if i+3<30 else 29
    hi=min(160,max(pk+28,5*j+2))
    m=neutral&(mx>lo)&(mx<hi)
    h_,v_=bands(m,MINLEN,MAXTH),bands(m.T,MINLEN,MAXTH)
    ln=sum(x[2]-x[1] for x in h_+v_ if x[3]>=3); area=sum((x[2]-x[1])*x[3] for x in h_+v_ if x[3]>=3)
    frac=min(1,area/max(1,int(m.sum()))); sc=ln*frac*frac   # בריבוע: בארבע התוכניות עם רקע אפור ההפרש בלי הריבוע היה 15-20% בלבד
    print('tone',pk,'len',ln,'frac',round(frac,2),'score',round(sc))
    if best is None or sc>best[0]: best=(sc,pk,lo,hi,h_,v_)
_,peak,LO,HI,hz,vt=best
print('wall tone',peak,'range',LO,HI,'size',W,H)
print('horizontal',len(hz),'vertical',len(vt))
json.dump({'h':hz,'v':vt,'W':W,'H':H,'thick':THICK},open(OUT+'.cv.json','w'))
# ציור
from PIL import ImageDraw
vis=Image.open(sys.argv[1]).convert('RGB'); vis=Image.blend(vis,Image.new('RGB',vis.size,(255,255,255)),.6); d=ImageDraw.Draw(vis)
for l,a,bb,th in hz: d.line([a,l,bb,l],fill=(220,30,30) if th>=THICK else (30,90,230),width=3)
for l,a,bb,th in vt: d.line([l,a,l,bb],fill=(220,30,30) if th>=THICK else (30,90,230),width=3)
vis.resize((W*3//2,H*3//2)).save(OUT+'.cv.png')
