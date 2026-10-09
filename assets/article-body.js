/* ============================================================================
   גוף הכתבה - מטקסט חופשי למבנה
   ----------------------------------------------------------------------------
   ‏מקור אחד לשרת ולדפדפן, כמו `assets/prices-render.js`: הקובץ נטען כ-
   `<script src>` ב-`article.html` (‏renderBody בונה ממנו DOM), **ומיובא** ב-
   `netlify/edge-functions/og-tags.ts`, שכותב את אותו גוף כ-HTML כבר בשרת -
   כדי שסורק שאינו מריץ JS (מנועי AI) יקרא את הכתבה ולא רק את הכותרת. ולכן
   אין כאן `export`, והתוצאה היא מבנה ולא HTML: כל צד בונה ממנו לבד, הדפדפן
   ב-textContent והשרת בבריחה.

   שלושה כללים פשוטים ומוסכמים: שורה ריקה מפרידה פסקאות; שורה קצרה
   שמסתיימת בנקודתיים היא כותרת ביניים; שורה שנפתחת ב-"- " היא פריט
   ברשימה; ושורה שנפתחת במירכאות היא ציטוט. ‏docs/social-preview.md.
   ========================================================================== */
(function (root) {
  /* ‏[{ tag:'p'|'h2'|'blockquote', text, lead? } | { tag:'ul', items:[…] }] */
  function parse(text) {
    var out = [];
    var blocks = String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/);
    blocks.forEach(function (raw) {
      var lines = raw.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      if (!lines.length) return;

      var list = null;
      var para = [];
      // שורות רגילות רצופות בתוך אותה פסקה מתחברות לפסקה אחת - כך שגלישת
      // שורה בעורך לא מפצלת את הטקסט לפסקאות באתר.
      function flush() {
        if (!para.length) return;
        out.push({ tag: 'p', text: para.join(' ') });
        para = [];
      }

      lines.forEach(function (line) {
        if (/^[-•*]\s+/.test(line)) {
          flush();
          if (!list) { list = { tag: 'ul', items: [] }; out.push(list); }
          list.items.push(line.replace(/^[-•*]\s+/, ''));
          return;
        }
        list = null;

        if (line.length <= 70 && /:$/.test(line)) {
          flush();
          out.push({ tag: 'h2', text: line.replace(/:$/, '') });
          return;
        }
        if (/^["'״”“]/.test(line)) {
          flush();
          out.push({ tag: 'blockquote', text: line });
          return;
        }
        para.push(line);
      });
      flush();
    });

    // האות המוגדלת מוצגת רק כשהכתבה נפתחת בפסקה שיש בה מספיק טקסט כדי
    // לעטוף אותה. פתיחה של שורה אחת הייתה משאירה אות ענקית תלויה מעל חלל ריק.
    if (out[0] && out[0].tag === 'p' && out[0].text.length >= 150) out[0].lead = true;
    return out;
  }

  root.ShukArticleBody = { parse: parse };
})(typeof window !== 'undefined' ? window : globalThis);
