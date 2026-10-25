#!/usr/bin/env python3
"""מוודא שטקסט מסמכי החתימה לא זז.

העיצוב (CSS, כותרת, PDF) מותר להשתנות. הנוסח שהחותם קורא - לא.
הסקריפט מרכיב את ששת הטפסים ואת בלוק החתימות, מוציא את צמתי הטקסט,
ומשווה לתמונת הבסיס ב-scripts/fixtures/agreement-doc-texts.json.

    python3 scripts/check_agreement_texts.py
    python3 scripts/check_agreement_texts.py --write   # רק אחרי שינוי נוסח מכוון
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = ROOT / "scripts" / "fixtures" / "agreement-doc-texts.json"
EXTRACT = ROOT / "scripts" / "check_agreement_texts.mjs"


def extract() -> dict:
    proc = subprocess.run(
        ["node", str(EXTRACT)],
        cwd=ROOT,
        env={**dict(**{k: v for k, v in __import__("os").environ.items()}), "TZ": "UTC"},
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        raise SystemExit(f"חילוץ הטקסט נכשל (יציאה {proc.returncode})")
    return json.loads(proc.stdout)


def first_diff(a: str, b: str) -> str:
    n = min(len(a), len(b))
    for i in range(n):
        if a[i] != b[i]:
            lo = max(0, i - 40)
            return (
                f"תו {i}:\n"
                f"  היה: {a[lo:i + 40]!r}\n"
                f"  עכשיו: {b[lo:i + 40]!r}"
            )
    if len(a) != len(b):
        return f"אורך שונה: היה {len(a)}, עכשיו {len(b)}"
    return ""


def main() -> int:
    current = extract()
    if "--write" in sys.argv:
        GOLDEN.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"נכתבה תמונת בסיס: {GOLDEN.relative_to(ROOT)}")
        return 0

    if not GOLDEN.exists():
        print(f"חסרה תמונת בסיס {GOLDEN}", file=sys.stderr)
        return 1

    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
    problems: list[str] = []

    g_docs = golden.get("documents") or {}
    c_docs = current.get("documents") or {}
    for key in sorted(set(g_docs) | set(c_docs)):
        if key not in g_docs or key not in c_docs:
            problems.append(f"{key}: המסמך חסר באחד הצדדים")
            continue
        diff = first_diff(g_docs[key], c_docs[key])
        if diff:
            problems.append(f"{key}: הטקסט השתנה\n{diff}")

    g_tpl = golden.get("template_strings") or []
    c_tpl = current.get("template_strings") or []
    if g_tpl != c_tpl:
        problems.append(
            f"מחרוזות התבנית השתנו (היה {len(g_tpl)}, עכשיו {len(c_tpl)})"
        )
        for i, (a, b) in enumerate(zip(g_tpl, c_tpl)):
            if a != b:
                problems.append(f"תבנית #{i}:\n{first_diff(a, b)}")
                break
        if len(g_tpl) != len(c_tpl):
            problems.append("מספר המחרוזות בתבנית השתנה")

    if problems:
        print("טקסט מסמכי החתימה השתנה:\n", file=sys.stderr)
        for p in problems:
            print(f"  ✗ {p}\n", file=sys.stderr)
        print(
            "מותר לשנות עיצוב סביב המסמך. אסור לשנות מילה בנוסח.\n"
            "אם השינוי בנוסח מכוון: python3 scripts/check_agreement_texts.py --write",
            file=sys.stderr,
        )
        return 1

    print(f"טקסט המסמכים זהה לתמונת הבסיס ({len(c_docs)} מסמכים, {len(c_tpl)} מחרוזות תבנית).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
