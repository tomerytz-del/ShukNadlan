/* ============================================================================
   שער הסרטון בדף הנכס (assets/property.js)
   ----------------------------------------------------------------------------
   התמונה היא מה שנטען ראשון. ה-src של הסרטון לא נקבע בזמן הציור, ו-play()
   לא נקרא לפני לחיצה. אחרי הטעינה, כשהדפדפן פנוי, נכנסת רק הכתובת
   (preload=none). reduced-motion, Save-Data ו-2G נשארים בלי סרטון בשער.

   הרצה:

       node --experimental-strip-types scripts/property_hero_video_test.ts

   ========================================================================== */

import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = "https://example.test/property-videos/marketing-reel-a.mp4";
const POSTER = "https://example.test/poster.jpg";

function makeDom() {
  const listeners = new Map<string, Array<(ev?: { key?: string }) => void>>();
  let idle: { cb: () => void; timeout: number } | null = null;
  const ids = new Map<string, ReturnType<typeof el>>();

  function el(tag: string) {
    const node: Record<string, any> = {
      tag,
      children: [] as any[],
      hidden: false,
      style: {},
      dataset: {},
      _attr: {} as Record<string, string>,
      _plays: 0,
      className: "",
      innerHTML: "",
      textContent: "",
      parentElement: null as any,
      classList: {
        _s: new Set<string>(),
        add(c: string) { this._s.add(c); },
        contains(c: string) { return this._s.has(c); },
        toggle() {},
      },
      setAttribute(k: string, v: string) { node._attr[k] = v; },
      getAttribute(k: string) { return k in node._attr ? node._attr[k] : null; },
      appendChild(c: any) {
        c.parentElement = node;
        node.children.push(c);
        return c;
      },
      insertBefore(c: any, before: any) {
        c.parentElement = node;
        const i = node.children.indexOf(before);
        node.children.splice(i < 0 ? node.children.length : i, 0, c);
        return c;
      },
      querySelector(sel: string) {
        const walk = (n: any): any => {
          if (sel === "img[data-lcp]" && n.dataset && n.dataset.lcp) return n;
          for (const ch of n.children || []) {
            const found = walk(ch);
            if (found) return found;
          }
          return null;
        };
        return walk(node);
      },
      querySelectorAll() { return []; },
      addEventListener(type: string, fn: () => void) {
        (node._on = node._on || {})[type] = (node._on[type] || []).concat(fn);
      },
      dispatch(type: string) { (node._on?.[type] || []).forEach((fn: () => void) => fn()); },
      play() {
        node._plays += 1;
        return Promise.resolve();
      },
      pause() { node._pauses = (node._pauses || 0) + 1; },
    };
    Object.defineProperty(node, "src", {
      get() { return node._src || ""; },
      set(v: string) { node._src = v; node._attr.src = v; },
    });
    Object.defineProperty(node, "firstElementChild", {
      get() { return node.children[0] || null; },
    });
    Object.defineProperty(node, "innerHTML", {
      get() { return node._html || ""; },
      set(v: string) {
        node._html = v;
        if (v === "") node.children.length = 0;
      },
    });
    return node;
  }

  const document = {
    readyState: "loading",
    getElementById(id: string) {
      if (!ids.has(id)) ids.set(id, el(id));
      return ids.get(id);
    },
    querySelectorAll() { return []; },
    addEventListener(type: string, fn: (ev?: { key?: string }) => void) {
      listeners.set(type, (listeners.get(type) || []).concat(fn));
    },
    createElement: el,
    fire(type: string) { (listeners.get(type) || []).forEach((fn) => fn()); },
  };

  const window = {
    location: { search: "" },
    matchMedia: (_q: string) => ({ matches: false }),
    addEventListener(type: string, fn: () => void) {
      listeners.set("window:" + type, (listeners.get("window:" + type) || []).concat(fn));
    },
    requestIdleCallback(cb: () => void, opts: { timeout: number }) {
      idle = { cb, timeout: opts.timeout };
      return 1;
    },
    fire(type: string) { (listeners.get("window:" + type) || []).forEach((fn) => fn()); },
  };

  const sandbox = {
    escapeHtml(s: unknown) {
      return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    },
    document,
    window,
    navigator: { connection: {} as { saveData?: boolean; effectiveType?: string } },
    console,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    Promise,
    IntersectionObserver: class {
      cb: (entries: { isIntersecting: boolean }[]) => void;
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) { this.cb = cb; }
      observe() {}
      fire(isIntersecting: boolean) { this.cb([{ isIntersecting }]); }
    },
  };
  (sandbox as any).globalThis = sandbox;
  return { sandbox, document, window, idle: () => idle, ids };
}

