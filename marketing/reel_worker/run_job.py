#!/usr/bin/env python3
"""הגיבוי של האתר לרילס בתבנית D - מריץ את reel.py של הערכה על בקשה אחת.

    python marketing/reel_worker/run_job.py --job <property_video_jobs.id>

רץ ב-GitHub Actions (‏.github/workflows/reel_render.yml) כש-Grok Bot לא לקח
בקשה, נתקע או ויתר. ‏tools/reel.py, ‏queue.py, ‏cutout.py ו-watermark.py הם
העתק **כלשונו** של reference_code מהערכה: זה מה שמבטיח שהרילס כאן זהה לזה
של Grok, ולכן גרסה חדשה של הערכה נכנסת בהעתקה ולא בעריכה. כל ההתאמה
לסביבה יושבת כאן:

  * הנתונים - מ-reel-producer?action=job_data ולא מ-snapshot מקומי; הקובץ
    queue/state.json נכתב בצורה ש-reel.py מצפה לה.
  * הקול - Azure Speech (אותו he-IL-AvriNeural) כשיש מפתח, ואחרת edge-tts
    כמו בערכה.
  * הסרת הרקע - rembg באותו python, ולא ב-venv הקשיח של הערכה.
  * המוזיקה - מהדלי הפרטי reel-assets (רישיון Pixabay אוסר להפיץ את הקובץ),
    ואם הוא חסר - funky_house (CC0) שבריפו, עם אזהרה בלוג.

כל כישלון נגמר ב-action=fail, שמעביר את הבקשה ל-fal. הבקשה אינה נסגרת
כאן ואינה מזוכה כאן - זה תפקיד השרת. ‏docs/property-marketing-video.md.
"""
import argparse
import importlib.util
import json
import os
import re
import sys
import threading
import traceback
import urllib.error
import urllib.request
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(HERE, "tools")
API = os.environ.get("REEL_PRODUCER_URL", "https://obookujgolazrwycsiyn.supabase.co/functions/v1/reel-producer")
SECRET = os.environ.get("REEL_SITE_SECRET", "")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
HEARTBEAT_S = 60


class LostJob(Exception):
    """הבקשה כבר אינה שלנו (not_owner). לא מדווחים fail - מי שמחזיק בה ימשיך."""


def call(action, body):
    req = urllib.request.Request(
        f"{API}?action={action}", data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", "x-reel-producer-secret": SECRET})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            data = json.loads(e.read() or b"{}")
        except ValueError:
            data = {}
        if data.get("error") == "not_owner":
            raise LostJob(action)
        raise RuntimeError(f"{action}: HTTP {e.code} {data}")


def put_file(signed_url, path, content_type):
    with open(path, "rb") as f:
        data = f.read()
    req = urllib.request.Request(signed_url, data=data, method="PUT",
                                 headers={"Content-Type": content_type, "x-upsert": "false"})
    with urllib.request.urlopen(req, timeout=300) as r:
        if r.status >= 300:
            raise RuntimeError(f"upload {os.path.basename(path)}: HTTP {r.status}")


def download(url, dst):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dst, "wb") as f:
        f.write(r.read())


# ---------------------------------------------------------------------------
# מה ש-reel.py קורא מ-queue/state.json. השמות הם של ה-snapshot של Grok
# (‏agent_name, ‏agency_logo, ‏image_tags[].url ...), ולא של המסד.
# ---------------------------------------------------------------------------
def snapshot_property(d):
    p = dict(d["property"])
    agent, agency = d.get("agent") or {}, d.get("agency") or {}
    p["category"] = p.get("category") or "residential"
    p["images"] = d.get("images") or []
    p["image_tags"] = [{"url": t.get("image_url"), "photo_type": t.get("photo_type"), "space_role": t.get("space_role"),
                        "room_type": t.get("room_type"), "has_branding": t.get("has_branding")}
                       for t in (d.get("image_tags") or []) if t.get("image_url")]
    # השכונה של נכס: neighborhood_id לפני sales_area (הסקיל search-core).
    p["neighborhood"] = d.get("neighborhood") or p.get("sales_area")
    p["agent_id"] = agent.get("id") or p.get("agent_id")
    p["agent_name"] = agent.get("name")
    p["agent_phone"] = agent.get("phone")
    p["agent_photo"] = agent.get("photo_url")
    p["agent_photo_position"] = agent.get("photo_position")
    p["agent_show_photo"] = agent.get("show_photo_in_ads", True) is not False
    p["agent_license"] = agent.get("license_number")
    p["agency_name"] = agency.get("name")
    p["agency_logo"] = agency.get("logo_url")
    return p


