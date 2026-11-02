/* ==========================================================================
   דף הבית של הסוכן/ת - "לוח היום" (#homeBoard)
   --------------------------------------------------------------------------
   שלב 2 בשדרוג ה-CRM (docs/handoff/crm-redesign/HANDOFF.md, סעיף 2.6;
   docs/crm-home.md). בשלב 6 של העיצוב מחדש (3.0, docs/crm-home.md):

     0. "מחכה לך עכשיו"   - חמישה אריחים עם מונים (homeWaitTiles)
     1. לחזור אליהם קודם - שלושת הלידים הראשונים לפי סדר העדיפות של "הלידים
                            שלי" (leadsPriorityGroups), עם חיוג, וואטסאפ ו"למה עכשיו"
     2. היום שלי        - ציר זמן: באיחור, הבא בתור, סימון בוצע, והעברת
                            מה שבאיחור למחר (agendaMoveLateToTomorrow)
     3. איפה הלקוחות שלי - כמה לידים בכל שלב, השלב התקוע ושורת "מה לעשות"
     4. הנכסים שלי       - צפיות ופניות לכל נכס פעיל, ומה כדאי לעשות

   **אין כאן שום שאילתה.** כל מה שמוצג כבר בזיכרון מהטעינה של הדשבורד:
   allLeads / archivedLeadIds / leadWork (loadLeads), agendaItems
   (loadAgenda), myPropertyRows / propertyViewCounts (loadProperties) ו-
   priceOf (loadPricing). הלוח נבנה מחדש ב-refreshNavCounts, שכבר מתקבץ
   לבנייה אחת לפריים - כלומר בכל פעם שאחת הטעינות האלה מסתיימת.

   **חיוג או וואטסאפ לליד קוראים ל-markLeadResponded** - אחרת זמן התגובה
   לא נרשם (docs/office-dashboard.md). ליד נעול אינו נפתח מכאן: הלחיצה
   מובילה לכרטיס שלו, שם המחיר של הפתיחה גלוי לפני שמשלמים.

   הקובץ נטען לפני assets/crm.js, וכל הפונקציות כאן נקראות רק אחרי שהוא
   רץ - ולכן הגלובלים שלו (esc, dashIcon, gotoSection...) זמינים בזמן הקריאה.
   ========================================================================== */

const HOME_LEADS_MAX = 3;
const HOME_AGENDA_MAX = 4;
const HOME_PROPS_MAX = 3;
/* השלבים בצנרת, בסדר שבו ליד מתקדם. "לא רלוונטי / לא ענה" אינו שלב בדרך
   לעסקה, ולכן אינו עמודה - הוא נספר בשורה שמתחת. */
const HOME_PIPE = [
  ['new',       'חדש'],
  ['contacted', 'בקשר'],
  ['meeting',   'פגישה / סיור'],
  ['won',       'נסגר'],
];

function homeMine(lead){
  return !!(lead && currentAgent && lead.agent_id === currentAgent.id);
}

function homeActiveLeads(){
  if (typeof allLeads === 'undefined') return [];
  return allLeads.filter(l => homeMine(l) && !archivedLeadIds.has(l.id));
}

function homeStageOf(lead){
  const w = leadWork.get(lead.id);
  return (w && w.stage) || 'new';
}

function homeCard(id, title, linkText, onLink){
  const card = document.createElement('section');
  card.className = 'hb-card';
  card.id = id;
  card.setAttribute('aria-label', title);
  const head = document.createElement('div');
  head.className = 'hb-head';
  head.innerHTML = '<h3>' + esc(title) + '</h3>';
  if (linkText){
    const a = document.createElement('button');
    a.type = 'button';
    a.className = 'hb-link';
    a.textContent = linkText + ' ←';
    a.addEventListener('click', onLink);
    head.appendChild(a);
  }
  card.appendChild(head);
  return card;
}

/* ---------- לחזור אליהם קודם ----------
   אותו סדר של "הלידים שלי" (crm-leads.js): בעלים, נרכש, שיחה, אתר - ובתוך
   כל מקור החדש ביותר. ליד של אותו/ה פונה הוא שורה אחת. */
