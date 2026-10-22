/* ==========================================================================
   שווקים וצמיחה (שלב 6 בשדרוג האדמין, docs/admin-growth.md)
   --------------------------------------------------------------------------
   שלוש לשוניות באקורדיון אחד (#accGrowth), מקריאה אחת (admin_growth,
   מיגרציה 20270725090000):

   * **שווקים** - כל השווקים שב-assets/markets.js, לא רשימה סגורה (החלטה
     מ-19.10.2026), עם מה שחסר עד הסף והצעד הבא. הסף הוא MARKET_GATE של
     crm.js והמספרים מהתמונה השמורה (market_snapshots) - אותו חישוב של
     "שווקים מקומיים" ושל מרכז הפיקוד, ולכן שלושתם מסכימים.
   * **גיוס משרדים** - נרשמו → אימתו רישיון → נכס ראשון → משלמים. מתחיל
     ב"נרשמו", כי אין רישום של משרדים שהפלטפורמה הזמינה.
   * **קמפיינים** - קריאה בלבד מקונסולת השיווק. הפעולות נשארות שם.

   הקובץ נטען לפני assets/crm.js ומשתמש בגלובלים שלו (sb, esc, gotoSection,
   heErr, showToast, MARKET_GATE, MARKET_VIEW_KEY) רק בזמן קריאה.
   ========================================================================== */

const GROWTH_TABS = [
  { key:'markets',   label:'שווקים' },
  { key:'funnel',    label:'גיוס משרדים' },
  { key:'campaigns', label:'קמפיינים' },
];
const GROWTH_SIGNUP_URL = 'https://shuknadlan.co.il/agency-signup';
let growthTab = 'markets';
let growthData = null;
let growthBusy = false;

function grInt(n){ return (Number(n) || 0).toLocaleString('he-IL'); }
function grDate(iso){ return iso ? new Date(iso).toLocaleDateString('he-IL') : ''; }

async function loadGrowth(){
  const host = document.getElementById('growthBody');
  if (!host || growthBusy) return;
  growthBusy = true;
  renderGrowthTabs();
  if (!growthData) host.innerHTML = '<div class="empty-state">טוען…</div>';
  const { data, error } = await sb.rpc('admin_growth');
  growthBusy = false;
  if (error){
    // האתר עולה לפני המיגרציה (הסקיל deploy-path)
    host.innerHTML = '<div class="empty-state">' + esc(
      (error.code === 'PGRST202' || error.code === '42883')
        ? 'המסך עוד לא זמין במסד - המיגרציה 20270725090000 טרם רצה.'
        : 'שגיאה בטעינה: ' + heErr(error)) + '</div>';
    return;
  }
  growthData = data || {};
  renderGrowth();
}

function renderGrowthTabs(){
  const host = document.getElementById('growthTabs');
  if (!host) return;
  host.innerHTML = '';
  GROWTH_TABS.forEach(t => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'inbx-chip';
    b.textContent = t.label;
    b.setAttribute('aria-pressed', String(t.key === growthTab));
    b.addEventListener('click', () => { growthTab = t.key; renderGrowthTabs(); renderGrowth(); });
    host.appendChild(b);
  });
}

function renderGrowth(){
  const host = document.getElementById('growthBody');
  if (!host || !growthData) return;
  if (growthTab === 'funnel') host.innerHTML = growthFunnelHtml(growthData);
  else if (growthTab === 'campaigns') host.innerHTML = growthCampaignsHtml(growthData);
  else host.innerHTML = growthMarketsHtml(growthData);
  host.querySelectorAll('[data-gr-act]').forEach(btn => btn.addEventListener('click', () => growthAction(btn)));
}

/* ---------------- שווקים ---------------- */

/* המצב, מה חסר והצעד הבא - לפי מה שחסר (HANDOFF 6.1). שוק פתוח עם פחות
   מליד לסוכן/ת מקבל "קמפיין לידים": הביקוש הוא המדד המרכזי (החלטה 4). */
