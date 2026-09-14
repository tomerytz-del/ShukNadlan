/* ============================================================================
   מסמך ההסכם — בנייה, חתימה והורדה
   ----------------------------------------------------------------------------
   שלושה עמודים מציגים את אותו מסמך: ‏crm.html (הסוכן/ת מרכיב/ה אותו),
   ‏sign.html (הלקוח/ה חותם/ת עליו מרחוק) ו-agreement.html (העותק החתום).
   הקובץ הזה הוא מה שמשותף להם.

   ‏**למה כל הסגנון כאן הוא inline.** המסמך נשלח גם כגוף מייל, ולקוחות
   מייל — ‏Gmail בראשם — מסננים ‎<style>‎, מתעלמים ממחלקות ולעתים גם
   מ-flex ומ-grid. טבלה עם סגנון על כל תא היא הדבר היחיד שמגיע לתיבה
   הנכנסת כמו שהוא נראה במסך. זה מכוער בקוד ונכון בתוצאה.

   ‏**למה ה-HTML נבנה פעם אחת ונשמר.** ‏document_html נכתב ברגע שההסכם נוצר
   ונחסם לשינוי במסד (‏agreements_freeze_body). מה שהחותם/ת רואה הוא מה
   שנשלח ומה שנשמר, ואף רינדור מאוחר יותר אינו יכול לשנות את הטקסט שנחתם.
   הפונקציות כאן משמשות אפוא ליצירה בלבד — ההצגה היא הזרקת ה-HTML השמור.
   ============================================================================ */
