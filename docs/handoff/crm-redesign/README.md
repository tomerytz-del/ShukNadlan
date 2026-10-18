# חבילת העברה: שדרוג ה-CRM של שוק נדל״ן

**איך משתמשים:**
1. מעתיקים את התיקייה `crm-redesign/` לריפו, ל-`docs/handoff/crm-redesign/`, ליד `docs/handoff/office-dashboard/` הקיימת.
2. פותחים סשן של Claude Code על הריפו ומדביקים את התוכן של `PROMPT.txt`.

**מה יש כאן:**

| קובץ | מה |
| --- | --- |
| `HANDOFF.md` | המסמך המלא: החלטות, מפת המסכים, כל שלב עם המקורות בקוד ובמסד, בדיקות, סדר ביצוע ושאלות פתוחות |
| `PROMPT.txt` | הפרומפט הפותח ל-Claude Code |
| `sql/draft_01_teams_and_active_agent.sql` | צוותים, `team_id`, `is_active_agent`, `current_led_team_id()`, `my_roles()`, RLS |
| `sql/draft_02_team_dashboard_and_leads.sql` | `team_dashboard`, ‏`team_leads` (בלי טלפונים), והרחבת `_office_dashboard_core` |
| `sql/draft_03_coaches.sql` | טבלאות למאמן הסוכן/ת ולמאמן הצוות, `agent_coach_due`, ‏`coach_action_done` |
| `sql/draft_04_onboarding_state_v2.sql` | ההרחבה של `agent_onboarding_state()` ל-7 צעדים |
| `design/SCREENS.md` | רשימת המסכים, ואיך לקרוא את קובצי העיצוב |
| `design/*.dc.html` | המסכים מקנבס העיצוב (HTML עם סגנון מוטבע) |
| `design/canvas.json` | סדר המסכים והמידות בקנבס |

**ה-SQL הוא טיוטה.** הוא נכתב אחרי בדיקה של המסד החי ב-17-18.10.2026. Claude Code מאמת אותו שוב,
ומכניס אותו רק כמיגרציה בצינור.

**הקנבס המקורי** (לצפייה ולהערות): https://claude.ai/code/artifact/ae09b6c5-f359-47e9-803d-b38346012a5d
