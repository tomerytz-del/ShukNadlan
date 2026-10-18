#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""כל קריאה למודל נרשמת ליומן העלויות.

**למה:** הפאנל "עלויות" מפרק את חשבוניות ה-AI לפי יכולת מתוך `ai_usage_log`
ויומני המנטור (`docs/platform-costs.md`, "עלות AI לפי יכולת"). קריאה חדשה
למודל בלי שורה ליומן אינה שוברת כלום - היא פשוט נעלמת מהפירוט, והפער מול
החשבונית גדל בשקט. כך היה עד אוקטובר 2026 עם גבריאלה, הכלי הכי בשימוש.

הבדיקה:
  1. כל קובץ שקורא ל-Anthropic, ל-Gemini או ל-OpenAI (‏supabase/functions,
     והמנועים בפייתון) קורא גם ל-`logAiUsage` / `log_ai_usage`, או כותב טוקני
     מטמון ליומני המנטור.
  2. כל יכולת ב-`AiFeature` (‏_shared/ai-usage.ts) מוצגת בפאנל (‏AI_FEATURES
     ב-assets/crm.js) - אחרת היא מופיעה בשם הפנימי שלה.

הרצה:
    python scripts/check_ai_usage.py
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CALL_RE = re.compile(
    r"api\.anthropic\.com/v1/messages|messages\.(create|parse|stream)\b|"
    r"generativelanguage\.googleapis\.com|api\.openai\.com"
)
LOG_RE = re.compile(r"\blogAiUsage\(|\blog_ai_usage\(|cache_read_tokens:")

SKIP_DIRS = {"node_modules", ".git"}


def files():
    for base in ("supabase/functions", "lead_engine", "news_engine", "deals_engine", "ops_agent"):
        for dirpath, dirnames, names in os.walk(os.path.join(ROOT, base)):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for n in names:
                if n.endswith((".ts", ".py")) and "_test" not in n and not n.startswith("test_"):
                    yield os.path.join(dirpath, n)


def strip_comments(src, py):
    if py:
        # docstrings מזכירים את `client.messages.parse()` בלי לקרוא לו
        src = re.sub(r'"""[\s\S]*?"""', "", src)
        return re.sub(r"#.*", "", src)
    # ‏`//` רק בתחילת שורה או אחרי רווח - לא ה-`//` שבתוך https://
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(^|\s)//.*", r"\1", src, flags=re.M)


def main():
    bad = []
    for path in files():
        src = open(path, encoding="utf-8").read()
        code = strip_comments(src, path.endswith(".py"))
        if CALL_RE.search(code) and not LOG_RE.search(code):
            bad.append(os.path.relpath(path, ROOT))

    ts = open(os.path.join(ROOT, "supabase/functions/_shared/ai-usage.ts"), encoding="utf-8").read()
    m = re.search(r"export type AiFeature =(.*?);", ts, re.S)
    features = re.findall(r'"([a-z_]+)"', m.group(1)) if m else []
    crm = open(os.path.join(ROOT, "assets/crm.js"), encoding="utf-8").read()
    block = re.search(r"const AI_FEATURES = \{(.*?)\n\};", crm, re.S)
    shown = set(re.findall(r"^\s*([a-z_]+):", block.group(1), re.M)) if block else set()
    missing = [f for f in features if f not in shown]

    ok = True
    if not features:
        print("✗ לא נמצא AiFeature ב-_shared/ai-usage.ts")
        ok = False
    if bad:
        ok = False
        print("✗ קריאה למודל בלי שורה ליומן העלויות (logAiUsage / log_ai_usage):")
        for b in bad:
            print("   " + b)
        print("  הוסיפו logAiUsage(anthropicRow(...)) אחרי התשובה. docs/platform-costs.md")
    if missing:
        ok = False
        print("✗ יכולת ב-AiFeature בלי שורה ב-AI_FEATURES (assets/crm.js): " + ", ".join(missing))
    if not ok:
        sys.exit(1)
    print(f"✓ כל הקריאות למודלים נרשמות ליומן, ו-{len(features)} היכולות מוצגות בפאנל.")


if __name__ == "__main__":
    main()