function homeLeadsCard(){
  if (!navAccVisible('accLeads')) return null;
  const groups = typeof leadsPriorityGroups === 'function' ? leadsPriorityGroups() : [];
  const card = homeCard('hbLeads', 'לחזור אליהם קודם',
    groups.length ? 'לכל הלידים' : '', ()=> gotoSection('accLeads'));
  if (!groups.length){
    card.insertAdjacentHTML('beforeend',
      '<p class="hb-empty">' + dashIcon('check') + '<span>אין ליד שמחכה לך עכשיו</span></p>');
    return card;
  }
  groups.slice(0, HOME_LEADS_MAX).forEach((g, i) => card.appendChild(homePriorityRow(g, i + 1)));
  const more = groups.length - HOME_LEADS_MAX;
  if (more > 0){
    card.insertAdjacentHTML('beforeend',
      '<p class="hb-more">ועוד ' + esc(plural(more, 'ליד אחד', 'לידים')) + ' ברשימה</p>');
  }
  return card;
}

function homePriorityRow(group, rank){
  const lead = group[0];
  const src = leadSrcKey(lead);
  const meta = LEAD_SRC[src];
  const call = leadCallById.get(lead.id);
  const unlocked = lead.status === 'unlocked';
  const excl = leadExclusiveEnd(lead);
  const name = lead.display_name || (call && call.extracted && call.extracted.caller_name)
    || (src === 'call' ? callLocalPhone(lead.display_phone) : 'ללא שם');
  const what = leadWants(lead, call) || [lead.property_type, lead.city].filter(Boolean).join(' · ');
  const hot = !!excl || (Date.now() - new Date(lead.created_at)) > 3 * 3600e3;
  const when = typeof leadWhen === 'function' ? leadWhen(lead.created_at) : { text: leadAgo(lead.created_at), title:'' };
  const why = (excl ? 'בלעדיות עוד ' + plural(Math.max(1, Math.ceil((excl - Date.now()) / 3600e3)), 'שעה', 'שעות')
    : when.text) + (leadStageOf(lead) === 'new' ? ' · עוד לא חזרת' : '');
  const row = document.createElement('div');
  row.className = 'hb-pr' + (leadStageOf(lead) === 'new' ? ' is-unread' : '');
  row.innerHTML =
      '<span class="hb-rank is-' + rank + '" aria-label="עדיפות ' + rank + '">' + rank + '</span>'
    + '<span class="hb-pr-text"><span class="hb-pr-top"><strong>' + (unlocked ? '' : '🔒 ') + '<bdi dir="auto">' + esc(name) + '</bdi></strong>'
    +   '<span class="ui-tag ui-tag--' + esc(meta.tone) + '">' + esc(meta.label) + '</span>'
    +   (typeof leadStageTagHtml === 'function' ? leadStageTagHtml(lead) : '') + '</span>'
    +   (what ? '<span class="hb-pr-what">' + esc(what) + '</span>' : '')
    +   '<span class="hb-pr-why' + (hot ? ' is-hot' : '') + '"' + (when.title ? ' title="' + esc(when.title) + '"' : '') + '>' + esc(why) + '</span></span>';
  const tel = String(lead.display_phone || '').replace(/[^\d+]/g, '');
  const wa = unlocked ? waLink(lead.display_phone) : null;
  const contacted = (kind)=>{
    if (typeof crmTrackLead === 'function') crmTrackLead(kind);
    markLeadResponded(lead);
    if (leadWorkReady && leadStageOf(lead) === 'new') saveLeadWork(lead, { stage:'contacted' });
  };
  const acts = document.createElement('div');
  acts.className = 'hb-pr-acts';
  if (unlocked && tel.replace(/\D/g, '').length >= 9){
    const a = document.createElement('a');
    a.className = 'hb-call';
    a.href = 'tel:' + tel;
    a.setAttribute('aria-label', 'חיוג אל ' + name);
    a.innerHTML = dashIcon('phone') + '<span class="hb-btxt">התקשרות</span>';
    a.addEventListener('click', () => contacted('call'));
    acts.appendChild(a);
  }
  if (wa){
    const a = document.createElement('a');
    a.className = 'hb-wa-btn';
    a.href = wa + '?text=' + encodeURIComponent(leadWhatsAppText(lead, leadPropertyContext(lead)));
    a.target = '_blank';
    a.rel = 'noopener';
    a.setAttribute('aria-label', 'וואטסאפ אל ' + name);
    a.innerHTML = waGlyph();
    a.addEventListener('click', () => contacted('whatsapp'));
    acts.appendChild(a);
  }
  if (unlocked && leadWorkReady && leadStageOf(lead) === 'new' && typeof leadMarkHandled === 'function'){
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'hb-done';
    done.textContent = 'טופל';
    done.setAttribute('aria-label', 'סימון הליד כטופל');
    done.addEventListener('click', () => leadMarkHandled(lead, currentAgent && currentAgent.id));
    acts.appendChild(done);
  }
  if (!unlocked || (!wa && tel.replace(/\D/g, '').length < 9)){
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hb-call';
    b.innerHTML = dashIcon('inbox') + '<span class="hb-btxt">' + (unlocked ? 'לליד' : 'לפתיחה') + '</span>';
    b.setAttribute('aria-label', (unlocked ? 'לכרטיס הליד של ' : 'פתיחת הליד של ') + name);
    b.addEventListener('click', ()=>{ gotoSection('accLeads'); openLeadFromParam(lead.id); });
    acts.appendChild(b);
  }
  if (acts.childElementCount) row.appendChild(acts);
  return row;
}

