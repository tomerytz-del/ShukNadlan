#!/usr/bin/env python3
"""
מצולעים משוערים לשכונות שרשות המיסים מכירה ו-GovMap אינה, וזיהוי כינויים.

ייבוא השכונות מ-GovMap (CRM, ניהול שכונות) מחזיר רק מה שיש בשכבת
`neighborhoods_area`. אחריו נשארים שני סוגי שמות ב-`market_deals_official`:

  * שם שכל הפינים שלו (95% ומעלה) בתוך מצולע קיים אחד - **כינוי** לשכונה
    הזו. פרדס חנה (21.11.2026): "נווה פרדסים" (122 עסקאות) = גינת אגוז.
  * שם שהפינים שלו מחוץ לכל מצולע - **שכונה שאינה בשכבה** (חדרה: מרכז
    העיר, עין הים; זכרון יעקב: כולן). לה בונים מצולע משוער מהפינים.

הסקריפט קורא שני קבצי JSON ששאילתות `.claude/skills/new-market/hoods_crosscheck.sql`
מחזירות (קריאה בלבד מהמסד), ומדפיס דוח: מצולע לכל שכונה, מועמדי כינוי,
ומה נדלג. עם `--migration` הוא כותב גם קובץ מיגרציה, לבדיקה אנושית.

  python3 scripts/hood_polygons.py --pins pins.json --polygons polygons.json
  python3 scripts/hood_polygons.py ... --migration supabase/migrations/<גרסה>_<שם>.sql --include-aliases

תלות: shapely (לא ב-requirements.txt, שמשרת את מנועי ה-Actions):
  pip install shapely

איך חושב כל מצולע (נימוקים ב-docs/market-opening-runbook.md):
  1. הפינים של העסקאות בשם הזה, בלי אלה שבתוך מצולע קיים (המפה גוברת על התיוג).
  2. בלי חריגים: מעל פי 2.5 מהמרחק החציוני למרכז השכונה (ולפחות 150 מ').
  3. חלוקת Voronoi בין כל הפינים של העיר, ואיחוד התאים של כל שכונה.
  4. חיתוך לעטיפה הקעורה של הפינים ברוחב 70 מ'.
  5. פישוט (8 מ'), ו**רק אז** החסרת כל מצולע קיים מורחב ב-2 מ' ואת המשוערים
     הקודמים - ההחסרה לפני הפישוט השאירה חפיפה של 330 מ"ר (חדרה, 21.11.2026).
  6. כיווץ 3 מ' ופישוט עדין (2 מ').
  7. אימות: אפס חפיפה מול כל מצולע אחר, ושום קודקוד אינו על קו של מצולע
     אחר. `neighborhood_for_city_point` מחזירה null לנקודה בשני מצולעים, ולכן
     חפיפה מוחקת שיוכים קיימים. הפרה = קוד יציאה 2 ובלי מיגרציה.

הסקריפט אינו מתחבר למסד ואינו כותב לו.
"""
import argparse
import json
import math
import re
import sys

try:
    from shapely import STRtree, concave_hull
    from shapely.geometry import MultiPoint, Point, Polygon
    from shapely.ops import unary_union, voronoi_diagram
except ImportError:  # pragma: no cover
    sys.exit("shapely לא מותקן: pip install shapely")

K = 111320.0  # מטר לקו רוחב
DEFAULTS = dict(
    min_pins=6,            # פינים נקיים מינימליים לשכונה
    min_area_m2=15000,     # מצולע קטן מזה נזרק
    outlier_x=2.5, outlier_floor_m=150,
    hull_ratio=0.5, hull_buffer_m=70,
    simplify_m=8, guard_m=2, shrink_m=3, final_simplify_m=2,
    alias_share=0.95, alias_min_pins=8,
)
INDUSTRIAL = re.compile(r"תעשי|פארק עסקים")


