/* ==========================================================================
   מרכז הפיקוד של מנהל/ת הפלטפורמה (שלב 4 בשדרוג האדמין,
   docs/admin-command-center.md), והודעה לכל הסוכנים
   --------------------------------------------------------------------------
   שלוש קריאות במקביל, כל אחת למה שיש לה מקור משלה:
     admin_command_center      - בריאות המרקטפלייס והתגים, בריאות המערכת,
                                 מוכנות השווקים (20270722090000)
     admin_inbox (7)           - "דורש אותך היום", אותה תיבה של שלב 3
     platform_admin_monthly_report (3) - ארבעת מספרי החודש וההכנסות
   ‏**ההחלטה 4 בהעברה: הביקוש הוא המדד המרכזי** - "לידים לסוכן/ת" מסומן
   בתיבת החודש ובעמודת הביקוש.

   נטען לפני assets/crm.js ומשתמש בגלובלים שלו ושל crm-admin-inbox.js רק
   בזמן קריאה.
   ========================================================================== */

const CC_TAG_LABEL = { growing:'צומח', stable:'יציב', weak:'חלש', early:'בתחילת הדרך' };
let ccBusy = false;

function ccInt(n){ return (Number(n) || 0).toLocaleString('he-IL'); }

function ccGreeting(){
  const h = new Date().getHours();
  return h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב';
}

async function loadCommandCenter(){
  const host = document.getElementById('adminCommand');
  if (!host || ccBusy) return;
  ccBusy = true;
  const [cc, inbox, counts, report] = await Promise.all([
    sb.rpc('admin_command_center'),
    sb.rpc('admin_inbox', { p_kind: null, p_limit: 7, p_offset: 0 }),
    sb.rpc('admin_inbox_counts'),
    sb.rpc('platform_admin_monthly_report', { p_months: 3 }),
  ]);
  ccBusy = false;

  renderCcHead(counts.error ? null : counts.data);
  renderCcInbox(inbox.error ? null : inbox.data);
  renderCcTools(cc.error ? null : cc.data);
  renderCcMonth(report.error ? null : report.data, cc.error ? null : cc.data);

  if (cc.error){
    // ‏PGRST202 - האתר עולה לפני המסד (הסקיל deploy-path)
    const msg = (cc.error.code === 'PGRST202' || cc.error.code === '42883')
      ? 'מרכז הפיקוד עוד לא קיים במסד - המיגרציה 20270722090000_command_center.sql טרם רצה.'
      : 'שגיאה בטעינת מרכז הפיקוד: ' + heErr(cc.error);
    ['ccMarket', 'ccMarkets', 'ccSystem'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="empty-state">' + esc(msg) + '</div>';
    });
    return;
  }
  renderCcMarket(cc.data, report.error ? null : report.data);
  renderCcMarkets(cc.data);
  renderCcSystem(cc.data);
}

function renderCcHead(counts){
  const hello = document.getElementById('ccHello');
  const sub = document.getElementById('ccSub');
  const first = String((currentAgent && currentAgent.display_name) || '').trim().split(/\s+/)[0];
  if (hello) hello.textContent = ccGreeting() + (first ? ', ' + first : '') + '.';
  if (!sub) return;
  if (!counts){ sub.textContent = ''; return; }
  const total = Number(counts.total) || 0, late = Number(counts.overdue) || 0;
  sub.textContent = !total ? 'אין כרגע שום דבר שמחכה לך.'
    : (total === 1 ? 'פריט אחד מחכה לך' : total + ' פריטים מחכים לך')
      + (late ? ', ' + (late === 1 ? 'אחד מהם חרג מזמן היעד.' : late + ' מהם חרגו מזמן היעד.') : '.');
}

