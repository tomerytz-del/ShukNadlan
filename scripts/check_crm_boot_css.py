#!/usr/bin/env python3
"""מסך ההמתנה של ה-CRM מצויר לפני שרוב ה-CSS מגיע - והבדיקה שומרת על זה.

‏`crm.html` מחזיק שני בלוקי `<style>` גדולים, ו-`#loginScreen` יושב ביניהם:
הראשון (ב-`<head>`) נושא את המשתנים, מסך הכניסה ומסך ההמתנה; השני, אחרי
‏`#loginScreen`, את כל השאר. כך הלוגו הקופץ מצויר כשהבתים הראשונים מגיעים
(FCP ‏1,116ms -> 240ms, ‏19.11.2026; ‏docs/agent-dashboard.md, "מסך ההמתנה לפני
ה-CSS").

**מה נשבר בלי הבדיקה, ולמה בשקט:** כלל למסך הכניסה או ההמתנה שנכתב בבלוק השני
עובד ונראה תקין בכל בדיקה רגילה. רק על קו איטי המסך מצויר פעם אחת בלי הכלל
ו"קופץ" כשהבלוק השני מגיע. ומי שמחזיר את כל ה-CSS ל-`<head>` מחזיר את המסך
הריק, בלי שום שגיאה.

    python scripts/check_crm_boot_css.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
# סלקטורים של מה שמצויר לפני שהבלוק השני מגיע
BOOT = re.compile(r"#loginScreen|#bootCard|#bootMessage|\.login-card|\.boot-card|\.brand-loader|\.bl-(?:pin|ping|shadow)")


def strip_comments(css: str) -> str:
    return re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), css, flags=re.S)


def problems(html: str) -> list[str]:
    out: list[str] = []
    login = html.find('<div id="loginScreen">')
    dash = html.find('<div id="dashboard">')
    head_end = html.find("</head>")
    if min(login, dash, head_end) < 0:
        return ["לא נמצאו </head>, #loginScreen או #dashboard ב-crm.html - הבדיקה אינה יכולה לרוץ"]
    blocks = [(m.start(), m.start(1), m.group(1)) for m in re.finditer(r"<style\b[^>]*>(.*?)</style>", html, flags=re.S)]
    first = [b for b in blocks if b[0] < head_end]
    second = [b for b in blocks if login < b[0] < dash]
    if not first:
        out.append("אין <style> ב-<head>: מסך ההמתנה יצויר בלי עיצוב")
    if not second:
        out.append("אין <style> בין #loginScreen ל-#dashboard: כל ה-CSS חזר ל-<head>, והמסך נשאר ריק עד שכולו יורד")
    if first and second:
        a, b = sum(len(x[2]) for x in first), sum(len(x[2]) for x in second)
        if a > 60_000:
            out.append(f"ה-<style> שב-<head> גדל ל-{a // 1000}KB (התקרה 60KB): מה שאינו מסך הכניסה או ההמתנה שייך לבלוק השני")
        if b < a:
            out.append("הבלוק השני קטן מהראשון: רוב ה-CSS יושב לפני #loginScreen")
    if first and not re.search(r"\.brand-loader\s*\{", strip_comments("".join(x[2] for x in first))):
        out.append("כללי .brand-loader אינם ב-<style> שב-<head>")
    for _, body_at, css in second:
        clean = strip_comments(css)
        base = html.count("\n", 0, body_at) + 1
        for i, line in enumerate(clean.split("\n")):
            head = line.split("{")[0] if "{" in line else ""
            if head and BOOT.search(head):
                out.append(f"crm.html:{base + i}: כלל למסך הכניסה/ההמתנה בבלוק השני - להעביר ל-<style> שב-<head>: {line.strip()[:90]}")
    return out


def main() -> int:
    found = problems((ROOT / "crm.html").read_text(encoding="utf-8"))
    if found:
        print("✗ מסך ההמתנה של ה-CRM (docs/agent-dashboard.md, \"מסך ההמתנה לפני ה-CSS\"):")
        for p in found:
            print("  " + p)
        return 1
    print("✓ מסך ההמתנה של ה-CRM מצויר מהבלוק הראשון, ואין כלל שלו בבלוק השני.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