function boot(dom: ReturnType<typeof makeDom>) {
  const code = readFileSync(new URL("../assets/property.js", import.meta.url), "utf8");
  vm.runInNewContext(code, dom.sandbox, { filename: "assets/property.js" });
  return dom.sandbox as any;
}

let failed = 0;
function check(name: string, ok: boolean) {
  if (!ok) failed++;
  console.log((ok ? "✓ " : "✗ ") + name);
}

{
  const dom = makeDom();
  const g = boot(dom);
  const grid = dom.document.getElementById("bentoGrid");
  g.renderGallery({
    video_url: SRC,
    video_poster_url: POSTER,
    images: ["https://example.test/1.jpg"],
  });
  const video = grid.children.find((c: any) => c.classList.contains("bento-video"))
    ?.children.find((c: any) => c.tag === "video");
  const poster = grid.querySelector("img[data-lcp]");
  check("פוסטר עם fetchpriority", poster && poster.getAttribute("fetchpriority") === "high" && poster.src === POSTER);
  check("בלי src ובלי ניגון בזמן הציור", video && !video.getAttribute("src") && video._plays === 0);
  check("preload=none ובלי autoplay", video && video.preload === "none" && video.autoplay === false && video.muted === true);
  check("הכפתור מבקש ניגון", dom.document.getElementById("heroSoundBtn").getAttribute("aria-label") === "ניגון הסרטון");

  const obs = (dom.sandbox as any).IntersectionObserver;
  // המשקיף נוצר בתוך הפונקציה. נבדוק דרך מופע אחרון אם נשמר. במקום זה: לחיצה.
  dom.window.fire("load");
  const idle = dom.idle();
  check("אחרי הטעינה הכתובת ממתינה ל-idle של 4 שניות", !!idle && idle.timeout === 4000 && !video.getAttribute("src") && video._plays === 0);
  idle.cb();
  check("idle מכניס src ולא מנגן", video.getAttribute("src") === SRC && video._plays === 0);

  poster.dispatch("click");
  check("לחיצה ראשונה מנגנת מושתק", video._plays === 1 && video.muted === true);
  poster.dispatch("click");
  check("לחיצה שנייה פותחת קול", video.muted === false && video._plays === 2);
  void obs;
}

{
  const dom = makeDom();
  dom.window.matchMedia = () => ({ matches: true });
  const g = boot(dom);
  const grid = dom.document.getElementById("bentoGrid");
  g.renderGallery({ video_url: SRC, video_poster_url: POSTER, images: ["https://example.test/1.jpg"] });
  const video = grid.children.some((c: any) => c.classList && c.classList.contains("bento-video"));
  check("reduced-motion: בלי סרטון בשער", !video && dom.document.getElementById("heroSoundBtn").hidden === true);
}

{
  const dom = makeDom();
  const g = boot(dom);
  const grid = dom.document.getElementById("bentoGrid");
  const main = dom.document.createElement("div");
  main.classList.add("bento-main");
  main.classList.add("bento-video");
  const img = dom.document.createElement("img");
  img.dataset.lcp = "1";
  img.src = POSTER;
  img.className = "bento-video-bg";
  main.appendChild(img);
  grid.appendChild(main);
  grid.setAttribute("data-count", "2");
  g.renderGallery({
    video_url: SRC,
    video_poster_url: POSTER,
    images: ["https://example.test/1.jpg"],
  });
  const cell = grid.children.find((c: any) => c.classList.contains("bento-video"));
  const video = cell?.children.find((c: any) => c.tag === "video");
  check("SSR שומר את אותו צומת של תמונת השער", grid.querySelector("img[data-lcp]") === img);
  check("SSR מוסיף וידאו בלי src ובלי ניגון", video && !video.getAttribute("src") && video.preload === "none" && video._plays === 0);
}

{
  const dom = makeDom();
  dom.sandbox.navigator.connection.saveData = true;
  const g = boot(dom);
  const grid = dom.document.getElementById("bentoGrid");
  g.renderGallery({ video_url: SRC, images: ["https://example.test/1.jpg"] });
  check("Save-Data: בלי סרטון בשער", !grid.children.some((c: any) => c.classList && c.classList.contains("bento-video")));
}

{
  const dom = makeDom();
  dom.sandbox.navigator.connection.effectiveType = "2g";
  const g = boot(dom);
  const grid = dom.document.getElementById("bentoGrid");
  g.renderGallery({ video_url: SRC, images: ["https://example.test/1.jpg"] });
  check("2G: בלי סרטון בשער", !grid.children.some((c: any) => c.classList && c.classList.contains("bento-video")));
}

if (failed) {
  console.error(`\n${failed} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\n✓ שער הסרטון: התמונה קודם, והניגון רק בלחיצה");