# --------------------------------------------------------------------------
# קלט
# --------------------------------------------------------------------------
def load_rows(path):
    """מערך JSON, או התשובה של execute_sql (עטיפה עם result ותגיות untrusted-data)."""
    raw = open(path, encoding="utf-8").read()
    data = json.loads(raw)
    if isinstance(data, dict) and "result" in data:
        m = re.search(r"<untrusted-data-[^>]+>\s*(\[.*\])\s*</untrusted-data", data["result"], re.S)
        if not m:
            raise ValueError(f"{path}: אין מערך בתוך result")
        data = json.loads(m.group(1))
    if not isinstance(data, list):
        raise ValueError(f"{path}: צפוי מערך JSON")
    return data


class Proj:
    """היטל מקומי במטרים סביב מרכז הנתונים (קטן מספיק לעיר או לשוק)."""

    def __init__(self, lat0, lng0):
        self.lat0, self.lng0 = lat0, lng0
        self.kx = K * math.cos(math.radians(lat0))

    def xy(self, lat, lng):
        return ((lng - self.lng0) * self.kx, (lat - self.lat0) * K)

    def ll(self, x, y):
        return (round(y / K + self.lat0, 6), round(x / self.kx + self.lng0, 6))


# --------------------------------------------------------------------------
# חישוב
# --------------------------------------------------------------------------
def biggest(g):
    if g is None or g.is_empty:
        return None
    if g.geom_type == "Polygon":
        return g
    parts = [x for x in getattr(g, "geoms", []) if x.geom_type == "Polygon"]
    return max(parts, key=lambda x: x.area) if parts else None


