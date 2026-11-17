/* ============================================================================
   הדף המסחרי (/afula/נדלן-מסחרי): מסנן, מגירה, מצב "אין תוצאות" וטופס פנייה.
   ----------------------------------------------------------------------------
   המודעות כבר ב-HTML (assets/silo-render.js, cmRender), עם data-deal,
   data-group, data-sqm, data-total, data-area ו-data-parking. כאן רק הסתרה
   והצגה, בלי טעינת דף ובלי שאילתה נוספת.

   הכתובת: type, deal, min_sqm, max_sqm, area. פרמטר מהכתובת גובר על ברירת
   המחדל (השכרה), ערך לא מוכר נזנח בשקט ומוצג הכל. כל שינוי כותב לכתובת
   עם replaceState ומשאיר את שאר הפרמטרים (utm, gclid). ה-canonical לא
   משתנה (silo-page.ts כותבת אותו מהנתיב), וה-H1 וה-title גם לא: משתנה
   רק כותרת הרשימה.

   מדידה: וואטסאפ וחיוג בכרטיס הם קישורי wa.me ו-tel: עם data-property-id,
   ו-events.js סופר אותם contact_agent (עם contact-inquiry.js). שליחת
   הטופס היא generate_lead. אין כאן שם, טלפון או כתובת ב-dataLayer.
   ========================================================================== */
