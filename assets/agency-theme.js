/* ערכת העיצוב של המשרד על דף שאינו דף המשרד.

   מנהל/ת המשרד בוחר/ת ערכה ב-CRM (מקטע "מיתוג ועיצוב דף המשרד", חמש ערכות
   מובנות או ברירת המחדל), והיא נשמרת ב-agencies.colors. הקובץ הזה פורש אותה
   על הטוקנים של הדף (‏--brand / --accent / --paper ...), כך שדף הסוכן/ת נראה
   בדיוק כמו דף המשרד שלו - וכל סוכני המשרד נראים אותו דבר. לסוכן/ת אין
   עיצוב אישי.

   הכללים כאן הם העתק של applyBranding ב-agency.html (בלי החלק של תמונת
   הנושא), וחייבים להישאר זהים לו: אחרת דף הסוכן/ת ודף המשרד יקבלו מאותה
   ערכה צבע טקסט שונה על הכפתורים. שורה בלי צבע ראשי (ברירת המחדל) אינה
   נוגעת בכלום, והדף נשאר בטוקנים של עצמו.

     AgencyTheme.apply(agency.colors)
*/
(function(){
  var HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  var ON_COLOR_INK = '#1b1f26';

  function safeHex(value, fallback){
    return typeof value === 'string' && HEX_RE.test(value.trim()) ? value.trim() : fallback;
  }
  function relLuminance(hex){
    var full = hex.length === 4 ? '#' + hex.slice(1).split('').map(function(c){ return c + c; }).join('') : hex;
    var w = [0.2126, 0.7152, 0.0722];
    return [1,3,5].map(function(i){
      var ch = parseInt(full.slice(i, i+2), 16) / 255;
      return ch <= 0.03928 ? ch/12.92 : Math.pow((ch+0.055)/1.055, 2.4);
    }).reduce(function(acc, ch, i){ return acc + w[i] * ch; }, 0);
  }
  function contrastBetween(a, b){
    var la = relLuminance(a), lb = relLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function readableOnPair(a, b){
    var onWhite = Math.min(contrastBetween(a, '#ffffff'), contrastBetween(b, '#ffffff'));
    var onInk   = Math.min(contrastBetween(a, ON_COLOR_INK), contrastBetween(b, ON_COLOR_INK));
    if (onWhite >= 4.5) return '#fff';
    if (onInk >= 4.5) return ON_COLOR_INK;
    return onWhite >= onInk ? '#fff' : ON_COLOR_INK;
  }

  function apply(colors, target){
    var c = colors || {};
    var root = (target || document.documentElement).style;
    var brand = safeHex(c.primary, null);
    if (!brand) return false;   // ברירת המחדל - הדף נשאר כמו שהוא
    var accent = safeHex(c.accent, null);
    var brandDark = safeHex(c.primary_dark, brand);
    root.setProperty('--brand', brand);
    root.setProperty('--brand-dark', brandDark);
    root.setProperty('--on-brand', readableOnPair(brand, brandDark));
    root.setProperty('--on-brand-fill', readableOnPair(brand, brandDark));
    if (accent){
      var accentDark = safeHex(c.accent_dark, accent);
      root.setProperty('--accent', accent);
      root.setProperty('--accent-dark', accentDark);
      root.setProperty('--on-accent', readableOnPair(accent, accentDark));
      root.setProperty('--on-accent-fill', readableOnPair(accent, accentDark));
      if (contrastBetween(accent, brand) >= 2){
        root.setProperty('--lead-mark', accent);
        root.setProperty('--lead-mark-ink', readableOnPair(accent, accentDark));
      }
      var surface = safeHex(c.paper_raised, '#FFFFFF');
      var ink = [accentDark, accent, brandDark].filter(function(hex){ return contrastBetween(hex, surface) >= 4.5; })[0] || '#0d1b3d';
      root.setProperty('--accent-ink', ink);
    }
    if (safeHex(c.paper, null)) root.setProperty('--paper', c.paper.trim());
    if (safeHex(c.paper_raised, null)){
      root.setProperty('--paper-raised', c.paper_raised.trim());
      root.setProperty('--surface', c.paper_raised.trim());
    }
    if (safeHex(c.line, null)){
      root.setProperty('--line', c.line.trim());
      root.setProperty('--hair', c.line.trim());
    }
    return true;
  }

  window.AgencyTheme = { apply: apply };
})();
