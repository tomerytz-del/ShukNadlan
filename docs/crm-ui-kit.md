# ערכת הרכיבים של ה-CRM (`ui-*`)

שלב 1 בעיצוב מחדש של אזורי העבודה, ההגדרות והניהול
(`docs/handoff/crm-settings-redesign/HANDOFF.md`, סעיפים 1 ו-6). השלבים
הבאים (ההגדרות, הפרופיל, הלידים, הנכסים...) נבנים **מהרכיבים האלה**, ולא
מסגנון מוטבע חדש בכל מסך - אחרת נקבל שוב עשרים גרסאות של "צ'יפ" ושל
"פס שמירה", וכל אחת מתנהגת קצת אחרת.

| איפה | מה |
| --- | --- |
| `crm.html`, תחת "ערכת הרכיבים" | העיצוב: כל המחלקות `ui-*` וכללי הנייד |
| `crm.html`, ה-`:root` של "ניווט הצד" | הטוקנים (`--nv-*`), אותם טוקנים של סרגל הצד |
| `assets/crm-ui.js` | ההתנהגות: צ'יפ, מתג, מקופל, לשוניות, פס שמירה, "עוד X" |

## הכלל שהשתנה בכל ה-CRM: הכפתור הראשי כחול

‏`.btn-gold` (כ-130 כפתורים) צבוע מעכשיו `--nv-accent` ‏(`#1F5BF0`) ולא
בורדו. הבורדו הוא צבע המיתוג של המשרד ולא של המערכת (סעיף 1.2). מסך
הכניסה שומר על הגרדיאנט שלו (`#loginScreen .btn-gold`), כי שם הוא המותג
ולא פעולה בתוך המערכת. שאר השימושים ב-`--gold` (קווים, הדגשות) נשארו,
ועוברים מסך-מסך בשלבים הבאים.

## הטוקנים

| טוקן | ערך | שימוש |
| --- | --- | --- |
| `--nv-ink` | `#0E1A33` | טקסט ראשי, כרטיס `ui-hero` כהה |
| `--nv-ground` | `#F4F6FA` | רקע עמוד |
| `--nv-line` / `--nv-line-soft` | `#E3E7EF` / `#EEF1F6` | גבול כרטיס / קו פנימי |
| `--nv-muted` | `#5A6478` | טקסט משני (4.5:1 על לבן) |
| `--nv-accent` (`-h`, `-soft`, `-ink`) | `#1F5BF0` | כפתור ראשי, נבחר, צ'יפ פעיל |
| `--nv-navy` | `#1C3A5E` | אווטארים, "מהמשרד שלך", ימים נבחרים |
| `--nv-urgent` / `-ink` / `-soft` | `#C2410C` / `#9A3412` / `#FDE7D9` | דחוף, באיחור, **פעולה הרסנית כטקסט** |
| `--nv-warn` / `-soft` | `#7A5300` / `#FFF1C7` | חסר, לתשומת לב, טיוטה |
| `--nv-ok` / `-soft` | `#166534` / `#E6F4EC` | הושלם, מחובר, נענה |
| `--nv-gold` / `-dark` | `#E0B84A` / `#B8862B` | מסגרת שדה חסר (`ui-missing`), כתר מנהל/ת צוות |

## הרכיבים

כל רכיב לחיץ הוא `button` אמיתי בגובה 44px לפחות. בכל הדוגמאות כאן ה-HTML
נבנה ב-JS, ולכן כל ערך מהמסד עובר `escapeHtml`.

### כפתורים

```html
<button class="ui-btn">שמירה</button>
<button class="ui-btn ui-btn--secondary">חיבור מחדש</button>
<button class="ui-link">לכל ההתראות</button>
<button class="ui-link ui-link--danger">ניתוק היומן</button>   <!-- הרסני: טקסט, לא כפתור מלא -->
<button class="ui-icon-btn" aria-label="העתקה">…svg…</button>
```

‏`.ui-btn:disabled` אפור (`#E3E7EF`) ולא מעומעם - זה מצב "אין מה לשמור".

### צ'יפ, מתג, מסננים

```js
el.innerHTML = `<div class="ui-chips">${types.map(t => uiChip(t.label, { value:t.id, on:t.on })).join('')}</div>`;
uiChipValues(el)              // ['apt', 'house']
uiSetChips(el, ['apt'])       // מחיל מצב (ביטול שינויים)
uiSwitchHtml('לידים מבעלי נכסים', true)
```

- צ'יפ לכל בחירה של עד 6 אפשרויות, במקום `select`. ‏`.ui-chips[data-ui-single]`
  הוא בחירה אחת (כמו רדיו). `uiChip(label, { count, tone:'warn'|'hot', icon:false })`
  לצ'יפ מסנן עם מונה ("בלי תמונות 4").
- מסננים משניים: שורה של `select.ui-pill-select` בתוך `.ui-filters`. בנייד
  השורה גוללת לצדדים. ‏`.ui-chips.ui-chips--scroll` עושה אותו דבר לצ'יפים.
- צ'יפ ומתג ששינו מצב שולחים `input` שמבעבע - בדיוק כמו שדה רגיל.

### מקופל

