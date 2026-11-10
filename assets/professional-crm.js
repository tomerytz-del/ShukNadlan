/* ============================================================================
   האזור האישי לבעלי מקצוע (professional-crm.html)
   ----------------------------------------------------------------------------
   כניסה, עריכת הכרטיסייה, ארנק, ומדף לידים לשני תחומים: "שאלה לעו״ד" לעורכי דין מאושרים,
   ולידים ממחשבון המשכנתא ליועצי משכנתאות מאושרים. לבעלי מקצוע אין חשבון CRM (הוא דורש
   רישיון תיווך), ולכן חשבון נפרד: professional_accounts (docs/professional-accounts.md).

   כל ההרשאות במסד, לא כאן:
     • החשבון והלידים שנרכשו נקראים ישירות (RLS לפי user_id / sold_to_professional_id).
     • המדף נקרא מ-lawyer_leads_public (רק לחשבון עו"ד מאושר ובעיר שלו) או מ-mortgage_leads_public
       (רק ליועץ/ת משכנתאות מאושר/ת).
     • הרכישה: מהארנק ב-lawyer-lead-purchase / mortgage-lead-purchase, או בכרטיס ב-lawyer-lead-checkout
       (עו"ד בלבד; JWT; הליד נשמר 15 דקות, והסגירה רק ב-wallet-topup-callback אחרי אימות מול מורנינג).
   המסך שמסתיר מדף הוא נוחות, לא ההגנה.
   ============================================================================ */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

  // הקישור שבמייל האימות (professional-account → inviteUserByEmail) נוחת כאן עם type=invite ב-hash. ה-hash נמחק
  // בעת יצירת ההפעלה, ולכן הדגל נקרא כאן, לפני הכול. מי שנוחת/ת מקישור כזה עוד בלי סיסמה, והטופס שלה גובר על boot.
  let inviteOpen = /[#&]type=invite\b/.test(location.hash);
  const linkExpired = /[#&]error_code=otp_expired\b/.test(location.hash);

  const el = (id) => document.getElementById(id);
  const KIND_LABELS = {
    real_estate_lawyer: 'עו״ד מקרקעין', mortgage_advisor: 'יועץ/ת משכנתאות', appraiser: 'שמאי/ת מקרקעין',
    architect: 'אדריכל/ית', interior_designer: 'מעצב/ת פנים', cleaning: 'חברת ניקיון', general: 'בעל/ת מקצוע',
  };
  const nis = (n) => '₪' + Math.round(Number(n) || 0).toLocaleString('he-IL');
  const hebDate = (d) => (d ? new Date(d).toLocaleDateString('he-IL') : '');
  const errText = (e) => (window.FriendlyError ? FriendlyError.text(e) : (e && e.message) || 'שגיאה');

  // המדף לפי התחום. תחום שאינו כאן רואה "אין עדיין מדף". הסינון האמיתי ב-view במסד
  const SHELF_COPY = {
    real_estate_lawyer: {
      title: 'שאלות לעו״ד בעיר שלכם',
      sub: 'שאלות של גולשים שנשאלו מדף נכס, אחרי אימות הטלפון. הרכישה (<b id="shelfPrice">₪50</b>) חושפת שם, טלפון ואימייל.',
      priceKey: 'lawyer_lead_price', buyTitle: 'אישור רכישת שאלה', card: true,
    },
    mortgage_advisor: {
      title: 'לידים ממחשבון המשכנתא',
      sub: 'פונים שביקשו ייעוץ משכנתא במחשבון באתר (דף הבית ודפי הנכסים). הרכישה (<b id="shelfPrice">₪50</b>) חושפת שם, טלפון ואימייל.',
      priceKey: 'mortgage_lead_price', buyTitle: 'אישור רכישת ליד משכנתאות', card: false,
    },
  };
  const shelfCopy = () => (account && SHELF_COPY[account.kind]) || null;
  const isLawyer = () => !!account && account.kind === 'real_estate_lawyer';

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
    if (inviteOpen) { inviteOpen = false; history.replaceState(null, '', location.pathname); }
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
    const copy = shelfCopy();
    const hasShelf = !!copy;
    if (copy) {
      el('shelfTitle').textContent = copy.title;
      el('shelfSub').innerHTML = copy.sub;   // נוסח קבוע מהקוד, לא מהמסד
    }
    show('shelfCard', hasShelf && account.shelf_enabled);
    show('boughtCard', hasShelf && account.shelf_enabled);
    show('pendingShelfCard', hasShelf && !account.shelf_enabled);
    show('noShelfCard', !hasShelf);
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
    const key = (shelfCopy() || SHELF_COPY.real_estate_lawyer).priceKey;
    try {
      const { data } = await sb.from('pricing_config').select('key, value').in('key', [key, 'vat_rate']);
      (data || []).forEach((r) => {
        if (r.key === key && Number(r.value) >= 0) price = Number(r.value);
        if (r.key === 'vat_rate' && Number(r.value) >= 0) vatRate = Number(r.value);
      });
    } catch (e) { /* ברירת המחדל */ }
    const priceEl = el('shelfPrice');
    if (priceEl) priceEl.textContent = nis(price);
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

  /* ---------- מדף המשכנתאות (יועצי משכנתאות מאושרים) ----------
     אותו מלאי כמו המגירה ב-CRM של הסוכנים (mortgage_leads_public: נתוני המחשבון בלי שם,
     טלפון ואימייל). הרכישה מהארנק בלבד, ב-mortgage-lead-purchase, שמזהה חשבון בעל מקצוע
     לפי ה-JWT. תשלום בכרטיס על ליד משכנתאות עוד לא נבנה (lawyer_lead_orders הוא של עו"ד). */
  const mortgageKind = (l) => (l.owns_property
    ? '🏘️ יש דירה בבעלות (משפר/ת דיור או משקיע/ה)'
    : '🔑 דירה יחידה');
  function mortgageMeta(l) {
    return [
      l.property_price ? 'נכס ' + nis(l.property_price) : null,
      l.equity != null ? 'הון עצמי ' + nis(l.equity) : null,
      l.ltv_pct != null ? Math.round(l.ltv_pct) + '% מימון' : null,
      l.years ? l.years + ' שנים' : null,
      l.interest_rate != null ? 'ריבית ' + l.interest_rate + '%' : null,
    ].filter(Boolean).join(' · ');
  }
  function mortgageSource(l) {
    const p = l.property_id ? propertyTitles[l.property_id] : null;
    if (p) return 'מנכס: ' + (p.title || 'מודעה') + (p.city ? ' · ' + p.city : '');
    if (l.property_id) return propertyLookupFailed ? 'מנכס באתר' : 'מנכס שהוסר מהאתר';
    return 'ממחשבון דף הבית';
  }
  // הטקסט שמוצג בדיאלוג האישור (ובכרטיס): מה שצריך כדי להחליט אם הליד שווה את המחיר
  function mortgageSummary(l) {
    return ['החזר חודשי מבוקש ' + nis(l.monthly_payment), mortgageKind(l), mortgageMeta(l), mortgageSource(l)]
      .filter(Boolean).join('\n');
  }

  async function loadMortgageShelf() {
    const list = el('shelfList');
    list.innerHTML = '<div class="empty">טוען…</div>';
    await loadPrice();
    const { data, error } = await sb
      .from('mortgage_leads_public').select('*').eq('status', 'new')
      .order('created_at', { ascending: false }).limit(60);
    if (error) {
      list.innerHTML = '<div class="empty">שגיאה בטעינת המדף: ' + escapeHtml(errText(error)) + '</div>';
      shelf = [];
      return;
    }
    shelf = data || [];
    await loadProperties(shelf);
    if (!shelf.length) {
      list.innerHTML = '<div class="empty">אין כרגע לידי משכנתאות פנויים. לידים חדשים נכנסים ממחשבון המשכנתא בדף הבית ובדפי הנכסים.</div>';
      return;
    }
    list.innerHTML = shelf.map((l) => `
      <div class="lead">
        <div class="q"><b>החזר חודשי מבוקש ${escapeHtml(nis(l.monthly_payment))}</b><br>${escapeHtml(mortgageKind(l))}</div>
        <div class="meta">${escapeHtml(mortgageMeta(l))}</div>
        <div class="meta">${escapeHtml(mortgageSource(l))} · ${escapeHtml(hebDate(l.created_at))} · ${l.has_email ? 'שם, טלפון ואימייל' : 'שם וטלפון'}</div>
        <div class="acts"><button class="btn btn-gold" type="button" data-buy="${escapeHtml(l.id)}">רכישה · ${escapeHtml(nis(price))}</button></div>
      </div>`).join('');
  }

  async function loadMortgageBought() {
    const list = el('boughtList');
    const { data, error } = await sb
      .from('mortgage_leads').select('id, full_name, phone, email, owns_property, property_price, equity, loan_amount, interest_rate, years, monthly_payment, ltv_pct, property_id, sold_at')
      .eq('sold_to_professional_id', account.id).order('sold_at', { ascending: false });
    if (error) { list.innerHTML = '<div class="empty">שגיאה בטעינת הלידים שנרכשו: ' + escapeHtml(errText(error)) + '</div>'; return; }
    if (!data || !data.length) { list.innerHTML = '<div class="empty">עוד לא רכשתם לידים.</div>'; return; }
    await loadProperties(data);
    list.innerHTML = data.map((l) => {
      const wa = String(l.phone).replace(/\D/g, '').replace(/^0/, '972');
      return `
      <div class="lead">
        <div><b>${escapeHtml(l.full_name)}</b> <span class="meta">נרכש ${escapeHtml(hebDate(l.sold_at))}</span></div>
        <div class="q" style="margin-top:6px">החזר חודשי ${escapeHtml(nis(l.monthly_payment))}${l.loan_amount != null ? ' · הלוואה ' + escapeHtml(nis(l.loan_amount)) : ''}<br>${escapeHtml(mortgageKind(l))}</div>
        <div class="meta">${escapeHtml(mortgageMeta(l))}</div>
        <div class="meta">${escapeHtml(mortgageSource(l))}</div>
        <div class="acts">
          <a class="btn btn-gold" href="tel:${escapeHtml(l.phone)}">📞 ${escapeHtml(l.phone)}</a>
          <a class="btn btn-ghost" href="https://wa.me/${escapeHtml(wa)}" target="_blank" rel="noopener noreferrer">💬 וואטסאפ</a>
          ${l.email ? `<a class="btn btn-ghost" href="mailto:${escapeHtml(l.email)}">✉️ אימייל</a>` : ''}
          ${l.property_id && propertyTitles[l.property_id] ? `<a class="btn btn-ghost" href="/property?id=${escapeHtml(l.property_id)}" target="_blank" rel="noopener noreferrer">🏠 הנכס</a>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  /* ---------- מדף עורכי הדין ---------- */
  async function loadShelf() {
    if (!isLawyer()) return loadMortgageShelf();
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
    if (!isLawyer()) return loadMortgageBought();
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
    const copy = shelfCopy() || SHELF_COPY.real_estate_lawyer;
    el('buyTitle').textContent = copy.buyTitle;
    el('buyQuestion').textContent = isLawyer() ? lead.question_text : mortgageSummary(lead);
    el('buyPrice').textContent = nis(price);
    const enough = Number(account.credit_balance) >= price;
    const gross = Math.round(price * (1 + vatRate) * 100) / 100;
    // תשלום בכרטיס קיים רק לליד עו"ד (lawyer_lead_orders). ליועץ/ת משכנתאות: מהארנק בלבד
    show('buyCard', copy.card);
    show('buyInvoice', copy.card);
    show('buyReserveNote', copy.card);
    el('buyCardNote').textContent = copy.card
      ? 'בכרטיס אשראי: ' + nis(gross) + ' כולל מע״מ. הרכישה חד-פעמית, בלי הוראת קבע.'
      : '';
    el('buyBalance').textContent = enough
      ? (copy.card ? 'או מהיתרה (לפני מע״מ). ' : 'מהיתרה (לפני מע״מ). ') + 'יתרה אחרי הרכישה: ' + nis(Number(account.credit_balance) - price)
      : (copy.card ? '' : 'היתרה אינה מספיקה. נדרש ' + nis(price) + '. לטעינת הארנק כתבו לנו מהכפתור למעלה.');
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
    not_a_mortgage_advisor: 'המדף הזה מיועד ליועצי משכנתאות בלבד',
    no_matching_agent_profile: 'לא נמצא חשבון בעל מקצוע לכניסה הזו',
    no_matching_account: 'לא נמצא חשבון בעל מקצוע לכניסה הזו',
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
      // הפונקציה לפי התחום. שתיהן גוזרות את החשבון מה-JWT, ולא מהגוף
      const fn = isLawyer() ? 'lawyer-lead-purchase' : 'mortgage-lead-purchase';
      const res = await fetch(SUPABASE_URL + '/functions/v1/' + fn, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify({ lead_id: pendingBuy.id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        // תשלום בכרטיס קיים רק במדף עו"ד; ליועץ/ת משכנתאות הדרך היא טעינת הארנק
        const copy = shelfCopy() || SHELF_COPY.real_estate_lawyer;
        const messages = Object.assign({
          insufficient_balance: 'היתרה אינה מספיקה. נדרש ' + nis(data.required) + '. ' +
            (copy.card ? 'אפשר לשלם בכרטיס אשראי.' : 'לטעינת הארנק כתבו לנו מהכפתור למעלה.'),
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

  /* ---------- מחיקת החשבון ----------
     הסיכום (כמה לידים, כמה יתרה) מגיע מהשרת, וההקלדה נבדקת שוב שם. אחרי המחיקה המשתמש ב-Auth כבר אינו קיים,
     ולכן יוצאים ומציגים את מסך הכניסה עם אישור. */
  const DELETE_PHRASE = 'מחיקת חשבון';
  async function callCloseAccount(payload) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return { ok: false, data: { error: 'no_session' } };
    const res = await fetch(SUPABASE_URL + '/functions/v1/close-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + session.access_token },
      body: JSON.stringify(Object.assign({ account: 'professional' }, payload)),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && !data.error, data };
  }
  function resetDeleteDialog() {
    show('delStep1', true); show('delStep2', false);
    el('delAck').checked = false;
    el('delNext').disabled = true; show('delNext', true);
    show('delConfirm', false); el('delConfirm').disabled = true;
    el('delPhrase').value = ''; setMsg('delDlgMsg', '');
  }
  el('deleteOpenBtn').addEventListener('click', async () => {
    setMsg('deleteMsg', 'טוענים…');
    const { ok, data } = await callCloseAccount({ action: 'preview' });
    if (!ok || !data.summary) { setMsg('deleteMsg', 'לא הצלחנו לטעון את פרטי המחיקה. נסו שוב, או כתבו אלינו: shuknadlan@gmail.com', 'err'); return; }
    setMsg('deleteMsg', '');
    const s = data.summary;
    show('delLeads', s.bought_leads > 0);
    el('delLeads').textContent = 'הפרטים של ' + s.bought_leads + ' פניות שרכשתם נשארים אצלנו עד שהם נמחקים לפי מדיניות שמירת המידע.';
    el('delMoney').textContent = s.credit_balance > 0
      ? 'בארנק יש ' + nis(s.credit_balance) + '. היתרה מאופסת. אם היא נטענה בתשלום, הנהלת האתר תבדוק ותחזיר ידנית. יתרה שהיא זיכוי או מתנה אינה מוחזרת.'
      : 'אין יתרה בארנק.';
    resetDeleteDialog();
    if (s.blocker === 'payment_pending') {
      el('delAck').disabled = true;
      setMsg('delDlgMsg', 'יש תשלום על ליד שעדיין מתעדכן. אי אפשר למחוק כרגע, ואפשר לנסות שוב בעוד כמה דקות.', 'err');
    } else {
      el('delAck').disabled = false;
    }
    show('delOverlay', true);
  });
  el('delAck').addEventListener('change', (e) => { el('delNext').disabled = !e.target.checked; });
  el('delNext').addEventListener('click', () => {
    show('delStep1', false); show('delStep2', true);
    show('delNext', false); show('delConfirm', true);
    el('delPhrase').focus();
  });
  el('delPhrase').addEventListener('input', (e) => { el('delConfirm').disabled = e.target.value.trim() !== DELETE_PHRASE; });
  el('delCancel').addEventListener('click', () => { show('delOverlay', false); resetDeleteDialog(); });
  el('delConfirm').addEventListener('click', async () => {
    el('delConfirm').disabled = true;
    setMsg('delDlgMsg', 'מוחקים…', 'ok');
    const { ok, data } = await callCloseAccount({ action: 'request', confirm: DELETE_PHRASE });
    if (!ok) {
      const messages = {
        already_closed: 'החשבון כבר נמחק.',
        payment_pending: 'יש תשלום על ליד שעדיין מתעדכן. נסו שוב בעוד כמה דקות.',
      };
      setMsg('delDlgMsg', messages[data.error] || 'המחיקה נכשלה. אפשר לנסות שוב, או לכתוב אלינו: shuknadlan@gmail.com', 'err');
      el('delConfirm').disabled = false;
      return;
    }
    show('delOverlay', false);
    account = null;
    try { await sb.auth.signOut(); } catch (_) { /* המשתמש כבר נמחק */ }
    showLogin();
    // מה שנאמר כאן הוא מה שקרה בפועל: מחיקת הכניסה ב-Auth יכולה להיכשל (deleted=false), או להישאר כי יש פרופיל חי אחר (auth='kept')
    if (data.deleted === false) {
      setMsg('lgMsg', 'הפרטים האישיים נמחקו, אבל מחיקת הכניסה נכשלה. כתבו לנו (shuknadlan@gmail.com) ונשלים אותה. הכרטיסייה שלכם באתר נשארת.', 'err');
    } else if (data.auth === 'kept') {
      setMsg('lgMsg', 'חשבון בעל המקצוע נמחק. הכניסה נשארת כי יש לכם חשבון נוסף באתר. הכרטיסייה שלכם באתר נשארת.', 'ok');
    } else {
      setMsg('lgMsg', 'החשבון נמחק, והפרטים האישיים והכניסה הוסרו. הכרטיסייה שלכם באתר נשארת.', 'ok');
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
    if (shelfCopy() && account.shelf_enabled) {
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
    if (!session) {
      showLogin();
      if (linkExpired) setMsg('lgMsg', 'הקישור במייל פג תוקף. בקשו שליחה חוזרת של מייל האימות מקישור העריכה של הכרטיסייה.', 'err');
      return;
    }
    if (inviteOpen) {
      // אימות המייל הצליח (ההפעלה נוצרה מהקישור), והחשבון עוד בלי סיסמה
      recovering = true;
      show('loginCard', false); show('app', false); show('recoverCard', true);
      el('rcTitle').textContent = 'הכתובת אומתה. קבעו סיסמה';
      return;
    }
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
      setMsg('lgMsg', 'אין חשבון בעל מקצוע לכתובת הזו. מי שנרשם/ה בכרטיסייה פותח/ת חשבון מקישור העריכה האישי (איבדתם אותו? הקישור "איבדתם את הקישור?" למטה).', 'err');
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
