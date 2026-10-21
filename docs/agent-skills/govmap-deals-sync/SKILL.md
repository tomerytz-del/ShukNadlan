---
name: "govmap-deals-sync"
description: "Pull new real-estate deals per city from Govmap (in the user's Chrome) into Shuk Nadlan's Supabase through upsert_deals - the due-city plan, count-based dedup, and a summary at the end. Use on \"עדכן עסקאות\" or a city list."
---

# עדכון עסקאות נדל"ן מ-Govmap לשוק נדל"ן

יעד: פרויקט Supabase `shuknadlan-marketplace` (id `obookujgolazrwycsiyn`). כל
הכתיבה עוברת **דרך הפונקציות** - לא INSERT ישיר. לא נוגעים בפרויקט נדל"ן עפולה.

> מקור הקובץ: `docs/agent-skills/govmap-deals-sync/SKILL.md` בריפו ShukNadlan.
> הפונקציות והסיבות שמאחוריהן: `docs/settlement-deals.md`.

## כללי ברזל
- ה-API של Govmap מוגן ב-reCAPTCHA. לא קוראים לו ישירות ולא עוקפים אותו. עובדים
  רק דרך ממשק האתר בטאב של המשתמש. אתגר "אני לא רובוט" - עוצרים ומבקשים מהמשתמש לפתור.
- **לא כותבים ל-`market_deals_official` ב-INSERT ישיר.** רק `upsert_deals` / `upsert_deals_text`. הן:
  מסמנות את היישוב כמעודכן (אחרת הוא נשאר בראש התור לנצח), רושמות אותו בסיכום,
  ומונעות כפילויות.
- **כפילויות - הפונקציה מטפלת.** תת-החלקה ב-Govmap לא יציבה והתאריך זז לפעמים
  ביום; `upsert_deals` מתאימה לפי ספירה: כל עסקה קיימת "סופגת" שורה נכנסת אחת
  (אותו גוש, חלקה, מחיר ושטח, ±יום). כך דירות זהות בפרויקט נשמרות, ואותה עסקה
  שנצפתה שוב לא נכנסת. **לא לסנן "כפילויות" בעצמך** מעבר למה שבשלב 5.
- DELETE דרך ה-MCP נתקע. אם צריך למחוק - לתת למשתמש SQL להריץ ב-SQL Editor.
- נתונים: כמו שהם מוצגים. לא לנחש ולא להשלים. "אין מידע" ו-"-" נשארים כמו שהם.

## מהירות - העיקרון
כל יישוב = בערך 6-8 סבבי כלים, לא עשרות:
1. browser_batch אחד: סגירת פאנל → חיפוש כתובת → find לתוצאה.
2. browser_batch אחד: לחיצה על התוצאה → סגירת פאנל כתובת → לחיצה על בניין → צילום מסך (scale 0.5).
3. לחיצה על "צפייה בנתוני עסקאות" + `__go` (פותח את הטבלה ומתחיל גריפה ברקע) - באותו סבב.
4. `__wait(); __wait()` בקריאה אחת + ספירת DB מקבילה.
5. לכל מנה של עד ~420 שורות: `__sb` + get_page_text באותו סבב, ואז SQL אחד.

לא לצלם מסך ולא לעשות zoom בלי צורך; צילומים ב-`scale: 0.5`. קריאות בלתי תלויות
באותו סבב (למשל `__wait` ושאילתת הספירה ב-DB).

## 1. מה לעדכן
```sql
select name, sync_from, due_total
from deal_sync_plan(25, '{afula-emek,nof-hagalil-migdal,krayot}');
```
רק יישובים שהגיע תורם (פעם ב-30 יום כברירת מחדל), הגדולים קודם. `sync_from` -
עד איזה תאריך למשוך. ריק - אין מה לעדכן: לדווח וזהו.

**השווקים** (הפרמטר השני). ברירת המחדל כאן - עמק יזרעאל והקריות. המשתמש
יכול לבקש אחרים ("עדכן עסקאות בחדרה"), או את כולם - `'{}'`:

| slug | השוק |
| --- | --- |
| `afula-emek` | עפולה והעמק |
| `nof-hagalil-migdal` | נוף הגליל ומגדל העמק |
| `krayot` | הקריות |
| `haifa` | חיפה |
| `akko-nahariya` | עכו-נהריה |
| `karmiel-misgav` | כרמיאל-משגב |
| `hadera` | חדרה |
| `netanya` | נתניה |

