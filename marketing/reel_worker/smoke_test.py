#!/usr/bin/env python3
"""בדיקת עשן לגיבוי של תבנית D - רילס מלא בלי רשת, בלי מסד ובלי סודות.

    python marketing/reel_worker/smoke_test.py --kit <template_D_kit>      # תמונות הדוגמה מהערכה
    python marketing/reel_worker/smoke_test.py --photos a.jpg b.jpg c.jpg [--agent-photo me.jpg]

מריץ את tools/reel.py דרך snapshot_property של run_job.py - כלומר בודק בדיוק
את ההתאמה שהגיבוי עושה - על נכס 1171 (הנתונים של samples/1171 בערכה), עם
תמונות file:// וקול מדומה (צליל באורך המשפט). מה שנבדק: שהתסריט, הבלוק
העליון, פס הסוכן/ת וכרטיס הסיום יוצאים, ושהקובץ הוא 1080x1920 H.264 + AAC.
מה שלא: הקול האמיתי (Azure / edge-tts), הסרת הרקע (rembg מוריד מודל), וכל מה
שמול reel-producer. אחרי עדכון של tools/ מהערכה - להריץ ולהשוות את הפריימים
ל-samples/1171/frame_*.jpg. דורש ffmpeg, ‏Chrome/Chromium ב-PATH והגופנים
מותקנים (ראו reel_render.yml). הפלט ב-<תיקייה זמנית>/1171/reel/.
"""
import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kit", help="תיקיית template_D_kit (משתמש ב-templates/html/bg_0{1,4,7}.jpg ו-agent_avatar.jpg)")
    ap.add_argument("--photos", nargs="*", default=[], help="לפחות שתי תמונות: סלון, מרפסת, מטבח - בסדר הזה")
    ap.add_argument("--agent-photo")
    ap.add_argument("--music", help="קובץ mp3 למוזיקה (ברירת מחדל: funky_house שבריפו)")
    a = ap.parse_args()

    photos, agent_photo = list(a.photos), a.agent_photo
    if a.kit:
        html = os.path.join(a.kit, "templates", "html")
        photos = photos or [os.path.join(html, f"bg_0{n}.jpg") for n in (1, 4, 7)]
        agent_photo = agent_photo or os.path.join(html, "agent_avatar.jpg")
    if len(photos) < 2:
        sys.exit("צריך --kit או לפחות שתי תמונות ב---photos")

    work = tempfile.mkdtemp(prefix="reel_smoke_")
    root = os.path.join(work, "reel_worker")
    shutil.copytree(HERE, root, ignore=shutil.ignore_patterns("queue", "[0-9]*", "__pycache__"))
    music_dir = os.path.join(root, "brand", "music")
    tracks = json.load(open(os.path.join(music_dir, "tracks.json"), encoding="utf-8"))
    track = "funky_house"
    if a.music:
        dst = os.path.join(music_dir, tracks["tracks"][tracks["default"]]["file"])
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy(a.music, dst)
        track = tracks["default"]

    sys.path.insert(0, root)
    import run_job as RJ  # noqa: E402

    url = lambda p: "file://" + os.path.abspath(p)  # noqa: E731
    rooms = ["living_room", "balcony", "kitchen", "master_bedroom", "bathroom"]
    data = {
        "property": {"id": "b72fbc68-8723-4c4d-83ea-f13f59951ff2", "listing_number": 1171, "status": "active",
                     "category": "residential", "property_type": "דירה", "deal_type": "sale", "price": 1590000,
                     "rooms": 5, "size_sqm": 150, "floor": 1, "total_floors": None,
                     "features": ["ac", "mamad", "balcony"], "city": "עפולה", "sales_area": None,
                     "agent_id": "8e3cfc88-1bd1-479d-b262-b813b7dfb751", "created_at": "2026-10-05T16:12:09Z"},
        "images": [url(p) for p in photos],
        "image_tags": [{"image_url": url(p), "photo_type": "interior", "space_role": "main",
                        "room_type": rooms[i % len(rooms)], "has_branding": False} for i, p in enumerate(photos)],
        "neighborhood": "השכונה הצפון מערבית",
        "agent": {"id": "8e3cfc88-1bd1-479d-b262-b813b7dfb751", "name": "אריק בויחצ'ן", "phone": "+972525950549",
                  "photo_url": url(agent_photo) if agent_photo else None, "show_photo_in_ads": True,
                  "license_number": "317504"},
        "agency": {"name": 'א.ב. נדל"ן', "logo_url": None},
        "disclosure_line": None,
    }
    p = RJ.snapshot_property(data)
    os.makedirs(os.path.join(root, "queue"), exist_ok=True)
    with open(os.path.join(root, "queue", "state.json"), "w", encoding="utf-8") as f:
        json.dump({"disclosure": None, "order": [p["id"]], "properties": {p["id"]: p}}, f, ensure_ascii=False)

    spec = importlib.util.spec_from_file_location("reel", os.path.join(root, "tools", "reel.py"))
    R = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(R)
    R.LAYOUT = "D"
    R.REMBG_PY = sys.executable

    def fake_tts(text, out, voice, rate="+12%", pitch="+0Hz"):
        print("VO:", text)
        secs = max(1.0, len(text) * 0.065)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"sine=frequency=220:duration={secs:.2f}",
                        "-ar", "24000", "-ac", "1", out], check=True)

    R.tts = fake_tts
    R.build_reel(1171, "male", False, False, False, None, "v4", track)

    out = os.path.join(root, "1171", "reel", "reel_voice_male_v4.mp4")
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,width,height",
                            "-of", "compact", out], capture_output=True, text=True).stdout
    ok = "codec_name=h264|width=1080|height=1920" in probe and "codec_name=aac" in probe
    print(probe.strip())
    print(("OK " if ok else "FAIL ") + out)
    print("cover:", os.path.join(root, "1171", "reel", "cover_v4.jpg"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
