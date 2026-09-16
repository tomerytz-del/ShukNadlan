#!/usr/bin/env python3
"""בדיקת מע״מ מול הסנדבוקס של מורנינג.

התיעוד הרשמי מראה ש-`price` בשורת income הוא **לפני מע״מ**: בדוגמה
‏price 300 מניב vat 54 ו-amountTotal 354. המחירים שלנו כוללים מע״מ, ולכן
טעינה של ₪100 תיגבה ₪118 — אלא אם יש ערך `vatType` בשורת ההכנסה שאומר
"המחיר הזה כבר כולל מע״מ".

ה-enum של `vatType` בשורת income לא מופיע בתיעוד שראינו, וגם אינו זהה
ל-enum של רמת המסמך (בדוגמה הרשמית שורה נושאת vatType 1 ובכל זאת חויבה
במע״מ, בעוד שברמת המסמך 1 = פטור).

הסקריפט שולח ₪100 בכל ערך אפשרי וקורא מה חזר. השורה שבה amount == 100
היא התשובה.

    export MORNING_API_KEY_ID=...
    export MORNING_API_KEY_SECRET=...
    python scripts/morning_vat_probe.py

הפרטים: docs/wallet-payments.md, סעיף "המע״מ".
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

# ‏₪100 ולא ₪1: עם ₪1 ההפרש בין 1.00 ל-1.18 נבלע בעיגול לאגורה, ובדיוק
# העיגול הוא מה שאנחנו מנסים לראות.
PROBE_PRICE = 100

# ערכי vatType שנבדקים בשורת ההכנסה. הרשימה רחבה בכוונה — ערך לא חוקי
# מוחזר כשגיאה מסודרת ולא מזיק, וזול יותר לבדוק אחד מיותר מאשר לפספס את
# הערך שפותר את הבעיה.
CANDIDATES = [0, 1, 2, 3]

API_BASE = (os.environ.get("MORNING_API_BASE")
            or "https://sandbox.d.greeninvoice.co.il/api/v1").rstrip("/")

# אותה גזירה כמו ב-supabase/functions/_shared/morning.ts. ארבעה דומיינים
# שאף אחד מהם אינו נגזר מהאחר, וסנדבוקס האימות הוא ‎.dev ולא ‎.co.
AUTH_BASE = (os.environ.get("MORNING_AUTH_BASE")
             or ("https://api.sandbox.morning.dev" if "sandbox" in API_BASE
                 else "https://api.morning.co")).rstrip("/")


def post(url, payload, token=None):
    """POST של JSON. מחזיר (status, body) ולא זורק על 4xx — קוד השגיאה
    עצמו הוא חלק מהתשובה שאנחנו מחפשים."""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, json.loads(res.read().decode())
    except urllib.error.HTTPError as err:
        raw = err.read().decode()
        try:
            return err.code, json.loads(raw)
        except json.JSONDecodeError:
            return err.code, {"raw": raw[:400]}


def main():
    key_id = os.environ.get("MORNING_API_KEY_ID", "")
    secret = os.environ.get("MORNING_API_KEY_SECRET", "")
    if not key_id or not secret:
        sys.exit("חסר MORNING_API_KEY_ID או MORNING_API_KEY_SECRET")

    # **הבדיקה הזו יוצרת מסמכים אמיתיים.** בפרודקשן זה אומר חשבוניות
    # ממוספרות שמדווחות, ולכן ריצה שם חסומה ולא רק מסומנת באזהרה.
    if "sandbox" not in API_BASE:
        sys.exit(f"‏MORNING_API_BASE אינו סנדבוקס ({API_BASE}). "
                 "הסקריפט מפיק מסמכים ולכן לא ירוץ מול פרודקשן.")

    status, body = post(f"{AUTH_BASE}/idp/v1/oauth/token", {
        "grant_type": "client_credentials",
        "client_id": key_id,
        "client_secret": secret,
    })
    token = body.get("accessToken")
    if not token:
        sys.exit(f"האימות נכשל ({status}): {json.dumps(body, ensure_ascii=False)[:400]}")
    print(f"אימות תקין מול {AUTH_BASE}\n")

    results = []
    for vat_type in CANDIDATES:
        tag = f"probe-vat-{vat_type}-{int(time.time())}"
        status, created = post(f"{API_BASE}/documents", {
            "type": 320,
            "lang": "he",
            "currency": "ILS",
            "vatType": 0,
            "description": tag,
            "client": {"name": "בדיקת מע״מ"},
            "income": [{
                "description": tag,
                "quantity": 1,
                "price": PROBE_PRICE,
                "currency": "ILS",
                "vatType": vat_type,
            }],
        }, token)

        if status >= 400:
            results.append((vat_type, None, None,
                            f"נדחה {status}: {json.dumps(created, ensure_ascii=False)[:120]}"))
            continue

        # תשובת היצירה אינה נושאת סכומים, ולכן קוראים אותם בחיפוש.
        _, found = post(f"{API_BASE}/documents/search",
                        {"description": tag, "pageSize": 1}, token)
        items = found.get("items") or []
        if not items:
            results.append((vat_type, None, None, "נוצר אך לא נמצא בחיפוש"))
            continue

        doc = items[0]
        results.append((vat_type, doc.get("amount"), doc.get("vat"),
                        f"מסמך {doc.get('number')}"))

    print(f"נשלח price={PROBE_PRICE} בכל ערך:\n")
    print(f"{'vatType':>8} | {'amount':>8} | {'vat':>7} | הערה")
    print("-" * 64)
    for vat_type, amount, vat, note in results:
        amount_txt = "—" if amount is None else f"{amount:g}"
        vat_txt = "—" if vat is None else f"{vat:g}"
        print(f"{vat_type:>8} | {amount_txt:>8} | {vat_txt:>7} | {note}")

    winners = [v for v, amount, _, _ in results if amount == PROBE_PRICE]
    print()
    if winners:
        print(f"‏vatType={winners[0]} מפרש את המחיר ככולל מע״מ — ‎₪{PROBE_PRICE} "
              f"נשאר ‎₪{PROBE_PRICE}. זה הערך לשלוח.")
    else:
        print("אף ערך לא השאיר את הסכום כמות שהוא. המשמעות: חייבים לשלוח "
              "סכום נטו או להגדיר את המחירים כלפני מע״מ — ראו את שלוש "
              "הדרכים ב-docs/wallet-payments.md.")


if __name__ == "__main__":
    main()