(function (root) {
  'use strict';

  var T = root.AgreementTemplates;

  /* ---------- עזרי טקסט ---------- */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* טקסט חופשי שנכנס למסמך: שורות חדשות הן חלק מהמשמעות (הערות, תשובות
     משאלון), ולכן הן הופכות ל-<br> ולא נבלעות. */
  function escMultiline(s) {
    return esc(s).replace(/\r?\n/g, '<br>');
  }

  /* ‏שני סוגי "קו למילוי ידני", ולא אחד, וזה בדיוק מה שנשבר קודם:

       ‏BLANK      — בתוך משפט ("ת.ז.: ____ טלפון: ____"). רוחב מינימלי
                     קבוע, כי הוא צריך להיראות כמו מקום לכתוב בו בעט.
       ‏CELL_BLANK — בתוך תא בטבלת פרטי הנכס. ‏display:block ורוחב מלא של
                     התא, בלי רוחב מינימלי כלל.

     ‏מינימום קבוע בתוך תא הוא מה שגרם לקווים לחרוג מהמסגרת בטלפון: ארבע
     עמודות עם קווים של 90px כל אחד אינן נכנסות ל-330px, והטבלה גדלה מעבר
     לתיבה שסביבה. */
  var BLANK = '<span style="display:inline-block;min-width:70px;max-width:100%;' +
    'border-bottom:1px solid #9aa0a6">&nbsp;</span>';
  var CELL_BLANK = '<span style="display:block;border-bottom:1px solid #b6b2a8">&nbsp;</span>';

  function valueOrBlank(v, blank) {
    var s = (v === null || v === undefined) ? '' : String(v).trim();
    return s ? esc(s) : (blank || BLANK);
  }

  function hebDate(d) {
    if (!d) return '';
    var t = new Date(d);
    return isNaN(t.getTime()) ? String(d) : t.toLocaleDateString('he-IL');
  }

  /* ‏04/09/2026 ולא 4.9.2026 — כך תקופת הבלעדיות מודפסת בטופס, וזה תאריך
     שנקרא כתחילת מרוץ זמן ולא כציון יום. אפסים מובילים מונעים את הקריאה
     השגויה של 4/3 כארבעה במרץ במקום כארבעה בחודש השלישי. */
  function slashDate(d) {
    if (!d) return '';
    var t = new Date(d);
    if (isNaN(t.getTime())) return String(d);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return pad(t.getDate()) + '/' + pad(t.getMonth() + 1) + '/' + t.getFullYear();
  }

  function shekel(n) {
    if (n === null || n === undefined || n === '') return '';
    var num = Number(n);
    return isNaN(num) ? String(n) : '₪' + num.toLocaleString('he-IL');
  }

  /* ---------- מחרוזת דמי התיווך ----------
     היא נכנסת לתוך סעיף שנוסח בלשון "בגין מכירת הנכס, ___, בצירוף מע"מ
     כחוק", ולכן היא חייבת להיקרא כרכיב אחד בתוך משפט ולא כמשפט בפני עצמו. */
  function commissionText(c) {
    c = c || {};
    var pct = (c.pct === null || c.pct === undefined || c.pct === '') ? null : Number(c.pct);
    var amount = (c.amount === null || c.amount === undefined || c.amount === '') ? null : Number(c.amount);
    var suffix = c.basisSuffix || '';
    var parts = [];

    if (pct !== null && !isNaN(pct)) parts.push(pct + '%' + suffix);
    if (amount !== null && !isNaN(amount)) {
      parts.push(parts.length ? '(ולא פחות מ-' + shekel(amount) + ')' : shekel(amount));
    }
    if (!parts.length) return '__________';
    return parts.join(' ');
  }

  /* ---------- בלוק הצדדים ----------
     שני נוסחים, ושניהם מהטפסים עצמם:

       ‏owner  — "בין / ובין / לבין". הצד הוא בעל/ת הנכס ובן/בת הזוג, שניהם
                 מזוהים בשמם, ולכן לכל אחד/ת שורה משלו/ה.
       ‏client — "בין / ו/או / ו/או מי מטעמו (כולם יחד וכ״א לחוד, להלן:
                 ״הלקוח״) / לבין". בטופס הקונה והשוכר כל החותמים הם ישות
                 חוזית אחת — "הלקוח" — וזו לא קוסמטיקה: המשמעות היא חבות
                 יחד ולחוד, והנוסח הזה הוא מה שיוצר אותה.

     במסלול ה-client מוצגות תמיד שתי משבצות, גם כשנבחר חותם אחד, בדיוק כמו
     בטופס הנייר — כדי שאפשר יהיה להוסיף שם בכתב יד. */
  function partiesHtml(signers, agent, style) {
    var pStyle = 'margin:0 0 10px;font-size:13px;line-height:1.7';
    var labelStyle = 'font-weight:700;font-size:13px';
    var clients = (signers || []).filter(function (s) { return s.party !== 'agent'; });
    var out = '';

    if (style === 'client') {
      var slots = Math.max(2, clients.length);
      for (var i = 0; i < slots; i++) {
        var c = clients[i] || {};
        out += '<p style="' + pStyle + '">' +
          '<span style="' + labelStyle + '">' + (i === 0 ? 'בין' : 'ו/או') + '</span><br>' +
          (c.full_name ? esc(c.full_name) + ' ' : '') +
          'ת.ז.: ' + valueOrBlank(c.id_number) + ' ' +
          (c.address ? esc(c.address) + ' ' : '') +
          'טלפון: ' + valueOrBlank(c.phone) +
          '</p>';
      }
      out += '<p style="' + pStyle + ';margin-top:-4px">' +
        'ו/או מי מטעמו (כולם יחד וכ"א לחוד, להלן: "הלקוח")</p>';
    } else {
      clients.forEach(function (s, i) {
        var bits = [];
        if (s.id_number) bits.push('ת.ז. ' + esc(s.id_number));
        if (s.address) bits.push(esc(s.address));
        out += '<p style="' + pStyle + '">' +
          '<span style="' + labelStyle + '">' + (i === 0 ? 'בין' : 'ובין') + '</span><br>' +
          esc(s.full_name || '') + (bits.length ? ', ' + bits.join(', ') : '') + '<br>' +
          'טלפון: ' + valueOrBlank(s.phone) +
          (s.email ? ' · אימייל: ' + esc(s.email) : '') +
          '</p>';
      });
      if (!clients.length) {
        out += '<p style="' + pStyle + '"><span style="' + labelStyle + '">בין</span><br>' +
          BLANK + '<br>טלפון: ' + BLANK + '</p>';
      }
    }

    var agentBits = [esc(agent.name || '')];
    if (agent.id_number) agentBits.push('ת.ז. ' + esc(agent.id_number));
    if (agent.license_number) agentBits.push('רישיון מס\' ' + esc(agent.license_number));

    out += '<p style="' + pStyle + '">' +
      '<span style="' + labelStyle + '">לבין</span><br>' +
      agentBits.join(', ') +
      (agent.agency_name ? '<br>' + esc(agent.agency_name) : '') +
      (agent.agency_address ? ', ' + esc(agent.agency_address) : '') +
      (agent.phone ? '<br>טלפון: ' + esc(agent.phone) : '') +
      '</p>';

    return out;
  }

  /* ---------- תיאור הנכס ----------
     טבלה של ארבע עמודות (תווית · ערך · תווית · ערך), כי זו הצורה היחידה
     ששורדת גם בלקוח מייל וגם בדפדפן צר.

     ‏table-layout:fixed עם colgroup הוא מה שמחזיק אותה בתוך הרוחב: בלעדיו
     תא עם "קומות בנכס/בניין" או עם ₪1,650,000 מרחיב את הטבלה, והיא גולשת
     מהמסגרת. ברוחב טלפון הזוגות נערמים שניים בשורה (ראו DOC_CSS). */
  function propertyBoxHtml(tpl, prop, index, total) {
    var fields = tpl.propertyFields || [];
    var overrides = tpl.propertyLabelOverrides || {};
    var data = (prop && prop.fields) || {};

    var rows = '';
    for (var i = 0; i < fields.length; i += 2) {
      var a = fields[i], b = fields[i + 1];
      rows += '<tr>' + cellPair(a, data, overrides) +
        (b ? cellPair(b, data, overrides)
           : '<td class="pad" colspan="2" style="' + CELL_STYLE + '"></td>') + '</tr>';
    }
    var table = '<table role="presentation" cellpadding="0" cellspacing="0" class="agr-doc-fields" ' +
      'style="width:100%;border-collapse:collapse;font-size:12.5px;table-layout:fixed">' +
      '<colgroup><col style="width:23%"><col style="width:27%">' +
      '<col style="width:23%"><col style="width:27%"></colgroup>' +
      rows + '</table>';

    /* ‏plain — רשימת ההצעות בטופס הקונה/השוכר. אין כותרת ואין מסגרת: זו
       רשימה בתוך סעיף, ומסגרת סביבה הייתה מנתקת אותה ממנו. */
    if (tpl.propertyBoxStyle === 'plain') {
      return '<div style="padding:10px 0' +
        (index > 0 ? ';border-top:1px solid #c5c3bc' : '') + '">' + table + '</div>';
    }

    var heading = tpl.propertyHeading || 'תאור הנכס:';
    if (total > 1) heading = 'נכס ' + (index + 1) + ' מתוך ' + total;

    return '' +
      '<div style="border:1px solid #c5c3bc;border-radius:10px;padding:14px 16px;margin:14px 0">' +
        '<div style="font-family:\'Frank Ruhl Libre\',Georgia,serif;font-weight:700;font-size:16px;margin-bottom:10px">' +
          esc(heading) +
        '</div>' +
        table +
        /* הערה שלא מולאה מקבלת שורה ברוחב מלא ולא קו קצר: זה המקום שבו
           כותבים בעט על העותק המודפס, ושורה של 70px אינה מקום לכתוב בו */
        '<div style="margin-top:10px;font-size:12.5px"><b>הערות לנכס:</b> ' +
          (prop && prop.notes
            ? escMultiline(prop.notes)
            : '<span style="display:block;margin-top:4px;border-bottom:1px solid #b6b2a8">&nbsp;</span>') +
        '</div>' +
      '</div>';
  }

  /* קו הפרדה דק בין השורות: הוא מה שמאפשר לעין לרוץ על טבלה של שנים-עשר
     שדות בלי לאבד את השורה, וגם מה שמסמן לאן ממלאים בעט על עותק מודפס. */
  var CELL_STYLE = 'padding:5px 5px;vertical-align:top;border-bottom:1px solid #ece9e2';

  function cellPair(field, data, overrides) {
    var label = overrides[field.key] || field.label;
    var raw = data[field.key];
    if (field.money && raw !== '' && raw !== null && raw !== undefined && !isNaN(Number(raw))) raw = shekel(raw);
    if (field.date && raw) raw = hebDate(raw);
    return '<td class="k" style="' + CELL_STYLE + ';font-weight:700">' + esc(label) + ':</td>' +
           '<td class="v" style="' + CELL_STYLE + '">' + valueOrBlank(raw, CELL_BLANK) + '</td>';
  }

  /* ---------- הסעיפים ----------
     ‏injectAfter מאפשר לתלות בלוק (רשימת ההצעות) בתוך מניין הסעיפים, בין
     שני פריטי <ol>. ‏</ol>…<ol start="N"> ולא <li> מקונן: כך המספור נשאר
     רציף, והבלוק יושב ברוחב מלא ולא בתוך תבליט. */
  function clausesHtml(tpl, vars, injectAfter, injected) {
    var clauses = tpl.clauses || [];
    var listStyle = 'font-size:12.5px;line-height:1.65;padding-inline-start:20px;margin:14px 0';
    var out = '';
    if (tpl.clausesHeading) {
      out += '<div style="font-family:\'Frank Ruhl Libre\',Georgia,serif;font-weight:700;' +
        'font-size:19px;margin:18px 0 2px">' + esc(tpl.clausesHeading) + '</div>';
    }
    out += '<ol style="' + listStyle + '">';

    clauses.forEach(function (c, i) {
      out += '<li style="margin-bottom:7px">' +
        escMultiline(T.fill(c, vars)).replace(/\{\{\w+\}\}/g, '') + '</li>';
      if (injectAfter && (i + 1) === injectAfter) {
        out += '</ol>' + injected + '<ol start="' + (i + 2) + '" style="' + listStyle + '">';
      }
    });

    return out + '</ol>';
  }

  /* ---------- המשאלון ----------
     שאלה בלי תשובה נשארת במסמך עם קו ריק. זו הנקודה: משאלון שלא נענה הוא
     עצמו מידע, והשמטת השאלה הייתה מסתירה אותו. */
  function questionnaireHtml(q, answers) {
    if (!q) return '';
    answers = answers || [];
    var items = q.items.map(function (question, i) {
      var a = (answers[i] || '').trim();
      return '<li style="margin-bottom:10px">' + esc(question) +
        '<div style="margin-top:3px;min-height:18px;border-bottom:1px solid #d8d6cf;padding-bottom:2px">' +
          (a ? escMultiline(a) : '&nbsp;') +
        '</div></li>';
    }).join('');
    return '' +
      '<div style="margin-top:22px">' +
        '<div style="font-weight:700;font-size:13.5px;margin-bottom:8px">' + esc(q.title) + '</div>' +
        '<ol style="font-size:12.5px;line-height:1.6;padding-inline-start:20px;margin:0">' + items + '</ol>' +
      '</div>';
  }

  /* ---------- נספח פעולות השיווק ----------
     ‏<ol> מקונן ולא רשימה שטוחה: "1.1 הצבת שלט על הנכס" הוא תת-סעיף של
     "1. פרסום באמצעות שילוט", והשטחה שלו הייתה משנה את מבנה ההתחייבות. */
  function marketingHtml(section) {
    if (!section) return '';
    var items = section.items.map(function (item) {
      var sub = (item.sub || []).length
        ? '<ol style="margin:5px 0 0;padding-inline-start:20px">' +
          item.sub.map(function (t) { return '<li style="margin-bottom:3px">' + esc(t) + '</li>'; }).join('') +
          '</ol>'
        : '';
      return '<li style="margin-bottom:7px">' + esc(item.text) + sub + '</li>';
    }).join('');

    return '<div style="margin-top:24px">' +
      '<div style="font-family:\'Frank Ruhl Libre\',Georgia,serif;font-weight:700;font-size:19px">' +
        esc(section.title) + '</div>' +
      '<div style="font-size:11px;color:#565c63;margin:2px 0 10px">' + esc(section.lawNote) + '</div>' +
      '<p style="font-size:12.5px;margin:0 0 8px">' + esc(section.intro) + '</p>' +
      '<ol style="font-size:12.5px;line-height:1.65;padding-inline-start:20px;margin:0">' + items + '</ol>' +
    '</div>';
  }

  /* ---------- גיליון הסגנון של המסמך ----------
     ‏החריג היחיד לכלל ה-inline, ומסיבה אחת: **media query אי אפשר לכתוב
     בתוך תכונת style**. הסגנון ה-inline נשאר מקור האמת ומספיק לכל לקוח
     מייל; מה שכאן רק *מתקן* אותו במסך צר — שם ארבע עמודות אינן נכנסות
     ל-330px, ובלעדיו קווי המילוי חורגים מהמסגרת (כפי שאכן קרה בטלפון).

     לקוח מייל שמסנן ‎<style>‎ מקבל בדיוק את מה שקיבל עד היום. */
  var DOC_CSS =
    '.agr-doc{overflow-wrap:anywhere;container-type:inline-size}' +
    '.agr-doc img{max-width:100%}' +
    /* ‏@container ולא @media, וזה לא קפריזה: הורדת ה-PDF מציירת את המסמך
       בתיבה נסתרת ברוחב 820px גם כשהמכשיר הוא טלפון. שאילתת מדיה הייתה
       מפרקת שם את הטבלה לשורות ומייצרת PDF שונה מזה שנשלח במייל; שאילתת
       מיכל שואלת את מה שבאמת קובע — רוחב המסמך עצמו.
       דפדפן ישן שאינו תומך מקבל את טבלת ארבע העמודות, שממילא כבר אינה
       חורגת מהמסגרת (‏table-layout:fixed וקווי מילוי ברוחב התא). */
    '@container (max-width:620px){' +
      /* הטבלה מתפרקת לשורות, וכל זוג תווית-ערך יושב בשורה משלו: שני זוגות
         בשורה אחת הם מה שלא נכנס בטלפון, ולא הטבלה עצמה */
      '.agr-doc .agr-doc-fields,.agr-doc .agr-doc-fields tbody,.agr-doc .agr-doc-fields tr{display:block;width:100%}' +
      '.agr-doc .agr-doc-fields td{display:inline-block;box-sizing:border-box;vertical-align:top}' +
      '.agr-doc .agr-doc-fields td.k{width:41%;padding-inline-start:0}' +
      '.agr-doc .agr-doc-fields td.v{width:59%;padding-inline-end:0}' +
      /* תא ריק שנועד רק להשלים שורה בת ארבע עמודות — במבנה שורה-לזוג אין
         לו קיום, והצגתו הייתה שורה ריקה באמצע התיאור */
      '.agr-doc .agr-doc-fields td.pad{display:none}' +
    '}' +
    '@media (max-width:640px){' +
      '.agr-doc{padding:18px 14px!important}' +
      '.agr-doc ol{padding-inline-start:18px}' +
    '}';

  function docStyleTag() {
    return '<style>' + DOC_CSS + '</style>';
  }

  /* ---------- המסמך השלם ---------- */
  function buildHtml(input) {
    var tpl = input.template;
    var props = input.properties || [];

    var vars = {
      subject: tpl.commissionSubject || '',
      commission: commissionText(input.commission),
      notes: input.notes || '',
      from: input.exclusive && input.exclusive.from ? slashDate(input.exclusive.from) : '__________',
      until: input.exclusive && input.exclusive.until ? slashDate(input.exclusive.until) : '__________'
    };

    /* משבצות ריקות עד למינימום שהטופס דורש — ראו minPropertySlots */
    var slots = props.slice();
    var minSlots = tpl.minPropertySlots || 1;
    while (slots.length < minSlots) slots.push({ fields: {}, notes: '' });

    var propertiesBlock = slots.map(function (p, i) {
      return propertyBoxHtml(tpl, p, i, slots.length);
    }).join('');

    var body = '';
    body += '<div style="text-align:center;border-bottom:1px solid #c5c3bc;padding-bottom:12px;margin-bottom:16px">' +
      '<div style="font-family:\'Frank Ruhl Libre\',Georgia,serif;font-weight:700;font-size:21px;line-height:1.3">' +
        esc(tpl.docTitle) + '</div>' +
      '<div style="font-size:11px;color:#565c63;margin-top:4px">' + esc(tpl.lawNote || '') + '</div>' +
    '</div>';

    body += partiesHtml(input.signers, input.agent || {}, tpl.partiesStyle);

    if (tpl.propertiesAfterClause) {
      // טופס קונה/שוכר: הסעיפים ראשונים, ורשימת ההצעות תלויה בתוכם
      body += clausesHtml(tpl, vars, tpl.propertiesAfterClause, propertiesBlock);
    } else {
      if (tpl.intro) body += '<p style="font-size:13px;font-weight:600;margin:14px 0 0">' + esc(tpl.intro) + '</p>';
      body += propertiesBlock;
      body += clausesHtml(tpl, vars);
    }

    body += questionnaireHtml(tpl.questionnaire, input.questionnaire);
    body += marketingHtml(tpl.marketingSection);

    body += '<div style="margin-top:20px;padding-top:10px;border-top:1px solid #e0ded7;font-size:10.5px;color:#565c63">' +
      'נוצר ב-' + esc(hebDate(input.createdAt || new Date())) +
      ' · קוד אימות המסמך: <b style="letter-spacing:.08em">' + esc(input.verifyCode || '') + '</b>' +
    '</div>';

    return docStyleTag() +
      '<div dir="rtl" lang="he" class="agr-doc" style="direction:rtl;text-align:right;' +
      'font-family:Heebo,Arial,sans-serif;color:#1B1F26;background:#fff;max-width:820px;' +
      'margin:0 auto;padding:26px 24px;line-height:1.55">' +
      body + '</div>';
  }

  /* ---------- בלוק החתימות ----------
     נבנה בנפרד מגוף המסמך ומצורף אליו בתצוגה, כי הגוף קפוא והחתימות
     נוספות אליו אחת-אחת. אותו נוסח בדיוק נבנה גם ב-Edge Function למייל.

     ‏data URL של חתימה נבדק כאן ולא רק בשרת: ‎<img src>‎ שמקורו בשדה טקסט
     במסד הוא בדיוק המקום שבו ‎javascript:‎ או ‎data:text/html‎ היו נכנסים. */
  var SIGNATURE_SRC_RE = /^data:image\/png;base64,[A-Za-z0-9+/=\s]+$/;

  function safeSignatureSrc(src) {
    return (typeof src === 'string' && SIGNATURE_SRC_RE.test(src) && src.length < 400000) ? src : '';
  }

  function signatureBlockHtml(signers, opts) {
    opts = opts || {};
    var intro = opts.intro || 'בחתימתי, אני מאשר בזאת כי קראתי את ההסכם.';
    var cards = (signers || []).map(function (s) {
      var src = safeSignatureSrc(s.signature);
      var img = src
        ? '<img src="' + src + '" alt="חתימת ' + esc(s.full_name) + '" ' +
          'style="max-width:100%;max-height:110px;display:block;margin:0 auto">'
        : '<div style="color:#8a8f96;font-size:12px;text-align:center;padding:34px 0">טרם נחתם</div>';
      var meta = s.signed_at
        ? 'נחתם ב-' + esc(new Date(s.signed_at).toLocaleString('he-IL')) +
          (s.method === 'remote' ? ' · חתימה מרחוק' : ' · חתימה במעמד הסוכן/ת')
        : '';
      return '' +
        '<div style="border:1px dashed #9aa0a6;border-radius:8px;padding:10px;margin:0 0 14px">' +
          '<div style="font-weight:700;font-size:13.5px;margin-bottom:6px">' + esc(s.full_name || '') +
            (s.id_number
              ? ' · ' + (s.id_kind === 'passport' ? 'דרכון' : 'ת.ז.') + ' ' + esc(s.id_number)
              : '') + ', חתום כאן:</div>' +
          '<div style="min-height:110px;display:flex;align-items:center;justify-content:center">' + img + '</div>' +
          (meta ? '<div style="font-size:10.5px;color:#565c63;margin-top:6px">' + meta + '</div>' : '') +
        '</div>';
    }).join('');

    return '<div dir="rtl" style="direction:rtl;text-align:right;font-family:Heebo,Arial,sans-serif;' +
      'max-width:820px;margin:0 auto;padding:0 24px 26px;color:#1B1F26">' +
      '<p style="font-size:13px;font-weight:600;margin:0 0 12px">' + esc(intro) + '</p>' +
      cards + '</div>';
  }

  /* ---------- לוח החתימה ----------
     ‏Pointer Events ולא mouse+touch: אותו קוד עובד לאצבע, לעט ולעכבר, וזה
     המסלול היחיד שלא מפספס עטים דיגיטליים. ‏touch-action:none חובה —
     בלעדיו הדפדפן במובייל גולל את העמוד במקום לצייר.                        */
  function signaturePad(canvas, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var drawing = false, dirty = false, last = null;

    function resize() {
      var ratio = Math.max(root.devicePixelRatio || 1, 1);
      var rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      var data = dirty ? canvas.toDataURL('image/png') : null;
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = opts.lineWidth || 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = opts.color || '#0d1b3d';
      if (data) {
        var img = new Image();
        img.onload = function () { ctx.drawImage(img, 0, 0, rect.width, rect.height); };
        img.src = data;
      }
    }

    function point(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function down(e) {
      drawing = true;
      last = point(e);
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
    function move(e) {
      if (!drawing) return;
      var p = point(e);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
      dirty = true;
      if (opts.onChange) opts.onChange(true);
      e.preventDefault();
    }
    function up(e) {
      if (!drawing) return;
      drawing = false;
      // נקודה בודדת בלי תזוזה היא עדיין חתימה (נקודה, קו קצר) — מציירים
      // עיגול זעיר כדי שלא תיעלם
      if (!dirty) { ctx.beginPath(); ctx.arc(last.x, last.y, 1.2, 0, Math.PI * 2); ctx.fill(); dirty = true; }
      if (opts.onChange) opts.onChange(true);
      if (e) e.preventDefault();
    }

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', up);
    root.addEventListener('resize', resize);
    resize();

    return {
      resize: resize,
      isEmpty: function () { return !dirty; },
      clear: function () {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        dirty = false;
        if (opts.onChange) opts.onChange(false);
      },
      /* ‏PNG על רקע לבן: שקיפות הופכת לשחור בחלק מלקוחות המייל וב-PDF,
         והחתימה הייתה מגיעה כמלבן שחור. */
      toDataURL: function () {
        var out = document.createElement('canvas');
        out.width = canvas.width;
        out.height = canvas.height;
        var octx = out.getContext('2d');
        octx.fillStyle = '#ffffff';
        octx.fillRect(0, 0, out.width, out.height);
        octx.drawImage(canvas, 0, 0);
        return out.toDataURL('image/png');
      }
    };
  }

  /* ---------- הורדה כ-PDF ----------
     ‏html2canvas + jsPDF ולא יצירת PDF מטקסט: עברית ב-PDF דורשת הטמעת גופן
     ובנייה ידנית של RTL, ושתיהן נשברות בדיוק על מה שחשוב כאן — שם, ת.ז.
     וסכום. רסטר של מה שכבר מוצג נכון על המסך אינו יכול להישבר.

     שתי הספריות נטענות בעצלתיים ורק בלחיצה: הן כבדות, והרוב המכריע של
     המבקרים בעמוד לא ילחצו על "הורדה".                                     */
  var PDF_LIBS = [
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
  ];

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) return resolve();
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('script_failed')); };
      document.head.appendChild(s);
    });
  }

  async function downloadPdf(node, filename) {
    for (var i = 0; i < PDF_LIBS.length; i++) await loadScript(PDF_LIBS[i]);
    var jsPDFCtor = (root.jspdf && root.jspdf.jsPDF) || root.jsPDF;
    if (!root.html2canvas || !jsPDFCtor) throw new Error('pdf_libs_missing');

    var canvas = await root.html2canvas(node, {
      scale: Math.min(2, Math.max(1.5, root.devicePixelRatio || 1)),
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false
    });

    var pdf = new jsPDFCtor({ orientation: 'p', unit: 'mm', format: 'a4' });
    var pageW = pdf.internal.pageSize.getWidth();
    var pageH = pdf.internal.pageSize.getHeight();
    var margin = 8;
    var imgW = pageW - margin * 2;
    var pxPerMm = canvas.width / imgW;
    var sliceH = Math.floor((pageH - margin * 2) * pxPerMm);

    var y = 0, page = 0;
    while (y < canvas.height) {
      var h = Math.min(sliceH, canvas.height - y);
      var slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = h;
      slice.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (page > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, imgW, h / pxPerMm);
      y += h;
      page++;
    }

    pdf.save(filename || 'agreement.pdf');
  }

  root.AgreementDoc = {
    esc: esc,
    escMultiline: escMultiline,
    hebDate: hebDate,
    shekel: shekel,
    commissionText: commissionText,
    buildHtml: buildHtml,
    signatureBlockHtml: signatureBlockHtml,
    safeSignatureSrc: safeSignatureSrc,
    signaturePad: signaturePad,
    downloadPdf: downloadPdf
  };
})(typeof window !== 'undefined' ? window : globalThis);
