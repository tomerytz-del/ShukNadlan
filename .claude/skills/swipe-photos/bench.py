#!/usr/bin/env python3
import glob, json, statistics, sys, time
from playwright.sync_api import sync_playwright
BASE, SCEN, N = sys.argv[1], sys.argv[2], int(sys.argv[3])
NET = {"offline": False, "downloadThroughput": 1_600_000//8, "uploadThroughput": 750_000//8, "latency": 150}
def rows(base):
    out = []
    for i in range(12):
        out.append({"id": 1000+i, "price": 2000000+i*1000, "title": "נכס %d" % i, "rooms": 4, "size_sqm": 100, "city": "עפולה",
          "property_type": "דירה", "deal_type": "sale", "category": "residential", "created_at": "2026-11-0%dT10:00:00Z" % (1+i%6),
          "is_promoted": False, "agent_id": None, "status": "active", "features": [], "listing_number": 1000+i,
          "images": ["%s/storage/v1/object/public/props/p%d/%d.jpg" % (base, i, n) for n in range(7)]})
    return out
INIT = """
(() => { const ROWS = %s;
 const mk = (t) => { const o = new Proxy({}, { get(_, k) {
   if (k === 'then') return (res) => Promise.resolve({data: t === 'properties' ? ROWS : [], error: null, count: 0}).then(res);
   return () => o; } }); return o; };
 const client = { from: mk, rpc: () => mk('rpc'), auth: { getSession: () => Promise.resolve({data:{session:null}}), onAuthStateChange: () => ({data:{subscription:{unsubscribe(){}}}}), getUser: () => Promise.resolve({data:{user:null}}) }, channel: () => ({on(){return this}, subscribe(){return this}}), removeChannel(){} };
 const fake = { createClient: () => client };
 Object.defineProperty(window, 'supabase', { get: () => fake, set: () => {}, configurable: true });
})();
"""
WAIT_VISIBLE = """(t0) => new Promise(res => {
  const img = document.querySelector('#swTopCard .sw-cimg');
  const prev = window.__prevU;
  const tick = () => {
    const im = document.querySelector('#swTopCard .sw-cimg');
    const u = im && im.getAttribute('data-u');
    if (im && u && u !== prev && im.src.indexOf(u.split('/storage/v1/object/public/')[1]) >= 0 && im.complete && im.naturalWidth && !im.classList.contains('sw-wait')) { res(performance.now() - t0); return; }
    if (performance.now() - t0 > 8000) { res(8000); return; }
    requestAnimationFrame(tick);
  }; tick(); })"""
def cur_u(page): return page.evaluate("(document.querySelector('#swTopCard .sw-cimg')||{getAttribute(){return null}}).getAttribute('data-u')")
def click(page, side):
    b = page.evaluate("(() => { const r = document.querySelector('#swTopCard .sw-card').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()")
    x = b[0] + b[2]*(0.2 if side == 'next' else 0.8); y = b[1] + b[3]*0.45
    page.evaluate("() => { window.__prevU = (document.querySelector('#swTopCard .sw-cimg')||{getAttribute(){return null}}).getAttribute('data-u'); window.__t0 = performance.now(); }")
    page.mouse.click(x, y)
    return page.evaluate(WAIT_VISIBLE, page.evaluate("window.__t0"))
def run(browser):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2.625, is_mobile=True, has_touch=False)
    page = ctx.new_page(); page.add_init_script(INIT % json.dumps(rows(BASE)))
    cdp = ctx.new_cdp_session(page); cdp.send("Network.enable"); cdp.send("Network.emulateNetworkConditions", NET)
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
    page.goto(BASE + "/swipe", wait_until="load", timeout=120000)
    page.wait_for_selector("#swTopCard .sw-cimg", timeout=60000)
    page.wait_for_function("(() => { const i = document.querySelector('#swTopCard .sw-cimg'); return i && i.complete && i.naturalWidth && !i.classList.contains('sw-wait'); })()", timeout=60000)
    page.wait_for_timeout(6000)       # warmAhead settles
    lat = []
    if SCEN == 'fwd':         # five quick taps forward, 450ms apart
        for _ in range(5): lat.append(click(page, 'next')); page.wait_for_timeout(450)
    elif SCEN == 'back':      # two forward, then three back
        for _ in range(2): click(page, 'next'); page.wait_for_timeout(3000)
        for _ in range(3): lat.append(click(page, 'prev')); page.wait_for_timeout(450)
    elif SCEN == 'next2':     # skip to next card, tap through its photos at once
        for _ in range(3):
            page.keyboard.press('ArrowLeft'); page.wait_for_timeout(700)
            lat.append(click(page, 'next')); page.wait_for_timeout(300)
            lat.append(click(page, 'next')); page.wait_for_timeout(2500)
    kb = page.evaluate("Math.round(performance.getEntriesByType('resource').filter(r=>r.name.indexOf('/storage/')>=0).reduce((s,r)=>s+(r.transferSize||0),0)/1024)")
    ctx.close(); return lat, kb
with sync_playwright() as pw:
    ex = sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux*/chrome"))
    br = pw.chromium.launch(executable_path=ex[-1] if ex else None, args=["--no-proxy-server"])
    allLat, kbs = [], []
    for i in range(N):
        l, kb = run(br); allLat.append(l); kbs.append(kb); print(json.dumps({"run": i, "lat": [round(x) for x in l], "img_kb": kb}), flush=True)
    flat = [x for l in allLat for x in l if x < 8000]
    tmo = sum(x >= 8000 for l in allLat for x in l)   # timeout של המכשיר (לא מדידה), מחוץ לסטטיסטיקה
    if tmo: print("TIMEOUTS (excluded):", tmo)
    print("SUMMARY %s median=%.0f p90=%.0f max=%.0f slow>150ms=%d/%d img_kb_median=%.0f" % (SCEN, statistics.median(flat), sorted(flat)[int(len(flat)*0.9)-1], max(flat), sum(x>150 for x in flat), len(flat), statistics.median(kbs)))
    br.close()
