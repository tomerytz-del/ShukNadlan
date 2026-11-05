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
- **לא כותבים ל-`market_deals_official` ב-INSERT ישיר.** רק `upsert_deals` / `upsert_deals_text`. הן
  מסמנות את היישוב כמעודכן (אחרת הוא נשאר בראש התור לנצח), רושמות אותו בסיכום,
  ומונעות כפילויות.
- **כפילויות - הפונקציה מטפלת.** תת-החלקה ב-Govmap לא יציבה והתאריך זז לפעמים
  ביום; `upsert_deals` מתאימה לפי ספירה: כל עסקה קיימת "סופגת" שורה נכנסת אחת
  (אותו גוש, חלקה, מחיר ושטח, ±יום). כך דירות זהות בפרויקט נשמרות, ואותה עסקה
  שנצפתה שוב לא נכנסת. **לא לסנן "כפילויות" בעצמך** מעבר למה שבשלב 5.
- DELETE דרך ה-MCP נתקע. אם צריך למחוק - לתת למשתמש SQL להריץ ב-SQL Editor.
- נתונים: כמו שהם מוצגים. לא לנחש ולא להשלים. "אין מידע" ו-"-" נשארים כמו שהם.
- **רשימה של מקום אחר**: "עסקאות ביישוב (1500)" ביישוב קטן, עם גושים מכל הארץ
  (קרה ב"שני") או רחובות של עיר אחרת (קרה ב"הראל" - רמת דן) = לא של היישוב.
  לא לכתוב → `deal_sync_fail`.

## השיטה המהירה (נבדקה על ~400 יישובים)
רוב העבודה רצה ב-JS בתוך העמוד, בלי צילומי מסך:
- **טבלה בעמוד אחד**: Govmap קובע שורות-לעמוד לפי `window.innerHeight` כשהטבלה נפתחת.
  דריסה ל-80000 (`__tall`) → כל 1500 העסקאות בעמוד אחד, גריפה ב-~4 שניות במקום
  דקות. ctrl+minus חסום ב-Claude in Chrome; CSS zoom / הגדלת קונטיינר לא עוזרים.
  חל רק על טבלה שנפתחת אחריו - `__go` מחליף לשונית כדי לטעון מחדש.
- **מציאת חלקה בלי לראות**: הקנבס של המפה קריא (getImageData). פוליגון היישוב
  שנבחר ממולא תכלת בהירה (~174,199,221); חלקות עם עסקאות - קו סגול (~72,56,216).
  `__pick` מוצא את הרכיב הגדול של המילוי וקווים סגולים בתוכו, הקרובים למרכז.
  בלי פוליגון - `__nearC` (קווים סגולים ליד מרכז המסך).
- **לחיצה על המפה ב-JS עובדת** (pointerdown/up + click סינתטיים על האלמנט בנקודה),
  וכך גם בחירת תוצאת חיפוש. **לא עובדים ב-JS**: הקלדה בתיבת החיפוש וכפתור
  "צפייה בנתוני עסקאות" - אלה תמיד ב-computer (לחיצה/הקלדה אמיתית).
- **השוואת חתימות** (שלב 5): ביישוב שיש לו עסקאות במסד לא מעתיקים את כל השורות -
  משווים חתימה לכל יום בין Govmap למסד ומושכים רק ימים שונים.

**סבב אחד ליישוב** - browser_batch אחד (**יישוב אחד בלבד** בכל batch - batch ארוך מדי
נכשל ב-timeout), ובמקביל ה-SQL של היישוב הקודם (כתיבה + חתימות של היישוב הבא):
1. javascript_tool: `window.__rows=[]; window.__closeP()` - מאפס שורות של היישוב הקודם
   (אחרת `B:no-tab` משאיר שורות ישנות שנראות כמו תוצאה) וסוגר פאנל קודם. **לפני**
   ההקלדה (אחריה הוא סוגר את רשימת התוצאות).
2. triple_click על תיבת החיפוש (700,38); `ctrl+a`; type שם היישוב; wait 3.
3. javascript_tool: `await window.__runA('<name>','<sync_from>')` - בוחר תוצאת "יישוב" בשם
   המדויק, מוצא חלקה, לוחץ, ואם נפתחה לשונית "עסקאות ביישוב" - גורף ומחזיר
   כותרת + מנה `#rows=..#end`. נפתחה רשימה עם כפתורים והרשומה הראשונה של
   היישוב הנכון - מחזיר `btns-ok`.
4. left_click על הכפתור הראשון ברשימה: (1048,183) ב-viewport 1242x733, (1071,183)
   ב-1265x706. רוחב החלון משתנה → ה-x משתנה; לאמת פעם אחת מה-`btns` בפלט של
   `__runA` (או בצילום). כש-3 כבר גרף, הלחיצה נופלת על הטבלה ולא מזיקה.
   ב-viewport 1102x762 (5.11.2026): תיבת חיפוש (600,38), כפתור ראשון (902,251).
   `ctrl+a` הקליד "a" בתיבה - בטוח יותר: triple_click ואז BackSpace ×20.
