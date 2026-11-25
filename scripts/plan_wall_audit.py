#!/usr/bin/env python3
"""משווה את קירות המודל התלת-ממדי לקירות שבתמונת התוכנית (docs/plan-3d-tour.md).

**למה:** מודל של דירה נראה תקין גם כשהקירות שלו זזו. בדירה הראשונה שנבנתה (דירה 12)
הקיר התחתון ישב 18 פיקסלים מהמקום שלו, עומק חדרי השינה יצא 323 ס"מ במקום 290, והליבה
הייתה גדולה מדי, ושום דבר במסך לא אמר את זה. הבדיקה הזו כן: היא מחלצת את הקירות
המצוירים בתוכנית (אפור מלא ועבה), מציירת מעליהם את קירות המודל, וסופרת.

  python3 scripts/plan_wall_audit.py plan.jpg model.json [--out diff.png] [--scale 1.56]

`model.json` הוא העמודה `plan_models.model` (או כל JSON עם `walls` ו-`solids` באותו מבנה).
קנה המידה (ס"מ לפיקסל) קובע את עובי הקיר המצויר; ברירת המחדל 1.5, ואפשר `--scale` או
`settings.scale` בתוך הקובץ.

**הפלט:**
  התאמה  - אחוז מקירות התוכנית שמכוסים בקיר של המודל.
  חסר    - קיר בתוכנית שאין במודל (באדום ב-diff).
  מיותר  - קיר במודל שאין בתוכנית (בכחול ב-diff).
ולכל קיר במודל: ההיסט (בפיקסלים) שבו הוא מתיישב הכי טוב על התוכנית. היסט של יותר
מ-4 פיקסלים הוא קיר שצריך להזיז.

**מה היא אינה יודעת:**
  * היא מזהה קירות לפי צבע (אפור ניטרלי בבהירות 78 עד 128). תוכנית בקווים שחורים דקים,
    או בצבע אחר, תיתן התאמה נמוכה גם למודל מדויק. `--gray LO HI` משנה את הטווח.
  * ארונות מטבח וריהוט אפור נספרים כ"חסר". לכן 100% אינו היעד: בדירה 12 מודל מתוקן
    נתן 73%, ומה שנשאר היה המטבח וחלקים פנימיים של הליבה.
  * מעקות (`rail`) אינם נבדקים: בתוכנית הם קו דק ולא קיר אפור.

דורש Pillow ו-numpy. כלי עבודה ידני, לא בדיקת CI.
"""
from __future__ import annotations

import argparse
import json
import sys


def load_mask(path: str, lo: int, hi: int):
    import numpy as np
    from PIL import Image, ImageFilter

    im = Image.open(path).convert("RGB")
    a = np.array(im).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    gray = (abs(r - g) < 9) & (abs(g - b) < 9) & (r > lo) & (r < hi)
    # פתיחה מורפולוגית: מוחקת טקסט וקווים דקים, משאירה קירות עבים
    m = Image.fromarray((gray * 255).astype("uint8"))
    m = m.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
    return np.array(m) > 0, im.size


