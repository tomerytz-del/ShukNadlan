"""שלב 2: סינון רשת הקירות. נשאר כל רכיב מחובר שיש בו קיר עבה; רהיט שעומד לבד ותוכנית המפתח נופלים."""
import os, sys, json
from PIL import Image, ImageDraw
src=sys.argv[1]; name=os.path.splitext(os.path.basename(src))[0]; OUT=os.path.join(os.environ.get('PLAN_OUT','/tmp/plan_cv'),name); d=json.load(open(OUT+'.cv.json')); SZ=max(d['W'],d['H']); TH=d.get('thick',7); T=round(SZ*0.011); GAP=round(SZ*0.16)
segs=[('h',l,a,b,th) for l,a,b,th in d['h']]+[('v',l,a,b,th) for l,a,b,th in d['v']]
def touch(p,q):
    if p[0]==q[0]:   # מקבילים: אותו קו בקירוב וחפיפה או נגיעה בקצה
        # אותו קו: מחוברים גם דרך פתח (חלון, דלת) עד GAP פיקסלים. רק קטעים באותו עובי בקירוב, כדי שרהיט דק לא ייצמד לקיר עבה
        return abs(p[1]-q[1])<=5 and min(p[3],q[3])-max(p[2],q[2])>=-GAP and abs(p[4]-q[4])<=max(4,TH//2)
    h,v=(p,q) if p[0]=='h' else (q,p)
    return h[2]-T<=v[1]<=h[3]+T and v[2]-T<=h[1]<=v[3]+T
par=list(range(len(segs)))
def find(i):
    while par[i]!=i: par[i]=par[par[i]]; i=par[i]
    return i
for i in range(len(segs)):
    for j in range(i+1,len(segs)):
        if touch(segs[i],segs[j]): par[find(i)]=find(j)
comp={}
for i,s in enumerate(segs): comp.setdefault(find(i),[]).append(i)
score=lambda ids: sum(segs[i][3]-segs[i][2] for i in ids)
# נשארת כל קבוצה שיש בה קיר עבה באורך של ממש: רהיט ותוכנית המפתח מצוירים בקו דק, קיר חיצוני לא
thick=lambda ids: sum(segs[i][3]-segs[i][2] for i in ids if segs[i][4]>=TH)
big=max(thick(c) for c in comp.values())
good=[c for c in comp.values() if thick(c)>=max(SZ*0.055,0.08*big)]
best=[i for c in good for i in c]
keep=[segs[i] for i in best]
print(name,'segments',len(segs),'components',len(comp),'kept',len(keep),'len kept',round(score(best)),'of',round(sum(s[3]-s[2] for s in segs)))
json.dump(keep,open(OUT+'.walls.json','w'))
im=Image.open(src).convert('RGB'); im=Image.blend(im,Image.new('RGB',im.size,(255,255,255)),.6); dr=ImageDraw.Draw(im)
for k,l,a,b,th in segs:
    if (k,l,a,b,th) in keep: continue
    dr.line([a,l,b,l] if k=='h' else [l,a,l,b],fill=(170,170,170),width=2)
for k,l,a,b,th in keep:
    col=(220,30,30) if th>=TH else (30,90,230)
    dr.line([a,l,b,l] if k=='h' else [l,a,l,b],fill=col,width=3)
im.resize((im.width*3//2,im.height*3//2)).save(OUT+'.walls.png')