/* ---------- היום שלי ----------
   מה שפתוח עד סוף היום, כולל מה שבאיחור - אותו "היום" של agendaBuckets
   ושל המונה בבלוק "דורש טיפול מיידי". */
function homeAgendaCard(){
  if (!navAccVisible('accAgenda') || typeof agendaBuckets !== 'function') return null;
  const today = agendaBuckets().today
    .slice().sort((a, b) => (agendaDue(a) || 0) - (agendaDue(b) || 0));
  const late = today.filter(agendaIsLate);
  const card = homeCard('hbToday', 'היום שלי', 'ליומן', ()=> gotoSection('accAgenda'));
  if (today.length){
    card.querySelector('.hb-head h3').insertAdjacentHTML('afterend', '<span class="hb-head-sub">'
      + esc(plural(today.length, 'פריט אחד להיום', 'להיום') + (late.length ? ' · ' + late.length + ' באיחור' : '')) + '</span>');
  }
  if (!today.length){
    card.insertAdjacentHTML('beforeend',
      '<p class="hb-empty">' + dashIcon('calendar') + '<span>אין פגישות או משימות להיום</span></p>');
  }
  const canAct = typeof assistantTierOk !== 'function' || assistantTierOk();
  let nextSet = false;
  today.slice(0, HOME_AGENDA_MAX).forEach(it=>{
    const isLate = agendaIsLate(it);
    const next = !isLate && !nextSet;
    if (next) nextSet = true;
    const d = agendaDue(it);
    const row = document.createElement('div');
    row.className = 'hb-ag' + (isLate ? ' is-late' : '') + (next ? ' is-next' : '');
    row.innerHTML =
        '<span class="hb-ag-time">' + esc(d ? d.toLocaleTimeString('he-IL', { hour:'2-digit', minute:'2-digit' }) : '') + '</span>'
      + '<button type="button" class="hb-ag-text"><span class="hb-ag-top"><span class="hb-ag-t">' + esc(it.title || '') + '</span>'
      +   (isLate ? '<span class="hb-flag is-late">באיחור</span>' : next ? '<span class="hb-flag is-next">הבא בתור</span>' : '') + '</span>'
      +   (it.location ? '<span class="hb-ag-s">' + esc(it.location) + '</span>' : '') + '</button>';
    row.querySelector('.hb-ag-text').addEventListener('click', ()=> agendaFocus(it.id));
    if (canAct){
      const done = document.createElement('button');
      done.type = 'button';
      done.className = 'hb-check';
      done.setAttribute('aria-pressed', 'false');
      done.setAttribute('aria-label', 'סימון כבוצע: ' + (it.title || ''));
      done.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>';
      done.addEventListener('click', ()=>{
        done.disabled = true;
        done.setAttribute('aria-pressed', 'true');
        agendaUpdate(it.id, { status:'done' }, 'סומן כבוצע');
      });
      row.appendChild(done);
    }
    card.appendChild(row);
  });
  if (today.length > HOME_AGENDA_MAX){
    card.insertAdjacentHTML('beforeend', '<p class="hb-more">ועוד '
      + esc(plural(today.length - HOME_AGENDA_MAX, 'פריט אחד', 'פריטים')) + ' ביומן</p>');
  }
  const foot = document.createElement('div');
  foot.className = 'hb-ag-foot';
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'hb-add';
  add.textContent = '+ פגישה או משימה';
  add.addEventListener('click', ()=> openAgendaForm({ kind:'meeting' }));
  foot.appendChild(add);
  if (canAct && late.length){
    const move = document.createElement('button');
    move.type = 'button';
    move.className = 'hb-add is-quiet';
    move.textContent = late.length === 1 ? 'העברת הפריט שבאיחור למחר' : `העברת ${late.length} הבאיחור למחר`;
    move.addEventListener('click', ()=> agendaMoveLateToTomorrow(move));
    foot.appendChild(move);
  }
  card.appendChild(foot);
  return card;
}

