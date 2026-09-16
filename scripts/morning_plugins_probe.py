#!/usr/bin/env python3
"""מי אשם ב-2600: שליפת תוספי הסליקה הפעילים בחשבון מורנינג.

השגיאה `errorCode 2600 — לא נמצא מסוף סליקה פעיל` חוזרת מ-`/payments/form`
בסנדבוקס ובפרודקשן כאחד, גם בחשבון שבו Digital Payments מופיע כמחובר.
עד עכשיו לא הייתה דרך לראות מהצד שלנו אם ה-API בכלל "רואה" תוסף, והשאלה
נשלחה לתמיכה.

`GET /documents/info?type=320` עונה על זה ישירות: התיעוד מגדיר אותו כמחזיר
"the payment plugins active on this business", בשדה `paymentPlugins`.

    export MORNING_API_KEY_ID=...
    export MORNING_API_KEY_SECRET=...
    python scripts/morning_plugins_probe.py

קריאה בלבד — לא מפיקה מסמך ולא משנה דבר, ולכן מותרת גם מול פרודקשן.
ושם דווקא חשוב להריץ אותה: השגיאה מופיעה בשתי הסביבות.

שלוש תוצאות אפשריות:
  * רשימה ריקה          → אין תוסף. ‏2600 מוסברת, והכדור אצל מורנינג.
  * תוסף עם active=false → התוסף קיים ואינו פעיל. אותה מסקנה, ראיה חזקה יותר.
  * תוסף עם active=true  → הבעיה אינה בתוסף. ה-id שיודפס הוא מה שצריך
                           להגדיר כ-MORNING_PLUGIN_ID ולנסות שוב.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

API_BASE = (os.environ.get("MORNING_API_BASE")
            or "https://sandbox.d.greeninvoice.co.il/api/v1").rstrip("/")

# אותה גזירה כמו ב-supabase/functions/_shared/morning.ts. ארבעה דומיינים
# שאף אחד מהם אינו נגזר מהאחר, וסנדבוקס האימות הוא ‎.dev ולא ‎.co.
AUTH_BASE = (os.environ.get("MORNING_AUTH_BASE")
             or ("https://api.sandbox.morning.dev" if "sandbox" in API_BASE
                 else "https://api.morning.co")).rstrip("/")

# סוג המסמך שאנחנו מפיקים בפועל בכל תשלום: חשבונית מס/קבלה. התוספים
# מוחזרים לפי סוג מסמך, ולכן חייבים לשאול על הסוג הנכון.
DOC_TYPE = 320


def request(url, payload=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url, data=data, headers=headers,
        method="POST" if payload is not None else "GET")
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

    env = "סנדבוקס" if "sandbox" in API_BASE else "פרודקשן"
    print(f"סביבה: {env}\n‏API:   {API_BASE}\nאימות: {AUTH_BASE}\n")

    status, body = request(f"{AUTH_BASE}/idp/v1/oauth/token", {
        "grant_type": "client_credentials",
        "client_id": key_id,
        "client_secret": secret,
    })
    token = body.get("accessToken")
    if not token:
        sys.exit(f"האימות נכשל ({status}): "
                 f"{json.dumps(body, ensure_ascii=False)[:400]}")
    print("אימות תקין.\n")

    url = f"{API_BASE}/documents/info?type={DOC_TYPE}"
    status, info = request(url, token=token)
    if status >= 400:
        sys.exit(f"‏/documents/info נכשל ({status}): "
                 f"{json.dumps(info, ensure_ascii=False)[:400]}")

    settings = info.get("settings") or {}
    print(f"סוג מסמך {DOC_TYPE} · המסמך הבא יהיה מספר {info.get('number')}")
    print(f"‏payable: {info.get('payable')} · "
          f"‏vatRate: {info.get('vatRate')} · "
          f"‏exemption: {info.get('exemption')}")
    print(f"ערוצי תשלום שנבחרו: {settings.get('selectedPaymentChannels')}")
    print(f"‏rowVatType שברירת המחדל של העסק: {settings.get('rowVatType')}\n")

    plugins = info.get("paymentPlugins") or []
    if not plugins:
        print("‏paymentPlugins: **ריק**\n")
        print("זו התשובה ל-2600: ל-API אין אף תוסף סליקה בחשבון הזה.")
        print("אין מה לתקן בקוד — התוסף צריך להיות מוגדר ומופעל אצל מורנינג.")
        return

    print(f"‏paymentPlugins ({len(plugins)}):\n")
    for plugin in plugins:
        print(f"  id           {plugin.get('id')}")
        print(f"  friendlyName {plugin.get('friendlyName')}")
        print(f"  description  {plugin.get('description')}")
        print(f"  active       {plugin.get('active')}")
        print(f"  type         {plugin.get('type')}")
        print(f"  maxPayments  {plugin.get('maxPayments')}\n")

    active = [p for p in plugins if p.get("active")]
    if not active:
        print("כל התוספים מוחזרים עם active=false.")
        print("זו התשובה ל-2600, והפעם עם ראיה מפורשת: התוסף קיים ואינו פעיל.")
        return

    print(f"יש {len(active)} תוסף פעיל. כלומר 2600 אינה נובעת מהיעדר תוסף.")
    print("הצעד הבא: להגדיר את ה-id שלמעלה כ-MORNING_PLUGIN_ID ב-Supabase")
    print("ולנסות טעינה. אם השגיאה נעלמת — הבעיה הייתה בזיהוי ברירת המחדל.")


if __name__ == "__main__":
    main()
