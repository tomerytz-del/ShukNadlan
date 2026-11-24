"""אב-טיפוס: קירות, קנה מידה ושמות חדרים מ-PDF וקטורי (תוכנית מהאדריכל או חוברת שיווקית).

    python3 scripts/plan_pdf_walls.py plan.pdf            # הפלט ב-/tmp/plan_cv או ב-PLAN_OUT

בלי מודל ראייה: הקירות הם הצורות הממולאות בצבע אחד שיוצרות פסים ארוכים וצרים (שחור בקובץ אחד, ירוק-אפור באחר),
הטקסט נקרא ישירות עם המיקום שלו, וקנה המידה נגזר מהמידות שכתובות בתוכנית מול המרחק הנמדד בין הקירות.
המדד שהסקריפט מדפיס הוא הסטייה של כל מידה כתובה מהמדידה - כלומר הדיוק נבדק מול מה שהאדריכל כתב.
נשען על pdftocairo ו-pdftotext (poppler); בפונקציית Edge יידרש קורא PDF אחר.
"""
import os, re, sys, json, subprocess, tempfile, collections
import numpy as np
from PIL import Image, ImageDraw, ImageChops

pdf=sys.argv[1]; name=os.path.splitext(os.path.basename(pdf))[0]
OUT=os.path.join(os.environ.get('PLAN_OUT','/tmp/plan_cv'),name); os.makedirs(os.path.dirname(OUT),exist_ok=True)
S=4.0   # פיקסלים לנקודת PDF במסכה. ב-1:50 זה 0.44 ס"מ לפיקסל
NUM=re.compile(r'^-?(\d{2,4})-?$')