function growthMarketRow(m, d){
  const gate = typeof MARKET_GATE !== 'undefined' ? MARKET_GATE : { agencies: 1, props: 10 };
  const ag = Number(d.agencies) || 0, props = Number(d.props_active) || 0;
  const agents = Number(d.agents) || 0, leads = Number(d.leads_30d) || 0;
  const pct = Math.round(50 * Math.min(1, ag / gate.agencies) + 50 * Math.min(1, props / gate.props));
  const r = { m, d, pct, ag, props, agents, leads };
  if (m.live){
    r.status = 'פתוח'; r.rank = 3;
    if (agents && leads / agents < 1){
      r.missing = 'פחות מליד לסוכן/ת';
      r.step = { act:'ads', label:'קמפיין לידים' };
    } else r.missing = '';
  } else if (ag < gate.agencies){
    r.status = pct > 0 ? 'בהקמה' : 'בתכנון'; r.rank = pct > 0 ? 1 : 0;
    r.missing = 'חסר משרד';
    r.step = { act:'invite', label:'הזמנת משרדים' };
  } else if (props < gate.props){
    r.status = 'בהקמה'; r.rank = 1;
    const miss = gate.props - props;
    r.missing = miss === 1 ? 'חסר נכס אחד' : 'חסרים ' + miss + ' נכסים';
    const recent = d.nudged_at && (Date.now() - new Date(d.nudged_at).getTime()) < 7 * 86400000;
    r.step = recent ? { label:'תזכורת נשלחה ' + grDate(d.nudged_at) }
                    : { act:'nudge', label:'תזכורת להעלאה' };
  } else {
    r.status = 'מוכן לפתיחה'; r.rank = 2;
    r.missing = '';
    r.step = { act:'open', label:'לפתיחת השוק' };
  }
  return r;
}

function growthMarketsHtml(g){
  const list = (window.ShukMarkets && window.ShukMarkets.list) || [];
  if (!list.length) return '<div class="empty-state">רשימת השווקים (assets/markets.js) לא נטענה.</div>';
  const bySlug = new Map((g.markets || []).map(x => [x.slug, x]));
  const rows = list.map(m => growthMarketRow(m, bySlug.get(m.slug) || {}))
    .sort((a, b) => b.rank - a.rank || b.pct - a.pct || a.m.label.localeCompare(b.m.label, 'he'));
  const count = st => rows.filter(r => r.status === st).length;
  const gate = typeof MARKET_GATE !== 'undefined' ? MARKET_GATE : { agencies: 1, props: 10 };
  return '<p class="gr-rule"><b>הכלל לפתיחת שוק:</b> ' + esc(gate.agencies === 1 ? 'משרד אחד' : gate.agencies + ' משרדים')
      + ' ו-' + esc(gate.props) + ' נכסים פעילים. ' + esc(count('פתוח') + ' פתוחים · ' + count('מוכן לפתיחה')
      + ' מוכנים לפתיחה · ' + count('בהקמה') + ' בהקמה · ' + count('בתכנון') + ' בתכנון') + '</p>'
    + '<div class="gr-table" role="table" aria-label="מוכנות השווקים">'
    + '<div class="gr-tr gr-th" role="row"><span role="columnheader">שוק</span><span role="columnheader">משרדים</span>'
    + '<span role="columnheader">סוכנים</span><span role="columnheader">נכסים</span><span role="columnheader">לידים 30 יום</span>'
    + '<span role="columnheader">מוכנות</span><span role="columnheader">מה חסר</span><span role="columnheader">הצעד הבא</span></div>'
    + rows.filter(r => r.rank > 0).map(r => '<div class="gr-tr" role="row" data-market="' + esc(r.m.slug) + '">'
      + '<span class="gr-nm" role="cell"><b>' + esc(r.m.label) + '</b><small>' + esc(r.status) + '</small></span>'
      + '<span role="cell" data-l="משרדים">' + grInt(r.ag) + '</span>'
      + '<span role="cell" data-l="סוכנים">' + grInt(r.agents) + '</span>'
      + '<span role="cell" data-l="נכסים">' + grInt(r.props) + '</span>'
      + '<span role="cell" data-l="לידים">' + grInt(r.leads) + '</span>'
      + '<span role="cell" class="gr-pct" data-l="מוכנות"><span class="cc-bar" aria-hidden="true"><span style="width:' + r.pct + '%"></span></span>' + r.pct + '%</span>'
      + '<span role="cell" class="gr-miss">' + esc(r.missing || '-') + '</span>'
      + '<span role="cell" class="gr-step">' + (r.step
          ? (r.step.act
            ? '<button type="button" class="inbx-open" data-gr-act="' + esc(r.step.act) + '" data-slug="' + esc(r.m.slug)
              + '" data-label="' + esc(r.m.label) + '">' + esc(r.step.label) + '</button>'
            : '<span class="gr-done">' + esc(r.step.label) + '</span>')
          : '') + '</span>'
      + '</div>').join('')
    + '</div>'
    + growthPlannedHtml(rows.filter(r => r.rank === 0));
}

