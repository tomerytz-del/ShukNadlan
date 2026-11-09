/* ============================================================================
   גוף הכתבה - מטקסט חופשי למבנה, ול-HTML אחד לשרת ולדפדפן
   ----------------------------------------------------------------------------
   ‏מקור אחד לשרת ולדפדפן, כמו `assets/prices-render.js`: הקובץ נטען כ-
   `<script src>` ב-`article.html`, **ומיובא** ב-`netlify/edge-functions/og-tags.ts`.
   שני הצדדים מכניסים את אותו `html()` ל-`#articleBody`. מי שבונה את הקישורים
   רק בצד אחד משאיר סורק בלי קישור, או גולש שהדף קופץ לו אחרי הטעינה.

   ‏`parse` מפרק את הטקסט למבנה: שורה ריקה מפרידה פסקאות; שורה קצרה
   שמסתיימת בנקודתיים היא כותרת ביניים; שורה שנפתחת ב-"- " היא פריט
   ברשימה; ושורה שנפתחת במירכאות היא ציטוט. ‏docs/articles.md.

   ‏`html` הוא מה שנכנס לדף. הטקסט מוברח. כתובת http או https בלבד הופכת
   ל-`<a>`: כתובת של shuknadlan.co.il נפתחת באותה לשונית, והטקסט שלה הוא
   הנתיב המפוענח (לא הכתובת המקודדת); כתובת חיצונית נפתחת בלשונית חדשה עם
   ‏rel="noopener nofollow". סכמה אחרת נשארת טקסט. אין כאן HTML שנשמר במסד.
   ========================================================================== */
(function (root) {
  /* ‏עותק משלו ולא escapeHtml: הקובץ רץ גם בשרת, שם אין esc.js. לכן כל
     חמשת התווים (‏scripts/check_escapers.py). */
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

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

  /* נתיב מוצג של קישור פנימי. ארוך מזה נחתך, והנתיב המלא נשאר ב-title. */
  var LABEL_MAX = 64;

  function countChar(s, c) {
    var n = 0;
    for (var i = 0; i < s.length; i++) if (s.charAt(i) === c) n++;
    return n;
  }

  /* רווח, מרכאות ותווי בקרה עוצרים כתובת. עברית באמצע נתיב נשארת חלק ממנה,
     כי כתובת שהודבקה משורת הכתובת מגיעה לפעמים מפוענחת ולא באחוזים. */
  function isUrlChar(c) {
    return !/[\s<>"'`\\\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/.test(c);
  }

  function trimUrlTail(raw) {
    var s = raw;
    while (s.length > 8) {
      var c = s.charAt(s.length - 1);
      if ('.,;:!?'.indexOf(c) !== -1 || c === '\u2026' || c === '\u00BB' || c === '\u05F4' || c === '\u05F3') {
        s = s.slice(0, -1);
        continue;
      }
      if ((c === ')' && countChar(s, '(') < countChar(s, ')')) ||
          (c === ']' && countChar(s, '[') < countChar(s, ']')) ||
          (c === '}' && countChar(s, '{') < countChar(s, '}'))) {
        s = s.slice(0, -1);
        continue;
      }
      break;
    }
    return s;
  }

  function safeDecode(s) {
    var str = String(s || '');
    try { return decodeURIComponent(str); }
    catch (e) {
      return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, function (run) {
        try { return decodeURIComponent(run); }
        catch (e2) { return run; }
      });
    }
  }

  function isSameSite(url) {
    var host = String(url.hostname || '').toLowerCase().replace(/\.$/, '');
    return host === 'shuknadlan.co.il' || host === 'www.shuknadlan.co.il';
  }

  function shortenLabel(label) {
    if (label.length <= LABEL_MAX) return label;
    var cut = label.slice(0, LABEL_MAX - 1);
    var tail = cut.charCodeAt(cut.length - 1);
    if (tail >= 0xD800 && tail <= 0xDBFF) cut = cut.slice(0, -1);
    return cut + '\u2026';
  }

  function sameSiteLabel(url) {
    var path = safeDecode(url.pathname || '/');
    var search = safeDecode(url.search || '');
    var full = (path || '/') + search;
    if (full === '/' || full === '') {
      return { text: String(url.hostname || '').replace(/^www\./i, '').replace(/\.$/, ''), title: '' };
    }
    var text = shortenLabel(full);
    return { text: text, title: text === full ? '' : full };
  }

  function linkFor(raw) {
    if (!/^https?:\/\//i.test(raw)) return null;
    if (/[\u0000-\u0020\u007F]/.test(raw)) return null;
    var url;
    try { url = new URL(raw); }
    catch (e) { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    var href = escapeHtml(raw);
    if (isSameSite(url)) {
      var label = sameSiteLabel(url);
      var title = label.title ? ' title="' + escapeHtml(label.title) + '"' : '';
      return '<a href="' + href + '" dir="ltr"' + title + '>' + escapeHtml(label.text) + '</a>';
    }
    return '<a href="' + href + '" dir="ltr" rel="noopener nofollow" target="_blank">' + escapeHtml(raw) + '</a>';
  }

  function linkify(text) {
    var src = String(text || '');
    var re = /https?:\/\//gi;
    var out = '';
    var last = 0;
    var m;
    while ((m = re.exec(src)) !== null) {
      var start = m.index;
      if (start > 0 && /[A-Za-z0-9]/.test(src.charAt(start - 1))) continue;
      var i = start + m[0].length;
      while (i < src.length && isUrlChar(src.charAt(i))) i++;
      var raw = trimUrlTail(src.slice(start, i));
      var anchor = linkFor(raw);
      if (!anchor) {
        re.lastIndex = start + m[0].length;
        continue;
      }
      re.lastIndex = start + raw.length;
      out += escapeHtml(src.slice(last, start));
      out += anchor;
      last = start + raw.length;
    }
    out += escapeHtml(src.slice(last));
    return out;
  }

  function html(text) {
    return parse(text).map(function (b) {
      if (b.tag === 'ul') {
        return '<ul>' + (b.items || []).map(function (item) {
          return '<li>' + linkify(item) + '</li>';
        }).join('') + '</ul>';
      }
      var cls = b.lead ? ' class="lead-para"' : '';
      return '<' + b.tag + cls + '>' + linkify(b.text || '') + '</' + b.tag + '>';
    }).join('');
  }

  root.ShukArticleBody = { parse: parse, html: html };
})(typeof window !== 'undefined' ? window : globalThis);
