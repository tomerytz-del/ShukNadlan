---
name: agreement-signing
description: עבודה על החתמת לקוחות על הסכמי תיווך בריפו של שוק נדל״ן - sign.html, ה-Edge Function agreement-sign, האימות לפני הצגת ההסכם (הודעת וואטסאפ נכנסת "אימות חתימה", קוד במייל, תבנית AUTHENTICATION עתידית), חתימה פנים מול פנים לפי ה-JWT של הסוכן/ת, prepare_agreement בבוט, והנעילה של גוף המסמך. Use when a signer is stuck on the verification screen, when "הקישור אינו תקין" appears on a valid link, when touching sign.html / agreement-sign / agreement-wa-verify.ts / whatsapp-otp.ts / prepare_agreement, when adding a verification channel, when changing how the WhatsApp webhook routes inbound messages, or when touching an ID-number (ת.ז.) field in a signing form, the agreement wizard, the client card, the agent profile or office opening (assets/il-id.js, "המספר נכון - לאשר בכל זאת").
---

# החתמת לקוחות על הסכם

המסמך המלא: `docs/client-agreements.md` — ובראשו "צורות החתימה במבט אחד".
כאן רק מה ששובר **בשקט**: כל אחד מהסעיפים למטה נראה תקין בבדיקה ידנית
ונכשל רק אצל הלקוח/ה הראשון/ה שהמקרה שלו/ה שונה.

## המפה

| קובץ | תפקיד |
| --- | --- |
| `sign.html` | הדף של החותם/ת: שער האימות, לוח החתימה, ההמתנה לאימות בוואטסאפ |
| `supabase/functions/agreement-sign/index.ts` | `open` / `otp_send` / `otp_verify` / `sign` / `view` (לפי אסימון) · `send` / `finalize` (‏JWT) |
| `supabase/functions/_shared/agreement-wa-verify.ts` | האימות בהודעה נכנסת: הקישור `wa.me`, והבדיקה שה-webhook מריץ |
| `supabase/functions/_shared/whatsapp-otp.ts` | קוד **יוצא** בוואטסאפ — רק עם `WHATSAPP_OTP_TEMPLATE` |
| `supabase/functions/whatsapp-webhook/index.ts` | קורא ל-`handleWaSignVerify` **לפני** זיהוי הסוכן/ת |
| `supabase/functions/whatsapp-webhook/agent.ts` | `prepare_agreement`, ‏`otpReachable` |

## שבעה דברים ששוברים בשקט

### 1. הודעת האימות נתפסת לפני זיהוי הסוכן/ת

ב-`handleMessage` הקריאה ל-`handleWaSignVerify` יושבת **מיד אחרי**
`markReadAndTyping`, לפני השאילתה על `agency_members`. מי שמזיז אותה
אחרי הזיהוי — הלקוח/ה אינו/ה סוכן/ת, ולכן מקבל/ת "איני מזהה את מספר
הטלפון שלך" ונתקע/ת. שום בדיקה לא תיכשל: סוכן/ת שבודק/ת מהטלפון שלו/ה
**כן** מזוהה.

### 2. ה-nonce שורד בין קריאות ל-`open`

הדף קורא ל-`open` כל 3 שניות בזמן ההמתנה. ‏nonce חדש בכל קריאה פוסל את
ההודעה שהלקוח/ה **כבר שלח/ה**. לכן `open` יוצר nonce רק כשהקיים ישן
מ-25 דקות (‏`WA_VERIFY_TTL_MINUTES - 5`, כדי שלא יפוג באמצע ההמתנה).

### 3. המספר שממנו נשלח הוא האימות — לא ה-nonce

שש ספרות יכולות לחזור אצל שני חותמים. ‏`handleWaSignVerify` מוצא את
**כל** השורות עם ה-nonce ובוחר את זו שהנייד שלה הוא ה-`from` של Meta.
אסור לקצר ל-`maybeSingle()` על ה-nonce: זה גם נופל על כפילות, וגם
מאמת/ת לפי מה שהגולש/ת הקליד/ה במקום לפי מה ש-Meta מעידה.

### 4. נרמול הנייד — שלושה מקומות, נרמול אחד

| מקום | צורה |
| --- | --- |
| `toWhatsappMsisdn` ב-`_shared/whatsapp-invite.ts` | `05XXXXXXXX` / `9725XXXXXXXX` → `9725XXXXXXXX` |
| `otpReachable` ב-`agent.ts` | אותו regex, מוטבע |
| `msg.from` מ-Meta | `9725XXXXXXXX` |

שינוי באחד בלבד = הבוט מאשר הסכם שאין לו דרך אימות, או שהאימות נדחה
על המספר הנכון.

### 5. קוד יוצא בוואטסאפ — רק בתבנית AUTHENTICATION