/* השווקים שאין בהם עוד כלום - 34 ב-21.10.2026 - בשורה אחת ולא בשורה לכל
   אחד: כולם חסרי משרד, והצעד הבא של כולם זהה. בטלפון 34 שורות זהות היו
   מטביעות את המעטים שבאמת קורה בהם משהו. */
function growthPlannedHtml(rows){
  if (!rows.length) return '';
  return '<div class="gr-planned"><b>' + esc(rows.length + ' שווקים בתכנון - עוד אין בהם משרד') + '</b>'
    + '<p>' + esc(rows.map(r => r.m.label).join(' · ')) + '</p>'
    + '<button type="button" class="inbx-open" data-gr-act="invite" data-slug="" data-label="השווקים האלה">הזמנת משרדים</button></div>';
}

async function growthAction(btn){
  const act = btn.dataset.grAct;
  if (act === 'ads'){ gotoSection('dashPanelAds'); return; }
  if (act === 'open'){
    // "שווקים מקומיים" על השוק הזה - שם הבדיקות לפני הפתיחה (הסקיל market-go-live)
    try { localStorage.setItem(MARKET_VIEW_KEY, btn.dataset.slug); } catch(_){ }
    gotoSection('dashPanelMarkets');
    if (typeof loadMarketReport === 'function') loadMarketReport();
    return;
  }
  if (act === 'invite'){
    // אין הזמנת משרד מהפלטפורמה; מה שיש הוא דף ההרשמה, שהמשרד פותח בעצמו
    try {
      await navigator.clipboard.writeText(GROWTH_SIGNUP_URL);
      showToast('קישור ההצטרפות הועתק - אפשר לשלוח אותו למשרדים ב' + btn.dataset.label);
    } catch(_){
      showToast('קישור ההצטרפות: ' + GROWTH_SIGNUP_URL);
    }
    return;
  }
  if (act === 'nudge'){
    if (!confirm('לשלוח לסוכני ' + btn.dataset.label + ' תזכורת להעלות נכסים? (פעמון ווואטסאפ, פעם בשבוע לשוק)')) return;
    btn.disabled = true;
    const { data, error } = await sb.rpc('admin_market_nudge', { p_market: btn.dataset.slug, p_label: btn.dataset.label });
    if (error){
      btn.disabled = false;
      showToast(/nudge_too_soon/.test(error.message || '') ? 'כבר נשלחה תזכורת לשוק הזה השבוע.' : heErr(error));
      return;
    }
    const n = Number(data && data.recipients) || 0;
    showToast(n ? 'התזכורת נשלחה ל-' + n + ' סוכנים' : 'אין בשוק הזה סוכנים פעילים לשלוח אליהם');
    loadGrowth();
  }
}

/* ---------------- גיוס משרדים ---------------- */

