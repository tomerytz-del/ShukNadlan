#!/usr/bin/env python3
"""
בדיקת ה-Edge Function ‏whatsapp-webhook בלי לחכות ל-Meta.

הסקריפט בונה payload בפורמט של WhatsApp Cloud API, חותם אותו ב-HMAC-SHA256 עם
ה-App Secret בדיוק כמו ש-Meta עושה, ושולח אותו לפונקציה. זה מאפשר לבדוק את כל
הזרימה — זיהוי הסוכן/ת, הפעלת הכלים והתשובה החוזרת — עוד לפני שהוובהוק מחובר
בצד של Meta.

הפונקציה מחזירה 200 מיד וממשיכה לעבד ברקע, ולכן קוד 200 לבדו לא מוכיח כלום.
דגל ‎--check סוגר את הלולאה: הוא קורא את טבלת whatsapp_messages ומראה מה באמת
קרה — מי זוהה, מה הבוט ענה, ואיפה זה נפל.

תלויות: ספריית התקן של פייתון בלבד. אין צורך ב-pip install.

  python scripts/whatsapp_webhook_test.py all --check
  python scripts/whatsapp_webhook_test.py text "תעלה נכס באבן גבירול 10, 3 חדרים, 1.8 מליון" --check
  python scripts/whatsapp_webhook_test.py verify
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

FUNCTION_SLUG = "whatsapp-webhook"
DEFAULT_TIMEOUT = 45  # שניות להמתנה לתשובת הבוט — סבב LLM עם כלים לוקח זמן

GREEN, RED, YELLOW, DIM, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


def ok(msg: str) -> None:
    print(f"{GREEN}✓{RESET} {msg}")


def fail(msg: str) -> None:
    print(f"{RED}✗{RESET} {msg}")


def warn(msg: str) -> None:
    print(f"{YELLOW}!{RESET} {msg}")


def dim(msg: str) -> None:
    print(f"{DIM}{msg}{RESET}")


# ---------------------------------------------------------------------------
# קונפיגורציה
# ---------------------------------------------------------------------------
def load_env() -> None:
    """טוען .env מתיקיית הרפו. משתמש ב-python-dotenv אם מותקן, אחרת פרסר מינימלי."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(root, ".env")
    try:
        from dotenv import load_dotenv  # type: ignore

        load_dotenv(path)
        return
    except ImportError:
        pass
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def env(name: str, *, required: bool = False, hint: str = "") -> str:
    value = os.environ.get(name, "").strip()
    if not value and required:
        fail(f"חסר משתנה הסביבה {name}." + (f" {hint}" if hint else ""))
        sys.exit(2)
    return value


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
def request(
    method: str,
    url: str,
    *,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 30,
) -> tuple[int, str]:
    """מחזיר (status, text). לא זורק על 4xx/5xx — הסטטוס עצמו הוא חלק מהבדיקה."""
    req = urllib.request.Request(url, data=body, method=method)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except urllib.error.URLError as exc:
        fail(f"לא ניתן להגיע ל-{url}: {exc.reason}")
        sys.exit(3)


def function_url() -> str:
    base = env(
        "SUPABASE_URL",
        required=True,
        hint="למשל https://obookujgolazrwycsiyn.supabase.co (מוגדר כבר ב-.env.example).",
    ).rstrip("/")
    return f"{base}/functions/v1/{FUNCTION_SLUG}"


# ---------------------------------------------------------------------------
# בניית ה-payload וחתימתו
# ---------------------------------------------------------------------------
def build_payload(sender: str, message: dict) -> dict:
    """מעטפת הוובהוק של Cloud API. המבנה זהה למה ש-Meta שולחת בפועל."""
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "0",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {
                                "display_phone_number": "972000000000",
                                "phone_number_id": env("WHATSAPP_PHONE_NUMBER_ID") or "0",
                            },
                            "contacts": [
                                {"profile": {"name": "בדיקה מקומית"}, "wa_id": sender}
                            ],
                            "messages": [message],
                        },
                    }
                ],
            }
        ],
    }


def new_message(sender: str, kind: str, **fields) -> dict:
    # מזהה ייחודי בכל הרצה: הפונקציה מדלגת על wa_message_id שכבר קיים ביומן
    # (הגנה מפני משלוחים חוזרים של Meta), אז מזהה קבוע היה גורם להרצה שנייה
    # להיבלע בשקט.
    return {
        "from": sender,
        "id": f"wamid.TEST-{uuid.uuid4()}",
        "timestamp": str(int(time.time())),
        "type": kind,
        **fields,
    }


def sign(raw: bytes, secret: str) -> str:
    return "sha256=" + hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()


