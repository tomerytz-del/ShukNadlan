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
- **לא כותבים ל-`market_deals_official` ב-INSERT ישיר.** רק `upsert_deals`. היא:
  מסמנת את היישוב כמעודכן (אחרת הוא נשאר בראש התור לנצח), רושמת אותו בסיכום,
  ומונעת כפילויות.
- **כפילויות - הפונקציה מטפלת.** תת-החלקה ב-Govmap לא יציבה והתאריך זז לפעמים
  ביום; `upsert_deals` מתאימה לפי ספירה: כל עסקה קיימת "סופגת" שורה נכנסת אחת
  (אותו גוש, חלקה, מחיר ושטח, ±יום). כך דירות זהות בפרויקט נשמרות, ואותה עסקה
  שנצפתה שוב לא נכנסת. **לא לסנן "כפילויות" בעצמך** מעבר למה שבשלב 4.
- DELETE דרך ה-MCP נתקע. אם צריך למחוק - לתת למשתמש SQL להריץ ב-SQL Editor.
- נתונים: כמו שהם מוצגים. לא לנחש ולא להשלים. "אין מידע" ו-"-" נשארים כמו שהם.

## 1. מה לעדכן
```sql
select name, sync_from, due_total from deal_sync_plan(25);
```
רק יישובים שהגיע תורם (פעם ב-30 יום כברירת מחדל), הגדולים קודם. `sync_from` -
עד איזה תאריך למשוך. ריק - אין מה לעדכן: לדווח וזהו.

## 2. פתיחת טבלת "עסקאות ביישוב" ב-Govmap
1. בתיבת החיפוש (find: "main search input box") להקליד כתובת ידועה בעיר, למשל
   "הבנים 19 מגדל העמק", ולבחור את התוצאה - המפה קופצת לעיר.
2. אם שכבת העסקאות לא פעילה: לחפש "עסקאות נדלן" ולבחור את השכבה.
3. ללחוץ על חלקה מסומנת (קו כחול) במפה → נפתח פאנל.
4. ללחוץ על "עסקאות ביישוב (N)" (find). N מוגבל ל-1500 - התקרה של Govmap.
5. זום מוקטן בדפדפן נותן 37 שורות לעמוד במקום 6.

היישוב לא נמצא / אין שכבה / הטבלה לא נטענת:
```sql
select deal_sync_fail('<name>', '<מה קרה, במשפט>');
```
ולעבור ליישוב הבא.

## 3. גריפה (javascript_tool, פעם אחת לכל טעינת עמוד)
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
 // שורה כמערך - הפורמט הדחוס ש-upsert_deals מקבלת, כמעט פי שניים שורות בכל מנה:
 // [gush, helka, tat, sold_at, price, sqm, street, house, neighborhood, type, rooms, floor]
 window.__rows=window.__payload.map(o=>[o.gush,o.helka,o.tat,o.sold_at,o.sale_price,o.size_sqm,o.street,o.house_number,o.neighborhood,o.property_type,o.rooms,o.floor]);
 window.__chunk=(i,n=10)=>JSON.stringify(window.__rows.slice(i,i+n));
 return JSON.stringify({pages,rows:window.__rows.length,log});
};
```
הרצה: `await window.__scrape('<sync_from>','<name>')`.

## 4. (אופציונלי) לשלוח רק מה שחסר - מקצר את ההעברה
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

## 5. כתיבה
פלט javascript_tool נחתך בערך ב-1,100 תווים - לשלוף במנות: `window.__chunk(0)`,
`window.__chunk(10)`, ... ולכל מנה:
```sql
select upsert_deals('<name>', $j$<הפלט של __chunk כמו שהוא>$j$::jsonb) - 'rejected';
```
`$j$` ולא גרשיים - בסוג נכס יש גרש (קוטג'). כל המנות של יישוב באותה הרצה -
הפונקציה זוכרת מה כבר נספג.

**אין אף עסקה חדשה** (או הכול סונן בשלב 4):
```sql
select upsert_deals('<name>', '[]');
```
חובה - כך היישוב נרשם כמעודכן ויוצא מהתור ל-30 יום.

## 6. ממשיכים
אחרי כל יישוב - הבא ב-plan. כשנגמר: אם `due_total` גדול ממה שעברת - שלב 1 שוב.

## 7. סיכום
בסוף, גם אם עצרת באמצע:
```sql
select deal_sync_run_finish()->>'summary';
```
להציג למשתמש **כמו שהוא**. זה גם שולח לו את הסיכום בוואטסאפ ובפעמון ב-CRM.
לא צריך לרשום ריצה ב-`market_deal_import_runs` - הפונקציות עושות את זה.