function renderCcInbox(rows){
  const host = document.getElementById('ccInbox');
  if (!host) return;
  if (!Array.isArray(rows)){ host.innerHTML = '<div class="empty-state">תיבת המשימות לא נטענה.</div>'; return; }
  if (!rows.length){ host.innerHTML = '<div class="empty-state">אין כרגע שום דבר שמחכה לך. 🎯</div>'; return; }
  host.innerHTML = '';
  rows.forEach(row => {
    const def = (typeof ADMIN_INBOX_KINDS !== 'undefined' && ADMIN_INBOX_KINDS[row.kind]) || { label: row.kind, acc: 'accAdminInbox' };
    const t = typeof inboxRowText === 'function' ? inboxRowText(row) : { title: row.kind, sub: '' };
    const el = document.createElement('div');
    el.className = 'inbx-row';
    el.innerHTML = '<div class="inbx-main"><div class="inbx-kind">' + esc(def.label) + '</div>'
      + '<div class="inbx-title">' + esc(t.title) + '</div>'
      + (t.sub ? '<div class="inbx-sub">' + esc(t.sub) + '</div>' : '') + '</div>'
      + '<span class="inbx-wait ' + inboxWaitClass(row) + '">'
      + esc((row.overdue ? 'חרג · ' : '') + inboxWaitText(row.waiting_minutes)) + '</span>';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'inbx-open';
    open.textContent = 'פתיחה';
    open.setAttribute('aria-label', 'פתיחת ' + def.label + ': ' + t.title);
    open.addEventListener('click', () => gotoSection(def.acc || 'accAdminInbox'));
    el.appendChild(open);
    host.appendChild(el);
  });
}

/* ארבעת מספרי החודש - מהדוח החודשי הקיים, החודש הנוכחי (האחרון ב-months).
   בלידים, שורת המשנה היא "לידים לסוכן/ת" - המדד המרכזי (החלטה 4). */
function renderCcMonth(report, cc){
  const host = document.getElementById('ccMonth');
  if (!host) return;
  const months = (report && Array.isArray(report.months)) ? report.months : [];
  const now = months[months.length - 1] || {};
  const agents = cc && cc.marketplace ? Number(cc.marketplace.agents_active) || 0 : 0;
  const perAgent = agents ? (Number(now.leads_total) || 0) / agents : null;
  const tiles = [
    ['משרדים שהצטרפו', ccInt(now.agencies_new), 'החודש', false],
    ['סוכנים שהצטרפו', ccInt(now.agents_new), 'החודש', false],
    ['לידים שנקלטו', ccInt(now.leads_total),
      perAgent == null ? 'החודש' : (Math.round(perAgent * 10) / 10) + ' לסוכן/ת', true],
    ['הכנסות החודש', typeof shekel === 'function' ? shekel(Number(now.revenue_total) || 0) : ccInt(now.revenue_total), 'לפני מע״מ', false],
  ];
  host.innerHTML = tiles.map(([l, v, n, focus]) =>
    '<div class="cc-tile' + (focus ? ' is-focus' : '') + '"><div class="l">' + esc(l) + '</div>'
    + '<div class="v">' + esc(v) + '</div><div class="n">' + esc(n) + '</div></div>').join('');
}

/* תג הכסף: "בתחילת הדרך" עד 10 מנויים בתשלום (במסד), ואחר כך לפי שינוי
   ההכנסה בין שני החודשים המלאים האחרונים - 10% ומעלה צומח, ירידה חלש. */
function ccMoneyTag(cc, report){
  if (cc.marketplace.money_early) return 'early';
  const m = (report && report.months) || [];
  if (m.length < 3) return 'early';
  const a = Number(m[m.length - 3].revenue_total) || 0, b = Number(m[m.length - 2].revenue_total) || 0;
  if (!a) return b > 0 ? 'growing' : 'early';
  const g = (b - a) / a;
  return g >= 0.1 ? 'growing' : g >= 0 ? 'stable' : 'weak';
}

function ccTag(tag){
  return '<span class="cc-tag is-' + esc(tag) + '">' + esc(CC_TAG_LABEL[tag] || tag) + '</span>';
}

function ccRow(label, value){
  return '<div class="cc-row"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>';
}