5. javascript_tool: `await window.__runB('<name>','<sync_from>')` - `A` = שלב 3 כבר גרף; `B:...` =
   גרף עכשיו אחרי הלחיצה. ליישוב שיש לו עסקאות במסד - באותה קריאה גם
   `+' || '+(await window.__fin('<חתימות>'))` (שלב 5).

**batch נכשל ("failed in the extension")** - העבודה בדף ממשיכה. לקרוא את התוצאה:
`for(let i=0;i<25&&/^pending/.test(window.__last);i++) await new Promise(r=>setTimeout(r,1000)); document.title+' | '+window.__lastBtns+' | '+window.__last`
(הכותרת מכילה את שם היישוב שנבחר; `pending:<name>` = עדיין רץ). אם שם היישוב
ב-`__last` לא תואם - להריץ את היישוב שוב, לא לכתוב תוצאה ישנה.

אחר כך: `#rows=0` / `diff[]` → `upsert_deals('<name>','[]')`; יש שורות → `upsert_deals_text` עם המנה
כמו שהיא (פלט נחתך? get_page_text מחזיר את ה-article `#__dump` במלואו); נכשל →
`deal_sync_fail`. באותו סבב עם ה-batch של היישוב הבא.

**תוצאות `__runA`:**
| תוצאה | משמעות | מה עושים |
| --- | --- | --- |
| `עסקאות ביישוב (N)...` | נגרף | כותבים |
| `btns-ok` | רשימה, הראשון של היישוב | `__runB` אחרי הלחיצה גורף |
| `B:no-tab` | אחרי הכפתור יש רק לשונית חלקה | `deal_sync_fail` |
| `FIND {"ok":"btns","first":"<אחר>"..}` | הרשומה הראשונה מיישוב שכן | ללחוץ על הכפתור של היישוב הנכון מ-`btns`, ואז `__go2`; אין כזה → fail |
| `FIND {"ok":false..}` | רק "עסקאות בחלקה" / כלום | `deal_sync_fail` |
| `FIND no-hl` | אין פוליגון ואין חלקות ליד המרכז | `document.title` מכיל את שם היישוב? → `deal_sync_fail` (עיר → חיפוש כתובת, שלב 3) |
| `FIND no-result` | הרשימה לא נטענה / שם שונה | להקליד שוב (או חלק מהשם); `JSON.stringify(__res().map(r=>r.t))` מראה את השמות |
| `{"nohl":1,...}` | נבחר לפי חלקה קרובה למרכז, בלי פוליגון | לציין בסיכום כפחות ודאי |

שמות ב-Govmap שונים לפעמים מה-DB: "זרעית (כפר רוזנוואלד)", "ביתן אהרון",
"בן שמן (כפר הנוער)", "קריית גת" (ב-DB "קרית גת"), "קריית מלאכי", "קריית שמונה",
"יוקנעם עילית" (ב-DB "יקנעם עילית"), "רם און", "יוטבתה", "כפר רתמים", "שומרייה", "אל רום" - ל-`__runA` שם כמו ב-Govmap, ב-SQL שם כמו ב-DB. שמות עם גרשיים
(תלמי ביל"ו) - ב-SQL גרש בודד כפול (`'ניצן ב'''`). שם שמצביע על יישוב אחר (פוריה -
כפר עבודה → רק "פורייה (נווה עובד)") → fail.

## 1. מה לעדכן
```sql
select string_agg(name||':'||sync_from, ', ' order by rn)
from (select name, sync_from, row_number() over () rn
      from deal_sync_plan(100, '{}')) t;
```
רק יישובים שהגיע תורם. ריק - אין מה לעדכן: לדווח וזהו.

**סדר עדיפויות (מובנה ב-`deal_sync_plan`, מ-26.10.2026):**
- `sync_every_days`: 14 לשוק עפולה-העמק ולכל יישוב עם 100+ עסקאות בשנה האחרונה
  (~130 יישובים - שם נמצאות כמעט כל העסקאות החדשות); 30 לשאר. הם מגיעים ראשונים
  (`order by sync_every_days < 30 desc`). שבועי היה מוקדם מדי: Govmap מתעדכן בערך
  פעם בחודש, ובבדיקה אחרי 17 יום 73 ערים הניבו 5 עסקאות חדשות בלבד.