def compute(pins, polygons, **opt):
    """pins: [{city, hood, lat, lng}], polygons: [{city, name, boundary: [[lat,lng],...]}]."""
    o = {**DEFAULTS, **opt}
    lats = [float(p["lat"]) for p in pins] or [32.0]
    lngs = [float(p["lng"]) for p in pins] or [35.0]
    prj = Proj(sum(lats) / len(lats), sum(lngs) / len(lngs))

    existing = {}
    for r in polygons:
        poly = Polygon([prj.xy(a, b) for a, b in r["boundary"]]).buffer(0)
        if not poly.is_empty:
            existing.setdefault(r["city"], []).append((r["name"], poly))

    groups = {}
    for r in pins:
        groups.setdefault(r["city"], {}).setdefault(r["hood"], []).append(
            Point(*prj.xy(float(r["lat"]), float(r["lng"]))))

    out, aliases, skipped = [], [], []
    for city, hoods in groups.items():
        ex = existing.get(city, [])
        ex_union = unary_union([p for _, p in ex]) if ex else None
        guard = ex_union.buffer(o["guard_m"]) if ex_union is not None else None

        # כינויים: רוב מוחלט של הפינים בתוך מצולע קיים אחד
        outside = []
        for hood, P in hoods.items():
            owners = {}
            for p in P:
                owner = next((n for n, poly in ex if poly.contains(p)), None)
                if owner:
                    owners[owner] = owners.get(owner, 0) + 1
                else:
                    outside.append((hood, p))
            if owners:
                top, n_top = max(owners.items(), key=lambda kv: kv[1])
                share = n_top / len(P)
                if len(P) >= o["alias_min_pins"] and share >= o["alias_share"]:
                    aliases.append(dict(city=city, hood=hood, pins=len(P), existing=top, share=round(share, 3)))

        # בלי חריגים, לכל שכונה לחוד
        clean = []
        for hood in hoods:
            P = [p for h, p in outside if h == hood]
            if len(P) >= 5:
                c = MultiPoint(P).centroid
                d = sorted(p.distance(c) for p in P)
                med = d[len(d) // 2]
                P = [p for p in P if p.distance(c) <= max(o["outlier_x"] * med, o["outlier_floor_m"])]
            clean += [(hood, p) for p in P]
        counts = {}
        for h, _ in clean:
            counts[h] = counts.get(h, 0) + 1
        for hood in hoods:
            if hood not in {a["hood"] for a in aliases if a["city"] == city} and counts.get(hood, 0) < o["min_pins"]:
                skipped.append(dict(city=city, hood=hood, pins=len(hoods[hood]), clean=counts.get(hood, 0), reason="too_few"))
        clean = [(h, p) for h, p in clean if counts[h] >= o["min_pins"]]
        if len(clean) < 3:
            continue

        pts = [p for _, p in clean]
        allpts = MultiPoint(pts)
        area = concave_hull(allpts, ratio=o["hull_ratio"]).buffer(o["hull_buffer_m"], join_style=1)
        if guard is not None:
            area = area.difference(guard)
        vor = voronoi_diagram(allpts, envelope=area.envelope.buffer(500))
        tree = STRtree(pts)
        cells = {}
        for cell in vor.geoms:
            idx = tree.query(cell, predicate="intersects")
            if len(idx):
                cells.setdefault(clean[int(idx[0])][0], []).append(cell)

        done = []
        for hood in sorted(counts, key=lambda h: -counts[h]):
            if hood not in cells:
                skipped.append(dict(city=city, hood=hood, pins=len(hoods[hood]), reason="no_region"))
                continue
            poly = biggest(unary_union(cells[hood]).intersection(area))
            poly = biggest(poly.simplify(o["simplify_m"]).buffer(0)) if poly else None
            if poly is not None and guard is not None:
                poly = biggest(poly.difference(guard))
            for q in done:
                poly = biggest(poly.difference(q.buffer(o["guard_m"]))) if poly is not None else None
            poly = biggest(poly.buffer(-o["shrink_m"]).buffer(0)) if poly is not None else None
            poly = biggest(poly.simplify(o["final_simplify_m"], preserve_topology=True).buffer(0)) if poly is not None else None
            if poly is None or poly.area < o["min_area_m2"]:
                skipped.append(dict(city=city, hood=hood, pins=len(hoods[hood]), reason="empty_after_clip"))
                continue
            done.append(poly)
            ring = [list(prj.ll(x, y)) for x, y in poly.exterior.coords]
            c = poly.centroid
            lat, lng = prj.ll(c.x, c.y)
            out.append(dict(city=city, hood=hood, pins=len(hoods[hood]),
                            inside=sum(1 for p in hoods[hood] if poly.contains(p)),
                            area_ha=round(poly.area / 1e4, 1), ring=ring, lat=lat, lng=lng))

    violations, min_gap = verify(out, existing, prj)
    return dict(polygons=out, aliases=aliases, skipped=skipped, violations=violations, min_gap_m=min_gap)


def verify(out, existing, prj):
    """חפיפה מול כל מצולע אחר, וקודקוד על קו של מצולע קיים. על הטבעות המעוגלות, כפי שייכתבו."""
    polys = {(f["city"], f["hood"]): Polygon([prj.xy(a, b) for a, b in f["ring"]]) for f in out}
    bad, gap = [], float("inf")
    for (city, hood), g in polys.items():
        for name, e in existing.get(city, []):
            if g.intersection(e).area > 0.01 or any(e.covers(Point(*v)) for v in g.exterior.coords):
                bad.append(f"{city}: {hood} חופף או נוגע ב-{name}")
            gap = min(gap, g.distance(e))
    keys = list(polys)
    for i, a in enumerate(keys):
        for b in keys[i + 1:]:
            if a[0] != b[0]:
                continue
            if polys[a].intersection(polys[b]).area > 0.01:
                bad.append(f"{a[0]}: {a[1]} חופף {b[1]}")
            gap = min(gap, polys[a].distance(polys[b]))
    return bad, (None if gap == float("inf") else round(gap, 2))


# --------------------------------------------------------------------------
# פלט
# --------------------------------------------------------------------------
def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def migration_sql(res, include_aliases):
    rows = []
    for p in res["polygons"]:
        ring = json.dumps([[a, b] for a, b in p["ring"]], separators=(",", ":"))
        ind = "true" if INDUSTRIAL.search(p["hood"]) else "false"
        rows.append(f"  ({q(p['city'])}, {q(p['hood'])}, {p['lat']:.6f}, {p['lng']:.6f}, {ind}, {p['pins']}, {q(ring)}::jsonb)")
    sql = [
        "-- שכונות שאינן בשכבה של GovMap, עם מצולע משוער מפיני העסקאות",
        "-- נוצר ב-scripts/hood_polygons.py. **להשלים לפני מיזוג:** למה, אילו ערים, מה נבדק",
        "-- מול המסד (docs/market-opening-runbook.md), ואם סימון אזור התעשייה נכון.",
        "-- אפס חפיפה מול מצולע אחר אומת בסקריפט; מרחק מזערי: "
        f"{res['min_gap_m']} מ'.",
        "",
    ]
    if rows:
        sql += [
            "insert into public.neighborhoods (city, name, city_id, lat, lng, is_industrial, boundary)",
            "select v.city, v.name, c.id, v.lat, v.lng, v.is_industrial, v.boundary",
            "  from (values",
            ",\n".join(rows),
            "  ) as v(city, name, lat, lng, is_industrial, pins, boundary)",
            "  join public.cities c on c.name_key = public.city_name_key(v.city) and c.active",
            " where not exists (",
            "   select 1 from public.neighborhoods n",
            "    where n.city_id = c.id",
            "      and public.neighborhood_name_key(n.name) = public.neighborhood_name_key(v.name))",
            "on conflict (city, name) do nothing;",
            "",
        ]
    if include_aliases and res["aliases"]:
        vals = ",\n".join(f"    ({q(a['city'])}, {q(a['existing'])}, {q(a['hood'])})" for a in res["aliases"])
        sql += [
            "insert into public.neighborhood_aliases (neighborhood_id, alias, shared, note)",
            "select n.id, v.alias, false, 'השם במאגר רשות המיסים: כל הפינים בתוך המצולע הזה'",
            "  from (values",
            vals,
            "  ) as v(city, hood, alias)",
            "  join public.cities c on c.name_key = public.city_name_key(v.city)",
            "  join public.neighborhoods n on n.city_id = c.id and n.name = v.hood",
            "on conflict (neighborhood_id, alias_key) do nothing;",
            "",
        ]
    return "\n".join(sql)


def report(res):
    print(f"{'עיר':<16}{'שכונה':<20}{'פינים':>6}{'בפנים':>7}{'הקטר':>8}{'קדקודים':>9}")
    for p in res["polygons"]:
        print(f"{p['city']:<16}{p['hood']:<20}{p['pins']:>6}{p['inside']:>7}{p['area_ha']:>8}{len(p['ring']):>9}")
    if res["aliases"]:
        print("\nמועמדי כינוי (95% מהפינים בתוך מצולע קיים אחד; לאשר ביד):")
        for a in res["aliases"]:
            print(f"  {a['city']}: {a['hood']} ({a['pins']} פינים) -> {a['existing']} ({a['share']:.0%})")
    if res["skipped"]:
        print("\nנדלגו:")
        for s in res["skipped"]:
            print(f"  {s['city']}: {s['hood']} ({s['pins']} פינים): {s['reason']}")
    print(f"\n{len(res['polygons'])} מצולעים, {len(res['violations'])} הפרות, "
          f"מרחק מזערי למצולע אחר: {res['min_gap_m']} מ'")
    for v in res["violations"]:
        print("  הפרה:", v)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--pins", required=True, help="JSON: city, hood, lat, lng (שאילתה 1)")
    ap.add_argument("--polygons", required=True, help="JSON: city, name, boundary (שאילתה 2)")
    ap.add_argument("--migration", help="נתיב לקובץ מיגרציה לכתיבה")
    ap.add_argument("--include-aliases", action="store_true", help="גם כינויים למועמדים (אחרי אישור ביד)")
    ap.add_argument("--min-pins", type=int, default=DEFAULTS["min_pins"])
    a = ap.parse_args(argv)
    res = compute(load_rows(a.pins), load_rows(a.polygons), min_pins=a.min_pins)
    report(res)
    if res["violations"]:
        print("\nלא נכתבה מיגרציה: יש הפרות.", file=sys.stderr)
        return 2
    if a.migration:
        open(a.migration, "w", encoding="utf-8").write(migration_sql(res, a.include_aliases))
        print(f"נכתב: {a.migration}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