def post_webhook(payload: dict, *, secret: str, corrupt_signature: bool = False) -> tuple[int, str]:
    # החתימה מחושבת על הבייטים המדויקים שנשלחים. ensure_ascii=False שומר על
    # עברית כ-UTF-8, בדיוק כמו שהפונקציה קוראת אותה בצד השני.
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    signature = sign(raw, secret)
    if corrupt_signature:
        signature = "sha256=" + "0" * 64
    return request(
        "POST",
        function_url(),
        body=raw,
        headers={
            "Content-Type": "application/json",
            "X-Hub-Signature-256": signature,
            "User-Agent": "facebookplatform/1.0",
        },
    )


# ---------------------------------------------------------------------------
# קריאת התוצאה מהיומן ב-Supabase
# ---------------------------------------------------------------------------
def rest_get(path: str, key: str) -> list[dict]:
    base = env("SUPABASE_URL", required=True).rstrip("/")
    status, text = request(
        "GET",
        f"{base}/rest/v1/{path}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    if status != 200:
        fail(f"שאילתה ל-Supabase נכשלה ({status}): {text[:200]}")
        return []
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return []


def check_result(wamid: str, sender: str, timeout: int) -> bool:
    """עוקב אחרי העיבוד ברקע ומדפיס מה קרה. מחזיר True אם הבוט ענה."""
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        warn("אין SUPABASE_SERVICE_ROLE_KEY — מדלג על בדיקת התוצאה.")
        dim("   הוסיפו אותו ל-.env כדי לראות מה הבוט ענה בפועל.")
        return False

    print(f"{DIM}   ממתין לעיבוד ברקע (עד {timeout}ש')…{RESET}")

    # שלב 1: ההודעה הנכנסת נרשמה ביומן = הפונקציה קיבלה ועיבדה אותה
    inbound = None
    deadline = time.time() + timeout
    while time.time() < deadline:
        rows = rest_get(
            f"whatsapp_messages?wa_message_id=eq.{urllib.parse.quote(wamid)}"
            "&select=created_at,agent_id,msg_type,body,error",
            key,
        )
        if rows:
            inbound = rows[0]
            break
        time.sleep(1.5)

    if not inbound:
        fail("ההודעה לא נרשמה ביומן — הפונקציה לא הגיעה לעיבוד.")
        dim("   כדאי לבדוק בלוגים של Supabase → Edge Functions → whatsapp-webhook.")
        return False

    if inbound.get("agent_id"):
        ok("הסוכן/ת זוהה/תה לפי מספר הטלפון.")
    else:
        warn("המספר לא זוהה — הבוט אמור להשיב 'איני מזהה את מספר הטלפון שלך'.")
    if inbound.get("error"):
        fail(f"שגיאה בעיבוד ההודעה הנכנסת: {inbound['error']}")

    # שלב 2: תשובה יוצאת שנוצרה אחרי ההודעה הנכנסת
    since = urllib.parse.quote(inbound["created_at"])
    deadline = time.time() + timeout
    while time.time() < deadline:
        rows = rest_get(
            f"whatsapp_messages?direction=eq.out&wa_phone=eq.{sender}"
            f"&created_at=gte.{since}&order=created_at.asc&select=body,error",
            key,
        )
        if rows:
            print()
            for row in rows:
                ok("תשובת הבוט:")
                for line in (row.get("body") or "").splitlines():
                    print(f"    {line}")
                if row.get("error"):
                    fail(f"  השליחה לוואטסאפ נכשלה: {row['error']}")
                    dim("  העיבוד עבד; רק המסירה ל-Meta נכשלה (טוקן/מספר לא מורשה).")
            return True
        time.sleep(2)

    fail("הבוט לא ייצר תשובה בזמן.")
    dim("   סיבה נפוצה: ANTHROPIC_API_KEY חסר או לא תקין. בדקו בלוגים.")
    return False


# ---------------------------------------------------------------------------
# הבדיקות
# ---------------------------------------------------------------------------
def test_verify() -> bool:
    """לחיצת היד שמבצעת Meta בהגדרת הוובהוק."""
    token = env(
        "WHATSAPP_VERIFY_TOKEN",
        required=True,
        hint="אותה מחרוזת שהוגדרה כ-secret ב-Supabase.",
    )
    challenge = f"challenge-{uuid.uuid4().hex[:12]}"
    query = urllib.parse.urlencode(
        {"hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": challenge}
    )
    status, text = request("GET", f"{function_url()}?{query}")
    if status == 200 and text.strip() == challenge:
        ok("אימות הוובהוק (GET) — הפונקציה החזירה את ה-challenge.")
        return True
    fail(f"אימות הוובהוק נכשל (status {status}, גוף: {text[:120]!r}).")
    if status == 403:
        dim("   ה-WHATSAPP_VERIFY_TOKEN המקומי לא זהה לזה שמוגדר ב-Supabase.")
    return False


def test_bad_signature(sender: str, secret: str) -> bool:
    """חתימה שגויה חייבת להידחות — זו שכבת האבטחה היחידה של הפונקציה."""
    payload = build_payload(sender, new_message(sender, "text", text={"body": "בדיקה"}))
    status, _ = post_webhook(payload, secret=secret, corrupt_signature=True)
    if status == 401:
        ok("חתימה שגויה נדחתה עם 401.")
        return True
    fail(f"חתימה שגויה החזירה {status} במקום 401 — האימות לא עובד כמצופה!")
    if status == 500:
        dim("   ‏500 = WHATSAPP_APP_SECRET לא מוגדר בכלל ב-Supabase.")
    return False


def send_text(sender: str, secret: str, text_body: str, args) -> bool:
    message = new_message(sender, "text", text={"body": text_body})
    payload = build_payload(sender, message)
    status, body = post_webhook(payload, secret=secret)
    if status != 200:
        fail(f"הפונקציה החזירה {status}: {body[:200]}")
        if status == 401:
            dim("   ה-WHATSAPP_APP_SECRET המקומי לא זהה לזה שמוגדר ב-Supabase.")
        elif status == 500:
            dim("   ‏WHATSAPP_APP_SECRET לא מוגדר ב-Supabase.")
        return False
    ok(f'נשלח מ-{sender}: "{text_body}"')
    if args.check:
        return check_result(message["id"], sender, args.timeout)
    dim("   (הוסיפו ‎--check כדי לראות מה הבוט ענה)")
    return True


def send_media(sender: str, secret: str, kind: str, media_id: str, caption: str, args) -> bool:
    field = {"id": media_id}
    if kind == "image" and caption:
        field["caption"] = caption
    message = new_message(sender, kind, **{kind: field})
    payload = build_payload(sender, message)
    status, body = post_webhook(payload, secret=secret)
    if status != 200:
        fail(f"הפונקציה החזירה {status}: {body[:200]}")
        return False
    ok(f"נשלחה הודעת {kind} עם media_id={media_id}")
    if args.check:
        return check_result(message["id"], sender, args.timeout)
    return True


# ---------------------------------------------------------------------------
def main() -> int:
    load_env()

    parser = argparse.ArgumentParser(
        description="בדיקת whatsapp-webhook עם חתימת HMAC אמיתית",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "command",
        choices=["all", "verify", "badsig", "text", "unknown", "image", "audio"],
        help="all = רצף בדיקות בטוח (verify + badsig + unknown + 'שלום')",
    )
    parser.add_argument("message", nargs="?", default="שלום", help="גוף ההודעה (לפקודת text)")
    parser.add_argument("--from", dest="sender", default=env("WA_TEST_FROM"),
                        help="מספר השולח בפורמט 9725XXXXXXXX (ברירת מחדל: WA_TEST_FROM)")
    parser.add_argument("--media-id", dest="media_id", help="media id אמיתי מוואטסאפ")
    parser.add_argument("--caption", default="", help="כיתוב לתמונה")
    parser.add_argument("--check", action="store_true", help="קריאת התוצאה מהיומן ב-Supabase")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    args = parser.parse_args()

    secret = env(
        "WHATSAPP_APP_SECRET",
        required=True,
        hint="App Settings → Basic → App Secret ב-Meta. חייב להיות זהה ל-secret ב-Supabase.",
    )

    needs_sender = args.command in {"all", "text", "image", "audio"}
    if needs_sender and not args.sender:
        fail("חסר מספר שולח. הגדירו WA_TEST_FROM ב-.env או העבירו ‎--from 9725XXXXXXXX.")
        return 2

    print(f"{DIM}יעד: {function_url()}{RESET}\n")

    if args.command == "verify":
        return 0 if test_verify() else 1

    if args.command == "badsig":
        return 0 if test_bad_signature(args.sender or "972500000000", secret) else 1

    if args.command == "unknown":
        # מספר שאינו רשום לאף סוכן/ת — מוודא את מסלול הדחייה
        return 0 if send_text("972500000000", secret, "בדיקה ממספר לא מוכר", args) else 1

    if args.command in {"image", "audio"}:
        if not args.media_id:
            fail("צריך ‎--media-id.")
            dim("   הפונקציה מורידה את הקובץ מ-Graph API, אז מזהה מומצא ייכשל.")
            dim("   קחו media id אמיתי מהיומן אחרי ששלחתם תמונה/הקלטה בוואטסאפ.")
            return 2
        return 0 if send_media(args.sender, secret, args.command, args.media_id,
                               args.caption, args) else 1

    if args.command == "text":
        warn("ההודעה נשלחת לפרויקט החי — בקשה ליצירת נכס באמת תיצור נכס.")
        return 0 if send_text(args.sender, secret, args.message, args) else 1

    # all — רצף בטוח שלא יוצר נכסים
    results = [
        test_verify(),
        test_bad_signature(args.sender, secret),
        send_text("972500000000", secret, "בדיקה ממספר לא מוכר", args),
        send_text(args.sender, secret, "שלום", args),
    ]
    print()
    if all(results):
        ok(f"כל הבדיקות עברו ({len(results)}/{len(results)}).")
        return 0
    fail(f"{results.count(True)}/{len(results)} בדיקות עברו.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