- **יישובים בלי אף עסקה במאגר** (מ-5.11.2026): פעם ב-120 יום, נמדד מ-
  `coalesce(last_synced_at, last_attempt_at)` - הכלל מחושב בתוך `deal_sync_plan`, לא
  בעמודה. ~580 יישובים כאלה (כמעט כולם קיבוצים / מועצות אזוריות / יו"ש); בריצה של
  5.11 54 מהם הניבו 2 עסקאות. יישוב שקיבל עסקה ראשונה חוזר לבד ל-`sync_every_days`.
  הם מגיעים בתור אחרי כל היישובים עם עסקאות (`order by has_deals desc`).
- **תדירות הסריקה**: תזכורת אוטומטית ב-1 וב-15 לחודש (משימה מתוזמנת שבודקת את
  התור ושולחת התראה). הסריקה עצמה רק ידנית ב-Chrome של המשתמש. עסקאות מגיעות
  באיחור של שבועות-חודשים (ב-5.11 נוספו עסקאות מיוני-ספטמבר בערים שנסרקו
  באוקטובר), לכן חלון `max(sold_at) - 90` חשוב יותר מתדירות.
- אחר כך יישובים לפי `fail_streak` עולה (שבדרך כלל מצליחים), ואז הוותיקים בתור.
- **backoff**: `fail_streak` = כישלונות רצופים (טריגר על `deal_settlements` - עולה ב-
  `deal_sync_fail`, מתאפס ב-`upsert_deals`). 2+ כישלונות → היישוב לא בתור 14 / 28 /
  56 / 90 יום. לכן תמיד לקרוא ל-`deal_sync_fail` / `upsert_deals` - בלי זה ה-backoff
  לא עובד. לבדוק ידנית יישוב שב-backoff: `update deal_settlements set fail_streak=0
  where name='...'` מחזיר אותו לתור.
- קצב: ~32-45 שניות ליישוב (100 יישובים ≈ 55-70 דקות; ערים עם השוואת חתימות - שלב 5). יישובים קטנים כמעט תמיד
  נכשלים; 100 כאלה הניבו 3 עסקאות. כשהמשתמש מבקש "עדכן עסקאות" בלי פירוט - להריץ
  עד שהתור מגיע ליישובים עם `fail_streak>=1` / בלי עסקאות, ולשאול לפני שממשיכים לזנב.
- כשהזנב (יישובים בלי עסקאות) נסרק: 3-4 יישובים ב-browser_batch אחד עובד (כישלון
  מהיר, ~15 שניות), וכתיבת כמה `deal_sync_fail` בשאילתה אחת:
  `select deal_sync_fail(n,'<סיבה>') from unnest(array['א','ב']) n;`

יישוב ספציפי שלא בתור ("עדכן עסקאות בעפולה") - sync_from = `max(sold_at) - 90`
של היישוב ב-`market_deals_official`, ולעדכן אותו קודם. המשתמש מבקש "עד N
ערים" - `deal_sync_plan(N, ...)`.

**השווקים** (הפרמטר השני; כולם = `'{}'`):

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

(יש עוד שווקים ב-`cities.market_slug`.)

## 2. התקנת עוזרים (פעם אחת לכל טעינת עמוד)
העמוד: `https://www.govmap.gov.il/?lay=REAL_ESTATE_DEALS`. השכבה לא פעילה (אין קווים סגולים
על המפה) - "שכבות" → לסמן "עסקאות נדל"ן" → לסגור. שלוש קריאות javascript_tool:
קודם `__scrape`, אח"כ השאר, ואז עוזרי שלב 5. `typeof window.__runA!=='function'` - העמוד נטען מחדש, להתקין שוב.

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
 const clean=s=>(s||'').replace(/[]/g,'').trim();
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

```js
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
window.__tall=(h=80000)=>{Object.defineProperty(window,'innerHeight',{get:()=>h,configurable:true}); window.dispatchEvent(new Event('resize'));};
// טקסט ארוך ב-article נסתר; get_page_text מחזיר אותו במלואו (פלט javascript_tool נחתך ב-~1,000 תווים)
window.__show=(txt)=>{let a=document.getElementById('__dump'); if(!a){a=document.createElement('article'); a.id='__dump'; a.style.cssText='position:fixed;left:0;bottom:0;width:300px;height:40px;overflow:hidden;opacity:0.01;z-index:-1;white-space:pre;font-size:2px;pointer-events:none'; document.body.appendChild(a);} a.textContent=txt; return txt.length;};
window.__sb=(i,n=150)=>{const line=r=>r.map(v=>v==null?'':String(v).replace(/[|\n]/g,' ')).join('|').replace(/\|+$/,''); const rows=window.__rows.slice(i,i+n).map(line); return window.__show(`#rows=${rows.length}\n${rows.join('\n')}${rows.length?'\n':''}#end`) && rows.length;};
// גיבוי בלבד (אם get_page_text לא מחזיר את ה-article): מנות קטנות מהפלט, שורה ראשונה next/total
window.__tfit=(i,L=940)=>{const line=r=>r.map(v=>v==null?'':String(v).replace(/[|\n]/g,' ')).join('|').replace(/\|+$/,''); let n=0,s='';while(i+n<window.__rows.length){const t=window.__rows.slice(i,i+n+1).map(line).join('\n'); if(t.length>L)break; s=t;n++;} return (i+n)+'/'+window.__rows.length+'\n'+s;};
// br = שבירות בסדר התאריכים (צריך 0)
window.__wait=async()=>{for(let i=0;i<28&&!window.__done;i++) await sleep(1000); if(!window.__done) return 'running'; const R=window.__rows; const d=JSON.parse(window.__done); let br=0; R.forEach((r,i)=>{if(i&&r[3]>R[i-1][3])br++}); return JSON.stringify({pages:d.pages,rows:d.rows,end:d.log.at(-1),br});};
// פותח "עסקאות ביישוב" בעמוד אחד וגורף
window.__go=async(cutoff,city)=>{window.__tall(); await sleep(300); const tabs=[...document.querySelectorAll('span')].filter(e=>/^עסקאות ב/.test(e.innerText.trim())); const s=tabs.find(e=>/^עסקאות ביישוב/.test(e.innerText.trim())); if(!s) return 'no-tab'; const o=tabs.find(e=>e!==s); if(o){(o.closest('button')||o.parentElement).click(); await sleep(1500);} (s.closest('button')||s.parentElement).click(); await sleep(3000); const head=s.innerText.trim()+'\n'+[...document.querySelectorAll('table tr')].slice(1,3).map(tr=>tr.innerText.replace(/\s+/g,' ')).join('\n'); window.__done=null; window.__scrape(cutoff,city,45).then(r=>window.__done=r); return head+'\n'+await window.__wait();};
window.__go2=async(name,cutoff)=>{await sleep(2500); const g=await window.__go(cutoff,name); window.__sb(0,400); const txt=document.getElementById('__dump').textContent; return g+'\n'+(txt.length<900?txt:'BIG '+window.__rows.length);};
window.__res=()=>[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&e.innerText?.trim()==='יישוב').map(e=>{let b=e.parentElement; while(b&&b.innerText.split('\n').length<2) b=b.parentElement; const r=b.getBoundingClientRect(); return {t:b.innerText.replace(/\n/g,' / '),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}});
const fire=(t,x,y)=>{const o={clientX:x,clientY:y,bubbles:true,cancelable:true,pointerId:1,isPrimary:true,button:0,buttons:1,pointerType:'mouse',view:window}; t.dispatchEvent(new PointerEvent('pointerdown',o)); t.dispatchEvent(new MouseEvent('mousedown',o)); o.buttons=0; t.dispatchEvent(new PointerEvent('pointerup',o)); t.dispatchEvent(new MouseEvent('mouseup',o)); t.dispatchEvent(new MouseEvent('click',o));};
window.__selRes=(name)=>{const e=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&e.innerText?.trim()==='יישוב').map(e=>{let b=e.parentElement; while(b&&b.innerText.split('\n').length<2) b=b.parentElement; return b;}).find(b=>b.innerText.split('\n')[0].trim()===name); if(!e) return false; const r=e.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; fire(document.elementFromPoint(x,y),x,y); return true;};
window.__mclick=(x,y)=>{fire(document.elementFromPoint(x,y),x,y);};
window.__closeP=()=>{const h=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/^עסקאות נדל/.test(e.innerText||'')); if(!h) return 0; let p=h; for(let i=0;i<4;i++){p=p.parentElement; const b=p&&p.querySelector('button'); if(b){b.click(); return 1;}} return 0;};
// מחכה עד ~7 שניות לפאנל (לפעמים מתעכב עם ספינר)
window.__panel=async()=>{let res; for(let k=0;k<12;k++){await sleep(k?500:1200); const tabs=[...document.querySelectorAll('span')].filter(e=>/^עסקאות ב/.test(e.innerText.trim())).map(e=>e.innerText.trim()); const h=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/^עסקאות נדל/.test(e.innerText||'')); let p=h; for(let i=0;i<7&&p;i++) p=p.parentElement; const btns=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/צפייה בנתוני עסקאות/.test(e.innerText||'')).map(e=>{const r=e.getBoundingClientRect(); return Math.round(r.x+r.width/2)+','+Math.round(r.y+r.height/2)}); res={tabs, list:p?p.innerText.replace(/\n+/g,' / ').slice(0,300):null, btns}; if(tabs.length||btns.length) break;} return JSON.stringify(res);};
// פוליגון היישוב (מילוי תכלת) וקווי חלקות עם עסקאות (סגול) בתוכו, מהקנבס
window.__pick=()=>{const c=document.querySelector('canvas'); const W=c.width,H=c.height; const sx=W/c.getBoundingClientRect().width; const d=c.getContext('2d').getImageData(0,0,W,H).data; const S=4, gw=Math.floor(W/S), gh=Math.floor(H/S);
 const hl=(i)=>{const r=d[i],g=d[i+1],b=d[i+2]; return r>=150&&r<=200&&g>=180&&g<=225&&b>=205&&b<=250&&b-r>=25;};
 const vi=(i)=>{const r=d[i],g=d[i+1],b=d[i+2]; return b>180&&r<130&&g<110;};
 const m=new Uint8Array(gw*gh); for(let y=0;y<gh;y++)for(let x=0;x<gw;x++){ if(hl(((y*S)*W+x*S)*4)) m[y*gw+x]=1; }
 const lab=new Int32Array(gw*gh); let best=0,bestN=0,id=0; for(let s=0;s<gw*gh;s++){ if(!m[s]||lab[s])continue; id++; let n=0; const st=[s]; lab[s]=id; while(st.length){const p=st.pop(); n++; const px=p%gw,py=(p-px)/gw; for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){const qx=px+dx,qy=py+dy; if(qx<0||qy<0||qx>=gw||qy>=gh)continue; const q=qy*gw+qx; if(m[q]&&!lab[q]){lab[q]=id; st.push(q);}}} if(n>bestN){bestN=n;best=id;} }
 if(bestN<150) return JSON.stringify({hl:bestN});
 let cx=0,cy=0,x0=gw,x1=0,y0=gh,y1=0; for(let s=0;s<gw*gh;s++) if(lab[s]===best){const x=s%gw,y=(s-x)/gw; cx+=x;cy+=y; if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;} cx/=bestN; cy/=bestN;
 const inC=(gx,gy)=>{let k=0; for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){const qx=gx+dx,qy=gy+dy; if(qx<0||qy<0||qx>=gw||qy>=gh)continue; if(lab[qy*gw+qx]===best)k++;} return k;};
 const cand=[]; for(let y=y0*S;y<=y1*S;y+=2)for(let x=x0*S;x<=x1*S;x+=2){ if(vi((y*W+x)*4)&&inC(Math.round(x/S),Math.round(y/S))>=14) cand.push([x,y,Math.hypot(x/S-cx,y/S-cy)]);}
 cand.sort((a,b)=>a[2]-b[2]); const pts=[]; for(const p of cand){ if(pts.every(q=>Math.hypot(q[0]-p[0],q[1]-p[1])>40)) pts.push(p); if(pts.length>=2)break;}
 return JSON.stringify({hl:bestN,c:[Math.round(cx*S/sx),Math.round(cy*S/sx)],pts:pts.map(p=>[Math.round(p[0]/sx),Math.round(p[1]/sx)])});};
