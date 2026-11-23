"""שלב 3: חדרים כחללים סגורים בין הקירות. קלט: הפלט של plan_cv_filter.py.

סוגרים פתחים (דלת, חלון) בקו וירטואלי, ממלאים את השטח הפנוי, וכל כתם שאינו נוגע בשולי התמונה הוא חדר.
numpy בלבד, כדי שיהיה קל להעביר ל-TS: המילוי הוא סריקת שורות עם union-find ולא ספרייה.
"""
import os, sys, json, numpy as np
from PIL import Image, ImageDraw
src=sys.argv[1]; name=os.path.splitext(os.path.basename(src))[0]; OUT=os.path.join(os.environ.get('PLAN_OUT','/tmp/plan_cv'),name)
d=json.load(open(OUT+'.walls.json')); walls=d['walls']; EXT=d['ext']
im=Image.open(src).convert('RGB'); W,H=im.size; SZ=max(W,H)
GAP=round(SZ*0.16)      # פתח בין שני קטעים על אותו קו: חלון או ויטרינה
DOOR=round(SZ*0.055)    # קצה חופשי של קיר עד הקיר הניצב: דלת
TOL=max(5,EXT)
# 1. סגירות: (א) שני קטעים על אותו קו עם רווח עד GAP, (ב) קצה קטע שממשיך עד קיר ניצב במרחק עד DOOR
closes=[]
for i,p in enumerate(walls):
    for q in walls[i+1:]:
        if p[0]==q[0] and abs(p[1]-q[1])<=TOL:
            a,b=(p,q) if p[2]<=q[2] else (q,p)
            if 0<b[2]-a[3]<=GAP: closes.append((p[0],(a[1]+b[1])/2,a[3],b[2]))
def hit(k,l,pos,sign):
    """המרחק מקצה הקטע, בכיוון שלו, עד הקיר הניצב הראשון"""
    best=None
    for q in walls:
        if q[0]==k: continue
        if q[2]-TOL<=l<=q[3]+TOL:
            dist=(q[1]-pos)*sign
            if -TOL<=dist and (best is None or dist<best): best=dist
    return best
for k,l,a,b,th in walls:
    for pos,sign in ((a,-1),(b,1)):
        dist=hit(k,l,pos,sign)
        if dist is not None and TOL<dist<=DOOR: closes.append((k,l,min(pos,pos+sign*dist),max(pos,pos+sign*dist)))
# 2. מסכת קירות
m=Image.new('L',(W,H),0); dr=ImageDraw.Draw(m)
for k,l,a,b,th in walls: dr.line([a,l,b,l] if k=='h' else [l,a,l,b],fill=255,width=max(3,int(th)))
for k,l,a,b in closes: dr.line([a,l,b,l] if k=='h' else [l,a,l,b],fill=255,width=3)
free=np.array(m)==0
# 2א. מה נחשב "בחוץ": לא כל מה שמחובר לשולי התמונה, כי קטע קיר אחד שחסר מדליף את כל הסלון החוצה.
# החוץ הוא מה שכדור ברדיוס R מגיע אליו מהשוליים; פתח צר מ-2R (חלון, ויטרינה, קיר שלא זוהה) חוסם אותו.
# (באב-טיפוס scipy; ב-TS זו טרנספורמת מרחק בשני מעברים)
from scipy import ndimage as ndi
R=round(SZ*0.07)
dist=ndi.distance_transform_edt(free)
core=dist>R; cl,_=ndi.label(core)
eb=set(np.unique(np.concatenate([cl[0],cl[-1],cl[:,0],cl[:,-1]])).tolist())-{0}
out_core=np.isin(cl,list(eb))
outside=ndi.distance_transform_edt(~out_core)<=R+2
free=free&~outside
# 3. רכיבים קשירים, 4 שכנים, בסריקת שורות
lab=np.zeros((H,W),np.int32); par=[0]
def find(i):
    while par[i]!=i: par[i]=par[par[i]]; i=par[i]
    return i
for y in range(H):
    row=free[y]; dd=np.diff(np.concatenate(([0],row.astype(np.int8),[0])))
    for a,b in zip(np.where(dd==1)[0],np.where(dd==-1)[0]):
        n=len(par); par.append(n); lab[y,a:b]=n
        if y:
            for u in np.unique(lab[y-1,a:b]):
                if u: par[find(int(u))]=find(n)
root=np.array([find(i) for i in range(len(par))]); lab=root[lab]
edge=set(np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]])).tolist())
ids,cnt=np.unique(lab,return_counts=True)
MINA=(SZ*0.045)**2      # חדר קטן מזה הוא פיר, ארון או שארית בין קווים
rooms=[]
for i,c in zip(ids.tolist(),cnt.tolist()):
    if i==0 or i in edge or c<MINA: continue   # שארית בין קיר לשולי תמונה חתוכה אינה חדר
    ys,xs=np.where(lab==i)
    rooms.append({'id':i,'area':c,'bbox':[int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())],'c':[int(xs.mean()),int(ys.mean())],'fill':round(c/((xs.max()-xs.min()+1)*(ys.max()-ys.min()+1)),2)})
rooms.sort(key=lambda r:-r['area'])
print(name,'closes',len(closes),'rooms',len(rooms),'areas%',[round(100*r['area']/(W*H),1) for r in rooms])
json.dump({'rooms':rooms,'closes':closes},open(OUT+'.rooms.json','w'))
vis=np.array(Image.blend(im,Image.new('RGB',im.size,(255,255,255)),.5))
rng=np.random.RandomState(3)
for r in rooms:
    col=rng.randint(60,230,3); sel=lab==r['id']; vis[sel]=(vis[sel]*0.45+col*0.55).astype(np.uint8)
v=Image.fromarray(vis); dr=ImageDraw.Draw(v)
for k,l,a,b,th in walls: dr.line([a,l,b,l] if k=='h' else [l,a,l,b],fill=(0,0,0),width=3)
for k,l,a,b in closes: dr.line([a,l,b,l] if k=='h' else [l,a,l,b],fill=(230,30,30),width=2)
v.save(OUT+'.rooms.png')
