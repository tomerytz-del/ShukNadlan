#!/usr/bin/env python3
"""
כל Action ב-.github/workflows נעול ל-SHA של קומיט, ולא לתג.

‏**למה:** תג כמו `@v4` הוא מצביע שבעלי ה-Action יכולים להזיז. מי שהשתלט/ה
על הריפו שלהם מזיז/ה את התג לקוד זדוני, והוא רץ אצלנו עם הסודות של
‏SUPABASE_DB_URL ו-SUPABASE_ACCESS_TOKEN - כך בדיוק קרה ב-tj-actions/changed-files
(‏2025). ‏SHA אינו זז. ‏Dependabot (‏.github/dependabot.yml) מעדכן את ה-SHA
ואת ההערה `# vX.Y.Z` שאחריו, ולכן הנעילה אינה עולה בעדכונים.

‏Action מקומי (`./`) ו-`docker://` עם digest אינם נבדקים. docs/security-ci.md
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
USES = re.compile(r"^\s*-?\s*uses:\s*([^\s#]+)(\s*#\s*(\S+))?", re.M)
SHA = re.compile(r"@[0-9a-f]{40}$")

bad = []
for wf in sorted((ROOT / ".github" / "workflows").glob("*.y*ml")):
    for m in USES.finditer(wf.read_text(encoding="utf-8")):
        ref = m.group(1)
        if ref.startswith("./") or ref.startswith("docker://"):
            continue
        if not SHA.search(ref) or not m.group(3):
            line = wf.read_text(encoding="utf-8")[: m.start()].count("\n") + 1
            bad.append(f"{wf.relative_to(ROOT)}:{line}: {ref}")

if bad:
    print("Action שאינו נעול ל-SHA עם הערת גרסה (`uses: owner/repo@<40 hex> # vX.Y.Z`):")
    for b in bad:
        print("  " + b)
    print("\nהדרך למצוא את ה-SHA: git ls-remote https://github.com/<owner>/<repo> refs/tags/<tag>")
    sys.exit(1)
print("✓ כל ה-Actions נעולים ל-SHA.")
