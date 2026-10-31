#!/usr/bin/env bash
# ============================================================================
# האם הדחיפה הזו צריכה דיפלוי ב-Netlify?
#
# ‏Netlify מריץ את הסקריפט לפני כל בנייה (‏`[build] ignore` ב-netlify.toml),
# גם לפרודקשן וגם ל-Deploy Preview. קוד היציאה הוא ההחלטה:
#
#   0  - לדלג. שום קובץ שהאתר מגיש לא השתנה.
#   1  - לבנות ולפרסם.
#
# למה זה קיים: כל מיזוג ל-main היה דיפלוי לפרודקשן, ודיפלוי עולה קרדיטים.
# בספירה של 18-21.10.2026, ‏19 מתוך 52 מיזוגים נגעו רק בתיעוד, במיגרציות,
# בפונקציות של Supabase או בבדיקות, ובכל זאת פורסמו מחדש. ‏docs/netlify-usage.md.
#
# **הכלל: בספק בונים.** כל מצב שהסקריפט לא יכול להכריע בו (אין בסיס להשוואה,
# הקומיט לא קיים בשיבוט, git נכשל) מסתיים ב-1. דיפלוי מיותר עולה 15 קרדיטים;
# דיפלוי שדולג בטעות משאיר את האתר על קוד ישן בלי שום סימן.
#
# הרשימה שלמטה היא של מה ש**אינו** אתר, ולא של מה שכן: תיקייה חדשה שאיש לא
# הוסיף לכאן נבנית, וזה הכיוון הבטוח.
#
# עקיפה ידנית: `[deploy]` בהודעת הקומיט האחרון מכריח בנייה.
# בדיקה מקומית:  CACHED_COMMIT_REF=<sha> COMMIT_REF=HEAD bash scripts/netlify_ignore.sh
# ============================================================================
set -u

base="${CACHED_COMMIT_REF:-}"
head="${COMMIT_REF:-HEAD}"

if [ -z "$base" ] || [ "$base" = "$head" ]; then
  echo "netlify_ignore: אין בסיס להשוואה - בונים"
  exit 1
fi
if ! git cat-file -e "${base}^{commit}" 2>/dev/null || ! git cat-file -e "${head}^{commit}" 2>/dev/null; then
  echo "netlify_ignore: $base או $head אינו בשיבוט - בונים"
  exit 1
fi
if git log -1 --format=%B "$head" 2>/dev/null | grep -qF "[deploy]"; then
  echo "netlify_ignore: [deploy] בהודעת הקומיט - בונים"
  exit 1
fi

# ‏minisite-link.ts ו-showcase-send.ts מייבאים את הקובץ הזה. שינוי רק בו
# היה נבלע ב-supabase/** ומשאיר את האתר על הנוסח הישן.
if ! git diff --quiet "$base" "$head" -- supabase/functions/_shared/wa-forward.ts; then
  echo "netlify_ignore: wa-forward.ts השתנה - בונים"
  exit 1
fi

# מה שאינו אתר. ‏netlify/ ו-assets/ אינם כאן בכוונה: פונקציות ה-edge מייבאות
# מ-assets (‏deals-render.js, ‏markets.js), ולכן שינוי בהן הוא שינוי באתר.
NOT_SITE=(
  ':(exclude)docs/**'
  ':(exclude)supabase/**'
  ':(exclude)scripts/**'
  ':(exclude).claude/**'
  ':(exclude).github/**'
  ':(exclude)ops_agent/**'
  ':(exclude)news_engine/**'
  ':(exclude)lead_engine/**'
  ':(exclude)deals_engine/**'
  ':(exclude)marketing/**'
  ':(exclude)gtm/**'
  ':(exclude)mobile/**'
  ':(exclude,glob)*.py'
  ':(exclude,glob)*.md'
  ':(exclude)requirements.txt'
  ':(exclude)schema.sql'
)

changed=$(git diff --name-only "$base" "$head" -- . "${NOT_SITE[@]}" 2>/dev/null)
status=$?
if [ $status -ne 0 ]; then
  echo "netlify_ignore: git diff נכשל - בונים"
  exit 1
fi

if [ -z "$changed" ]; then
  echo "netlify_ignore: אין שינוי באתר בין $base ל-$head - מדלגים על הדיפלוי"
  exit 0
fi

echo "netlify_ignore: קבצי אתר שהשתנו - בונים:"
echo "$changed" | head -20
exit 1
