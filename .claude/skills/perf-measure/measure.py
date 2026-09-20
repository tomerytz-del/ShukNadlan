#!/usr/bin/env python3
"""משווה שתי גרסאות של דף בשני תרחישים, ומדווח גם את הפיזור.

    python measure.py --before /before.html --after /index.html

שלוש החלטות שבלעדיהן המספר שיוצא מכאן שקרי, וכולן מוסברות ב-SKILL.md:

‏1. **אין `context.route`.** יירוט בקשות ב-Playwright מכבה את מטמון
   ה-HTTP של Chromium **כולו**, ואז תרחיש "ביקור חוזר" מוריד הכול
   מחדש ונראה זהה לביקור ראשון. במקום זה: פרוקסי מת לכל מה שאינו
   מקומי, כך שבקשות ה-CDN נכשלות מיד — בשתי הגרסאות במידה שווה.
‏2. **הבייטים נלקחים מ-Resource Timing** (`transferSize`) ולא מאירוע
   ה-`response` של Playwright, שסופר פגיעת מטמון כהורדה מלאה.
‏3. **שלוש סדרות, לא אחת.** ראו `--samples` ואת הפיזור בפלט.
"""
import argparse, glob, statistics, sys
from playwright.sync_api import sync_playwright

# ‏Slow 4G בקירוב. זה הרוחב שבו הפרשי גודל נראים בכלל; על localhost
# בלי מיתון כל גרסה תיראה מיידית ושום דבר לא יתגלה.
NET = {"offline": False, "downloadThroughput": 1_600_000 // 8,
       "uploadThroughput": 750_000 // 8, "latency": 150}

METRICS = """() => {
  const n = performance.getEntriesByType('navigation')[0] || {};
  const f = performance.getEntriesByName('first-contentful-paint')[0];
  const res = performance.getEntriesByType('resource');
  return {
    fcp:  f ? f.startTime : null,
    dcl:  n.domContentLoadedEventEnd,
    load: n.loadEventEnd,
    doc_kb:  (n.transferSize || 0) / 1024,
    wire_kb: ((n.transferSize || 0) + res.reduce((s, r) => s + (r.transferSize || 0), 0)) / 1024,
  };
}"""


def chromium_path():
    hits = sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome"))
    return hits[-1] if hits else None


def one_load(browser, base, path, warm):
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    page = ctx.new_page()
    cdp = ctx.new_cdp_session(page)
    cdp.send("Network.enable")
    cdp.send("Network.emulateNetworkConditions", NET)
    if warm:
        page.goto(base + path, wait_until="load", timeout=120_000)           # חימום
        page.goto(base + path + "?v=2", wait_until="load", timeout=120_000)  # "פריסה"
    else:
        page.goto(base + path, wait_until="load", timeout=120_000)
    m = page.evaluate(METRICS)
    ctx.close()
    return m


def span(values):
    v = sorted(values)
    return "%.0f  [%.0f–%.0f]" % (statistics.median(v), v[0], v[-1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8741")
    ap.add_argument("--before", required=True)
    ap.add_argument("--after", required=True)
    ap.add_argument("--samples", type=int, default=9)
    a = ap.parse_args()

    med = lambda rs, k: statistics.median([r[k] for r in rs if r.get(k) is not None])
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path=chromium_path(),
            # פרוקסי מת לכל מה שאינו מקומי — במקום יירוט שמכבה את המטמון
            args=["--proxy-server=127.0.0.1:1", "--proxy-bypass-list=127.0.0.1;<local>"])
        for title, warm in (("ביקור ראשון (מטמון ריק)", False),
                            ("פריסה שנגעה רק ב-HTML (assets במטמון)", True)):
            print("\n" + title)
            print("  %-6s %-22s %-22s %9s %11s" % ("", "FCP ms", "load ms", "מסמך KB", "רשת KB"))
            out = {}
            for label, path in (("לפני", a.before), ("אחרי", a.after)):
                rs = [one_load(browser, a.base, path, warm) for _ in range(a.samples)]
                out[label] = rs
                print("  %-6s %-22s %-22s %9.1f %11.1f" % (
                    label, span([r["fcp"] for r in rs]), span([r["load"] for r in rs]),
                    med(rs, "doc_kb"), med(rs, "wire_kb")))
            b, c = out["לפני"], out["אחרי"]
            for key, name in (("fcp", "FCP"), ("load", "load")):
                vb = [r[key] for r in b]; vc = [r[key] for r in c]
                overlap = not (max(vc) < min(vb) or max(vb) < min(vc))
                print("  → %-5s חציון %+.0fms · פיזור %.0f/%.0f · הטווחים %s" % (
                    name, med(c, key) - med(b, key), max(vb) - min(vb), max(vc) - min(vc),
                    "נחתכים — יכול להיות רעש" if overlap else "**אינם נחתכים** — אמיתי"))
            print("  → בייטים %+.0f%%" % (100 * (med(c, "wire_kb") / med(b, "wire_kb") - 1)))
        browser.close()


if __name__ == "__main__":
    sys.exit(main())
