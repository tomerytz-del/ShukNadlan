#!/usr/bin/env bash
# ‏פקודת הבנייה של Netlify (netlify.toml): הקטנת העותק שנפרס - scripts/build_minify.mjs.
#
# ‏esbuild מותקן מחוץ לתיקיית האתר, ולא כ-package.json בשורש: קובץ כזה, ו-
# ‏node_modules לצדו, היו מתפרסמים יחד עם האתר. הגרסה נעוצה.
#
# ‏כל כשל כאן נגמר ב-exit 0 והאתר נפרס בלי הקטנה - כמו לפני שהשלב הזה היה קיים.
set -u
ESB_DIR="${TMPDIR:-/tmp}/shuk-esbuild"
if npm install --silent --no-save --no-audit --no-fund --prefix "$ESB_DIR" esbuild@0.25.10 >/dev/null 2>&1; then
  node scripts/build_minify.mjs "$ESB_DIR/node_modules/esbuild" . || echo "[minify] נכשל - האתר נפרס בלי הקטנה"
else
  echo "[minify] התקנת esbuild נכשלה - האתר נפרס בלי הקטנה"
fi
exit 0