function renderCcMarket(cc, report){
  const host = document.getElementById('ccMarket');
  if (!host) return;
  const mk = cc.marketplace || {};
  const r = mk.response || {};
  const fmt = n => n == null ? '-' : String(Math.round(Number(n) * 10) / 10);
  const respNote = Number(r.total)
    ? 'זמן תגובה חציוני ' + (r.median_hours == null ? '-' : r.median_hours + ' שע׳')
      + ' · נמדד ב-' + ccInt(r.measured) + ' מ-' + ccInt(r.total) + ' לידים (סוכנים עונים גם מחוץ למערכת)'
    : '';
  host.innerHTML =
    '<div class="cc-col"><div class="cc-col-head">היצע ' + ccTag(mk.supply_tag) + '</div>'
    + ccRow('נכסים פעילים', ccInt(mk.props_active))
    + ccRow('נכסים חדשים · 7 ימים', ccInt(mk.props_new_7d))
    + ccRow('נכסים חדשים לסוכן/ת · 30 יום', fmt(mk.supply_per_agent))
    + '</div>'
    + '<div class="cc-col"><div class="cc-col-head">ביקוש ' + ccTag(mk.demand_tag) + '</div>'
    + ccRow('לידים לסוכן/ת · 30 יום', fmt(mk.demand_per_agent))
    + ccRow('לידים · 30 יום', ccInt(mk.leads_30d) + ' (לפני כן ' + ccInt(mk.leads_prev_30d) + ')')
    + ccRow('נענו תוך 12 שעות', ccInt(r.within_12h))
    + (respNote ? '<div class="cc-note">' + esc(respNote) + '</div>' : '')
    + '</div>'
    + '<div class="cc-col"><div class="cc-col-head">כסף ' + ccTag(ccMoneyTag(cc, report)) + '</div>'
    + ccRow('מנויים בתשלום', ccInt(mk.paying))
    + ccRow('בהטבת ההשקה', ccInt(mk.on_promo))
    + ccRow('סוכנים פעילים', ccInt(mk.agents_active))
    + '</div>';
}

/* מוכנות לפי הכלל הקיים (MARKET_GATE ב-crm.js: משרד אחד ו-10 נכסים): חצי
   על משרדים וחצי על נכסים. כל השווקים (החלטה מ-19.10.2026), פתוחים קודם,
   אחריהם מוכנים לפתיחה, ואחר כך לפי המוכנות. */
function renderCcMarkets(cc){
  const host = document.getElementById('ccMarkets');
  if (!host) return;
  const gate = typeof MARKET_GATE !== 'undefined' ? MARKET_GATE : { agencies: 1, props: 10 };
  const list = (window.ShukMarkets && window.ShukMarkets.list) || [];
  const bySlug = new Map((cc.markets || []).map(m => [m.slug, m]));
  const rows = list.map(m => {
    const d = bySlug.get(m.slug) || {};
    const pct = Math.round(50 * Math.min(1, (Number(d.agencies) || 0) / gate.agencies)
                         + 50 * Math.min(1, (Number(d.props_active) || 0) / gate.props));
    const status = m.live ? 'פתוח' : pct >= 100 ? 'מוכן לפתיחה' : pct > 0 ? 'בהקמה' : 'בתכנון';
    return { m, d, pct, status, rank: m.live ? 3 : pct >= 100 ? 2 : pct > 0 ? 1 : 0 };
  }).sort((a, b) => b.rank - a.rank || b.pct - a.pct || a.m.label.localeCompare(b.m.label, 'he'));
  if (!rows.length){ host.innerHTML = '<div class="empty-state">רשימת השווקים לא נטענה.</div>'; return; }
  const ready = rows.filter(r => r.status === 'מוכן לפתיחה').length;
  const shown = rows.filter(r => r.rank > 0).slice(0, 8);
  host.innerHTML = '<p class="cc-note" style="margin:0 0 6px">'
    + esc(rows.filter(r => r.m.live).length + ' פתוחים · ' + ready + ' מוכנים לפתיחה · '
      + rows.filter(r => r.rank === 1).length + ' בהקמה · ' + rows.filter(r => r.rank === 0).length + ' בתכנון') + '</p>'
    + shown.map(r => '<div class="cc-mkt"><span class="nm">' + esc(r.m.label) + '</span>'
      + '<span class="cc-bar" aria-hidden="true"><span style="width:' + r.pct + '%"></span></span>'
      + '<span class="st">' + esc(r.status) + '</span>'
      + '<span class="ld">' + esc(ccInt(r.d.leads_30d) + ' לידים') + '</span></div>').join('');
}

