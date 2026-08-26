# לידי ייעוץ משכנתאות — הפעלה

פונים משאירים פרטים בטופס שנפתח ממחשבון המשכנתא בדף הבית, והליד נמכר
ליועצ/ת משכנתאות אחד/ת ב-**₪50** מיתרת הארנק — אותו מנגנון Pay-per-lead של
מדף לידי ה-RSS.

## הזרימה

```
דף הבית → מחשבון המשכנתא → "בדיקת זכאות מיידית וייעוץ אישי"
   ↓ בלון: שם מלא, טלפון, אימייל, "יש ברשותי דירה"
   ↓ POST (anon) → mortgage-lead-intake  [service_role]
mortgage_leads  status='new'
   ↓
CRM → "מדף לידי משכנתאות" (רק ל-is_mortgage_advisor)
   מציג את mortgage_leads_public — סכומים בלבד, בלי שם/טלפון/אימייל
   ↓ "רכישה — ₪50" → mortgage-lead-purchase  [JWT]
purchase_mortgage_lead()  ניכוי ארנק + status='sold' + יומן חיובים — טרנזקציה אחת
   ↓
פרטי הקשר נחשפים לקונה בלבד (policy "buyer reads purchased mortgage lead")
```

## הקבצים

| קובץ | תפקיד |
| --- | --- |
| `supabase/migrations/20260826120000_mortgage_leads.sql` | הטבלאות, ה-view, המחיר ופונקציית הרכישה האטומית |
| `supabase/functions/mortgage-lead-intake/index.ts` | קליטת הליד מהאתר (anon) — ולידציה וכתיבה ב-service_role |
| `supabase/functions/mortgage-lead-purchase/index.ts` | הרכישה (JWT) — עטיפה ל-`purchase_mortgage_lead` |
| `index.html` | המחשבון, כפתור ה-CTA והבלון |
| `crm.html` | מדף הלידים ליועצ/ת + "הלידים שרכשתי" |

## שלב 1 — מסד הנתונים

הריצו את `supabase/migrations/20260826120000_mortgage_leads.sql`
(SQL Editor → New query → הדבקה → Run). הקובץ אידמפוטנטי.

הוא יוצר:

- `mortgage_leads` — הליד המלא. שם, טלפון ואימייל רגישים; `anon` נשלל מהטבלה
  לגמרי ולא נשענים על RLS בלבד.
- `mortgage_leads_public` — ה-view של המדף: נתוני המחשבון בלבד
  (מחיר נכס, הון עצמי, אחוז מימון, ריבית, תקופה, החזר חודשי, `has_email`).
  ל-`authenticated` בלבד — זהו מלאי מקצועי בתוך ה-CRM ולא ויטרינה פומבית.
- `mortgage_lead_purchases` — יומן החיובים. `unique(lead_id)` מונע מכירה כפולה.
- `agency_members.is_mortgage_advisor` — מי רואה את המדף ורשאי לקנות.
- `pricing_config.mortgage_lead_price` = 50.

> **תלות:** המיגרציה משתמשת ב-`normalize_msisdn()` (מיגרציית הוואטסאפ),
> ב-`rss_set_updated_at()` (מ-`schema.sql`) וב-`current_agent_id()`. כולן כבר
> קיימות בפרויקט.

### למה ליד פתוח אחד לכל טלפון

```sql
create unique index mortgage_leads_open_phone_key
  on public.mortgage_leads (phone_e164) where status = 'new';
```

מי ששולח/ת פעמיים לא נמכר/ת פעמיים. אחרי שהליד נמכר האינדקס משחרר, כך
שפנייה חדשה מאותו אדם בעוד חצי שנה תיקלט כליד חדש. ה-intake מחזיר על
המצב הזה `{success:true, duplicate:true}` — מבחינת הפונה זו הצלחה.

## שלב 2 — פריסת ה-Edge Functions

```bash
supabase functions deploy mortgage-lead-intake   --no-verify-jwt
supabase functions deploy mortgage-lead-purchase
```

- **intake** נקראת ממבקר/ת אנונימי/ת באתר עם ה-anon key, ולכן `--no-verify-jwt`.
  היא כותבת ב-`SUPABASE_SERVICE_ROLE_KEY` כי הטבלה סגורה ל-anon.
- **purchase** מזיזה כסף, ולכן `verify_jwt` נשאר דלוק והיועצ/ת נגזר/ת מה-JWT
  המאומת בלבד — לעולם לא מה-body. אותה תבנית כמו `rss-lead-purchase`.

> `purchase_mortgage_lead` נעולה ל-`service_role`. זה לא קישוט: הטריגר
> `protect_sensitive_agency_member_fields` מתעלם משינוי `credit_balance` שלא
> הגיע מ-service_role, כך שחיוב ישירות מהדפדפן היה נבלע בשקט והליד היה
> נמכר בחינם.

## שלב 3 — לסמן יועצ/ת משכנתאות

יועצ/ת נרשמ/ת ל-CRM כרגיל (אותו מסך של סוכן/ת), ואז:

```sql
update public.agency_members
   set is_mortgage_advisor = true
 where id = '<member-uuid>';
```

מרגע זה נפתחת אצלה במסך הבית האקורדיון **"מדף לידי משכנתאות — רכישה"**.
הדגל נבדק פעמיים: פעם ב-`crm.html` (הצגת הסקציה) ופעם ב-`purchase_mortgage_lead`
עצמה — ה-gating בתצוגה הוא נוחות, ההגנה היא בפונקציה.

> יועצ/ת משכנתאות היא בעל/ת מקצוע ולא סוכן/ת תיווך, אבל כל מנגנון הרכישה
> (ארנק `credit_balance`, `current_agent_id()`, טריגר השדות הרגישים) בנוי סביב
> `agency_members`. הדגל מאפשר לרכוב על הארנק הקיים במקום לשכפל ארנק שני.
> אם בהמשך ייפתח מסלול הרשמה נפרד ליועצים — זו הנקודה שבה הוא מתחבר.

## שינוי המחיר

```sql
update public.pricing_config set value = 60 where key = 'mortgage_lead_price';
```

הן דיאלוג האישור ב-CRM והן הגבייה בפועל קוראים את הערך הזה, ולכן אין מצב
שהסוכן/ת רואה סכום אחד ומחויב/ת באחר. `mortgage_lead_purchases.amount` שומר
את הסכום **כפי שחויב בפועל**, כך ששינוי מחיר לא משכתב היסטוריית חיובים.

## מה נחשף ומתי

| שדה | לפני הרכישה | אחרי הרכישה |
| --- | --- | --- |
| מחיר נכס, הון עצמי, אחוז מימון, ריבית, תקופה, החזר חודשי | ✅ | ✅ |
| "יש ברשותי דירה" | ✅ | ✅ |
| האם הושאר אימייל (`has_email`) | ✅ | ✅ |
| שם מלא, טלפון, אימייל | ❌ | ✅ לקונה בלבד |
