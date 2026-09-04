#!/usr/bin/env bash
# ============================================================================
# בדיקת התאמה מול fal.ai — לפני שמפעילים את הסרטונים בפרודקשן
#
# **למה הסקריפט הזה קיים.** הצינור של property-video שולח שני סוגי בקשות
# ל-fal: image-to-video לכל תמונה (‏ai_reel), ו-ffmpeg/compose שמחבר. שתיהן
# עולות כסף, ושתיהן נשלחות מתוך Edge Function שאי אפשר לראות בה מה נדחה.
# הסקריפט הזה שולח בדיוק את אותן שתי הבקשות מהמסוף, ומדפיס את התשובה
# המלאה — כולל השגיאה, אם יש. חמש דקות כאן חוסכות חיפוש עיוור אחר כך.
#
# הוא בודק ארבעה דברים, ובסדר הזה:
#   1. שהמפתח עובד בכלל.
#   2. שהמודל של image-to-video מקבל את שמות השדות שאנחנו שולחים
#      (‎image_url‎ / ‎prompt‎ / ‎duration‎), ובאיזה מבנה הוא מחזיר את הווידאו.
#   3. ש-compose מקבל **תמונות** כ-keyframes — זה מה שמסלול ה-slideshow
#      עומד עליו, והמסלול הזה פתוח לכל סוכן/ת.
#   4. ש-compose מקבל keyframes **חופפים** — זה מה שהופך את
#      ‎marketing_video_crossfade_ms‎ ממספר בקונפיג למעברים רכים בפועל.
#
# בדיקות 3 ו-4 הן הסיבה העיקרית: סכמת ה-tracks של compose אינה מתועדת
# אצלנו כקבועה, והקוד בנוי כך שגם אם היא לא מתאימה — הסרטון עדיין נוצר.
# הסקריפט אומר איזו משתי האפשרויות היא זו שבפועל.
#
# הרצה:
#   FAL_KEY=xxx scripts/fal_video_probe.sh
#   FAL_KEY=xxx FAL_VIDEO_MODEL=fal-ai/ltx-video/image-to-video scripts/fal_video_probe.sh
#   FAL_KEY=xxx SKIP_I2V=1 scripts/fal_video_probe.sh     # רק compose, בלי לשלם על קליפ
#
# עלות: בדיקה 2 מייצרת קליפ אחד אמיתי (סנטים בודדים, לפי המודל). ‎SKIP_I2V=1‎
# מדלג עליה. בדיקות 3–4 הן ffmpeg בלבד.
# ============================================================================
set -euo pipefail

KEY="${FAL_KEY:-}"
VIDEO_MODEL="${FAL_VIDEO_MODEL:-fal-ai/wan-i2v}"
COMPOSE_MODEL="${FAL_COMPOSE_MODEL:-fal-ai/ffmpeg-api/compose}"
SKIP_I2V="${SKIP_I2V:-0}"

# שתי תמונות ציבוריות לבדיקה. אפשר להחליף בכתובות של נכס אמיתי מהדלי שלנו.
IMG_A="${PROBE_IMAGE_A:-https://picsum.photos/id/1029/1280/720}"
IMG_B="${PROBE_IMAGE_B:-https://picsum.photos/id/1039/1280/720}"

if [ -z "$KEY" ]; then
  echo "חסר FAL_KEY. הרצה: FAL_KEY=xxx scripts/fal_video_probe.sh" >&2
  exit 1
fi

# ‏jq אינו חובה — בלעדיו פשוט מדפיסים JSON גולמי. עדיף פלט מכוער מאשר
# סקריפט בדיקה שנופל בגלל כלי חסר.
if command -v jq >/dev/null 2>&1; then
  pretty() { jq . 2>/dev/null || cat; }
else
  pretty() { cat; echo; }
fi

submit() {  # submit <model> <json>
  curl -sS -X POST "https://queue.fal.run/$1" \
    -H "Authorization: Key $KEY" \
    -H "Content-Type: application/json" \
    -d "$2"
}