‏Meta דוחה טקסט חופשי מחוץ לחלון 24 השעות, ולקוח/ה שמקבל/ת קישור
מעולם לא כתב/ה לעסק. **אסור להעביר קוד דרך תבנית UTILITY/MARKETING**
(למשל `WHATSAPP_NOTIFY_TEMPLATE`): זו הפרת מדיניות שעלולה לסווג מחדש את
התבנית או לפגוע בחשבון. בלי `WHATSAPP_OTP_TEMPLATE`, ‏`otpChannels`
אינו מחזיר `whatsapp` בכלל — ניסיון היה תמיד נכשל ורק מעכב את המייל.

### 6. פנים מול פנים — בעל/ת ההסכם בלבד

`isOwningAgentSession` משווה את `agency_members.id` של ה-JWT ל-
`agreement.agent_id`. לא משרד, לא מנהל/ת. החתימה נרשמת `manual` — זה מה
שהעמודה מתעדת (המכשיר), לא איזה מסך שימש.

### 7. "הקישור אינו תקין" רק כשהאסימון באמת לא קיים

`loadByToken` מבחין: שגיאת שאילתה → `db_error` (‏503, "תקלה זמנית"),
אין שורה → `not_found` (‏404) **ונרשם ביומן** עם אורך האסימון. עד
1.10.2026 כל תקלה הוצגה כ"הועתק חלקית" על קישור שנפתח דקה קודם. מי
שמוסיף שאילתה שם — בודק `error` לפני `data`.

## ת.ז. נבדקת בזמן ההזנה - ותמיד עם עקיפה

כל שדה ת.ז. שמזין הסכם נושא `data-il-id` ונבדק מול ספרת הביקורת ב-
`assets/il-id.js` (‏`IlId`): ‏`sign.html`, האשף (טופס החותמים, `agrValidate`,
המילוי המהיר), כרטיס הלקוח/ה, פרטי הסוכן/ת, ושתי דרכי פתיחת המשרד. הטבלה
המלאה: `docs/client-agreements.md`, "בדיקת ת.ז. בזמן ההזנה".

- **העקיפה היא חלק מהכלל, לא חור בו.** הבדיקה תופסת טעות הקלדה, לא זהות.
  שדה חדש בלי "המספר נכון" חוסם לקוח/ה אמיתי/ת. לכן גם **אין** בדיקה בשרת
  (‏`agreement-sign`, ‏`agency-signup`, ‏`create-own-agency` שומרים מה שהגיע).
- **האישור קשור לערך** (`data-il-id-ok`). טופס שמצויר מחדש (האשף) מאבד
  אותו - ולכן הוא נשמר על החותם/ת (`id_override`, האירוע `il-id-override`).
- **ערך שכבר שמור נחשב מאושר** (כרטיס, פרופיל): אחרת כל שמירה של הערות
  הייתה דורשת אישור מחדש. ת.ז. של הסוכן/ת נבדקת פעם אחת, בפתיחת המשרד.
- דרכון אינו נבדק (`data-il-id="off"`), ושדה `readOnly` (מולא מראש) גם לא.
- שדה ת.ז. חדש: `data-il-id` + `IlId.check(input)` לפני השליחה, ושורה בטבלה במסמך.

## הבוט בודק לפני שהוא יוצר

`prepare_agreement` בודק את `otpReachable` **לפני** ה-insert, כי
`agreements_freeze_body` נועל את גוף המסמך ביצירה: הסכם שנוצר בלי דרך
אימות אפשר רק לבטל. ערוץ אימות חדש → לעדכן את `otpReachable` באותו PR.

## מיגרציה + פונקציה באותו PR

הפונקציות והמיגרציות נפרסות בשני jobs נפרדים, בלי סדר מובטח. קוד שכותב
לעמודה חדשה חייב לשרוד את הדקה שבה היא עוד לא קיימת — ראו את הניסיון
השני ב-`issueOtp` ואת `nErr` ב-`open`. אחרי המיזוג: לוודא בשאילתה
שהעמודה קיימת.

## בדיקה

אין סביבת staging; בודקים כך:

```sh
# טיפוסים — אסור להוסיף שגיאות מעל הרף
python3 scripts/check_edge_types.py          # צריך deno ב-PATH (npx -y deno@latest)

# מקף ארוך / בריחה / סיווג קישורי קשר
python3 scripts/check_long_dash.py
python3 scripts/check_escapers.py
python3 scripts/check_events.py              # כפתור האימות נושא data-site-contact
```

- **`handleWaSignVerify`** — קובץ זמני ב-`_shared/` עם DB מדומה, ‏`deno run
  --no-check`: התאמה, מספר זר (בלי עדכון), nonce לא מוכר, הודעה רגילה
  (`null`), ושני חותמים עם אותו nonce.
- **`sign.html`** — Playwright מול שרת סטטי, עם `page.route` על
  `functions/v1/agreement-sign`. ‏jsdelivr חסום בקונטיינר: מגישים את
  `@supabase/supabase-js@2.116.0` מ-npm במקומו (ה-SRI תואם — אותו קובץ),
  אחרת מסלול פנים מול פנים לא נבדק כלל (`window.supabase` חסר).
- **מול Meta** — רק ידנית, מהטלפון, עם הסכם שבו הנייד שלך רשום כלקוח/ה.
