#!/usr/bin/env bash
# ============================================================================
# מילוי לאחור של סט הדמיות הבסיס
#
# הטריגר האוטומטי יורה רק על *אירוע פרסום* — נכס שנעשה active, או נכס פעיל
# שקיבל תמונות בפעם הראשונה. נכס שכבר מפורסם עם תמונות לא יעבור אף אחד
# מהשניים לעולם, ולכן בלי דחיפה ידנית אחת הוא לא יקבל הדמיות בכלל.
# הסקריפט הזה הוא הדחיפה הזו.
#
# הרצה:
#   SUPABASE_SERVICE_ROLE_KEY=eyJ... scripts/visualizations_backfill.sh
#   SUPABASE_SERVICE_ROLE_KEY=eyJ... scripts/visualizations_backfill.sh --dry-run
#   SUPABASE_SERVICE_ROLE_KEY=eyJ... scripts/visualizations_backfill.sh <property_id>...
#
# בלי ארגומנטים הסקריפט שואב את רשימת הנכסים הזכאים מה-DB בעצמו: נכס פרטי
# פעיל, של סוכן/ת Premium פעיל/ה, עם תמונות, שאינו קרקע. אלה בדיוק התנאים
# של property_visualizations_enabled ושל הטריגר.
#
# בטוח להריץ שוב: הפונקציה מדלגת על מטרה שכבר קיימת (אלא אם FORCE=1), ולכן
# הרצה חוזרת אינה מייצרת תמונות כפולות ואינה עולה קריאות Gemini נוספות.
# ============================================================================
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-obookujgolazrwycsiyn}"
BASE_URL="${SUPABASE_URL:-https://${PROJECT_REF}.supabase.co}"
KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
FORCE="${FORCE:-0}"
DRY_RUN=0

if [ -z "$KEY" ]; then
  echo "שגיאה: SUPABASE_SERVICE_ROLE_KEY לא מוגדר." >&2
  echo "המפתח נמצא ב-Supabase → Settings → API → service_role. אין לשמור אותו בקובץ." >&2
  exit 1
fi

IDS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --force)   FORCE=1 ;;
    -*) echo "דגל לא מוכר: $arg" >&2; exit 1 ;;
    *)  IDS+=("$arg") ;;
  esac
done

# ---- הרשימה -----------------------------------------------------------------
# ‏PostgREST ולא psql: אין כאן תלות ב-connection string או בסיסמת DB, ואותם
# תנאים בדיוק כמו ב-scripts/visualizations_setup.sql חלק 3.
if [ ${#IDS[@]} -eq 0 ]; then
  echo "שולף את רשימת הנכסים הזכאים..."
  LIST=$(curl -fsS "${BASE_URL}/rest/v1/properties?select=id,property_type,images,agency_members!inner(tier,active,billing_status)&category=eq.residential&status=eq.active&agency_members.tier=eq.premium&agency_members.active=is.true&agency_members.billing_status=eq.active" \
    -H "apikey: ${KEY}" -H "Authorization: Bearer ${KEY}")

  # סינון בצד הלקוח על שני תנאים ש-PostgREST לא מבטא: מערך תמונות לא ריק,
  # וסוג נכס שאינו קרקע. הביטוי זהה ל-public.is_land_property_type.
  while IFS= read -r id; do
    [ -n "$id" ] && IDS+=("$id")
  done < <(printf '%s' "$LIST" | python3 -c '
import json,re,sys
LAND = re.compile("מגרש|קרקע|נחל|משק|חקלא")
for p in json.load(sys.stdin):
    if not p.get("images"):
        continue
    if LAND.search(p.get("property_type") or ""):
        continue
    print(p["id"])
')
fi

if [ ${#IDS[@]} -eq 0 ]; then
  echo "אין נכס זכאי למילוי לאחור."
  echo "‏(נכס צריך להיות: פרטי, active, של סוכן/ת Premium פעיל/ה, עם תמונות, ולא קרקע.)"
  exit 0
fi

echo "‏${#IDS[@]} נכסים לעיבוד."
if [ "$DRY_RUN" = "1" ]; then
  printf '%s\n' "${IDS[@]}"
  echo "‏--dry-run: לא נשלחה אף בקשה."
  exit 0
fi

# ---- ההרצה -------------------------------------------------------------------
# העיבוד עצמו ממשיך ברקע ב-EdgeRuntime.waitUntil, ולכן התשובה חוזרת מיד עם
# ‏job_id. ההשהיה היא כדי לא להציף את Gemini בכל הנכסים בבת אחת.
BODY_FORCE=$([ "$FORCE" = "1" ] && echo ', "force": true' || echo '')
FAILED=()
for id in "${IDS[@]}"; do
  printf '  %s ... ' "$id"
  if OUT=$(curl -fsS -X POST "${BASE_URL}/functions/v1/property-visualize-base" \
      -H "Authorization: Bearer ${KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"property_id\": \"${id}\"${BODY_FORCE}}" 2>&1); then
    echo "$OUT"
  else
    echo "נכשל: $OUT"
    FAILED+=("$id")
  fi
  sleep 2
done

echo
echo "הסתיים. ‏$(( ${#IDS[@]} - ${#FAILED[@]} ))/${#IDS[@]} נשלחו בהצלחה."
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "נכשלו:"; printf '  %s\n' "${FAILED[@]}"
  echo "‏gemini_not_configured פירושו שחסר GEMINI_API_KEY ב-Edge Functions → Secrets."
  exit 1
fi

echo "העיבוד ממשיך ברקע. למעקב: select * from public.visualization_jobs order by created_at desc;"