## 2. התקנת עוזרים (javascript_tool, פעם אחת לכל טעינת עמוד)
קודם את `__scrape` משלב 4, ואז:
```js
// טקסט ארוך מוצג באלמנט article נסתר; get_page_text מחזיר אותו במלואו
// (פלט javascript_tool נחתך ב-~1,000 תווים, ו-navigate ל-blob נכשל).
window.__show=(txt)=>{let a=document.getElementById('__dump'); if(!a){a=document.createElement('article'); a.id='__dump'; a.style.cssText='position:fixed;left:0;bottom:0;width:300px;height:40px;overflow:hidden;opacity:0.01;z-index:-1;white-space:pre;font-size:2px;pointer-events:none'; document.body.appendChild(a);} a.textContent=txt; return txt.length;};
// מנה בפורמט upsert_deals_text, כולל #rows= ו-#end
window.__sb=(i,n=150)=>{const line=r=>r.map(v=>v==null?'':String(v).replace(/[|\n]/g,' ')).join('|').replace(/\|+$/,''); const rows=window.__rows.slice(i,i+n).map(line); return window.__show(`#rows=${rows.length}\n${rows.join('\n')}${rows.length?'\n':''}#end`) && rows.length;};
// פותח "עסקאות ביישוב", מחזיר כותרת + 3 שורות ראשונות (לאימות היישוב) ומתחיל גריפה ברקע
window.__go=async(cutoff,city)=>{const s=[...document.querySelectorAll('span')].find(e=>/^עסקאות ביישוב/.test(e.innerText.trim())); if(!s) return 'no-tab'; (s.closest('button')||s.parentElement).click(); await new Promise(r=>setTimeout(r,3500)); const head=s.innerText.trim()+'\n'+[...document.querySelectorAll('table tr')].slice(1,4).map(tr=>tr.innerText.replace(/\s+/g,' ')).join('\n'); window.__done=null; window.__scrape(cutoff,city,45).then(r=>window.__done=r); return head;};
// מחכה עד 28 שניות לסיום הגריפה; מחזיר גם בדיקות איכות:
// br = שבירות בסדר התאריכים, ov = עמודים חופפים (>3 שורות זהות)
window.__wait=async()=>{for(let i=0;i<28&&!window.__done;i++) await new Promise(r=>setTimeout(r,1000)); if(!window.__done) return 'running'; const R=window.__rows; let br=0; R.forEach((r,i)=>{if(i&&r[3]>R[i-1][3])br++}); let ov=0; for(let p=1;p*37<R.length;p++){const a=new Set(R.slice((p-1)*37,p*37).map(x=>x.join('|'))); if(R.slice(p*37,(p+1)*37).filter(x=>a.has(x.join('|'))).length>3)ov++;} const d=JSON.parse(window.__done); return JSON.stringify({pages:d.pages,rows:d.rows,last:d.log.at(-2)||d.log.at(-1),end:d.log.at(-1),br,ov});};
// גיבוי בלבד (אם get_page_text לא מחזיר את ה-article): מנות קטנות ישירות מהפלט
window.__tfit=(i,L=940)=>{const line=r=>r.map(v=>v==null?'':String(v).replace(/[|\n]/g,' ')).join('|').replace(/\|+$/,'');
 let n=0,s='';while(i+n<window.__rows.length){const t=window.__rows.slice(i,i+n+1).map(line).join('\n'); if(t.length>L)break; s=t;n++;}
 return (i+n)+'/'+window.__rows.length+'\n'+s;};
