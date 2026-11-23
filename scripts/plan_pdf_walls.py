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

# --- קנה מידה: לכל מידה כתובה מודדים את המרווח הפנוי בין קירות דרך מרכז הטקסט, אופקית ואנכית
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
if not dims: sys.exit('no dimension could be matched to a wall span')
r=np.array([d['cm']/v for d in dims for k,v in d['cand']])
# הקונצנזוס: היחס שהכי הרבה מידות מסכימות עליו עד 3%. מידה שעוברת דרך פתח או מודדת משהו אחר נופלת
cons=max(r,key=lambda v:int((np.abs(r-v)/v<0.03).sum()))
for d in dims:
    k,v=min(d['cand'],key=lambda c:abs(d['cm']/c[1]-cons)); d['dir']=k; d['pt']=round(v,2); d['ratio']=d['cm']/v; del d['cand']
r=np.array([d['ratio'] for d in dims]); ok=np.abs(r-cons)/cons<0.03
scale=float(np.median(r[ok]))
err=[abs(d['cm']-d['pt']*scale) for d,k in zip(dims,ok) if k]
print('dimensions read',len(dims),'agree',int(ok.sum()),'scale cm/pt',round(scale,4),'declared',round(declared,4) if declared else None)
print('error vs written dimensions, cm: median',round(float(np.median(err)),1),'max',round(max(err),1))
for d,k in zip(dims,ok): print('  ',d['cm'],'->',round(d['pt']*scale,1),'' if k else '(no match)')
labels=[(t,round((x0+x1)/2),round((y0+y1)/2)) for x0,y0,x1,y1,t in ws if re.search('[א-ת]',t)]
json.dump({'page':page,'wall_fill':wallcol,'scale_cm_per_pt':scale,'declared_cm_per_pt':declared,'dims':dims,'labels':labels},open(OUT+'.pdf.json','w'),ensure_ascii=False)
v=Image.fromarray((~mask).astype(np.uint8)*255).convert('RGB'); dr=ImageDraw.Draw(v)
for d,k in zip(dims,ok):
    x,y=d['at'][0]*S,d['at'][1]*S; dr.ellipse([x-9,y-9,x+9,y+9],fill=(30,160,60) if k else (220,40,40))
v.resize((v.width//3,v.height//3)).save(OUT+'.pdf.png')