function renderCcSystem(cc){
  const host = document.getElementById('ccSystem');
  const alert = document.getElementById('ccAlert');
  if (!host) return;
  const h = cc.health || {};
  const cron = Array.isArray(h.cron_failed_24h) ? h.cron_failed_24h : [];
  const newsH = h.news_last_at ? (Date.now() - new Date(h.news_last_at).getTime()) / 3600000 : null;
  const rows = [
    [Number(h.findings_high) ? 'bad' : Number(h.findings_medium) ? 'warn' : 'ok',
      Number(h.findings_high) ? ccInt(h.findings_high) + ' ממצאים חמורים פתוחים'
        : Number(h.findings_medium) ? ccInt(h.findings_medium) + ' ממצאים בינוניים פתוחים' : 'אין ממצאים חמורים'],
    [cron.length ? 'bad' : 'ok', cron.length ? 'משימות מתוזמנות שנכשלו: ' + cron.join(', ') : 'המשימות המתוזמנות רצו ב-24 השעות האחרונות'],
    [Number(h.markets_errors) || Number(h.markets_oldest_hours) > 3 ? 'warn' : 'ok',
      Number(h.markets_errors) ? 'נתוני השווקים: ' + h.markets_errors + ' שווקים לא התעדכנו'
        : 'נתוני השווקים עודכנו לפני ' + (h.markets_oldest_hours == null ? '-' : h.markets_oldest_hours) + ' שע׳'],
    [newsH == null || newsH > 24 ? 'warn' : 'ok',
      newsH == null ? 'אין מבזקים' : 'מבזק אחרון לפני ' + Math.round(newsH) + ' שע׳'],
  ];
  host.innerHTML = rows.map(([lvl, text]) =>
    '<div class="cc-sys"><span class="cc-dot' + (lvl === 'ok' ? '' : ' is-' + lvl) + '"></span>' + esc(text) + '</div>').join('');
  // פס "תקלה פעילה": רק כשמשהו חמור - ממצא חמור או משימה מתוזמנת שנכשלה
  if (alert){
    const bad = rows.filter(r => r[0] === 'bad').map(r => r[1]);
    alert.hidden = !bad.length;
    alert.innerHTML = bad.length ? '⚠ תקלה פעילה: ' + esc(bad.join(' · '))
      + ' <button type="button" data-goto="dashPanelOps">לבריאות המערכת</button>' : '';
  }
}

/* כלי עבודה ופרסום - רק מה שקיים (HANDOFF סעיף 3.2): הודעה לכל הסוכנים,
   ומעברים למסכים קיימים. "קוד הטבה" ו"דוח חודשי לבעלי משרדים" אינם קיימים
   ולכן אינם כאן (docs/admin-command-center.md). */
function renderCcTools(cc){
  const host = document.getElementById('ccTools');
  if (!host || host.dataset.ready) return;
  host.dataset.ready = '1';
  const agents = cc && cc.marketplace ? Number(cc.marketplace.agents_active) || 0 : 0;
  host.innerHTML =
    '<button type="button" class="cc-tool is-primary" id="ccBcOpen" aria-expanded="false" aria-controls="ccBc">📣 הודעה לכל הסוכנים</button>'
    + '<div class="cc-bc" id="ccBc" hidden>'
    +   '<input type="text" id="ccBcTitle" maxlength="80" placeholder="כותרת (עד 80 תווים)" aria-label="כותרת ההודעה">'
    +   '<textarea id="ccBcBody" maxlength="600" placeholder="ההודעה (עד 600 תווים, שורה אחת בוואטסאפ)" aria-label="תוכן ההודעה"></textarea>'
    +   '<div class="cnt" id="ccBcCnt">0 / 600</div>'
    +   '<button type="button" class="cc-tool is-primary" id="ccBcSend">שליחה' + (agents ? ' ל-' + agents + ' סוכנים' : '') + '</button>'
    + '</div>'
    + '<button type="button" class="cc-tool" data-goto="accArticles">📰 כתבה חדשה</button>'
    + '<button type="button" class="cc-tool" data-goto="dashPanelAds">📢 קמפיינים · Meta ו-Google</button>'
    + '<button type="button" class="cc-tool" data-goto="accDealSettlements">🗺️ יישובים לעסקאות (GovMap)</button>'
    + '<button type="button" class="cc-tool" data-goto="accRssSources">📡 מקורות הטיקר · RSS</button>';
  const box = document.getElementById('ccBc');
  const openBtn = document.getElementById('ccBcOpen');
  openBtn.addEventListener('click', () => {
    box.hidden = !box.hidden;
    openBtn.setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) document.getElementById('ccBcTitle').focus();
  });
  const body = document.getElementById('ccBcBody');
  body.addEventListener('input', () => {
    document.getElementById('ccBcCnt').textContent = body.value.length + ' / 600';
  });
  document.getElementById('ccBcSend').addEventListener('click', sendBroadcast);
}