```
העמוד נטען מחדש (`typeof window.__go!=='function'`) - להתקין שוב.

## 3. פתיחת הטבלה ליישוב (המסלול המהיר)
קואורדינטות לחלון 1391x777 עם הפאנל בצד ימין (לאמת בצילום אם החלון שונה):

1. **browser_batch**: לחיצה (704,36) - סגירת טבלת העסקאות הקודמת; לחיצה (712,14) -
   תיבת החיפוש; `ctrl+a`; הקלדת "<רחוב> <מספר> <יישוב>"; wait 2; `find` "first
   search autocomplete result button with type כתובת".
2. **browser_batch**: לחיצה על ה-ref שנמצא; wait 3; לחיצה (1276,35) - סגירת פאנל
   הכתובת; wait 2; לחיצה על בניין במפה (למשל (650,450) או (680,300)); wait 2;
   screenshot scale 0.5.
3. בפאנל יש כפתור "צפייה בנתוני עסקאות" → לחיצה (1328,86), ובאותו סבב:
   `await new Promise(r=>setTimeout(r,2500)); await window.__go('<sync_from>','<name>')`.
   פאנל של חלקה בלבד / רשימת חלקות בלי הכפתור → לחיצה (1273,35) ובניין אחר.
   לחיצה על הכפתור דרך JS לא עובדת (לא נמצא) - תמיד לחיצת עכבר.
4. לוודא בשורות שחזרו מ-`__go` שהרחובות/השכונות שייכים ליישוב. יישוב עם שם דומה
   (רמת יוחנן / כפר המכבי) = `deal_sync_fail`, לא ניחוש. N מוגבל ל-1500 - התקרה של Govmap.
5. באותו סבב: `await window.__wait(); await window.__wait()` (עד ~56 שניות) +
   `select count(*) from market_deals_official where city='<name>' and sold_at>='<sync_from>'::date-7`.
   `"running"` - לקרוא ל-`__wait` שוב.

יישוב קטן שלא נמצא בשם - לחפש "גוש X חלקה Y" לפי גוש/חלקה ידועים מה-DB.
השכבה לא פעילה - לחפש "עסקאות נדלן" ולבחור את השכבה. המפה ריקה / לא זזה -
לטעון `https://www.govmap.gov.il/?lay=REAL_ESTATE_DEALS`, לבחור שוב את השכבה,
ולהתקין עוזרים מחדש. find/batch נכשל "failed in the extension" - לנסות פעם אחת
כקריאה בודדת או צילום מסך, לא לחזור על כל ה-batch. זום מוקטן בדפדפן נותן
37 שורות לעמוד במקום 6.

היישוב לא נמצא / אין שכבה / הטבלה לא נטענת:
```sql
select deal_sync_fail('<name>', '<מה קרה, במשפט>');
```
ולעבור ליישוב הבא.

## 4. גריפה (`__scrape` - חלק מהעוזרים)
```js
window.__scrape = async (cutoff, city, maxPages=40) => {
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const pagEl=()=>[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/of\s+\d+/.test(e.innerText||''));
 const iso=d=>{const [dd,mm,yy]=d.split('.');return `${yy}-${mm}-${dd}`};
 const read=()=>[...document.querySelectorAll('table tr')].slice(1).map(tr=>[...tr.children].map(c=>c.innerText.trim()));
 for(let i=0;i<60;i++){const pb=document.querySelector('button[aria-label="Go to previous page"]'); if(!pb||pb.disabled)break; const b=pagEl().innerText; pb.click(); for(let j=0;j<40;j++){await sleep(250); if(pagEl()?.innerText!==b)break;} await sleep(300);}
 const all=[]; let pages=0; const log=[];
 while(pages<maxPages){ const rows=read(); pages++; all.push(...rows); const last=iso(rows.at(-1)[1]); log.push(pagEl().innerText.split(' of')[0]+'→'+last); if(last<cutoff)break;
  const before=pagEl().innerText; const nb=document.querySelector('button[aria-label="Go to next page"]'); if(!nb||nb.disabled){log.push('end');break;}
  nb.click(); let ok=false; for(let i=0;i<40;i++){await sleep(250); if(pagEl()?.innerText!==before&&read().length){ok=true;break;}} if(!ok){log.push('timeout');break;} await sleep(1200);}
 const clean=s=>(s||'').replace(/[‎‏]/g,'').trim();
 const num=s=>{const v=clean(s).replace(/[^\d.]/g,'');return v===''?null:Number(v)};
 window.__payload=all.map(r=>{const [addrRaw,date,gh,type,rooms,floor,sqm,price]=r.map(clean);
  const lines=addrRaw.split('\n').map(clean); const a=lines[0]; const hood=lines[1]||null; let street=null,house=null;
  if(a&&a!=='אין מידע'){const m=a.match(/^(.*?)\s+(\d+\S*)$/); if(m){street=m[1];house=m[2]} else street=a;}
  const [g,h,t]=gh.split('-'); const d=iso(date);
  return {gush:g,helka:h,tat:t??null,sold_at:d,sale_price:num(price),size_sqm:num(sqm),street,house_number:house,neighborhood:hood,property_type:(type==='-'||!type)?null:type,rooms:num(rooms),floor:(floor==='-'||!floor)?null:floor};})
  .filter(o=>o.sold_at>=cutoff);
 // gush|helka|tat|date|price|sqm|street|house|neighborhood|type|rooms|floor
 window.__rows=window.__payload.map(o=>[o.gush,o.helka,o.tat,o.sold_at,o.sale_price,o.size_sqm,o.street,o.house_number,o.neighborhood,o.property_type,o.rooms,o.floor]);
 return JSON.stringify({pages,rows:window.__rows.length,log});
};
```

