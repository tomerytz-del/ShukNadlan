#!/usr/bin/env python3
"""הבדיקה של הבדיקה: כל ממצא יכול להיסגר, ולכל ממצא מפתח משלו.

שני כשלים שקטים, ושניהם נמצאו בפאנל הבריאות ב-28.9.2026:

1. **קוד שאינו ב-`PROBE_CODES` אינו נסגר לעולם.** ה-probe מפסיק לדווח,
   והשורה נשארת פתוחה בדשבורד. כך נשארו חמישה ממצאים על השוק
   ‏haifa-krayot אחרי שפוצל, וכך `make_` לפניהם. ‏`store.py`.
2. **נושא שכולו עברית איבד את המפתח.** ‏`_slug` מחק אותו ל-`-`, וכל
   ה-workflows שנכשלו חלקו שורה אחת. ‏`models.py`.

    python3 scripts/ops_probe_codes_test.py
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ops_agent.models import Finding, _slug  # noqa: E402

failed = 0


def check(name, ok, detail=""):
    global failed
    print(("✓ " if ok else "✗ ") + name + (("\n    " + detail) if detail and not ok else ""))
    failed += 0 if ok else 1


def probe_codes() -> dict:
    """‏`PROBE_CODES` מתוך store.py בלי לייבא אותו - הוא מושך psycopg2."""
    tree = ast.parse((ROOT / "ops_agent" / "store.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
                getattr(t, "id", None) == "PROBE_CODES" for t in node.targets):
            return ast.literal_eval(node.value)
    raise SystemExit("PROBE_CODES לא נמצא ב-store.py")


codes_by_probe = probe_codes()
for path in sorted((ROOT / "ops_agent" / "probes").glob("*.py")):
    probe = path.stem
    if probe == "__init__":
        continue
    emitted = set(re.findall(r'\bcode="([a-z_]+)"', path.read_text(encoding="utf-8")))
    prefixes = tuple(codes_by_probe.get(probe, ()))
    orphans = sorted(c for c in emitted if not c.startswith(prefixes))
    check("%s: כל %d הקודים נסגרים אוטומטית" % (probe, len(emitted)), not orphans,
          "חסרים ב-PROBE_CODES[%r] ב-store.py: %s" % (probe, ", ".join(orphans)))


def key(subject):
    return Finding(area="health", code="workflow_failing", severity="high",
                   subject=subject, title="t", detail="").key


check("שני נושאים עבריים - שני מפתחות",
      key("נרמול עסקאות רשמיות") != key("סוג בעלות בקרקע — טאבו"))
check("נושא עברי - מפתח יציב", key("נרמול עסקאות רשמיות") == key("נרמול עסקאות רשמיות"))
check("נושא עברי אינו -", not key("נרמול עסקאות רשמיות").endswith(":-"))
check("נושא לטיני לא השתנה", _slug("assets/crm.js") == "assets/crm.js"
      and _slug("land_ownership.yml") == "land_ownership.yml")
check("נושא ריק נשאר -", _slug("") == "-")

print("\n" + ("✗ %d נכשלו" % failed if failed else "✓ כל ממצא נסגר, ולכל ממצא מפתח משלו"))
sys.exit(1 if failed else 0)