async function sendBroadcast(){
  const title = document.getElementById('ccBcTitle').value.trim();
  const body = document.getElementById('ccBcBody').value.trim();
  if (title.length < 2 || body.length < 2){ showToast('צריך כותרת ותוכן'); return; }
  const ok = await confirmPurchase({
    title: 'שליחת הודעה לכל הסוכנים',
    lines: ['"' + title + '"',
            'ההודעה תגיע לפעמון של כל סוכן/ת פעיל/ה, ובוואטסאפ לפי ההגדרות של כל אחד/ת - בשעות השקט היא תחכה.',
            'אי אפשר לבטל אחרי השליחה.'],
    price: 0, hidePrice: true, requireAck: true, terms: false,
    ackText: 'קראתי את ההודעה, והיא מתאימה לכל הסוכנים.', confirmLabel: 'שליחה',
  });
  if (!ok) return;
  const btn = document.getElementById('ccBcSend');
  btn.disabled = true;
  const { data, error } = await sb.rpc('admin_broadcast', { p_title: title, p_body: body });
  btn.disabled = false;
  if (error){
    showToast(/broadcast_too_soon/.test(error.message || '')
      ? 'נשלחה הודעה לכולם בעשר הדקות האחרונות. אפשר לשלוח שוב בעוד כמה דקות.'
      : 'השליחה נכשלה: ' + heErr(error));
    return;
  }
  showToast('ההודעה נשלחה ל-' + ((data && data.recipients) || 0) + ' סוכנים');
  document.getElementById('ccBcTitle').value = '';
  document.getElementById('ccBcBody').value = '';
  document.getElementById('ccBcCnt').textContent = '0 / 600';
  document.getElementById('ccBc').hidden = true;
  document.getElementById('ccBcOpen').setAttribute('aria-expanded', 'false');
}

/* ---------- אצל הסוכן/ת: "הודעות מהפלטפורמה" ----------
   נטען כשהקטגוריה נפתחת (ומהפעמון, NOTIF_TYPES.refresh) - אין סיבה לשאילתה
   בכל כניסה בשביל משהו שנשלח פעם בכמה שבועות. */
async function loadPlatformNews(){
  const host = document.getElementById('platformNewsList');
  if (!host) return;
  const { data, error } = await sb.from('admin_broadcasts')
    .select('id, title, body, created_at').order('created_at', { ascending: false }).limit(20);
  if (error){
    host.innerHTML = '<div class="empty-state">' + esc(
      (error.code === '42P01' || error.code === 'PGRST205') ? 'עוד אין הודעות.' : 'שגיאה בטעינה: ' + heErr(error)) + '</div>';
    return;
  }
  const rows = data || [];
  if (!rows.length){ host.innerHTML = '<div class="empty-state">עוד אין הודעות מהפלטפורמה.</div>'; return; }
  host.innerHTML = rows.map(r => '<div class="pn-item"><time>'
    + esc(new Date(r.created_at).toLocaleDateString('he-IL', { day:'numeric', month:'numeric', year:'numeric' }))
    + '</time><b>' + esc(r.title) + '</b><p>' + esc(r.body) + '</p></div>').join('');
}

(function wirePlatformNews(){
  const acc = document.getElementById('accPlatformNews');
  if (acc) acc.addEventListener('toggle', () => { if (acc.open) loadPlatformNews(); });
})();
