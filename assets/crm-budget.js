/* ==========================================================================
   עלויות מול תקציב (שלב 7 בשדרוג האדמין, docs/platform-costs.md "תקציב")
   --------------------------------------------------------------------------
   בלוק בראש "עלויות תפעול ו-AI": ההוצאה של החודש מול התקציב בשלוש קטגוריות
   (AI, פרסום, תשתית), וההכנסות של החודש לצדה - כדי שהפער ייראה מיד
   (HANDOFF סעיף 10). ההוצאה והתקציב מהמסד (platform_budget_status), בשקלים,
   לפני מע״מ, בשער שנשמר שם - ולא בשער של הדפדפן שלמטה, כי לפיו גם יוצאות
   ההתראות של 80% ו-100%.

   **תקציב שלא אושר הוא הצעה.** הסכומים הראשונים חושבו ממוצע שלושת החודשים
   האחרונים; הם מסומנים "הצעה" ולא מתריעים עד ששומרים אותם.

   נטען לפני assets/crm.js ומשתמש בגלובלים שלו (sb, admEl, admBlock,
   admMoney, heErr, showToast) רק בזמן קריאה.
   ========================================================================== */

const BUDGET_LABELS = { ai: 'AI', ads: 'פרסום', infra: 'תשתית' };
const BUDGET_NOTES = {
  ai: 'Anthropic, מנוי Claude, fal, Gemini, OpenAI',
  ads: 'כל הערוצים: מטא, גוגל ומה שיתווסף',
  infra: 'Netlify, Supabase, Twilio, הדומיין ושאר הספקים',
};

function budgetTone(pct){
  return pct == null ? '' : pct >= 100 ? ' is-over' : pct >= 80 ? ' is-warn' : '';
}

/* ‏status - platform_budget_status; ‏revenue - הכנסות החודש (‏null = לא ידוע);
   ‏ads - admin_ads_spend, הפירוט של שורת הפרסום לכל ערוץ וקמפיין */
function costsBudgetBlock(status, revenue, ads){
  const block = admBlock('החודש מול התקציב',
    'חיובים מאושרים בלבד, בשקלים לפני מע״מ. התראה לפעמון ב-80% וב-100% של תקציב מאושר.');
  if (!status){
    block.appendChild(admEl('div', 'empty-state', 'התקציב עוד לא זמין במסד - המיגרציה 20270727090000 טרם רצה.'));
    return block;
  }
  const cats = status.categories || [];
  const spent = cats.reduce((s, c) => s + (Number(c.spent) || 0), 0);
  const top = admEl('div', 'bdg-top');
  top.appendChild(admEl('span', null, 'הוצאות החודש ' + admMoney(spent)));
  if (revenue != null){
    top.appendChild(admEl('span', null, 'הכנסות החודש ' + admMoney(revenue)));
    const gap = revenue - spent;
    top.appendChild(admEl('b', gap < 0 ? 'is-neg' : '', (gap < 0 ? 'פער ' : 'עודף ') + admMoney(Math.abs(gap))));
  }
  block.appendChild(top);

  cats.forEach(c => {
    const row = admEl('div', 'bdg-row');
    const head = admEl('div', 'bdg-head');
    const name = admEl('div', 'bdg-name', BUDGET_LABELS[c.key] || c.key);
    name.appendChild(admEl('small', null, BUDGET_NOTES[c.key] || ''));
    head.appendChild(name);
    const budget = c.budget == null ? null : Number(c.budget);
    head.appendChild(admEl('div', 'bdg-val' + budgetTone(c.pct),
      admMoney(Number(c.spent) || 0) + (budget ? ' מתוך ' + admMoney(budget) + ' (' + c.pct + '%)' : ' · בלי תקציב')));
    row.appendChild(head);
    if (budget){
      const bar = admEl('div', 'bdg-bar' + budgetTone(c.pct));
      const fill = admEl('span');
      fill.style.width = Math.min(100, Number(c.pct) || 0) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
    }
    // העריכה: הסכום, ושמירה שהיא גם האישור
    const edit = admEl('div', 'bdg-edit');
    const input = admEl('input');
    input.type = 'number'; input.min = '0'; input.step = '50';
    input.value = budget == null ? '' : String(budget);
    input.placeholder = 'בלי תקציב';
    input.setAttribute('aria-label', 'תקציב חודשי ל' + (BUDGET_LABELS[c.key] || c.key) + ' בשקלים');
    edit.appendChild(admEl('span', null, '₪'));
    edit.appendChild(input);
    const save = admEl('button', 'cst-act', c.approved ? 'שמירה' : 'אישור');
    save.type = 'button';
    save.addEventListener('click', () => budgetSave(c.key, input.value, save));
    edit.appendChild(save);
    if (!c.approved && budget != null){
      edit.appendChild(admEl('span', 'bdg-prop', 'הצעה לפי ממוצע 3 החודשים האחרונים. לא מתריעה עד האישור.'));
    }
    row.appendChild(edit);
    // הפרסום נמדד מהערוצים עצמם: הפירוט לכל ערוץ וקמפיין, בלחיצה
    if (c.key === 'ads' && ads && typeof adsSpendHtml === 'function'){
      const more = admEl('details', 'bdg-more');
      more.appendChild(admEl('summary', null, 'פירוט לפי ערוץ וקמפיין'));
      const inner = admEl('div');
      inner.innerHTML = adsSpendHtml(ads);
      more.appendChild(inner);
      row.appendChild(more);
    }
    block.appendChild(row);
  });

  const rate = admEl('div', 'cst-rate');
  rate.appendChild(admEl('span', null, 'שער הדולר לתקציב ולהתראות: ₪'));
  const rateIn = admEl('input');
  rateIn.type = 'number'; rateIn.step = '0.01'; rateIn.min = '1';
  rateIn.value = String(status.usd_rate || 3.7);
  rateIn.setAttribute('aria-label', 'שער הדולר בשקלים לתקציב');
  rateIn.addEventListener('change', () => budgetSave('usd_rate', rateIn.value, null));
  rate.appendChild(rateIn);
  block.appendChild(rate);
  return block;
}

async function budgetSave(key, raw, btn){
  const amount = String(raw).trim() === '' ? null : Number(raw);
  if (amount !== null && !(amount >= 0)){ showToast('סכום לא תקין'); return; }
  if (btn) btn.disabled = true;
  const { error } = await sb.rpc('platform_budget_set', { p_key: key, p_amount: amount });
  if (btn) btn.disabled = false;
  if (error){
    showToast(/budget_invalid/.test(error.message || '') ? 'הסכום מחוץ לטווח.' : heErr(error));
    return;
  }
  showToast(key === 'usd_rate' ? 'השער נשמר' : 'התקציב נשמר');
  if (typeof loadCostsReport === 'function') loadCostsReport();
}