/* "להעביר את כל האיחורים למחר" (3.0, 3.20): כל פריט פתוח שמועדו עבר עובר
   למחר, באותה שעה (agendaPostpone 'tomorrow'). עדכון לכל פריט, וטעינה
   אחת בסוף. התזכורות ללקוח/ה נבנות מהמועד בזמן השליחה (meeting-followup),
   ולכן הן זזות יחד עם הפריט. */
async function agendaMoveLateToTomorrow(btn){
  const late = (agendaItems || []).filter(agendaIsLate);
  if (!late.length) return;
  if (!confirm(late.length === 1 ? 'להעביר את הפריט שבאיחור למחר?' : `להעביר ${late.length} פריטים שבאיחור למחר, באותה שעה?`)) return;
  if (btn) btn.disabled = true;
  const tomorrow = agendaDayStart(1);
  const results = await Promise.all(late.map(it => {
    const next = new Date(agendaDue(it));
    next.setFullYear(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
    return sb.from('agent_agenda_items').update({ due_at: next.toISOString() }).eq('id', it.id);
  }));
  const failed = results.filter(r => r.error).length;
  showToast(failed ? `${late.length - failed} הועברו למחר, ${failed} לא הועברו - כדאי לנסות שוב`
    : plural(late.length, 'פריט אחד הועבר', 'פריטים הועברו') + ' למחר');
  await loadAgenda();
}

/* ---------- איפה הלקוחות שלי ----------
   הלידים הפעילים שלי לפי השלב ב-lead_work. ליד בלי שורה שם הוא "חדש" -
   אותה ברירת מחדל של הבורר בכרטיס. רק כשהטבלה קיימת (leadWorkReady). */
function homePipelineCard(){
  if (!navAccVisible('accLeads') || !leadWorkReady) return null;
  const leads = homeActiveLeads();
  if (!leads.length) return null;
  const counts = {};
  leads.forEach(l => { const s = homeStageOf(l); counts[s] = (counts[s] || 0) + 1; });
  const max = Math.max(1, ...HOME_PIPE.map(([k]) => counts[k] || 0));
  const card = homeCard('hbPipe', 'איפה הלקוחות שלי', 'ללידים', ()=> gotoSection('accLeads'));
  const grid = document.createElement('div');
  grid.className = 'hb-pipe';
  HOME_PIPE.forEach(([key, label])=>{
    const n = counts[key] || 0;
    grid.insertAdjacentHTML('beforeend',
      '<div class="hb-stage hb-st-' + key + '"><span class="hb-stage-n">' + esc(String(n)) + '</span>'
      + '<span class="hb-stage-l">' + esc(label) + '</span>'
      + '<span class="hb-stage-bar"><span style="height:' + Math.round(n / max * 100) + '%"></span></span></div>');
  });
  card.appendChild(grid);
  /* השלב התקוע: החדש כשיש בו לידים (הצעד הבא תמיד בידיים שלך), ואחרת השלב
     שהכי הרבה לידים עומדים בו לפני הסגירה */
  const stuck = counts.new ? 'new'
    : ['contacted', 'meeting'].sort((a, b) => (counts[b] || 0) - (counts[a] || 0)).find(k => counts[k]);
  if (stuck){
    grid.querySelector('.hb-st-' + stuck).classList.add('is-stuck');
    const n = counts[stuck];
    const advice = {
      new: [plural(n, 'ליד אחד עדיין בשלב "חדש".', 'לידים עדיין בשלב "חדש".'), 'שיחה ראשונה מעבירה אותם ל"בקשר" ומשפרת את הסיכוי לסגירה.'],
      contacted: [plural(n, 'ליד אחד בקשר בלי פגישה.', 'לידים בקשר בלי פגישה.'), 'הצעה לסיור או לפגישה היא הצעד הבא.'],
      meeting: [plural(n, 'ליד אחד אחרי פגישה.', 'לידים אחרי פגישה.'), 'שיחת המשך היום שומרת על המומנטום.'],
    }[stuck];
    card.insertAdjacentHTML('beforeend', '<p class="hb-advice"><strong>' + esc(advice[0]) + '</strong><span>' + esc(advice[1]) + '</span></p>');
  }
  const off = counts.not_relevant || 0;
  if (off){
    card.insertAdjacentHTML('beforeend', '<p class="hb-more">'
      + esc(plural(off, 'ליד אחד סומן', 'לידים סומנו')) + ' "לא רלוונטי / לא ענה"</p>');
  }
  return card;
}

/* ---------- הנכסים שלי ----------
   הצפיות הן המונה המצטבר מכרטיס הנכס (property_view_counts), והפניות הן
   הלידים שלי על הנכס - שני המספרים שהכרטיס עצמו כבר מציג. אין כאן חלון
   של 7 ימים כמו בעיצוב, כי אין מקור כזה בלי שאילתה חדשה.
   המוביל מסומן, ולשני האחרים - הפעולה שמתאימה להם: נכס בלי תמונות מקבל
   "להוספת תמונות", ונכס בלי פניות - "לקידום". שתיהן פותחות את הכרטיס,
   שם הכפתורים עצמם עם המחיר של היום. */
function homePropsCard(){
  if (!navAccVisible('accProperties') || typeof myPropertyRows === 'undefined') return null;
  const active = myPropertyRows.filter(p => p.status === 'active' && homeMine(p));
  if (!active.length) return null;
  const inquiries = {};
  homeActiveLeads().forEach(l => { if (l.property_id) inquiries[l.property_id] = (inquiries[l.property_id] || 0) + 1; });
  const score = p => (propertyViewCounts[p.id] || 0) + 20 * (inquiries[p.id] || 0);
  const sorted = active.slice().sort((a, b) => score(b) - score(a));
  const leader = sorted[0];
  const noPhotos = active.find(p => !(p.images || []).length);
  const quiet = sorted.slice().reverse().find(p => p !== leader && p !== noPhotos && !(inquiries[p.id] || 0));
  const pick = [leader, noPhotos, quiet].filter((p, i, arr) => p && arr.indexOf(p) === i).slice(0, HOME_PROPS_MAX);

  const card = homeCard('hbProps', 'הנכסים שלי', 'לכל הנכסים', ()=> gotoSection('accProperties'));
  pick.forEach(p=>{
    const views = propertyViewCounts[p.id] || 0;
    const inq = inquiries[p.id] || 0;
    const missing = !(p.images || []).length;
    let tag = '', cta = '';
    if (p === leader && score(p) > 0) tag = '<span class="hb-tag is-ok">מוביל</span>';
    else if (missing) cta = 'להוספת תמונות';
    else if (!inq) cta = 'לקידום';
    const row = document.createElement('div');
    row.className = 'hb-prop';
    row.innerHTML =
        '<span class="hb-prop-text"><span class="hb-prop-t">' + esc(p.title || p.address || 'נכס') + '</span>'
      + '<span class="hb-prop-s">' + esc(missing ? 'חסרות תמונות'
          : plural(views, 'צפייה אחת', 'צפיות') + ' · ' + plural(inq, 'פנייה אחת', 'פניות')) + '</span></span>'
      + tag;
    if (cta){
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hb-btn';
      b.textContent = cta;
      b.addEventListener('click', ()=>{ gotoSection('accProperties'); openPropertyFromParam(p.id); });
      row.appendChild(b);
    } else {
      row.classList.add('is-click');
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      const open = ()=>{ gotoSection('accProperties'); openPropertyFromParam(p.id); };
      row.addEventListener('click', open);
      row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); open(); } });
    }
    card.appendChild(row);
  });
  return card;
}