def words(page):
    x=subprocess.run(['pdftotext','-bbox','-f',str(page),'-l',str(page),pdf,'-'],capture_output=True,text=True).stdout
    return [(float(a),float(b),float(c),float(d),t) for a,b,c,d,t in re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>',x)]
npages=int(re.search(r'Pages:\s+(\d+)',subprocess.run(['pdfinfo',pdf],capture_output=True,text=True).stdout).group(1))
# העמוד של התוכנית: זה שיש בו הכי הרבה מידות (מספר של 2-4 ספרות שעומד לבד)
page=max(range(1,npages+1),key=lambda p:sum(1 for w in words(p) if NUM.match(w[4])))
ws=words(page)
svg=tempfile.mktemp(suffix='.svg'); subprocess.run(['pdftocairo','-svg','-f',str(page),'-l',str(page),pdf,svg],check=True)
s=open(svg).read(); os.remove(svg)
PW,PH=[float(v) for v in re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"',s).groups()]

def subpaths(d):
    """M/L/H/V/C/Z מוחלטים, כמו ש-cairo כותב. עקומה מיוצגת בנקודת הסיום שלה: קיר הוא קו ישר"""
    out=[]; cur=[]; x=y=0.0
    for cmd,args in re.findall(r'([MLHVCZ])([^MLHVCZ]*)',d):
        v=[float(t) for t in args.split()]
        if cmd=='M':
            if len(cur)>2: out.append(cur)
            x,y=v[0],v[1]; cur=[(x,y)]
        elif cmd=='L':
            for i in range(0,len(v),2): x,y=v[i],v[i+1]; cur.append((x,y))
        elif cmd=='H':
            for t in v: x=t; cur.append((x,y))
        elif cmd=='V':
            for t in v: y=t; cur.append((x,y))
        elif cmd=='C':
            for i in range(0,len(v),6): x,y=v[i+4],v[i+5]; cur.append((x,y))
    if len(cur)>2: out.append(cur)
    return out

fills=collections.defaultdict(list)
for attrs in re.findall(r'<path ([^>]*)/>',s):
    f=re.search(r'fill="rgb\(([\d.]+)%, ([\d.]+)%, ([\d.]+)%\)"',attrs); d=re.search(r' d="([^"]*)"',attrs)
    if not f or not d or 'transform=' in attrs: continue
    col=tuple(round(float(c)/100*255/8)*8 for c in f.groups())
    if min(col)>235: continue     # לבן: רקע ומסכות
    sp=subpaths(d.group(1))
    if sp: fills[col].append(sp)

def raster(paths):
    """מסכה של כל הצורות. תת-מסלולים של אותה צורה ב-XOR, כדי שחור בתוך קיר טבעתי יישאר חור"""
    m=Image.new('1',(round(PW*S),round(PH*S)),0)
    for sp in paths:
        xs=[p[0] for q in sp for p in q]; ys=[p[1] for q in sp for p in q]
        x0,y0=int(min(xs)*S)-1,int(min(ys)*S)-1; w,h=int(max(xs)*S)+2-x0,int(max(ys)*S)+2-y0
        if w<=0 or h<=0 or w*h>2e8: continue
        t=Image.new('1',(w,h),0)
        for q in sp:
            u=Image.new('1',(w,h),0); ImageDraw.Draw(u).polygon([(px*S-x0,py*S-y0) for px,py in q],fill=1)
            t=ImageChops.logical_xor(t,u)
        m.paste(1,(x0,y0),t)
    return np.array(m)

def runs_len(m,minlen,maxth):
    """אורך כולל של רצפים ארוכים בשורות, ושיעור המסכה שנמצא בפסים צרים: אותו מדד כמו בתמונות"""
    tot=0; inband=0
    for a in (m,m.T):
        d=np.diff(np.concatenate([np.zeros((a.shape[0],1),np.int8),a.astype(np.int8),np.zeros((a.shape[0],1),np.int8)],1),axis=1)
        ys,xs=np.where(d==1); ye,xe=np.where(d==-1)
        ln=xe-xs; ok=ln>=minlen
        tot+=int(ok.sum()); inband+=int(ln[ok].sum())
    return tot,inband
best=None
for col,paths in fills.items():
    if len(paths)<4: continue
    m=raster(paths); area=int(m.sum())
    if area<0.002*m.size: continue
    # קיר: פס ארוך. שורה של המסכה שיש בה רצף ארוך היא חלק מפס; מודדים כמה מהמסכה כזה, ואת העובי הממוצע
    rows,inband=runs_len(m,round(60*S),0)
    frac=min(1,inband/(2*area)) if area else 0
    thick=inband/max(1,rows)/1   # אורך ממוצע של רצף
    score=area*frac*frac
    print('fill',col,'shapes',len(paths),'area%',round(100*area/m.size,2),'in long runs',round(frac,2),'score',round(score))
    if best is None or score>best[0]: best=(score,col,m)
if best is None: sys.exit('no filled wall colour found - walls may be drawn as outlines')
_,wallcol,mask=best
print('page',page,'of',npages,'wall fill',wallcol)

# --- מחיצות ששורטטו כזוג קווים מקבילים בלי מילוי (חוברות שיווקיות): ממלאים בין השניים.
# מחיצה היא 0.35 עד 1.1 מעובי הקיר הממולא; רהיט רחב מזה, וקו כפול של חלון צר מזה
from scipy import ndimage as ndi
dt=ndi.distance_transform_edt(mask); EXT=float(np.percentile(dt[mask],90))/0.45/S     # עובי קיר ממולא, בנקודות
segs={'h':[],'v':[]}
for attrs in re.findall(r'<path ([^>]*)/>',s):
    if 'stroke="rgb' not in attrs or 'stroke-dasharray' in attrs: continue
    d=re.search(r' d="([^"]*)"',attrs); t=re.search(r'transform="matrix\(([^)]*)\)"',attrs)
    if not d: continue
    a,b,c,dd,e,f=[float(v) for v in t.group(1).split(',')] if t else (1,0,0,1,0,0)
    pts=[]
    for cmd,args in re.findall(r'([MLHVCZ])([^MLHVCZ]*)',d.group(1)):
        v=[float(u) for u in args.split()]
        if cmd=='M': pts.append([(v[0],v[1])])
        elif cmd=='L' and pts:
            for i in range(0,len(v),2): pts[-1].append((v[i],v[i+1]))
        elif cmd=='C' and pts: pts.append([(v[-2],v[-1])])     # עקומה שוברת את הרצף: קשת של דלת אינה קיר
        elif cmd=='Z' and pts and len(pts[-1])>1: pts[-1].append(pts[-1][0])
    for q in pts:
        q=[(a*x+c*y+e,b*x+dd*y+f) for x,y in q]
        for (x0,y0),(x1,y1) in zip(q,q[1:]):
            if abs(y0-y1)<0.3 and abs(x0-x1)>=10: segs['h'].append(((y0+y1)/2,min(x0,x1),max(x0,x1)))
            elif abs(x0-x1)<0.3 and abs(y0-y1)>=10: segs['v'].append(((x0+x1)/2,min(y0,y1),max(y0,y1)))
pairs=[]
for k in 'hv':
    L=sorted(set((round(l,1),round(a_,1),round(b_,1)) for l,a_,b_ in segs[k]))
    for i,(l1,a1,b1) in enumerate(L):
        for l2,a2,b2 in L[i+1:]:
            gap=l2-l1
            if gap>EXT*1.1: break
            lo,hi=max(a1,a2),min(b1,b2)
            if gap>=EXT*0.35 and hi-lo>=EXT*3: pairs.append([lo*S,l1*S,hi*S,l2*S] if k=='h' else [l1*S,lo*S,l2*S,hi*S])
# מחיצה מחוברת לרשת הקירות; ספה באמצע החדר לא. מוסיפים בסבבים: מה שנוגע בקיר, ואז מה שנוגע במה שנוסף
filled=mask; net=ndi.binary_dilation(mask,iterations=round(EXT*S*0.6)); kept=[]; left=pairs
while True:
    nxt=[]; grew=False
    for r_ in left:
        x0,y0,x1,y1=[int(v) for v in r_]
        if net[max(0,y0-2):y1+3,max(0,x0-2):x1+3].any():
            kept.append(r_); grew=True
            g=round(EXT*S*0.6); net[max(0,y0-g):y1+g,max(0,x0-g):x1+g]=True
        else: nxt.append(r_)
    left=nxt
    if not grew: break
pm=Image.new('1',(mask.shape[1],mask.shape[0]),0); pd=ImageDraw.Draw(pm)
for r_ in kept: pd.rectangle(r_,fill=1)
with_pairs=mask|np.array(pm)
print('filled wall thickness pt',round(EXT,1),'stroke segments',len(segs['h'])+len(segs['v']),'line pairs',len(pairs),'connected',len(kept))

# --- קנה מידה: לכל מידה כתובה מודדים את המרווח הפנוי בין קירות דרך מרכז הטקסט, אופקית ואנכית
def measure(mask):
  def span(cx,cy,horizontal):
      x,y=int(cx*S),int(cy*S); line=mask[y,:] if horizontal else mask[:,x]; p=x if horizontal else y
      if line[p]: return None
      a=p
      while a>0 and not line[a-1]: a-=1
      b=p
      while b<len(line)-1 and not line[b+1]: b+=1
      if a==0 or b==len(line)-1: return None
      return (b-a+1)/S
  dims=[]
  for x0,y0,x1,y1,t in ws:
      mt=NUM.match(t)
      if not mt: continue
      cm=int(mt.group(1)); cx,cy=(x0+x1)/2,(y0+y1)/2
      # כיוון המידה לא נקבע מצורת התיבה של הטקסט (לא אמין בטקסט מסובב): מודדים בשני הכיוונים, והקונצנזוס בוחר
      c=[(k,span(cx,cy,k=='h')) for k in 'hv']
      c=[(k,v) for k,v in c if v]
      if c: dims.append({'cm':cm,'at':[round(cx),round(cy)],'cand':c})
  declared=re.search(r'1\s*:\s*(\d{2,3})',' '.join(w[4] for w in ws))
  declared=int(declared.group(1))*2.54/72 if declared else None      # ס"מ לנקודה
  if not dims: return [],np.array([],bool),None,[],declared
  r=np.array([d['cm']/v for d in dims for k,v in d['cand']])
  # הקונצנזוס: היחס שהכי הרבה מידות מסכימות עליו עד 3%. מידה שעוברת דרך פתח או מודדת משהו אחר נופלת
  cons=max(r,key=lambda v:int((np.abs(r-v)/v<0.03).sum()))
  for d in dims:
      k,v=min(d['cand'],key=lambda c:abs(d['cm']/c[1]-cons)); d['dir']=k; d['pt']=round(v,2); d['ratio']=d['cm']/v; del d['cand']
  r=np.array([d['ratio'] for d in dims]); ok=np.abs(r-cons)/cons<0.03
  scale=float(np.median(r[ok]))
  err=[abs(d['cm']-d['pt']*scale) for d,k in zip(dims,ok) if k]
  return dims,ok,scale,err,declared
# קובץ שכל הקירות בו ממולאים לא צריך את הזוגות, והם רק מזיקים לו. לא מנחשים איזה קובץ זה: מודדים בשתי הדרכים,
# ונשארים עם זו שיותר מידות כתובות מסכימות איתה
A=measure(filled); B=measure(with_pairs)
use_pairs=int(B[1].sum())>int(A[1].sum())
dims,ok,scale,err,declared=B if use_pairs else A; mask=with_pairs if use_pairs else filled
print('agreeing dimensions: filled only',int(A[1].sum()),'with line pairs',int(B[1].sum()),'-> using','line pairs' if use_pairs else 'filled only')
if scale is None: sys.exit('no dimension could be matched to a wall span')
print('dimensions read',len(dims),'agree',int(ok.sum()),'scale cm/pt',round(scale,4),'declared',round(declared,4) if declared else None)
print('error vs written dimensions, cm: median',round(float(np.median(err)),1),'max',round(max(err),1))
for d,k in zip(dims,ok): print('  ',d['cm'],'->',round(d['pt']*scale,1),'' if k else '(no match)')
# --- חדרים: סוגרים פתחים, ממלאים, וכל חלל סגור הוא חדר. פתח הוא רווח בין שני קצוות קיר לאורך אותו קו,
# ולכן הוא "פס" בעובי של קיר. רווח באותו רוחב בין שני קירות מקבילים (מסדרון) נמשך לכל אורך החדר, וכך מבדילים
def bridges(m,maxgap,maxth):
    """רווח בין שני רצפי קיר באותה שורה. עוקבים אחרי כל רווח לפי שני הקצוות שלו: פתח נמשך כעובי הקיר,
    וחדר צר (אותו רוחב, קצוות אחרים) נמשך לכל גובהו ונזרק"""
    out=np.zeros_like(m); act={}      # (e,nx) -> שורת התחלה
    def flush(k,y0,y1):
        if y1-y0<=maxth: out[y0:y1,k[0]:k[1]]=True
    for y in range(m.shape[0]+1):
        cur=[]
        if y<m.shape[0] and m[y].any():
            d=np.diff(np.concatenate(([0],m[y].astype(np.int8),[0])))
            st=np.where(d==1)[0]; en=np.where(d==-1)[0]
            cur=[(int(e),int(nx)) for e,nx in zip(en[:-1],st[1:]) if nx-e<=maxgap]
        nxt={}
        for g in cur:
            k=next((k for k in act if abs(k[0]-g[0])<=2 and abs(k[1]-g[1])<=2),None)
            if k is not None: nxt[k]=act.pop(k)
            else: nxt[g]=y
        for k,y0 in act.items(): flush(k,y0,y)
        act=nxt
    return out
MAXGAP=round(260/scale*S); MAXTH=round(EXT*1.6*S)
closed=mask|bridges(mask,MAXGAP,MAXTH)|bridges(mask.T,MAXGAP,MAXTH).T
free=~closed
R=round(120/scale*S)      # החוץ: מה שעיגול ברדיוס 1.2 מ' מגיע אליו משולי העמוד
core=ndi.distance_transform_edt(free)>R; cl,_=ndi.label(core)
eb=set(np.unique(np.concatenate([cl[0],cl[-1],cl[:,0],cl[:,-1]])).tolist())-{0}
outside=ndi.distance_transform_edt(~np.isin(cl,list(eb)))<=R+2
lab,n=ndi.label(free&~outside)
px2m=(scale/S/100)**2
# שמות: מילים בעברית באותה שורה שסמוכות זו לזו הן תווית אחת
heb=sorted([w for w in ws if re.search('[א-ת]',w[4])],key=lambda w:(round(w[1]/4),w[0]))
groups=[]
for w in heb:
    g=groups[-1] if groups else None
    if g and abs(g['y']-(w[1]+w[3])/2)<4 and w[0]-g['x1']<12: g['t'].append(w[4]); g['x1']=w[2]
    else: groups.append({'t':[w[4]],'x0':w[0],'x1':w[2],'y':(w[1]+w[3])/2})
rooms={}
for g in groups:
    cx,cy=int((g['x0']+g['x1'])/2*S),int(g['y']*S)
    i=int(lab[cy,cx]) if 0<=cy<lab.shape[0] and 0<=cx<lab.shape[1] else 0
    if i: rooms.setdefault(i,[]).append(' '.join(t[::-1] if re.search('[א-ת]',t) else t for t in reversed(g['t'])))
sizes=ndi.sum(np.ones_like(lab),lab,range(1,n+1))
out_rooms=[]; objs=ndi.find_objects(lab)
for i in range(1,n+1):
    m2=float(sizes[i-1])*px2m
    if m2<0.8: continue
    sl=objs[i-1]
    out_rooms.append({'id':i,'names':rooms.get(i,[]),'m2':round(m2,2),'bbox_pt':[round(sl[1].start/S,1),round(sl[0].start/S,1),round(sl[1].stop/S,1),round(sl[0].stop/S,1)]})
out_rooms.sort(key=lambda r:-r['m2'])
alltext=' '.join(w[4] for w in ws)
decl=[float(v) for v in re.findall(r'(\d{2,3}\.\d{1,2})',alltext)]
named=sum(r['m2'] for r in out_rooms if r['names'])
print('rooms',len(out_rooms),'named',sum(1 for r in out_rooms if r['names']),'| net floor of named rooms m2',round(named,1),'| all closed spaces',round(sum(r['m2'] for r in out_rooms),1),'| areas written in the plan',decl)
for r in out_rooms: print('  ',r['m2'],'m2',' / '.join(r['names']) or '(no name)')
rng=np.random.RandomState(5); rgb2=np.full(mask.shape+(3,),255,np.uint8)
for r in out_rooms: rgb2[lab==r['id']]=rng.randint(120,240,3) if r['names'] else (225,225,225)
rgb2[closed&~mask]=(230,60,60); rgb2[mask]=(0,0,0)
Image.fromarray(rgb2).resize((mask.shape[1]//3,mask.shape[0]//3)).save(OUT+'.pdf.rooms.png')
labels=[(t,round((x0+x1)/2),round((y0+y1)/2)) for x0,y0,x1,y1,t in ws if re.search('[א-ת]',t)]
json.dump({'rooms':out_rooms,'page':page,'wall_fill':wallcol,'scale_cm_per_pt':scale,'declared_cm_per_pt':declared,'dims':dims,'labels':labels},open(OUT+'.pdf.json','w'),ensure_ascii=False)
rgb=np.full(mask.shape+(3,),255,np.uint8); rgb[mask]=(40,90,220); rgb[filled]=(0,0,0)
v=Image.fromarray(rgb); dr=ImageDraw.Draw(v)
for d,k in zip(dims,ok):
    x,y=d['at'][0]*S,d['at'][1]*S; dr.ellipse([x-9,y-9,x+9,y+9],fill=(30,160,60) if k else (220,40,40))
v.resize((v.width//3,v.height//3)).save(OUT+'.pdf.png')
