#!/usr/bin/env bash
# ============================================================================
# בדיקה ל-scripts/netlify_ignore.sh
#
# הכשל שהבדיקה הזו קיימת בשבילו הוא השקט מבין השניים: דיפלוי שדולג בטעות.
# מי שמוסיף/ה ל-NOT_SITE תיקייה שהאתר כן מגיש (‏assets/, ‏netlify/) - או
# ‏glob רחב מדי - מקבל/ת אתר שנשאר על קוד ישן, בלי שגיאה ובלי סימן. לכן כל
# סוג של קובץ אתר נבדק כאן שהוא **בונה**, וכל סוג של קובץ שאינו אתר שהוא
# מדלג.
#
# בונה ריפו זמני, ולא נוגע בריפו האמיתי. הרצה: bash scripts/netlify_ignore_test.sh
# ============================================================================
set -u

SCRIPT="$(cd "$(dirname "$0")" && pwd)/netlify_ignore.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cd "$tmp" || exit 2
git init -q .
git config user.email t@t
git config user.name t
echo base > index.html
git add . && git commit -qm base

fail=0
# expect: 0 = מדלג, 1 = בונה
check() {
  local path="$1" expect="$2" msg="${3:-change}"
  local base
  base=$(git rev-parse HEAD)
  mkdir -p "$(dirname "$path")"
  echo "$RANDOM $path" >> "$path"
  git add -A && git commit -qm "$msg"
  CACHED_COMMIT_REF=$base COMMIT_REF=$(git rev-parse HEAD) bash "$SCRIPT" >/dev/null 2>&1
  local got=$?
  if [ "$got" != "$expect" ]; then
    echo "FAIL: $path ($msg) - ציפינו ל-$expect וקיבלנו $got"
    fail=1
  fi
}

# קבצי אתר - חייבים לבנות
check index.html 1
check crm.html 1
check assets/crm.js 1
check assets/hero.webp 1
check assets/notes.md 1          # ‏*.md מדלג רק בשורש
check vendor/lib/x.js 1
check netlify/edge-functions/og-tags.ts 1
check netlify/edge-functions/lib/x.md 1
check _headers 1
check _redirects 1
check robots.txt 1
check sitemap.xml 1
check llms.txt 1
check sw.js 1
check manifest.webmanifest 1
check netlify.toml 1
check newdir/page.html 1         # תיקייה שאיש לא הכיר - בונים
check .well-known/apple-app-site-association 1

# לא אתר - מדלגים
check docs/x.md 0
check CLAUDE.md 0
check supabase/migrations/1_x.sql 0
check supabase/functions/a/index.ts 0
check supabase/functions/_shared/wa-forward.ts 1
check scripts/check_x.py 0
check .claude/skills/x/SKILL.md 0
check .github/workflows/x.yml 0
check ops_agent/x.py 0
check deals_engine/x.py 0
check news_engine/x.py 0
check lead_engine/x.py 0
check marketing/videos/x.json 0
check gtm/container.json 0
check mobile/www/index.html 0
check scraper.py 0
check requirements.txt 0

# עקיפה ידנית
check docs/y.md 1 "docs only [deploy]"

# אין בסיס - בונים
CACHED_COMMIT_REF= COMMIT_REF=HEAD bash "$SCRIPT" >/dev/null 2>&1
[ $? = 1 ] || { echo "FAIL: בלי CACHED_COMMIT_REF היה צריך לבנות"; fail=1; }
CACHED_COMMIT_REF=0000000000000000000000000000000000000000 COMMIT_REF=HEAD bash "$SCRIPT" >/dev/null 2>&1
[ $? = 1 ] || { echo "FAIL: בסיס שאינו בשיבוט היה צריך לבנות"; fail=1; }

if [ $fail = 0 ]; then
  echo "netlify_ignore: כל המקרים עברו"
fi
exit $fail