/* ---------- מחכה לך עכשיו (3.0) ----------
   חמישה אריחים מאותם מונים של התפריט (accCounts), כדי שהמספר כאן והמספר
   בסרגל יהיו אותו מספר. כתום ("hot") רק למה שדורש פעולה ממך עכשיו - לידים
   חדשים ומשימות באיחור. התאמות לא בכתום: 60 התאמות בעיגול אדום הן עייפות
   התראות, לא דחיפות. */
function homeWaitData(){
  const late = navAccVisible('accAgenda') && typeof agendaBuckets === 'function'
    ? agendaBuckets().today.filter(agendaIsLate) : [];
  const todayLeft = navAccVisible('accAgenda') && typeof agendaBuckets === 'function'
    ? agendaBuckets().today.length - late.length : 0;
  const fresh = typeof leadsPriorityGroups === 'function' ? leadsPriorityGroups() : [];
  const oldest = fresh.map(g => g[0]).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
  // ‏agrCountable: בלי טופס ההסכמה לשיווק, שהבלעדיות שלו כבר נספרת
  const drafts = typeof agrCountable === 'function' ? agrCountable().filter(a => a.status === 'draft').length : 0;
  const matches = accCountOf('accAlerts');
  const shelf = accCountOf('accLeadShelf');
  return [
    { acc:'accLeads', n: accCountOf('accLeads'), label:'לידים חדשים', icon:'inbox', tone:'hot',
      hint: oldest ? 'הוותיק מחכה ' + leadAgo(oldest.created_at).replace(/^לפני /, '') : 'אין ליד שמחכה' },
    { acc:'accAgenda', n: late.length, label:'משימות באיחור', icon:'calendar', tone:'hot',
      hint: todayLeft ? 'ועוד ' + todayLeft + ' ביומן להיום' : 'היומן של היום פנוי' },
    { acc:'accAgreements', n: drafts, label:'הסכמים לשליחה', icon:'sign', tone:'warn', hint:'נוצרו ולא נשלחו' },
    { acc:'accAlerts', n: matches, label:'התאמות חדשות', icon:'target', tone:'calm', hint:'נכסים ללקוחות שלך' },
    { acc:'accLeadShelf', n: shelf, label:'ליד בחנות', icon:'store', tone:'calm', hint:'לידים טריים לרכישה' },
  ].filter(t => navAccVisible(t.acc));
}

