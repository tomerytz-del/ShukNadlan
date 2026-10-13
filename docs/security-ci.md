# בדיקות אבטחה ב-CI

שתי בדיקות שרצות בלי שאף אחד צריך לזכור אותן.

## סודות בקוד - gitleaks

‏`.github/workflows/secrets.yml` מריץ את [gitleaks](https://github.com/gitleaks/gitleaks)
על **הקומיטים** של כל PR, ובכל push ל-`main`. בודקים קומיטים ולא רק את
המצב הסופי, כי סוד שנוסף ונמחק בקומיט הבא עדיין יושב בהיסטוריה של git,
ולכן עדיין דלף.

- **בלי סינון נתיבים:** סוד יכול לשבת בכל קובץ, ובדיקה נדרשת שמדולגת
  חוסמת מיזוג לנצח (‏CLAUDE.md, "גרסאות מיגרציה").
- **הבינארי עצמו, בגרסה נעולה עם checksum,** ולא ה-Action הרשמי, שדורש
  רישיון לחשבון ארגון.
- **רשימת ההיתר ב-`.gitleaks.toml`:** ערכים שהם ציבוריים בכוונה, כמו
  מפתח ה-publishable של Supabase, טוקן GovMap שנעול לדומיין ותגית האימות
  של Search Console, ושמות מפתחות הגדרה שאינם סודות. כל שורה עם נימוק.
  ההרצה הראשונה (אוקטובר 2026, על כל ההיסטוריה) מצאה 85 ממצאים, וכולם
  היו מהסוגים האלה.

**כשהבדיקה נכשלת על סוד אמיתי:** מחיקה מהקוד **לא מספיקה**, כי הוא כבר
בהיסטוריה. מחליפים (rotate) את הסוד אצל הספק, מעדכנים ב-Supabase Secrets
או ב-GitHub Secrets, ורק אז מוחקים מהקוד.

הרצה מקומית:

```sh
gitleaks git . -c .gitleaks.toml --log-opts="origin/main..HEAD"
```

## תלויות - Dependabot

‏`.github/dependabot.yml`: פעם בשבוע, PR מקובץ אחד לכל אקוסיסטם.

| מכוסה | לא מכוסה |
| --- | --- |
| ‏GitHub Actions ב-workflows | פונקציות ה-Edge (Deno, ‏`jsr:`/`npm:` בתוך הקוד) |
| ‏`requirements.txt` (המנועים) | ‏supabase-js שנטען מ-CDN בדפים |
| ‏`ops_agent/requirements.txt` | |

מה שלא מכוסה נעול לגרסה מדויקת ומתעדכן ידנית. **התראות האבטחה של
Dependabot** (‏Dependabot alerts) נדלקות בהגדרות הריפו ב-GitHub
(‏Settings ← Code security), לא בקובץ הזה.

## ‏Actions נעולים ל-SHA

כל `uses:` ב-workflows נעול לקומיט, עם הערת הגרסה אחריו:

```yaml
uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
```

**למה:** תג כמו `@v4` הוא מצביע שבעלי ה-Action יכולים להזיז. מי שמשתלט/ת על
הריפו שלהם מזיז/ה אותו לקוד זדוני, והקוד הזה רץ אצלנו עם הסודות של המסד. כך
בדיוק קרה ב-`tj-actions/changed-files` ב-2025. ‏SHA לא זז.

**העדכונים לא נפגעים:** Dependabot מעדכן גם את ה-SHA וגם את ההערה.

**האכיפה:** `scripts/check_action_pins.py` (job ‏`action-pins` ב-`secrets.yml`)
חוסם `uses:` בלי SHA או בלי הערת גרסה. את ה-SHA של תג מוצאים כך:
`git ls-remote https://github.com/<owner>/<repo> refs/tags/<tag>`.
