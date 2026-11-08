/* ============================================================================
   האזור האישי לבעלי מקצוע (professional-crm.html)
   ----------------------------------------------------------------------------
   כניסה, ארנק, ומדף "שאלה לעו״ד" לעורכי דין מאושרים. לבעלי מקצוע אין חשבון CRM (הוא דורש
   רישיון תיווך), ולכן חשבון נפרד: professional_accounts (docs/professional-accounts.md).

   כל ההרשאות במסד, לא כאן:
     • החשבון והלידים שנרכשו נקראים ישירות (RLS לפי user_id / sold_to_professional_id).
     • המדף נקרא מ-lawyer_leads_public, שמחזיר שורות רק לחשבון עו"ד מאושר ובעיר שלו.
     • הרכישה: מהארנק ב-lawyer-lead-purchase, או בכרטיס ב-lawyer-lead-checkout (JWT; הליד נשמר 15 דקות,
       והסגירה רק ב-wallet-topup-callback אחרי אימות מול מורנינג).
   המסך שמסתיר מדף הוא נוחות, לא ההגנה.
   ============================================================================ */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

  const el = (id) => document.getElementById(id);
  const KIND_LABELS = {
    real_estate_lawyer: 'עו״ד מקרקעין', mortgage_advisor: 'יועץ/ת משכנתאות', appraiser: 'שמאי/ת מקרקעין',
    architect: 'אדריכל/ית', interior_designer: 'מעצב/ת פנים', cleaning: 'חברת ניקיון', general: 'בעל/ת מקצוע',
  };
  const nis = (n) => '₪' + Math.round(Number(n) || 0).toLocaleString('he-IL');
  const hebDate = (d) => (d ? new Date(d).toLocaleDateString('he-IL') : '');
  const errText = (e) => (window.FriendlyError ? FriendlyError.text(e) : (e && e.message) || 'שגיאה');

  let account = null;
  let price = 50;
  let vatRate = 0.18;   // תצוגה בלבד: הסכום שנגבה נקבע במסד (start_lawyer_lead_order)
  let shelf = [];
  const propertyTitles = {};
  let propertyLookupFailed = false;
  let pendingBuy = null;
  let recovering = false;   // חזרה מקישור איפוס סיסמה: הטופס של הסיסמה החדשה גובר על boot

  function setMsg(id, text, cls) {
    const n = el(id);
    if (!n) return;
    n.textContent = text || '';
    n.className = 'msg' + (cls ? ' ' + cls : '');
  }
  function show(id, on) { el(id).hidden = !on; }

  /* ---------- כניסה ---------- */
  function showLogin() {
    show('loginCard', true); show('recoverCard', false); show('app', false);
  }

  el('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el('lgBtn');
    btn.disabled = true; btn.textContent = 'מתחבר…'; setMsg('lgMsg', '');
    try {
      const { error } = await sb.auth.signInWithPassword({
        email: el('lgEmail').value.trim(), password: el('lgPassword').value,
      });
      if (error) { setMsg('lgMsg', 'אימייל או סיסמה שגויים', 'err'); return; }
      await boot();
    } catch (err) {
      setMsg('lgMsg', 'שגיאת רשת - נסו שוב', 'err');
    } finally {
      btn.disabled = false; btn.textContent = 'כניסה';
    }
  });

  el('forgotBtn').addEventListener('click', async () => {
    const email = el('lgEmail').value.trim();
    if (!email) { setMsg('lgMsg', 'כתבו את כתובת האימייל ולחצו שוב', 'err'); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/professional-crm' });
    // אותה תשובה בכל מקרה: לא מגלים אם הכתובת רשומה
    setMsg('lgMsg', error ? 'לא הצלחנו לשלוח כרגע - נסו שוב בעוד דקה' : 'אם הכתובת רשומה, נשלח אליה קישור לאיפוס סיסמה', error ? 'err' : 'ok');
  });

  el('recoverForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: el('rcPassword').value });
    if (error) { setMsg('rcMsg', 'לא הצלחנו לשמור: ' + errText(error), 'err'); return; }
    setMsg('rcMsg', 'הסיסמה נשמרה', 'ok');
    show('recoverCard', false);
    recovering = false;
    await boot();
  });

  el('logoutBtn').addEventListener('click', async () => {
    await sb.auth.signOut();
    location.reload();
  });

  /* ---------- החשבון ---------- */
  async function loadAccount(userId) {
    // ‏eq('user_id') חובה: מנהל/ת פלטפורמה רואה את כל החשבונות (policy), ו-maybeSingle על כולם נכשל
    const { data, error } = await sb
      .from('professional_accounts')
      .select('id, kind, display_name, credit_balance, shelf_enabled, active, city_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    account = data;
  }

  function renderAccount() {
    el('acctName').textContent = account.display_name;
    el('acctKind').textContent = KIND_LABELS[account.kind] || KIND_LABELS.general;
    el('acctBalance').textContent = nis(account.credit_balance);
    const lawyer = account.kind === 'real_estate_lawyer';
    show('shelfCard', lawyer && account.shelf_enabled);
    show('boughtCard', lawyer && account.shelf_enabled);
    show('pendingShelfCard', lawyer && !account.shelf_enabled);
    show('noShelfCard', !lawyer);
  }

  el('manageBtn').addEventListener('click', async () => {
    const btn = el('manageBtn');
    btn.disabled = true;
    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(SUPABASE_URL + '/functions/v1/professional-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify({ action: 'manage_link' }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) { setMsg('appMsg', 'לא מצאנו כרטיסייה מקושרת לחשבון הזה', 'err'); return; }
      location.href = data.url;
    } catch (err) {
      setMsg('appMsg', 'שגיאת רשת - נסו שוב', 'err');
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- מדף השאלות ---------- */
  async function loadPrice() {
    try {
      const { data } = await sb.from('pricing_config').select('key, value').in('key', ['lawyer_lead_price', 'vat_rate']);
      (data || []).forEach((r) => {
        if (r.key === 'lawyer_lead_price' && Number(r.value) >= 0) price = Number(r.value);
        if (r.key === 'vat_rate' && Number(r.value) >= 0) vatRate = Number(r.value);
      });
    } catch (e) { /* ברירת המחדל */ }
    el('shelfPrice').textContent = nis(price);
  }

  async function loadProperties(leads) {
    const ids = [...new Set(leads.map((l) => l.property_id).filter((id) => id && !propertyTitles[id]))];
    if (!ids.length) return;
    const { data, error } = await sb.from('properties').select('id, title, city').in('id', ids);
    if (error) { propertyLookupFailed = true; return; }
    (data || []).forEach((p) => { propertyTitles[p.id] = p; });
  }

  // כשל בשליפת הכותרות אינו "נכס שהוסר": הכרטיס לא טוען על הנכס דבר שאינו יודע
  function sourceText(lead) {
    const p = lead.property_id ? propertyTitles[lead.property_id] : null;
    if (p) return 'על נכס: ' + (p.title || 'מודעה') + (p.city ? ' · ' + p.city : '');
    if (lead.property_id) return propertyLookupFailed ? 'על נכס באתר' : 'על נכס שהוסר מהאתר';
    return 'שאלה כללית';
  }

  async function loadShelf() {
    const list = el('shelfList');
    list.innerHTML = '<div class="empty">טוען…</div>';
    await loadPrice();
    const { data, error } = await sb
      .from('lawyer_leads_public').select('*').eq('status', 'new')
      .order('created_at', { ascending: false }).limit(60);
    if (error) {
      list.innerHTML = '<div class="empty">שגיאה בטעינת המדף: ' + escapeHtml(errText(error)) + '</div>';
      shelf = [];
      return;
    }
    shelf = data || [];
    await loadProperties(shelf);
    if (!shelf.length) {
      list.innerHTML = '<div class="empty">אין כרגע שאלות פנויות בעיר שלכם. שאלות חדשות עולות מדף נכס אחרי אימות הטלפון של הפונה.</div>';
      return;
    }
    list.innerHTML = shelf.map((l) => `
      <div class="lead">
        <div class="q">${escapeHtml(l.question_text)}</div>
        <div class="meta">${escapeHtml(sourceText(l))} · ${escapeHtml(hebDate(l.created_at))} · ${l.has_email ? 'שם, טלפון ואימייל' : 'שם וטלפון'} · טלפון מאומת בוואטסאפ</div>
        <div class="acts">${l.reserved_by_other
          ? '<button class="btn btn-ghost" type="button" disabled title="עו״ד אחר/ת בתהליך רכישה. נסו שוב בעוד כמה דקות">בטיפול</button>'
          : `<button class="btn btn-gold" type="button" data-buy="${escapeHtml(l.id)}">רכישה · ${escapeHtml(nis(price))}</button>`}</div>
      </div>`).join('');
  }

  async function loadBought() {
    const list = el('boughtList');
    const { data, error } = await sb
      .from('lawyer_leads').select('id, full_name, phone, email, question, property_id, sold_at')
      .eq('sold_to_professional_id', account.id).order('sold_at', { ascending: false });
    if (error) { list.innerHTML = '<div class="empty">שגיאה בטעינת הלידים שנרכשו: ' + escapeHtml(errText(error)) + '</div>'; return; }
    if (!data || !data.length) { list.innerHTML = '<div class="empty">עוד לא רכשתם לידים.</div>'; return; }
    await loadProperties(data);
    list.innerHTML = data.map((l) => {
      // ‏wa.me דורש מספר בינלאומי בלי + ובלי האפס המוביל
      const wa = String(l.phone).replace(/\D/g, '').replace(/^0/, '972');
      return `
      <div class="lead">
        <div><b>${escapeHtml(l.full_name)}</b> <span class="meta">נרכש ${escapeHtml(hebDate(l.sold_at))}</span></div>
        <div class="q" style="margin-top:6px">${escapeHtml(l.question)}</div>
        <div class="meta">${escapeHtml(sourceText(l))}</div>
        <div class="acts">
          <a class="btn btn-gold" href="tel:${escapeHtml(l.phone)}">📞 ${escapeHtml(l.phone)}</a>
          <a class="btn btn-ghost" href="https://wa.me/${escapeHtml(wa)}" target="_blank" rel="noopener noreferrer">💬 וואטסאפ</a>
          ${l.email ? `<a class="btn btn-ghost" href="mailto:${escapeHtml(l.email)}">✉️ אימייל</a>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  /* ---------- רכישה ---------- */
  el('shelfList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-buy]');
    if (!btn) return;
    const lead = shelf.find((l) => l.id === btn.dataset.buy);
    if (!lead) return;
    pendingBuy = lead;
    el('buyQuestion').textContent = lead.question_text;
    el('buyPrice').textContent = nis(price);
    const enough = Number(account.credit_balance) >= price;
    const gross = Math.round(price * (1 + vatRate) * 100) / 100;
    el('buyCardNote').textContent = 'בכרטיס אשראי: ' + nis(gross) + ' כולל מע״מ. הרכישה חד-פעמית, בלי הוראת קבע.';
    el('buyBalance').textContent = enough
      ? 'או מהיתרה (לפני מע״מ). יתרה אחרי הרכישה: ' + nis(Number(account.credit_balance) - price)
      : '';
    show('buyConfirm', enough);
    el('buyInvName').value = el('buyInvName').value || account.display_name || '';
    el('buyCard').disabled = false;
    el('buyCard').textContent = 'תשלום בכרטיס אשראי';
    setMsg('buyMsg', '');
    show('buyOverlay', true);
  });

  el('buyCancel').addEventListener('click', () => { pendingBuy = null; show('buyOverlay', false); });

  const BUY_ERRORS = {
    lead_already_sold: 'הליד כבר נמכר לעו״ד אחר/ת',
    lead_not_available: 'הליד כבר אינו זמין',
    lead_not_found: 'הליד לא נמצא',
    lead_reserved: 'עו״ד אחר/ת בתהליך רכישה של הליד הזה. נסו שוב בעוד כמה דקות.',
    order_in_progress: 'דף התשלום עוד נפתח. נסו שוב בעוד רגע.',
    already_purchased: 'הליד כבר שלכם, והוא מופיע למטה תחת "הלידים שרכשתי"',
    too_many_open_orders: 'יש לכם כבר שלוש רכישות פתוחות. השלימו אותן או המתינו 15 דקות.',
    not_a_lawyer: 'המדף הזה מיועד לעורכי דין בלבד',
    shelf_not_approved: 'הגישה למדף עדיין לא אושרה על ידי הנהלת האתר',
    account_inactive: 'החשבון אינו פעיל',
    payment_unavailable: 'התשלום בכרטיס אינו זמין כרגע. נסו שוב מאוחר יותר.',
    payment_provider_error: 'לא הצלחנו לפתוח את דף התשלום. נסו שוב בעוד רגע.',
    payment_terminal_missing: 'התשלום בכרטיס אינו זמין כרגע. נסו שוב מאוחר יותר.',
  };

  // תשלום בכרטיס: ההזמנה נפתחת בשרת (הסכום נקבע שם), והליד נשמר לכם 15 דקות. הסגירה אחרי התשלום
  // נעשית רק בשרת, אחרי אימות מול חברת הסליקה: החזרה לכאן אינה "הוכחת תשלום"
  el('buyCard').addEventListener('click', async () => {
    if (!pendingBuy) return;
    const btn = el('buyCard');
    btn.disabled = true; btn.textContent = 'פותח דף תשלום…'; setMsg('buyMsg', '');
    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(SUPABASE_URL + '/functions/v1/lawyer-lead-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify({
          action: 'start',
          lead_id: pendingBuy.id,
          client_name: el('buyInvName').value.trim(),
          client_tax_id: el('buyInvTax').value.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error || !data.redirect_url) {
        setMsg('buyMsg', BUY_ERRORS[data.error] || ('שגיאה: ' + errText(data.error)), 'err');
        btn.disabled = false; btn.textContent = 'תשלום בכרטיס אשראי';
        if (data.error === 'lead_already_sold' || data.error === 'lead_not_available' || data.error === 'lead_reserved') await refresh();
        return;
      }
      location.href = data.redirect_url;
    } catch (err) {
      setMsg('buyMsg', 'שגיאת רשת - נסו שוב', 'err');
      btn.disabled = false; btn.textContent = 'תשלום בכרטיס אשראי';
    }
  });

  // חזרה מדף התשלום (?lead_payment=...&order_id=...): שואלים את השרת, וה-webhook סוגר ברקע, ולכן כמה ניסיונות
  async function handlePaymentReturn() {
    let q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    const result = q.get('lead_payment');
    const orderId = q.get('order_id');
    if (!result || !orderId) return;
    history.replaceState(null, '', location.pathname);
    if (result === 'failure') {
      setMsg('appMsg', 'התשלום לא הושלם ולא בוצע חיוב. אפשר לנסות שוב (הליד נשמר לכם עד 15 דקות מפתיחת התשלום).', 'err');
      return;
    }
    setMsg('appMsg', 'מאמתים את התשלום…', 'ok');
    for (let i = 0; i < 10; i++) {
      try {
        const { data: { session } } = await sb.auth.getSession();
        const res = await fetch(SUPABASE_URL + '/functions/v1/lawyer-lead-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + session.access_token },
          body: JSON.stringify({ action: 'status', order_id: orderId }),
        });
        const data = await res.json();
        // תשובת שגיאה (למשל אימות דו-שלבי שפג) לא תשתנה בניסיון חוזר: עוצרים במקום להמתין 30 שניות
        if (!res.ok) {
          setMsg('appMsg', 'לא הצלחנו לאמת את התשלום כרגע. רעננו את הדף. אם שילמתם, הליד יופיע תחת "הלידים שרכשתי" ברגע שיאושר.', 'err');
          return;
        }
        if (data.status === 'success') {
          setMsg('appMsg', 'התשלום התקבל. פרטי הקשר של הפונה מופיעים למטה תחת "הלידים שרכשתי".', 'ok');
          await refresh();
          return;
        }
        if (data.status === 'refunded') {
          setMsg('appMsg', 'התשלום הוחזר לכם במלואו.', 'ok');
          return;
        }
        if (data.status === 'refund_needed') {
          setMsg('appMsg', 'התשלום התקבל, אבל הליד כבר אינו זמין (נמכר בינתיים). נחזיר לכם את התשלום במלואו, ונעדכן.', 'err');
          return;
        }
        if (data.status === 'failed') {
          setMsg('appMsg', 'התשלום לא הושלם ולא בוצע חיוב.', 'err');
          await refresh();
          return;
        }
      } catch (e) { /* ניסיון נוסף */ }
      await new Promise((r) => setTimeout(r, 3000));
    }
    setMsg('appMsg', 'עדיין מאמתים את התשלום. הליד יופיע תחת "הלידים שרכשתי" ברגע שיאושר, ואין צורך לשלם שוב.', 'ok');
  }

  el('buyConfirm').addEventListener('click', async () => {
    if (!pendingBuy) return;
    const btn = el('buyConfirm');
    btn.disabled = true; btn.textContent = 'רוכש…'; setMsg('buyMsg', '');
    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(SUPABASE_URL + '/functions/v1/lawyer-lead-purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify({ lead_id: pendingBuy.id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        const messages = Object.assign({
          insufficient_balance: 'היתרה אינה מספיקה. נדרש ' + nis(data.required) + '. אפשר לשלם בכרטיס אשראי.',
        }, BUY_ERRORS);
        setMsg('buyMsg', messages[data.error] || ('שגיאה: ' + errText(data.error)), 'err');
        btn.textContent = 'רכישה מהיתרה';
        btn.disabled = false;
        if (data.error === 'lead_already_sold' || data.error === 'lead_not_available' || data.error === 'lead_reserved') await refresh();
        return;
      }
      show('buyOverlay', false);
      pendingBuy = null;
      setMsg('appMsg', data.already_purchased
        ? 'הליד כבר שלכם, והוא מופיע למטה תחת "הלידים שרכשתי"'
        : 'הליד נרכש וחויבתם ' + nis(data.price_charged) + '. פרטי הקשר מופיעים למטה תחת "הלידים שרכשתי"', 'ok');
      await refresh();
    } catch (err) {
      setMsg('buyMsg', 'שגיאת רשת - נסו שוב', 'err');
      btn.disabled = false;
    } finally {
      btn.textContent = 'רכישה מהיתרה';
    }
  });

  /* ---------- טעינה ---------- */
  async function currentUserId() {
    const { data: { session } } = await sb.auth.getSession();
    return session ? session.user.id : null;
  }

  // renderAll: התצוגה והמדף, לפי החשבון הטעון. refresh (אחרי כל פעולה) ו-boot (אחרי בדיקות הכניסה) משתמשים בה
  async function renderAll() {
    renderAccount();
    if (account.kind === 'real_estate_lawyer' && account.shelf_enabled) {
      await Promise.all([loadShelf(), loadBought()]);
    }
  }

  async function refresh() {
    await loadAccount(await currentUserId());
    await renderAll();
  }

  async function boot() {
    if (!sb) { setMsg('lgMsg', 'לא הצלחנו לטעון את האתר. רעננו את הדף.', 'err'); show('loginCard', true); return; }
    const { data: { session } } = await sb.auth.getSession();
    if (recovering) return;
    if (!session) { showLogin(); return; }
    try {
      await loadAccount(session.user.id);
    } catch (err) {
      showLogin();
      setMsg('lgMsg', 'שגיאה בטעינת החשבון: ' + errText(err), 'err');
      return;
    }
    if (!account) {
      // מחובר, אבל אין חשבון בעל מקצוע (למשל סוכן/ת שנכנס/ת לכאן בטעות)
      await sb.auth.signOut();
      showLogin();
      setMsg('lgMsg', 'אין חשבון בעל מקצוע לכתובת הזו. מי שנרשם/ה בכרטיסייה פותח/ת חשבון מקישור העריכה האישי.', 'err');
      return;
    }
    show('loginCard', false); show('recoverCard', false); show('app', true);
    await renderAll();
    // בלי await: האימות מתחיל להמתין עד 30 שניות, והמדף כבר מוצג
    handlePaymentReturn();
  }

  if (sb) {
    // חזרה מקישור איפוס סיסמה: מציגים טופס סיסמה חדשה ולא את הכניסה
    sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') { recovering = true; show('loginCard', false); show('app', false); show('recoverCard', true); }
    });
  }
  boot();
})();