/* פגישות של היום (יומן), נכס שתוקף המודעה שלו נגמר בקרוב, ובלעדיות
   שמסתיימת בשבועיים. הכל מנתונים שכבר בזיכרון. שורה עם אפס לא נכנסת. */
function homeMeetingsToday(){
  if (typeof agendaItems === 'undefined' || typeof agendaDayStart !== 'function' || typeof agendaDue !== 'function') return [];
  const start = agendaDayStart(0), end = agendaDayStart(1);
  return agendaItems.filter(it => {
    if (it.status !== 'open' || (it.kind !== 'meeting' && it.kind !== 'showing')) return false;
    const d = agendaDue(it);
    return d && d >= start && d < end;
  });
}

function homeExpiringProps(){
  if (typeof myPropertyRows === 'undefined' || typeof propertyIsExpiring !== 'function') return [];
  return myPropertyRows.filter(p => p.status === 'active' && homeMine(p) && propertyIsExpiring(p));
}

function homeExclusivitySoon(){
  if (typeof myPropertyRows === 'undefined' || typeof exclusivityDaysLeft !== 'function') return [];
  return myPropertyRows.filter(p => {
    if (p.status !== 'active' || !homeMine(p)) return false;
    const d = exclusivityDaysLeft(p);
    return d !== null && d >= 0 && d <= 14;
  });
}