def segments(wall: dict):
    """קטעי הקיר המלאים, בלי הפתחים: [(from, to), ...] לאורך הציר."""
    lo, hi = min(wall["a"], wall["b"]), max(wall["a"], wall["b"])
    out, cur = [], lo
    for o in sorted(wall.get("o") or [], key=lambda o: o[1]):
        out.append((cur, o[1]))
        cur = o[2]
    out.append((cur, hi))
    return [(s, e) for s, e in out if e - s > 1]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("plan")
    ap.add_argument("model")
    ap.add_argument("--out", default="plan_wall_audit.png")
    ap.add_argument("--scale", type=float, default=None, help='ס"מ לפיקסל')
    ap.add_argument("--gray", type=int, nargs=2, default=[78, 128], metavar=("LO", "HI"))
    args = ap.parse_args()

    try:
        import numpy as np
        from PIL import Image, ImageDraw
    except ImportError:
        print("צריך Pillow ו-numpy:  pip install pillow numpy", file=sys.stderr)
        return 2

    doc = json.load(open(args.model, encoding="utf-8"))
    model = doc.get("model", doc)
    scale = args.scale or (doc.get("settings") or {}).get("scale") or 1.5
    plan, size = load_mask(args.plan, *args.gray)
    if "imgW" in model and (model["imgW"], model["imgH"]) != size:
        print(f"✗ המודל נבנה לתמונה של {model['imgW']}x{model['imgH']}, והתמונה היא {size[0]}x{size[1]}.")
        return 1

    thick = {"ext": 22 / scale, "int": 10 / scale}
    mine_img = Image.new("L", size, 0)
    d = ImageDraw.Draw(mine_img)
    walls = [w for w in model.get("walls", []) if w.get("t") in thick]
    for w in walls:
        th = thick[w["t"]]
        for s, e in segments(w):
            if "h" in w:
                d.rectangle([s - th / 2, w["h"] - th / 2, e + th / 2, w["h"] + th / 2], fill=255)
            else:
                d.rectangle([w["v"] - th / 2, s - th / 2, w["v"] + th / 2, e + th / 2], fill=255)
    for x1, y1, x2, y2 in model.get("solids", []):
        d.rectangle([x1, y1, x2, y2], outline=255, width=max(4, round(14 / scale)))
    mine = np.array(mine_img) > 0

    total = int(plan.sum())
    if total < 500:
        print("✗ לא נמצאו קירות אפורים בתוכנית. נסו --gray עם טווח אחר, או שהתוכנית מצוירת בקווים.")
        return 1
    match = int((plan & mine).sum())
    print(f"קירות בתוכנית: {total:,} פיקסלים · במודל: {int(mine.sum()):,}")
    print(f"התאמה: {match / total:.0%} · חסר: {int((plan & ~mine).sum()):,} · מיותר: {int((~plan & mine).sum()):,}")

    # לכל קיר: ההיסט שבו הוא יושב הכי טוב על התוכנית
    moved = []
    for w in walls:
        horiz = "h" in w
        c = round(w["h"] if horiz else w["v"])
        segs = segments(w)
        length = sum(e - s for s, e in segs)
        if length < 20:
            continue
        best_d, best, at0 = 0, -1.0, 0.0
        for off in range(-30, 31):
            cc = c + off
            lim = plan.shape[0] if horiz else plan.shape[1]
            if not 2 < cc < lim - 3:
                continue
            hit = 0
            for s, e in segs:
                s, e = int(s), int(e)
                band = plan[cc - 2:cc + 3, s:e].any(axis=0) if horiz else plan[s:e, cc - 2:cc + 3].any(axis=1)
                hit += int(band.sum())
            cov = hit / length
            if off == 0:
                at0 = cov
            if cov > best + 1e-9 or (abs(cov - best) < 1e-9 and abs(off) < abs(best_d)):
                best, best_d = cov, off
        if abs(best_d) > 4 and best - at0 > 0.2:
            moved.append((w, best_d, at0, best))
    if moved:
        print(f"\n{len(moved)} קירות שיושבים טוב יותר במקום אחר (היסט בפיקסלים):")
        for w, off, at0, best in moved:
            axis = f"h={w['h']}" if "h" in w else f"v={w['v']}"
            print(f"  {axis:8s} {w['a']}-{w['b']} ({w['t']}): להזיז {off:+d}  (כיסוי {at0:.0%} -> {best:.0%})")
    else:
        print("\nאין קיר שיושב טוב יותר במקום אחר.")

    vis = np.full(plan.shape + (3,), 255, dtype="uint8")
    vis[plan & mine] = [90, 90, 90]
    vis[plan & ~mine] = [220, 40, 40]
    vis[~plan & mine] = [40, 90, 230]
    Image.fromarray(vis).save(args.out)
    print(f"\nתמונת ההשוואה: {args.out}  (אפור = תואם, אדום = חסר במודל, כחול = מיותר במודל)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