def azure_tts(text, out, voice, rate="+12%", pitch="+0Hz"):
    key, region = os.environ["AZURE_SPEECH_KEY"], os.environ["AZURE_SPEECH_REGION"]
    ssml = (f"<speak version='1.0' xml:lang='he-IL'><voice name='{voice}'>"
            f"<prosody rate='{rate}' pitch='{pitch}'>{escape(text)}</prosody></voice></speak>")
    req = urllib.request.Request(
        f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1", data=ssml.encode("utf-8"), method="POST",
        headers={"Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml",
                 # אותו פורמט ש-edge-tts מוריד, כדי שהקיצוץ והעוצמה ב-reel.py יתנהגו זהה
                 "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3", "User-Agent": "shuknadlan-reel"})
    with urllib.request.urlopen(req, timeout=60) as r, open(out, "wb") as f:
        f.write(r.read())


def heartbeat(job_id, stop, lost):
    while not stop.wait(HEARTBEAT_S):
        try:
            call("job_heartbeat", {"job_id": job_id})
        except LostJob:
            lost.set()
            print("heartbeat: not_owner - the job moved on; stopping", file=sys.stderr)
            os._exit(0)
        except Exception as e:  # דופק שנכשל פעם אחת אינו סיבה לעצור רינדור
            print("heartbeat failed:", e, file=sys.stderr)


def render(job_id):
    data = call("job_data", {"job_id": job_id})
    job = data["job"]
    n = job["listing_number"]
    p = snapshot_property(data)

    qdir = os.path.join(HERE, "queue")
    os.makedirs(qdir, exist_ok=True)
    disc = data.get("disclosure_line") or None
    state = {"disclosure": disc, "order": [p["id"]], "properties": {p["id"]: p}}
    with open(os.path.join(qdir, "state.json"), "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)

    music_dir = os.path.join(HERE, "brand", "music")
    tracks = json.load(open(os.path.join(music_dir, "tracks.json"), encoding="utf-8"))
    track = tracks["default"]
    main = os.path.join(music_dir, tracks["tracks"][track]["file"])
    if not os.path.exists(main):
        try:
            if not data.get("music_url"):
                raise RuntimeError("no music_url (reel-assets/music/pixabay/candidate_1.mp3 missing?)")
            os.makedirs(os.path.dirname(main), exist_ok=True)
            download(data["music_url"], main)
        except Exception as e:
            print(f"::warning::default music unavailable ({e}); using funky_house (CC0)", file=sys.stderr)
            track = "funky_house"

    spec = importlib.util.spec_from_file_location("reel", os.path.join(TOOLS, "reel.py"))
    R = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(R)
    R.LAYOUT = "D"
    R.REMBG_PY = sys.executable
    if os.environ.get("AZURE_SPEECH_KEY") and os.environ.get("AZURE_SPEECH_REGION"):
        R.tts = azure_tts
    else:
        print("::warning::AZURE_SPEECH_KEY not set; using edge-tts", file=sys.stderr)

    R.build_reel(n, "male", False, False, False, None, "v4", track)

    rd = os.path.join(HERE, str(n), "reel")
    video = os.path.join(rd, "reel_voice_male_v4.mp4")
    cover = os.path.join(rd, "cover_v4.jpg")
    if not os.path.exists(video):
        raise RuntimeError("reel.py finished without reel_voice_male_v4.mp4")

    urls = call("upload_urls", {"job_id": job_id})
    put_file(urls["video"]["signed_url"], video, "video/mp4")
    cover_path = None
    if os.path.exists(cover):
        put_file(urls["cover"]["signed_url"], cover, "image/jpeg")
        cover_path = urls["cover"]["path"]
    done = call("complete", {"job_id": job_id, "video_path": urls["video"]["path"], "cover_path": cover_path})
    print(json.dumps({"job_id": job_id, "listing": n, "result_url": done.get("result_url")}, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    a = ap.parse_args()
    if not UUID.match(a.job):
        sys.exit("bad job id")
    if len(SECRET) < 32:
        sys.exit("REEL_SITE_SECRET is not configured")

    stop, lost = threading.Event(), threading.Event()
    try:
        call("job_heartbeat", {"job_id": a.job})
    except LostJob:
        print("job is not ours (already moved on or done)")
        return
    threading.Thread(target=heartbeat, args=(a.job, stop, lost), daemon=True).start()
    try:
        render(a.job)
    except LostJob:
        print("job moved on during render; nothing to report")
    except BaseException as e:  # גם sys.exit מתוך reel.py ("command failed: ...")
        msg = f"{type(e).__name__}: {e}"[:180]
        traceback.print_exc()
        if not lost.is_set():
            try:
                print("fail ->", call("fail", {"job_id": a.job, "reason": f"site_render: {msg}"}))
            except Exception as e2:
                print("could not report failure:", e2, file=sys.stderr)
        sys.exit(1)
    finally:
        stop.set()


if __name__ == "__main__":
    main()