// מרכז שלם (רוחב אי-זוגי → אינדקס שבור); סגול בלבד, לא הסיכה הכחולה
window.__nearC=(R=220)=>{const c=document.querySelector('canvas'); const W=c.width,H=c.height; const sx=W/c.getBoundingClientRect().width; const d=c.getContext('2d').getImageData(0,0,W,H).data; const cx=Math.floor(W/2), cy=Math.floor(H/2); const cand=[]; for(let y=Math.max(0,cy-R);y<Math.min(H,cy+R);y+=2)for(let x=Math.max(0,cx-R);x<Math.min(W,cx+R);x+=2){const i=(y*W+x)*4; if(d[i+2]>=190&&d[i]>=45&&d[i]<=115&&d[i+1]<=85) cand.push([x,y,Math.hypot(x-cx,y-cy)]);} cand.sort((a,b)=>a[2]-b[2]); const pts=[]; for(const p of cand){ if(pts.every(q=>Math.hypot(q[0]-p[0],q[1]-p[1])>40)) pts.push(p); if(pts.length>=2)break;} return pts.map(p=>[Math.round(p[0]/sx),Math.round(p[1]/sx)]);};
// מקסימום 2 נקודות - אחרת ה-batch נכשל ב-timeout
window.__try=async(pts)=>{const log=[]; for(const [x,y] of pts.slice(0,2)){ window.__closeP(); await sleep(500); window.__mclick(x,y); const p=JSON.parse(await window.__panel()); log.push([x,y,p.tabs.join('|'),p.btns.length]); if(p.tabs.some(t=>/ביישוב/.test(t))) return JSON.stringify({ok:'tab',x,y}); if(p.btns.length){ const m=(p.list||'').match(/רחוב \/ [^/]*\/ ([^/]+?) \/ בוצעו/); return JSON.stringify({ok:'btns',first:m?m[1].trim():'',btns:p.btns,list:(p.list||'').slice(0,250)}); } } return JSON.stringify({ok:false,log});};
window.__find=async(name)=>{let ok=false; for(let i=0;i<10&&!ok;i++){ok=window.__selRes(name); if(!ok) await sleep(500);} if(!ok) return 'no-result'; let pk; for(let i=0;i<7;i++){await sleep(2000); pk=JSON.parse(window.__pick()); if(pk.pts&&pk.pts.length) break;} let pts=(pk.pts&&pk.pts.length)?pk.pts:(pk.c?[pk.c]:window.__nearC()); if(!pts.length) return 'no-hl'; const r=await window.__try(pts); return pk.c? r : r.replace('{','{"nohl":1,');};
window.__run=async(name,cutoff)=>{const f=await window.__find(name); let j; try{j=JSON.parse(f)}catch(e){return 'FIND '+f} if(j.ok!=='tab') return 'FIND '+f; const g=await window.__go(cutoff,name); window.__sb(0,400); const txt=document.getElementById('__dump').textContent; return g+'\n'+(txt.length<900?txt:'BIG '+window.__rows.length);};
window.__runA=async(name,cutoff)=>{window.__last='pending:'+name; window.__lastBtns=false; window.__last=await window.__run(name,cutoff); let j=null; try{j=JSON.parse(window.__last.replace(/^FIND /,''))}catch(e){} window.__lastBtns=!!(j&&j.ok==='btns'&&j.first===name); return window.__lastBtns? 'btns-ok' : window.__last.slice(0,600);};
window.__runB=async(name,cutoff)=>{ if(!window.__lastBtns) return 'A'; return 'B:'+await window.__go2(name,cutoff);};
'ok'
```

## 3. ערים ומנות גדולות
`BIG N` בפלט - לשלוף במנות: באותו סבב `window.__sb(i, N)` ואז get_page_text (מחזיר
את ה-article הנסתר במלואו), ואז SQL אחד. עד 400-480 שורות למנה עובד; יותר - מנות
שוות (524 → 262+262, 840 → 420+420, 1500 → 4×375). get_page_text לא מחזיר את
ה-article - `__tfit(0)` כגיבוי. `navigate` ל-`blob:` ו-`window.open` לא עובדים.
בעיר שכבר יש לה עסקאות - קודם שלב 5, ורק השורות שנשארות נשלפות.

**עיר**: קודם `__runA` לפי שם (עובד ברוב הערים - רמת גן, ירושלים, אשקלון, לוד...).
`no-result` / `no-hl` / רשימה של יישוב שכן → חיפוש כתובת "<רחוב> <מספר> <עיר>" (כתובת
מה-DB: הרחוב הנפוץ בעיר) ובמקום `__runA`/`__runB`: `await window.__runC('<name>','<sync_from>')`,
לחיצה על (1071,183), `await window.__runD(...)`. `__runC` בוחר את תוצאת "כתובת",
מחכה, לוחץ על חלקה סגולה ליד המרכז ופותח "עסקאות ביישוב". **לוודא שזו העיר**:
חיפוש כתובת נחת על מקום אחר (קדימה → גוש 73570; חזרה לחיפוש בשם תיקנה), וחיפוש
בשם עם `nohl` נחת על תל מונד באבן יהודה (כתובת תיקנה). סימן:
`__fin` מחזיר הרבה ימים שונים / מעט שורות מוזרות. "הרצליה" לא נמצא בשם - רק
בכתובת. בעיר: תמיד שלב 5 לפני הכתיבה.

**תקרת 1500**: אם `end` עדיין אחרי `sync_from`, Govmap לא נותן להגיע עמוק יותר.
לכתוב מה שיש ולציין בסיכום עד איזה תאריך הגענו.

## 4. תקלות שנתקלנו בהן
- צילומי מסך נכשלים לפעמים ("failed in the extension") - להמשיך: השיטה למעלה לא
  צריכה צילומים.
- פאנל פתוח מסתיר את חצי המפה ומזיז את המרכז - תמיד `__closeP()` לפני החיפוש.
- בחלקה רק לשונית "עסקאות בחלקה" (`__go` → `no-tab`) ואין חלקה אחרת עם הלשונית →
  `deal_sync_fail`. קיבוצים ויישובי בקעה/ערבה/יהודה ושומרון - הרבה פעמים בלי חלקות עם
  עסקאות (~מחצית מהתור); fail זו התוצאה הנכונה. נבדק ידנית (26.10.2026): גם
  יישובים גדולים ביו"ש (שילה, כוכב יעקב, טלמון, תקוע וכו') - פוליגון קיים, אין בתוכו
  אף חלקה סגולה ולחיצה לא פותחת פאנל. ב-Govmap אין להם נתוני עסקאות; לא באג.
  ביו"ש עובדים רק יישובים עירוניים (מודיעין עילית, אריאל, אפרת, קרני שומרון...).
- רשימה של יישוב שכן (`FIND {"ok":"btns","first":"<אחר>"}` בלי כפתור ליישוב הנכון):
  באר גנים → אשקלון, שיזף → משאבי שדה, הראל → רמת דן, חברון → קריית ארבע, אל רום → אודם.
  לא לכתוב → fail. "בארות יצחק" פותח "עסקאות ביישוב (1500)" עם רחובות ראש העין → fail.
- כמה `FIND no-hl` ברצף ביישובים שאמורים להיות בסדר → לצלם מסך פעם אחת: אם יש
  פוליגון/סגול במפה והעוזר לא מוצא, משהו נשבר (כך נמצא באג המרכז הלא-שלם ב-`__nearC`
  אחרי שינוי רוחב החלון).
- יישוב קטן שלא נמצא בשם - לחפש חלק מהשם, או "גוש X חלקה Y" לפי גוש/חלקה
  ידועים מה-DB.
- המפה ריקה / לא זזה - לטעון מחדש את ה-URL, לבחור שכבה, להתקין עוזרים.
- `apply_migration` ב-MCP מבקש אישור מהמשתמש ונתקע ב-timeout; DDL לא הרסני
  (create or replace, add column if not exists) עובר ב-`execute_sql`.

## 5. (כשיש עסקאות ב-DB בתקופה) השוואת חתימות - לא מעתיקים את כל העסקאות
עיר עם 300-1,200 שורות בחלון - להעתיק את כולן ל-SQL זה הרבה טקסט, וכמעט תמיד
כולן כבר במסד. במקום זה משווים **חתימה לכל יום**: לכל שורה hash של
`גוש-חלקה:תאריך:מחיר:שטח` (6 תווי hex מ-SHA-256), ולכל יום סכום ה-hashes mod 65536.
אותה חתימה ב-JS וב-SQL = אותן עסקאות באותו יום. רק ימים שונים נבדקים לעומק.

**א. חתימות מה-DB** - באותה קריאת SQL עם הכתיבה של היישוב הקודם:
```sql
with h as (select to_char(sold_at,'YYMMDD') m, left(encode(sha256(convert_to(gush||'-'||helka||':'||sold_at||':'||round(sale_price)||':'||coalesce(round(size_sqm)::text,''),'UTF8')),'hex'),6) x
  from market_deals_official where city='<name>' and sold_at >= '<sync_from>')