**בדיקה לפני כתיבה** - `__wait` מחזיר `br` ו-`ov`; שניהם צריכים להיות 0.
עמוד חסר/כפול - לחזור אליו בדפדוף ולשלוף אותו שוב, ולשבץ במקום. שורות זהות
בודדות הן דירות זהות בפרויקט - להשאיר.

**תקרת 1500**: אם `end` עדיין אחרי `sync_from`, Govmap לא נותן להגיע עמוק יותר.
לכתוב מה שיש ולציין בסיכום עד איזה תאריך הגענו. (בעמוד האחרון 37 שורות גם
כשהתווית אומרת "of 1500" - זה תקין, ‏41×37=1517.)

## 5. (רק אם הספירה ב-DB > 0) לשלוח רק מה שחסר
ספירה 0 (המקרה הרגיל ביישוב שלא עודכן) - לדלג ישר לשלב 6.
```sql
select string_agg(gush||'-'||helka||':'||sold_at||':'||round(sale_price)||':'||coalesce(round(size_sqm)::text,''), ',')
from market_deals_official where city='<name>' and sold_at >= '<sync_from>'::date - 7;
```
```js
window.__keep=(keys)=>{const cnt=new Map(); for(const k of (keys||'').split(',').filter(Boolean))cnt.set(k,(cnt.get(k)||0)+1);
 const lk=r=>`${r[0]}-${r[1]}:${r[3]}:${r[4]}:${r[5]??''}`;
 window.__rows=window.__rows.filter(r=>{const c=cnt.get(lk(r))||0; if(c>0){cnt.set(lk(r),c-1);return false;} return true;});
 return window.__rows.length;};
```
זה רק קיצור: הסינון האמיתי ב-`upsert_deals`, כולל ±יום ותת-חלקה שהשתנתה.

## 6. כתיבה - מנות גדולות דרך get_page_text
1. באותו סבב: `window.__sb(i, N)` ב-javascript_tool (מחזיר מספר שורות) ואז
   get_page_text - מחזיר `#rows=N ... #end` מתוך ה-article הנסתר.
2. לשלוח **כמו שהוא, כולל `#rows=` ו-`#end`**:
```sql
select upsert_deals_text('<name>', $l$
<הטקסט - #rows=N, שורה לעסקה, #end>
$l$) - 'rejected';
```
3. הבא: `__sb(i+N, N)` עד שנגמר.

גודל מנה: **עד 400-480 שורות** עובד (נבדק). עד ~420 - מנה אחת; יותר - לחלק
למנות שוות בערך (524 → 262+262, 840 → 420+420, 1500 → 4×375).

`{"error":"truncated"}` - שום דבר מהמנה לא נכתב. לשלוח שוב בחצי הגודל.
לא לתקן ביד ולא לשלוח בלי שורת `#rows=` - היא כל ההגנה מפני עסקאות שנעלמות.

get_page_text לא מחזיר את ה-article - גיבוי: `window.__tfit(0)` מחזיר בשורה
הראשונה `next/total` (13-17 שורות למנה, בלי `#rows=`), ממשיכים מ-next, ומציינים
בסיכום. `navigate` ל-`blob:` ו-`window.open` לא עובדים ב-Claude in Chrome - לא לנסות.

`$l$` ולא גרשיים - בסוג נכס יש גרש (קוטג'). כל המנות של יישוב באותה הרצה -
הפונקציה זוכרת מה כבר נספג. (`upsert_deals` עם מערך JSON עדיין עובדת, אבל
השורות המופרדות מכניסות יותר עסקאות לכל העברה.)

**אין אף עסקה חדשה** (או הכול סונן בשלב 5):
```sql
select upsert_deals('<name>', '[]');
```
חובה - כך היישוב נרשם כמעודכן ויוצא מהתור ל-30 יום.

## 7. ממשיכים
אחרי כל יישוב - הבא ב-plan, בלי לעצור לדווח (עדכון קצר למשתמש כל כמה יישובים
מספיק). כשנגמר: אם `due_total` גדול ממה שעברת - שלב 1 שוב.

## 8. סיכום
בסוף, גם אם עצרת באמצע:
```sql
select deal_sync_run_finish()->>'summary';
```
להציג למשתמש **כמו שהוא**. זה גם שולח לו את הסיכום בוואטסאפ ובפעמון ב-CRM.
לא צריך לרשום ריצה ב-`market_deal_import_runs` - הפונקציות עושות את זה.