function homeNavOk(acc){
  return typeof navAccVisible !== 'function' || navAccVisible(acc);
}

/* שורות תמונת המצב מתחת לברכה. רק מה שיש לו מספר וגם מסך שאליו ללכת. */
function homeSummaryItems(){
  const rows = [];
  if (homeNavOk('accLeads') && typeof accCountOf === 'function'){
    const n = accCountOf('accLeads') || 0;
    if (n > 0) rows.push({ key:'leads', label: plural(n, 'ליד אחד חדש', 'לידים חדשים') });
  }
  if (homeNavOk('accAgenda')){
    const meetings = homeMeetingsToday().length;
    if (meetings > 0) rows.push({ key:'meetings', label: plural(meetings, 'פגישה אחת היום', 'פגישות היום') });
    const late = typeof agendaBuckets === 'function' ? agendaBuckets().today.filter(agendaIsLate).length : 0;
    if (late > 0) rows.push({ key:'late', label: plural(late, 'משימה אחת באיחור', 'משימות באיחור') });
  }
  if (homeNavOk('accProperties')){
    const expiring = homeExpiringProps().length;
    if (expiring > 0) rows.push({ key:'expiring', label: plural(expiring, 'נכס אחד עומד לפוג', 'נכסים עומדים לפוג') });
    const excl = homeExclusivitySoon().length;
    if (excl > 0) rows.push({ key:'exclusive', label: plural(excl, 'בלעדיות אחת מסתיימת', 'בלעדיות מסתיימות') });
  }
  return rows;
}

function crmTrackHome(item){
  const params = { summary_item: item };
  try {
    if (typeof window.shukTrack === 'function'){
      window.shukTrack('crm_home_summary', params);
      return;
    }
    window.dataLayer = window.dataLayer || [];
    const path = ((location.pathname || '').split('/').pop() || 'crm').replace(/\.html$/, '') || 'crm';
    window.dataLayer.push({ event: 'crm_home_summary', page_type: path, summary_item: item });
  } catch (e) { /* מדידה לא חוסמת ניווט */ }
}

function homeSummaryGo(key){
  crmTrackHome(key);
  if (key === 'leads'){
    if (typeof leadsTab !== 'undefined'){ leadsTab = 'new'; leadsSrc = 'all'; leadsShown = typeof LEADS_STEP === 'number' ? LEADS_STEP : 3; }
    gotoSection('accLeads');
    if (typeof renderLeads === 'function' && currentAgent) renderLeads(currentAgent.id);
    return;
  }
  if (key === 'meetings' || key === 'late'){
    if (typeof agendaTab !== 'undefined') agendaTab = 'today';
    gotoSection('accAgenda');
    if (typeof renderAgenda === 'function') renderAgenda();
    return;
  }
  if (key === 'expiring' && typeof openPropertyFilterFromParam === 'function'){
    gotoSection('accProperties');
    openPropertyFilterFromParam('expiring');
    return;
  }
  if (key === 'exclusive' && typeof PROP_FILTER_IDS !== 'undefined'){
    PROP_FILTER_IDS.forEach(fid => { const el = document.getElementById(fid); if (el) el.value = ''; });
    if (typeof propOwnerTab === 'function') propOwnerTab('mine');
    const status = document.getElementById('propStatusFilter');
    const smart = document.getElementById('propSmartFilter');
    if (status) status.value = 'active';
    if (smart) smart.value = 'excl';
    gotoSection('accProperties');
    if (typeof renderPropertiesFromTop === 'function') renderPropertiesFromTop();
  }
}