(function () {
  "use strict";

  var SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
  var DEALS = ["rent", "sale"];
  /* ‏הקבוצות מ-silo-render.js (CM_GROUPS), עותק אחד: אותו מיפוי קובע את הצ'יפים
     בשרת, את הכותרות כאן ואת property_types שנשלח לטופס. */
  var GROUPS = {};
  ((window.ShukSilo && window.ShukSilo.cmGroups) || []).forEach(function (g) { GROUPS[g.key] = g; });
  var DEAL_WORD = { rent: "להשכרה", sale: "למכירה" };

  var inited = false;

  function init() {
    var root = document.getElementById("cmRoot");
    if (!root || inited) return;
    inited = true;

    var grid = document.getElementById("cmGrid");
    var empty = document.getElementById("cmEmpty");
    var title = document.getElementById("cmListTitle");
    var activeBox = document.getElementById("cmActive");
    var drawer = document.getElementById("cmDrawer");
    var lead = document.getElementById("cmLead");
    var form = document.getElementById("cmLeadForm");
    var sticky = document.getElementById("cmSticky");
    var areaSel = document.getElementById("cmArea");
    var parkBox = document.getElementById("cmParking");
    var items = Array.prototype.slice.call(grid.querySelectorAll(".cm-item"));

    var state = { deal: "rent", type: "", sqm: null, price: null, area: "", parking: false, order: [] };

    /* ---------- כתובת ---------- */
    function num(v) {
      if (v == null || v === "") return null;
      var n = Number(v);
      return isFinite(n) && n >= 0 && n < 1e7 ? n : null;
    }
    function readUrl() {
      var q = new URLSearchParams(location.search);
      var deal = q.get("deal");
      if (DEALS.indexOf(deal) >= 0) state.deal = deal;
      var type = q.get("type");
      /* ‏offices|shops|warehouse|clinic|land. "clinic" ו-"land" נשארים תקפים גם בלי מלאי. */
      if (type && Object.prototype.hasOwnProperty.call(GROUPS, type)) { state.type = type; state.order.push("type"); }
      var mn = num(q.get("min_sqm"));
      var mx = num(q.get("max_sqm"));
      if (mn != null || mx != null) {
        if (mn != null && mx != null && mn > mx) { var t = mn; mn = mx; mx = t; }
        state.sqm = [mn, mx];
        state.order.push("sqm");
      }
      var area = q.get("area");
      if (area) {
        for (var i = 0; i < areaSel.options.length; i++) {
          if (areaSel.options[i].value === area) { state.area = area; state.order.push("area"); break; }
        }
      }
    }
    function writeUrl() {
      try {
        var q = new URLSearchParams(location.search);
        q.set("deal", state.deal);
        if (state.type) q.set("type", state.type); else q.delete("type");
        if (state.sqm && state.sqm[0] != null) q.set("min_sqm", state.sqm[0]); else q.delete("min_sqm");
        if (state.sqm && state.sqm[1] != null) q.set("max_sqm", state.sqm[1]); else q.delete("max_sqm");
        if (state.area) q.set("area", state.area); else q.delete("area");
        var qs = q.toString();
        history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
      } catch (e) { /* כתובת חסומה: הרשימה עדיין מתעדכנת */ }
    }

    /* ---------- סינון ---------- */
    function fails(el) {
      var miss = [];
      var d = el.getAttribute("data-deal");
      if (d !== state.deal) miss.push("deal");
      if (state.type && el.getAttribute("data-group") !== state.type) miss.push("type");
      var sq = Number(el.getAttribute("data-sqm")) || 0;
      if (state.sqm && (sq <= 0 || (state.sqm[0] != null && sq < state.sqm[0]) || (state.sqm[1] != null && sq > state.sqm[1]))) miss.push("sqm");
      var tot = Number(el.getAttribute("data-total")) || 0;
      if (state.price && (tot <= 0 || (state.price[0] != null && tot < state.price[0]) || (state.price[1] != null && tot > state.price[1]))) miss.push("price");
      if (state.area && el.getAttribute("data-area") !== state.area) miss.push("area");
      if (state.parking && el.getAttribute("data-parking") !== "1") miss.push("parking");
      return miss;
    }

    function dealWord() { return DEAL_WORD[state.deal]; }

    function listTitle() {
      if (!state.type) return "מודעות פעילות";
      return GROUPS[state.type].list + " " + dealWord();
    }

    function sqmLabel() {
      var a = state.sqm[0], b = state.sqm[1];
      if (b == null) return a + "+ מ״ר";
      if (a == null || a === 0) return "עד " + b + " מ״ר";
      return a + " עד " + b + " מ״ר";
    }
    function priceLabel() {
      var a = state.price[0], b = state.price[1];
      /* ‏בידוד כיוון סביב כל סכום, כדי ששני סכומים באותו טקסט לא יתהפכו */
      var f = function (n) { return "\u2066₪" + Math.round(n).toLocaleString("en-US") + "\u2069"; };
      if (b == null) return "מעל " + f(a);
      if (a == null || a === 0) return "עד " + f(b);
      return f(a) + " עד " + f(b);
    }

    function renderActive() {
      var out = [];
      function add(key, label) { out.push({ key: key, label: label }); }
      if (state.type) add("type", GROUPS[state.type].list);
      if (state.sqm) add("sqm", sqmLabel());
      if (state.price) add("price", priceLabel());
      if (state.area) add("area", state.area);
      if (state.parking) add("parking", "חניה");
      activeBox.textContent = "";
      out.forEach(function (o) {
        var li = document.createElement("li");
        var b = document.createElement("button");
        b.type = "button";
        b.className = "cm-x-chip";
        b.setAttribute("data-cm-remove", o.key);
        b.setAttribute("aria-label", "הסרת המסנן " + o.label);
        var s = document.createElement("span");
        s.textContent = o.label;
        var x = document.createElement("b");
        x.setAttribute("aria-hidden", "true");
        x.textContent = "✕";
        b.appendChild(s);
        b.appendChild(x);
        li.appendChild(b);
        activeBox.appendChild(li);
      });
      if (out.length > 1) {
        var li2 = document.createElement("li");
        var c = document.createElement("button");
        c.type = "button";
        c.className = "cm-clear";
        c.setAttribute("data-cm-clear", "");
        c.textContent = "ניקוי הכל";
        li2.appendChild(c);
        activeBox.appendChild(li2);
      }
    }

    function syncControls() {
      root.setAttribute("data-deal", state.deal);
      Array.prototype.forEach.call(root.querySelectorAll("[data-cm-deal]"), function (b) {
        b.setAttribute("aria-pressed", b.getAttribute("data-cm-deal") === state.deal ? "true" : "false");
      });
      Array.prototype.forEach.call(root.querySelectorAll("[data-cm-type]"), function (b) {
        b.setAttribute("aria-pressed", b.getAttribute("data-cm-type") === state.type ? "true" : "false");
      });
      Array.prototype.forEach.call(drawer.querySelectorAll("[data-cm-sqm]"), function (b) {
        var r = range(b.getAttribute("data-cm-sqm"));
        var on = !!state.sqm && state.sqm[0] === r[0] && state.sqm[1] === r[1];
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      Array.prototype.forEach.call(drawer.querySelectorAll("[data-cm-price-for]"), function (g) {
        g.hidden = g.getAttribute("data-cm-price-for") !== state.deal;
      });
      Array.prototype.forEach.call(drawer.querySelectorAll("[data-cm-price]"), function (b) {
        var r = range(b.getAttribute("data-cm-price"));
        var on = !!state.price && state.price[0] === r[0] && state.price[1] === r[1];
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      areaSel.value = state.area;
      parkBox.checked = state.parking;
    }

    function range(text) {
      var p = String(text).split("-");
      return [p[0] === "" ? null : Number(p[0]), p[1] === "" || p[1] == null ? null : Number(p[1])];
    }

    function nearby() {
      /* ‏שלושה קרובים: מהעסקה הנבחרת קודם, ואז לפי כמה מסננים הם מפספסים. */
      var scored = [];
      items.forEach(function (el, i) {
        var miss = fails(el);
        if (!miss.length) return;
        var weight = miss.length + (miss.indexOf("deal") >= 0 ? 10 : 0);
        scored.push({ el: el, w: weight, i: i });
      });
      scored.sort(function (a, b) { return a.w - b.w || a.i - b.i; });
      return scored.slice(0, 3).map(function (x) { return x.el; });
    }

    function renderEmpty() {
      var what = state.type ? GROUPS[state.type].none : "נכס מסחרי";
      empty.textContent = "";
      var h = document.createElement("h3");
      h.textContent = "אין כרגע " + what + " " + dealWord() + " בטווח הזה";
      empty.appendChild(h);
      var row = document.createElement("div");
      row.className = "cm-empty-actions";
      if (state.order.length) {
        var widen = document.createElement("button");
        widen.type = "button";
        widen.className = "cm-ghost";
        widen.setAttribute("data-cm-widen", "");
        widen.textContent = "להרחיב חיפוש";
        row.appendChild(widen);
      }
      var alertBtn = document.createElement("button");
      alertBtn.type = "button";
      alertBtn.className = "cm-gold";
      alertBtn.setAttribute("data-cm-alert", "");
      alertBtn.textContent = "לקבל התראה כשעולה נכס";
      row.appendChild(alertBtn);
      empty.appendChild(row);
      var near = nearby();
      if (near.length) {
        var sub = document.createElement("h3");
        sub.className = "cm-near-title";
        sub.textContent = "נכסים קרובים";
        empty.appendChild(sub);
        var ul = document.createElement("ul");
        ul.className = "cm-grid";
        near.forEach(function (el) {
          var c = el.cloneNode(true);
          c.hidden = false;
          ul.appendChild(c);
        });
        empty.appendChild(ul);
      }
    }

    function apply(write) {
      var shown = 0;
      items.forEach(function (el) {
        var ok = fails(el).length === 0;
        el.hidden = !ok;
        if (ok) shown++;
      });
      title.textContent = listTitle();
      grid.hidden = shown === 0;
      empty.hidden = shown !== 0;
      if (shown === 0) renderEmpty(); else empty.textContent = "";
      renderActive();
      syncControls();
      if (write) writeUrl();
    }

    function touch(key, on) {
      state.order = state.order.filter(function (k) { return k !== key; });
      if (on) state.order.push(key);
    }
    function remove(key) {
      if (key === "type") state.type = "";
      else if (key === "sqm") state.sqm = null;
      else if (key === "price") state.price = null;
      else if (key === "area") state.area = "";
      else if (key === "parking") state.parking = false;
      touch(key, false);
    }

    /* ---------- אירועים ---------- */
    var lastFocus = null;
    function openSheet(el) {
      lastFocus = document.activeElement;
      el.hidden = false;
      document.documentElement.classList.add("cm-lock");
      sticky.classList.add("is-off");
      var first = el.querySelector("input,select,button:not([data-cm-close])");
      if (first) first.focus();
    }
    function closeSheets() {
      [drawer, lead].forEach(function (el) { el.hidden = true; });
      document.documentElement.classList.remove("cm-lock");
      sticky.classList.remove("is-off");
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* אין מיקוד לשחזר */ } }
    }

    function openLead(mode) {
      var alertMode = mode === "alert";
      document.getElementById("cmLeadT").textContent = alertMode ? "קבלו התראה כשעולה נכס" : "מחפשים נכס מסחרי? נמצא לכם";
      form.setAttribute("data-mode", alertMode ? "alert" : "lead");
      form.type.value = state.type || "";
      var sq = "";
      if (state.sqm) {
        Array.prototype.forEach.call(form.sqm.options, function (o) {
          if (!o.value) return;
          var r = range(o.value);
          if (r[0] === state.sqm[0] && r[1] === state.sqm[1]) sq = o.value;
        });
      }
      form.sqm.value = sq;
      document.getElementById("cmLeadDone").hidden = true;
      Array.prototype.forEach.call(form.querySelectorAll(".cm-lead-fields,.cm-consent,.cm-send,.cm-err"), function (n) { n.hidden = false; });
      form.querySelector(".cm-sheet-head").hidden = false;
      openSheet(lead);
    }

    document.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      var el;
      if ((el = t.closest("[data-cm-deal]"))) {
        state.deal = el.getAttribute("data-cm-deal");
        /* ‏טווח מחיר של השכרה אינו של מכירה */
        if (state.price) { state.price = null; touch("price", false); }
        apply(true);
        return;
      }
      if ((el = t.closest("[data-cm-type]"))) {
        state.type = el.getAttribute("data-cm-type");
        touch("type", !!state.type);
        apply(true);
        return;
      }
      if ((el = t.closest("[data-cm-sqm]"))) {
        var r = range(el.getAttribute("data-cm-sqm"));
        var same = state.sqm && state.sqm[0] === r[0] && state.sqm[1] === r[1];
        state.sqm = same ? null : r;
        touch("sqm", !!state.sqm);
        apply(true);
        return;
      }
      if ((el = t.closest("[data-cm-price]"))) {
        var pr = range(el.getAttribute("data-cm-price"));
        var samep = state.price && state.price[0] === pr[0] && state.price[1] === pr[1];
        state.price = samep ? null : pr;
        touch("price", !!state.price);
        apply(true);
        return;
      }
      if ((el = t.closest("[data-cm-remove]"))) { remove(el.getAttribute("data-cm-remove")); apply(true); return; }
      if (t.closest("[data-cm-clear]")) {
        ["type", "sqm", "price", "area", "parking"].forEach(remove);
        apply(true);
        return;
      }
      if (t.closest("[data-cm-widen]")) {
        var last = state.order[state.order.length - 1];
        if (last) remove(last);
        apply(true);
        return;
      }
      if (t.closest("[data-cm-open]")) { openSheet(drawer); return; }
      if (t.closest("[data-cm-alert]")) { openLead("alert"); return; }
      if (t.closest("[data-cm-lead]")) { openLead("lead"); return; }
      if (t.closest("[data-cm-close]")) { closeSheets(); return; }
      if (t.classList && t.classList.contains("cm-sheet")) closeSheets();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && (!drawer.hidden || !lead.hidden)) closeSheets(); });
    areaSel.addEventListener("change", function () {
      state.area = areaSel.value;
      touch("area", !!state.area);
      apply(true);
    });
    parkBox.addEventListener("change", function () {
      state.parking = parkBox.checked;
      touch("parking", state.parking);
      apply(true);
    });

    /* ---------- טופס ---------- */
    function track(name, params) {
      try { if (window.shukTrack) window.shukTrack(name, params || {}); } catch (e) { /* מדידה לא שוברת טופס */ }
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var err = document.getElementById("cmLeadErr");
      var name = form.name.value.trim();
      var phone = form.phone.value.trim();
      if (name.length < 2) { err.textContent = "נא להזין שם"; form.name.focus(); return; }
      if (phone.replace(/\D/g, "").length < 9) { err.textContent = "נא להזין מספר טלפון תקין"; form.phone.focus(); return; }
      if (!form.consent.checked) { err.textContent = "צריך לסמן את האישור כדי לשלוח"; form.consent.focus(); return; }
      err.textContent = "";
      var group = form.type.value;
      var r = form.sqm.value ? range(form.sqm.value) : null;
      var alertMode = form.getAttribute("data-mode") === "alert";
      var body = {
        full_name: name, phone: phone, contact_channel: "whatsapp",
        category: "commercial", deal_type: state.deal, cities: ["עפולה"],
        consent_agent_contact: true, consent_text: form.getAttribute("data-consent-text"), consent_version: "commercial-v1",
        source: "commercial_landing",
        free_text: (alertMode ? "התראה מהדף המסחרי" : "פנייה מהדף המסחרי") + (state.area ? " · שכונה: " + state.area : ""),
      };
      if (group && GROUPS[group]) body.property_types = GROUPS[group].types;
      if (r) { if (r[0] != null) body.min_size_sqm = r[0]; if (r[1] != null) body.max_size_sqm = r[1]; }
      var btn = form.querySelector(".cm-send");
      btn.disabled = true;
      fetch(SUPABASE_URL + "/functions/v1/saved-search-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY },
        body: JSON.stringify(body),
      }).then(function (res) {
        if (!res.ok) throw new Error("status");
        track("generate_lead", { form_id: alertMode ? "commercial_alert" : "commercial_landing" });
        Array.prototype.forEach.call(form.querySelectorAll(".cm-lead-fields,.cm-consent,.cm-send,.cm-err"), function (n) { n.hidden = true; });
        form.querySelector(".cm-sheet-head").hidden = true;
        document.getElementById("cmLeadDone").hidden = false;
      }).catch(function () {
        err.textContent = "השליחה לא הצליחה. בדקו את החיבור ונסו שוב.";
      }).then(function () { btn.disabled = false; });
    });

    readUrl();
    apply(false);
  }

  if (document.getElementById("cmRoot")) init();
  else document.addEventListener("silo:rendered", init);
  document.addEventListener("DOMContentLoaded", init);
})();
