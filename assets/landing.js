/* פס תחתון, פתיחת ההתראה הקיימת, ומדידה.
   ההתראה היא באנר החיפוש השמור (#buyerStartBtn), לא טופס חדש.
   האירועים הם שמות שכבר יש להם תגית ב-GTM: contact_bot נרשם לבד
   מ-data-bot ב-events.js, ולכל הנכסים / קבלו התראה נדחפים כ-search_submit
   עם landing_action. בלי תגית חדשה. */
(function () {
  var hero = document.getElementById("landHero");
  var bar = document.getElementById("landBar");
  if (hero && bar && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        bar.classList.toggle("is-on", !entries[i].isIntersecting);
      }
    }, { threshold: 0 });
    io.observe(hero);
  }

  function resultCount(el) {
    var n = el && el.getAttribute("data-count");
    if (n == null) {
      var all = document.getElementById("landAll");
      n = all ? all.getAttribute("data-count") : "0";
    }
    return Number(n) || 0;
  }

  document.addEventListener("click", function (e) {
    var node = e.target && e.target.closest ? e.target : null;
    if (!node || !node.closest) return;
    var alertBtn = node.closest("[data-land-alert]");
    if (alertBtn) {
      e.preventDefault();
      var banner = document.getElementById("buyerBanner");
      var start = document.getElementById("buyerStartBtn");
      if (banner && banner.scrollIntoView) banner.scrollIntoView({ behavior: "smooth", block: "center" });
      if (start && start.getAttribute("aria-expanded") !== "true") start.click();
      if (window.shukTrack) window.shukTrack("search_submit", { result_count: resultCount(alertBtn), landing_action: "alert" });
      return;
    }
    var cta = node.closest("[data-land-cta]");
    if (cta && window.shukTrack) {
      window.shukTrack("search_submit", { result_count: resultCount(cta), landing_action: "cta" });
    }
  }, true);

  var LANDING_HELLO = 'שלום, הגעתי מהאתר מדף הנחיתה בעפולה ואשמח לעזרה';
  if (window.ShukBot && typeof window.ShukBot.link === "function") {
    var href = window.ShukBot.link(LANDING_HELLO);
    var links = document.querySelectorAll("[data-land-wa]");
    for (var i = 0; i < links.length; i++) {
      if (!href) continue;
      links[i].setAttribute("href", href);
      links[i].hidden = false;
    }
  }
})();