function homeWaitTiles(){
  const host = document.getElementById('homeWait');
  if (!host) return;
  const tiles = homeWaitData().filter(t => t.n > 0);
  host.hidden = !tiles.length;
  host.querySelector('.hm-wait').innerHTML = tiles.map(t => {
    const on = t.n > 0;
    return `<button type="button" class="hm-tile is-${on ? t.tone : 'calm'}${on ? '' : ' is-zero'}" data-goto="${t.acc}"`
      + ` aria-label="${esc(t.label + ': ' + t.n)}">`
      + `<span class="hm-tile-top"><span class="hm-tile-ico">${dashIcon(t.icon)}</span><span class="hm-tile-n">${esc(String(t.n))}</span></span>`
      + `<span class="hm-tile-l">${esc(t.label)}</span><span class="hm-tile-h">${esc(t.hint)}</span></button>`;
  }).join('');
}

/* מתחת ל"הנה תמונת המצב שלך להיום": שורות לחיצות, רק כשיש מה לספור.
   הברכה עצמה ומשפטי המוטיבציה (GREETINGS) לא משתנים. */
function homeBrief(){
  const el = document.getElementById('dashBrief');
  if (!el) return;
  if (!el.dataset.bound){
    el.dataset.bound = '1';
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-home-sum]');
      if (!b) return;
      homeSummaryGo(b.dataset.homeSum);
    });
  }
  const rows = homeSummaryItems();
  el.hidden = !rows.length;
  el.innerHTML = rows.map(r =>
    `<button type="button" class="hm-sum" data-home-sum="${esc(r.key)}">`
    + `<span>${esc(r.label)}</span><span class="hm-sum-go" aria-hidden="true">←</span></button>`).join('');
  const date = document.getElementById('hmDate');
  if (date) date.textContent = new Date().toLocaleDateString('he-IL', { weekday:'long', day:'numeric', month:'numeric' });
}

/* הצעדים שהמנטור ממליץ להיום - צ'יפים בכרטיס הגיבור. אותו "בוצע" של
   השכבה (data-coach-done, crm-coach.js) */
function homeMentorSteps(){
  const box = document.getElementById('hmSteps');
  if (!box) return;
  const row = typeof coachState !== 'undefined' ? coachState.agent : null;
  const s = row && row.summary;
  const acts = s && s.v === 2 ? (s.actions || []).slice(0, 3) : [];
  box.hidden = !acts.length;
  if (!acts.length) return;
  const done = new Set((row.actions_done || []).map(Number));
  box.innerHTML = '<span class="hm-steps-h">הצעדים שהמנטור ממליץ להיום:</span>'
    + acts.map((a, i) => `<button type="button" class="hm-step" data-coach-done="agent" data-coach-i="${i}" aria-pressed="${done.has(i)}"`
      + ` aria-label="${esc((done.has(i) ? 'בוצע: ' : 'סימון כבוצע: ') + (a.title || ''))}"><span class="hm-step-box" aria-hidden="true">${done.has(i) ? '✓' : ''}</span>${esc(a.title || '')}</button>`).join('');
}

function renderHomeBoard(){
  // כפתור "המנטור" - לפי מה שנטען עד עכשיו (assets/crm-coach.js)
  if (typeof homeCoachSync === 'function') homeCoachSync();
  const host = document.getElementById('homeBoard');
  if (!host) return;
  if (dashView !== 'agent' || !currentAgent){ host.hidden = true; return; }
  const cards = [homeLeadsCard(), homeAgendaCard(), homePipelineCard(), homePropsCard()].filter(Boolean);
  host.innerHTML = '';
  cards.forEach(c => host.appendChild(c));
  host.hidden = !cards.length;
  homeWaitTiles();
  homeMentorSteps();
  homeBrief();
}
if (typeof currentAgent !== 'undefined' && currentAgent && document.getElementById('homeBoard')) renderHomeBoard();