```html
<section class="ui-fold" id="prefs" data-ui-fold-group="settings">
  <div class="ui-fold-head">
    <div class="ui-fold-title"><span class="ui-badge-ico">…</span>
      <div><h2 class="ui-h2">העדפות לידים</h2><div class="ui-fold-summary">9 שכונות · 4 סוגי נכס</div></div></div>
    <div class="ui-fold-tools">
      <!-- מה שעובד גם כשסגור: מתג, תגית מצב -->
      <button class="ui-icon-btn" data-ui-fold aria-expanded="false" aria-controls="prefsBody" aria-label="פתיחה וסגירה">${UI_ICON_CHEV}</button>
    </div>
  </div>
  <div class="ui-fold-body" id="prefsBody" hidden>…</div>
</section>
```

- סגור כברירת מחדל, ושורת הסיכום בכותרת אומרת מה בפנים.
- `data-ui-fold-group` על כמה מקופלים: רק אחד פתוח בכל פעם.
- `uiFoldOpen('prefs')` פותח מהקוד (למשל: מי שעוד לא הגדיר/ה - נפתח מעצמו).
- ה-section שולח `ui-fold` (‏`detail.open`) - לטעינה עצלה של התוכן.

### פס שמירה

```html
<div id="prefsBody">
  …השדות…
  <div class="ui-savebar">            <!-- ‏ui-savebar--sticky בדף ארוך -->
    <span class="ui-savebar-text"></span>
    <div class="ui-savebar-acts">
      <button class="ui-btn ui-btn--secondary" data-ui-reset>ביטול שינויים</button>
      <button class="ui-btn" data-ui-save>שמירת העדפות</button>
    </div>
  </div>
</div>
```

```js
const bar = uiSaveBar(root, {
  read:  () => ({ types: uiChipValues(typesEl), active: sw.getAttribute('aria-pressed') === 'true' }),
  apply: s  => { uiSetChips(typesEl, s.types); sw.setAttribute('aria-pressed', String(s.active)); },
  save:  async s => { const { error } = await sb.from(...).update(...); if (error) throw error; },
});
// אחרי שהערכים נטענו מהמסד ונכתבו לשדות:
bar.setBaseline();
```

- "יש שינויים" נקבע מהשוואה של `read()` למצב השמור, ולא מ"נגעו בשדה": שינוי
  וחזרה למצב המקורי מחזירים "כל השינויים שמורים".
- `save` שזורק משאיר את הפס במצב "יש שינויים" ומציג `heErr` בטוסט.
- `crmUnsavedInput` (השאלה ביציאה מה-CRM) שואל גם את `uiAnyDirty()`, כי צ'יפים
  ומתגים אינם שדות של `form` והבדיקה הישנה לא רואה אותם.

### רשימה במנות

```js
const pager = uiPager({
  mount: listEl, step: 10, noun: 'נכסים', countEl: countEl,
  render: p => `<div class="…">${escapeHtml(p.title)}</div>`,
  resetLabel: 'הצגת 10 בלבד',      // לא חובה
});
pager.setItems(rows);   // "מוצגים 10 מתוך 67" ו"עוד 10 נכסים (נשארו 57)"
```

### לשוניות, תגיות, באנרים, שורות קישור

- `.ui-tabs` עם `role="tablist"` ו-`.ui-tab` עם `role="tab"` ו-`aria-selected`.
  החצים, Home ו-End עוברים בין לשוניות (ב-RTL החץ השמאלי הוא "הבא").
  המסך מטפל ב-`click`, כמו לחיצה רגילה.
- `.ui-tag` + `--accent` / `--navy` / `--ok` / `--warn` / `--urgent`.
- `.ui-banner--warn` (חסר), `--urgent` (פס כהה עם עיגול כתום), `--info`.
  הטקסט ב-`.ui-banner-text`, והקישור לשדה/לפריט ב-`.ui-link`.
- `.ui-row-link` עם `.ui-row-title` ו-`.ui-row-sub` (‏`is-warn` לצהוב) -
  השורות של "ניהול המשרד".
- `.ui-hint`: הסבר של עד שתי שורות, כל משפט ב-`<span>` משלו.
- `.ui-missing` על שדה חסר: מסגרת זהב.

## נייד (עד 640px)

ריפוד כרטיס 16px, `ui-h1` ‏28px ו-`ui-h2` ‏20px, ומסננים/צ'יפים שגוללים
לצדדים. גריד של שני טורים נבנה עם `flex-wrap` ולא עם `@media`, ולכן נערם
לבד. המטרה: בלי גלילה אופקית של הדף ב-390px.

## שלושה דברים שנלמדו בשלב 2

- **`display` גובר על `[hidden]`.** כל רכיב כאן מגדיר `display:flex` או `grid`,
  ולכן `hidden` לא הסתיר אותו - מקופל סגור הציג את גופו, ובאנר "מושהה" הוצג
  ליד מתג דלוק. הכלל `.ui-scope [hidden]{display:none!important}` מכסה את כולם;
  רכיב חדש עובד בתוך `.ui-scope`.
- **המתג 38px כמו בעיצוב, ושטח הלחיצה 50px** - שכבה שקופה ב-`::after`.
- **לחיצה על כותרת של מקופל** (לא על מתג או כפתור שבה) פותחת וסוגרת כמו החץ.

השימוש הראשון בערכה: `docs/crm-settings.md`.