select string_agg(m||':'||lpad(to_hex(s::int),4,'0'), ',' order by m)
from (select m, sum(('x'||x)::bit(24)::int::bigint + 7919) % 65536 s from h group by m) t;
```
(`YYMMDD` ולא `MMDD` - חלון של יותר משנה מתנגש. NULL = אין עסקאות במסד → לכתוב את כל השורות.)

**ב. ב-batch של היישוב** - בשלב 5: `await window.__fin('<המחרוזת>')` → `rows N diff[...]`.
- `diff[]` → `upsert_deals('<name>','[]')`. זה המקרה הרגיל (~90% מהערים).
- ימים שונים, מעט שורות בהם (בודקים: `window.__rows.filter(r=>[...].includes(__dk(r[3]))).length`)
  → `await window.__keepDD('<ימים>','')` מציג את השורות של הימים האלה → `upsert_deals_text`.
- הרבה שורות בימים השונים → hashes מה-DB רק לימים האלה:
  ```sql
  select string_agg(left(encode(sha256(convert_to(gush||'-'||helka||':'||sold_at||':'||round(sale_price)||':'||coalesce(round(size_sqm)::text,''),'UTF8')),'hex'),6), ',')
  from market_deals_official where city='<name>' and to_char(sold_at,'YYMMDD') in ('260609',...);
  ```
  ואז `await window.__keepDD('<ימים>','<hashes>')` - משאיר רק שורות שאין להן התאמה.
  ברוב המקרים יוצא 0: במסד יש יותר שורות (הצגות כפולות ישנות), לא פחות.

השורות שנשארות הולכות ל-`upsert_deals_text` כרגיל; הסינון האמיתי (±יום, תת-חלקה)
עדיין ב-`upsert_deals` - הרבה מהן חוזרות `unchanged`, וזה בסדר.

עוזרים (להתקין יחד עם שלב 2):
```js
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fire=(t,x,y)=>{const o={clientX:x,clientY:y,bubbles:true,cancelable:true,pointerId:1,isPrimary:true,button:0,buttons:1,pointerType:'mouse',view:window}; t.dispatchEvent(new PointerEvent('pointerdown',o)); t.dispatchEvent(new MouseEvent('mousedown',o)); o.buttons=0; t.dispatchEvent(new PointerEvent('pointerup',o)); t.dispatchEvent(new MouseEvent('mouseup',o)); t.dispatchEvent(new MouseEvent('click',o));};
window.__h6=async s=>{const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)); return [...new Uint8Array(b)].slice(0,3).map(x=>x.toString(16).padStart(2,'0')).join('');};
window.__hs=async()=>{const o=[]; for(const r of window.__rows){o.push(await window.__h6(`${r[0]}-${r[1]}:${r[3]}:${Math.round(r[4])}:${r[5]==null?'':Math.round(r[5])}`));} return o;};
window.__dk=d=>d.slice(2,4)+d.slice(5,7)+d.slice(8,10);
window.__dayMap=async()=>{const h=await window.__hs(); const m={}; window.__rows.forEach((r,i)=>{const k=window.__dk(r[3]); m[k]=((m[k]||0)+parseInt(h[i],16)+7919)%65536;}); return m;};
window.__diffD=async(db)=>{const m=await window.__dayMap(); const d={}; for(const p of (db||'').split(',').filter(Boolean)){const [k,v]=p.split(':'); d[k]=v;} const diff=[]; for(const k of Object.keys(m)){ if(m[k].toString(16).padStart(4,'0')!==d[k]) diff.push(k);} return diff.sort().join(',');};
window.__fin=async(db)=>'rows '+window.__rows.length+' diff['+(await window.__diffD(db))+']';
// משאיר שורות שאין להן hash תואם (לפי ספירה), ומציג ב-#__dump
window.__keepH=async(hs)=>{const cnt=new Map(); for(const k of (hs||'').split(',').filter(Boolean))cnt.set(k,(cnt.get(k)||0)+1); const h=await window.__hs(); const out=[]; window.__rows.forEach((r,i)=>{const c=cnt.get(h[i])||0; if(c>0) cnt.set(h[i],c-1); else out.push(r);}); const before=window.__rows.length; window.__rows=out; window.__sb(0,500); return before+'→'+out.length;};
window.__keepDD=async(days,hs)=>{const ds=days.split(','); window.__rows=window.__rows.filter(r=>ds.includes(window.__dk(r[3]))); const k=await window.__keepH(hs); const t=document.getElementById('__dump').textContent; return k+'\n'+(t.length<900?t:'BIG - get_page_text');};
// עיר דרך חיפוש כתובת
window.__selAddr=()=>{const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.innerText?.trim()==='כתובת'); if(!e) return false; let b=e.parentElement; while(b&&b.innerText.split('\n').length<2) b=b.parentElement; const r=b.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; fire(document.elementFromPoint(x,y),x,y); return true;};
window.__runC=async(city,cutoff)=>{window.__last='pending:'+city; window.__lastBtns=false; let ok=false; for(let i=0;i<10&&!ok;i++){ok=window.__selAddr(); if(!ok) await sleep(500);} if(!ok){window.__last='FIND no-addr'; return window.__last;} await sleep(4000); window.__closeP(); await sleep(800); const pts=window.__nearC(); if(!pts.length){window.__last='FIND no-hl'; return window.__last;} const f=await window.__try(pts); const j=JSON.parse(f); if(j.ok==='tab'){const g=await window.__go(cutoff,city); window.__last=g; return g.slice(0,400);} window.__last='FIND '+f; window.__lastBtns=!!(j.ok==='btns'&&j.first===city); return window.__lastBtns?'btns-ok':window.__last.slice(0,500);};
window.__runD=async(city,cutoff)=>{ if(!window.__lastBtns) return 'A'; await sleep(2500); const g=await window.__go(cutoff,city); return 'B:'+g.slice(0,400);};
'ok'
```

**הקצב בפועל (26.10.2026):** 73 ערים בשיטה הזו - כ-57 דקות, 16 עסקאות חדשות. כמעט
כל ה-`diff` חזרו ריקים; כשלא - בדרך כלל `unchanged`.

## 6. כתיבה
```sql
select upsert_deals_text('<name>', $l$
#rows=N
...
#end
$l$) - 'rejected';
```
כמו שהוא, כולל `#rows=` ו-`#end` - זו כל ההגנה מפני עסקאות שנעלמות. `$l$` ולא
גרשיים (קוטג'). `{"error":"truncated"}` - שום דבר לא נכתב, לשלוח שוב בחצי הגודל.
כל המנות של יישוב באותה הרצה.

אין עסקאות חדשות: `select upsert_deals('<name>', '[]');` - חובה, כך היישוב יוצא מהתור
ל-`sync_every_days` ו-`fail_streak` מתאפס. נכשל: `select deal_sync_fail('<name>', '<מה קרה, במשפט>');`

## 7. ממשיכים וסיכום
יישוב אחרי יישוב בלי לעצור לדווח. כשנגמרה הרשימה ו-`due_total` גדול יותר - שלב 1
שוב. לפני הסיכום - לוודא שלא נשכח יישוב (קרה: טירת כרמל נגרפה ולא נכתבה):
`select name from deal_settlements where name in (<רשימת התוכנית>) and last_attempt_at < <תחילת הריצה>`
- כל שורה שחוזרת → `upsert_deals` / `deal_sync_fail` עכשיו. בסוף, גם אם עצרת באמצע:
```sql
select deal_sync_run_finish()->>'summary';
```
להציג למשתמש **כמו שהוא** (נשלח גם בוואטסאפ ובפעמון ב-CRM), ולציין
מקרים פחות ודאיים (`nohl`, גוש חריג, רשימה כללית), ואת משך הריצה. לא צריך לרשום ריצה ב-
`market_deal_import_runs` - הפונקציות עושות את זה.