const GROWTH_STAGES = [
  { key:'signed',         label:'נרשמו' },
  { key:'licensed',       label:'אימתו רישיון', hint:'בלי רישיון מאושר הדף לא מוצג באתר' },
  { key:'first_property', label:'העלו נכס ראשון' },
  { key:'paying',         label:'משלמים (Mid או Premium)' },
];

function growthFunnelHtml(g){
  const f = g.funnel || {};
  const col = (win, title) => {
    const d = f[win] || {};
    let prev = null;
    return '<div class="gr-funnel"><h4>' + esc(title) + '</h4>'
      + GROWTH_STAGES.map(s => {
          const n = Number(d[s.key]) || 0;
          const pct = prev ? Math.round(100 * n / prev) : null;
          prev = n || prev;
          return '<div class="gr-stage' + (s.key === 'licensed' ? ' is-key' : '') + '">'
            + '<span class="lbl">' + esc(s.label) + (s.hint ? '<small>' + esc(s.hint) + '</small>' : '') + '</span>'
            + '<span class="n">' + grInt(n) + (pct != null ? ' <small>(' + pct + '%)</small>' : '') + '</span></div>';
        }).join('') + '</div>';
  };
  const stuck = g.stuck_license || [];
  return '<p class="gr-rule">"משלמים" הם מנוי בתשלום בתוקף. הטבת ההשקה אינה תשלום. "הוזמנו" אינו כאן: אין רישום של משרדים שהפלטפורמה הזמינה.</p>'
    + '<div class="gr-funnels">' + col('all', 'מאז ההשקה') + col('30d', 'נרשמו ב-30 הימים האחרונים') + '</div>'
    + '<h4 class="gr-h">נתקעו ברישיון' + (stuck.length ? ' (' + stuck.length + ')' : '') + '</h4>'
    + (stuck.length
      ? stuck.map(o => '<div class="inbx-row"><div class="inbx-main"><div class="inbx-title">' + esc(o.name || o.slug || '')
          + '</div><div class="inbx-sub">נרשם/ה ' + esc(grDate(o.created_at)) + '</div></div></div>').join('')
        + '<p class="gr-rule">הסוכנים בהם מקבלים תזכורת אוטומטית אחרי יומיים ואחרי שבוע. אישור רישיון שנשלח לבדיקה מחכה בתיבת המשימות.</p>'
      : '<div class="empty-state">אין משרד שמחכה לרישיון.</div>');
}

/* ---------------- קמפיינים ---------------- */

function growthCampaignsHtml(g){
  const list = g.campaigns || [];
  const open = '<button type="button" class="inbx-open" data-gr-act="ads">לקונסולת הקמפיינים</button>';
  if (!list.length){
    return '<div class="empty-state">אין עדיין קמפיינים בקונסולת השיווק. יצירה, השהיה ותקציב נעשים שם.</div>'
      + '<p style="text-align:center">' + open + '</p>';
  }
  return list.map(c => {
    const spend = Number(c.spend_30d) || 0, leads = Number(c.leads_30d) || 0;
    const sub = [c.status, c.daily_budget ? '₪' + grInt(c.daily_budget) + ' ליום' : '',
      '₪' + grInt(Math.round(spend)) + ' ב-30 יום', grInt(leads) + ' לידים',
      leads ? '₪' + grInt(Math.round(spend / leads)) + ' לליד' : grInt(c.clicks_30d) + ' קליקים'].filter(Boolean).join(' · ');
    return '<div class="inbx-row"><div class="inbx-main"><div class="inbx-title">' + esc(c.name || 'קמפיין')
      + '</div><div class="inbx-sub">' + esc(sub) + '</div></div></div>';
  }).join('') + '<p class="gr-rule">השהיה, הפעלה, תקציב ושכפול לאזור אחר - בקונסולה. ' + open + '</p>';
}

(function wireGrowth(){
  const acc = document.getElementById('accGrowth');
  if (acc) acc.addEventListener('toggle', () => { if (acc.open) loadGrowth(); });
})();