# ממתין לבקשה עד שתסתיים ומדפיס את התוצאה. מחזיר 1 כשנכשלה.
await() {  # await <status_url> <response_url> <label>
  local status_url="$1" response_url="$2" label="$3" i status
  for i in $(seq 1 60); do
    status=$(curl -sS -H "Authorization: Key $KEY" "$status_url" \
             | grep -o '"status"[[:space:]]*:[[:space:]]*"[A-Z_]*"' \
             | grep -o '[A-Z_]*"$' | tr -d '"' || true)
    case "$status" in
      COMPLETED) break ;;
      IN_QUEUE|IN_PROGRESS) sleep 5 ;;
      *) echo "  ✖ $label — סטטוס לא צפוי: ${status:-(ריק)}"; return 1 ;;
    esac
  done
  if [ "$status" != "COMPLETED" ]; then
    echo "  ✖ $label — לא הסתיים תוך 5 דקות"; return 1
  fi
  echo "  ✔ $label — הסתיים. התשובה:"
  curl -sS -H "Authorization: Key $KEY" "$response_url" | pretty
}

# מוציא שדה מתשובת השליחה בלי jq
field() { grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" <<<"$1" | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//'; }

run_case() {  # run_case <label> <model> <json>
  echo
  echo "── $1"
  local out status_url response_url
  out=$(submit "$2" "$3")
  status_url=$(field "$out" status_url)
  response_url=$(field "$out" response_url)
  if [ -z "$status_url" ]; then
    echo "  ✖ השליחה נדחתה. תשובת fal:"
    echo "$out" | pretty
    return 1
  fi
  await "$status_url" "$response_url" "$1"
}

echo "════════════════════════════════════════════════════════"
echo " בדיקת fal.ai · מודל וידאו: $VIDEO_MODEL"
echo "                 מודל חיבור: $COMPOSE_MODEL"
echo "════════════════════════════════════════════════════════"

# --- 1. המפתח ---------------------------------------------------------------
echo
echo "── 1. המפתח"
code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "https://queue.fal.run/$COMPOSE_MODEL" \
       -H "Authorization: Key $KEY" -H "Content-Type: application/json" -d '{}')
if [ "$code" = "401" ] || [ "$code" = "403" ]; then
  echo "  ✖ המפתח נדחה (HTTP $code). בדקו את FAL_KEY."
  exit 1
fi
echo "  ✔ המפתח מתקבל (הבקשה הריקה חזרה HTTP $code — שגיאת קלט, לא שגיאת אימות)"

# --- 2. image-to-video ------------------------------------------------------
if [ "$SKIP_I2V" = "1" ]; then
  echo
  echo "── 2. image-to-video — דילוג (SKIP_I2V=1)"
else
  run_case "2. image-to-video — שדות הקלט ומבנה הפלט" "$VIDEO_MODEL" "$(cat <<JSON
{"image_url": "$IMG_A",
 "prompt": "Slow cinematic drone shot pushing forward, steady smooth motion. Camera movement only.",
 "duration": 5}
JSON
)" || echo "  ← אם נדחה: השוו את שמות השדות ל-API של המודל, ועדכנו את submitClips ב-property-video."
fi

# --- 3. compose עם תמונות ---------------------------------------------------
run_case "3. compose עם תמונות כ-keyframes (מסלול ה-slideshow)" "$COMPOSE_MODEL" "$(cat <<JSON
{"tracks": [{"id": "video", "type": "video", "keyframes": [
  {"url": "$IMG_A", "timestamp": 0,    "duration": 4000},
  {"url": "$IMG_B", "timestamp": 4000, "duration": 4000}]}]}
JSON
)" || cat <<'MSG'
  ← נדחה: מסלול ה-slideshow לא יעבוד בצורתו הנוכחית.
    שתי דרכים קדימה, שתיהן בלי שינוי בקוד המסד:
      • להעביר את שני המסלולים דרך image-to-video (‏marketing_video_enabled
        נשאר 1, וה-CRM פשוט לא יציע slideshow), או
      • להחליף את FAL_COMPOSE_MODEL בנקודת קצה שמקבלת תמונות.
MSG

# --- 4. compose עם חפיפה ----------------------------------------------------
run_case "4. compose עם keyframes חופפים (מעבר רך)" "$COMPOSE_MODEL" "$(cat <<JSON
{"tracks": [{"id": "video", "type": "video", "keyframes": [
  {"url": "$IMG_A", "timestamp": 0,    "duration": 4000},
  {"url": "$IMG_B", "timestamp": 3500, "duration": 4000}]}]}
JSON
)" || echo "  ← נדחה: השאירו את marketing_video_crossfade_ms על 0 (חיתוכים חדים)."

echo
echo "════════════════════════════════════════════════════════"
echo " סיום. פתחו את קובצי הווידאו שבתשובות וראו איך הם נראים —"
echo " ‏HTTP 200 אומר שהבקשה התקבלה, לא שהתוצאה טובה."
echo "════════════════════════════════════════════════════════"
