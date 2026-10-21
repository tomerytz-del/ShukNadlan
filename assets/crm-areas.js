/* ==========================================================================
   תחום ואזורי פעילות - רכיב אחד לפרופיל הסוכן/ת ולדף המשרד
   --------------------------------------------------------------------------
   docs/area-scope.md; העיצוב: docs/handoff/crm-settings-redesign, סעיף 3.22.

   שני שלבים: באילו נכסים (פרטיים / מסחריים ותעשייה / הכל), ובאילו אזורים
   (השווקים מ-assets/markets.js, בשלוש קבוצות). מתחת - משפט כהה שאומר במה
   ישתפו אותך, כדי שהבחירה תהיה מובנת בלי לקרוא הסבר.

   ‏**משרד וסוכן/ת מתמזגים** (החלטה של תומר, 20.10.2026): אזורי המשרד חלים על
   כל הסוכנים, וכל סוכן/ת מוסיף/ה עליהם. סוג הנכס של הסוכן/ת גובר כשנבחר;
   כשלא נבחר (property_scope = null) - של המשרד. לכן בפרופיל אזורי המשרד
   מוצגים מסומנים ונעולים, עם התגית "מהמשרד".

   ‏AreaPicker.mount(host, { scope:'agent'|'office', prefix }) מחזיר:
     set({ kind, markets, office:{ kind, markets } })  - kind null = כמו המשרד
     read() -> { kind, markets }   - kind null אם לא נגעו בסוג ונשאר כמו המשרד
   ושולח input מה-host בכל שינוי, כמו שדה רגיל.

   הקובץ נטען לפני assets/crm.js; נשען על ShukMarkets ועל crm-ui.js.
   ========================================================================== */

/* שלוש הקבוצות. ‏markets.js אינו נושא אזור, והרשימה כאן היא המקום היחיד
   שבו הוא נקבע. שוק חדש שלא נרשם כאן נכנס ל"עוד אזורים" - הוא לא נעלם */
const AREA_REGIONS = [
  { key:'north', name:'צפון', slugs:['afula-emek', 'nof-hagalil-migdal', 'beit-shean', 'yokneam', 'tiberias', 'haifa', 'krayot',
    'akko-nahariya', 'karmiel-misgav', 'safed', 'kiryat-shmona', 'golan'] },
  { key:'center', name:'מרכז', slugs:['hadera', 'netanya', 'kfar-saba-raanana', 'herzliya', 'tel-aviv', 'ramat-gan', 'bnei-brak-elad',
    'petah-tikva', 'holon-bat-yam', 'rishon', 'rehovot', 'modiin', 'lod-ramla', 'jerusalem', 'beit-shemesh', 'samaria', 'binyamin', 'gush-etzion'] },
  { key:'south', name:'דרום', slugs:['ashdod', 'ashkelon', 'kiryat-gat', 'sderot-netivot', 'beer-sheva', 'dimona-arad', 'eilat'] },
];

const AREA_KINDS = [
  { id:'private',    label:'נכסים פרטיים בלבד',     hint:'דירות, בתים פרטיים, דירות גן ומגרשים למגורים', phrase:'בנכסים פרטיים בלבד' },
  { id:'commercial', label:'מסחריים ותעשייה בלבד', hint:'חנויות, משרדים, מבני תעשייה ולוגיסטיקה',      phrase:'בנכסים מסחריים ובתעשייה בלבד' },
  { id:'all',        label:'כל סוגי הנכסים',        hint:'פרטיים, מסחריים ותעשייה',                     phrase:'בכל סוגי הנכסים' },
];

function areaMarketList(){
  return (window.ShukMarkets && Array.isArray(window.ShukMarkets.list)) ? window.ShukMarkets.list : [];
}

function areaRegions(){
  const list = areaMarketList();
  const bySlug = new Map(list.map(m => [m.slug, m]));
  const placed = new Set();
  const regions = AREA_REGIONS.map(r => {
    const items = r.slugs.filter(s => bySlug.has(s)).map(s => { placed.add(s); return bySlug.get(s); });
    return { key:r.key, name:r.name, items };
  });
  const rest = list.filter(m => !placed.has(m.slug));
  if (rest.length) regions.push({ key:'other', name:'עוד אזורים', items:rest });
  return regions.filter(r => r.items.length);
}

/* "עפולה והעמק, חיפה ותל אביב" / "כל הצפון ועפולה" */
function areaJoin(parts){
  if (parts.length <= 1) return parts[0] || '';
  return parts.slice(0, -1).join(', ') + ' ו' + parts[parts.length - 1];
}

const AreaPicker = {
  mount(host, { scope = 'agent', prefix = 'ap' } = {}){
    const office = scope === 'office';
    const regions = areaRegions();
    const labelOf = new Map(areaMarketList().map(m => [m.slug, m.label]));
    let state = { kind:'all', markets:[], office:{ kind:'all', markets:[] }, kindTouched:false, inherited:false };
    let openRegion = null;

    const subtitle = office
      ? 'סוגי הנכסים והאזורים שבהם המשרד פועל. הם חלים על כל סוכני המשרד, וכל סוכן/ת יכול/ה להוסיף אזורים משלו/ה.'
      : 'לפיהם נקבע במה משתפים אותך ועל מה מגיעה התראה. בנוסף, בכל אזור שתבחר/י הדף שלך מופיע באתר.';

    host.classList.add('ui-scope', 'area-picker');
    host.innerHTML =
      `<p class="ui-hint"><span>${escapeHtml(subtitle)}</span></p>`
      + `<div class="set-field"><span class="set-field-label" id="${prefix}KindLabel">באילו נכסים</span>`
      + `<div class="area-kinds" role="radiogroup" aria-labelledby="${prefix}KindLabel">`
      + AREA_KINDS.map(k => `<button type="button" class="np2-preset" role="radio" aria-checked="false" data-area-kind="${k.id}">`
          + `<span class="np2-dot" aria-hidden="true"></span><span><span class="np2-preset-t">${escapeHtml(k.label)}</span>`
          + `<span class="np2-preset-h">${escapeHtml(k.hint)}</span></span></button>`).join('')
      + `</div><p class="ui-hint area-inherit" data-area-inherit hidden></p></div>`
      + `<div class="set-field"><span class="set-field-label">באילו אזורים</span>`
      + `<div class="area-selected" data-area-selected></div>`
      + `<div class="area-regions">`
      + regions.map(r => `<section class="ui-fold np2-group" data-area-region="${r.key}">`
          + `<div class="ui-fold-head"><div class="ui-fold-title"><div><h4 class="ui-h3">${escapeHtml(r.name)}</h4>`
          + `<div class="ui-fold-summary">${r.items.length} אזורים</div></div></div>`
          + `<div class="ui-fold-tools"><span class="ui-tag ui-tag--accent" data-area-n hidden></span>`
          + `<button type="button" class="ui-icon-btn" data-area-fold aria-expanded="false" aria-controls="${prefix}R-${r.key}" aria-label="פתיחה וסגירה: ${escapeHtml(r.name)}">${UI_ICON_CHEV}</button></div></div>`
          + `<div class="ui-fold-body" id="${prefix}R-${r.key}" hidden>`
          + `<div class="set-group-head"><span class="set-group-line" aria-hidden="true"></span><button type="button" class="ui-link" data-area-all></button></div>`
          + `<div class="ui-chips">${r.items.map(m => uiChip(m.label, { value:m.slug })).join('')}</div>`
          + `</div></section>`).join('')
      + `</div></div>`
      + `<div class="area-summary" data-area-summary role="status"></div>`;

    const q = sel => host.querySelector(sel);
    const officeSet = () => new Set(office ? [] : state.office.markets);
    const effectiveKind = () => state.kind || state.office.kind || 'all';

    function paint(){
      const kind = effectiveKind();
      host.querySelectorAll('[data-area-kind]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.areaKind === kind)));
      const inh = q('[data-area-inherit]');
      inh.hidden = office || !state.inherited || state.kindTouched;
      inh.textContent = 'כרגע לפי המשרד. בחירה כאן תחול רק עליך.';

      const fromOffice = officeSet();
      const mine = new Set(state.markets);
      host.querySelectorAll('[data-area-region] [data-ui-chip]').forEach(c => {
        const s = c.dataset.value;
        const locked = fromOffice.has(s);
        c.setAttribute('aria-pressed', String(locked || mine.has(s)));
        c.disabled = locked;
        c.title = locked ? 'מאזורי המשרד' : '';
      });
      host.querySelectorAll('[data-area-region]').forEach(sec => {
        const chips = [...sec.querySelectorAll('[data-ui-chip]')];
        const on = chips.filter(c => c.getAttribute('aria-pressed') === 'true').length;
        const n = sec.querySelector('[data-area-n]');
        n.hidden = !on;
        n.textContent = on === chips.length ? 'כל ה' + sec.querySelector('h4').textContent : `${on} נבחרו`;
        const free = chips.filter(c => !c.disabled);
        const allOn = free.every(c => c.getAttribute('aria-pressed') === 'true');
        const btn = sec.querySelector('[data-area-all]');
        btn.textContent = allOn ? 'ניקוי' : 'כל ה' + sec.querySelector('h4').textContent;
        btn.hidden = !free.length;
      });

      // "נבחרו X": של המשרד (נעולים) ושלי (להסרה)
      const all = [...fromOffice, ...state.markets.filter(s => !fromOffice.has(s))];
      q('[data-area-selected]').innerHTML = all.length
        ? `<span class="ui-count">נבחרו ${all.length}:</span>`
          + [...fromOffice].map(s => `<span class="ui-tag ui-tag--navy">${escapeHtml(labelOf.get(s) || s)} · מהמשרד</span>`).join('')
          + state.markets.filter(s => !fromOffice.has(s)).map(s =>
              `<button type="button" class="ui-tag ui-tag--accent area-remove" data-area-remove="${escapeHtml(s)}" aria-label="הסרת ${escapeHtml(labelOf.get(s) || s)}">${escapeHtml(labelOf.get(s) || s)} ✕</button>`).join('')
        : '<span class="ui-count">עוד לא נבחר אזור</span>';

      // המשפט הכהה
      const sel = new Set(all);
      const fullRegions = regions.filter(r => r.items.every(m => sel.has(m.slug)));
      const fullSlugs = new Set(fullRegions.flatMap(r => r.items.map(m => m.slug)));
      const parts = fullRegions.map(r => 'כל ה' + r.name).concat(all.filter(s => !fullSlugs.has(s)).map(s => labelOf.get(s) || s));
      const k = AREA_KINDS.find(x => x.id === kind);
      const who = office ? 'סוכני המשרד ישותפו ' : 'יגיעו אליך שיתופים ';
      let text = parts.length
        ? who + k.phrase + ', ב' + areaJoin(parts.slice(0, 6)) + (parts.length > 6 ? ` ועוד ${parts.length - 6}` : '') + '.'
        : (office ? 'בלי אזורים, סוכני המשרד ישותפו בכל הארץ ' : 'בלי אזורים, יגיעו אליך שיתופים מכל הארץ ') + k.phrase + '.';
      if (kind === 'commercial') text += office ? ' הם לא ישותפו בנכסים פרטיים (דירות ובתים).' : ' שיתופים בנכסים פרטיים (דירות ובתים) לא יגיעו אליך.';
      if (kind === 'private') text += office ? ' הם לא ישותפו בנכסים מסחריים ובתעשייה.' : ' שיתופים בנכסים מסחריים ובתעשייה לא יגיעו אליך.';
      q('[data-area-summary]').textContent = text;
    }

    const changed = () => { paint(); host.dispatchEvent(new Event('input', { bubbles:true })); };

    host.addEventListener('click', e => {
      const kindBtn = e.target.closest('[data-area-kind]');
      if (kindBtn){ state.kind = kindBtn.dataset.areaKind; state.kindTouched = true; changed(); return; }
      const fold = e.target.closest('[data-area-fold]');
      const head = !fold && !e.target.closest('button') && e.target.closest('[data-area-region] .ui-fold-head');
      if (fold || head){
        const sec = e.target.closest('[data-area-region]');
        const key = sec.dataset.areaRegion;
        openRegion = openRegion === key ? null : key;
        host.querySelectorAll('[data-area-region]').forEach(s => {
          const open = s.dataset.areaRegion === openRegion;
          s.classList.toggle('is-open', open);
          s.querySelector('[data-area-fold]').setAttribute('aria-expanded', String(open));
          s.querySelector('.ui-fold-body').hidden = !open;
        });
        return;
      }
      const all = e.target.closest('[data-area-all]');
      if (all){
        const sec = all.closest('[data-area-region]');
        const free = [...sec.querySelectorAll('[data-ui-chip]:not(:disabled)')].map(c => c.dataset.value);
        const allOn = free.every(s => state.markets.includes(s));
        state.markets = allOn ? state.markets.filter(s => !free.includes(s)) : [...new Set(state.markets.concat(free))];
        changed();
        return;
      }
      const rm = e.target.closest('[data-area-remove]');
      if (rm){ state.markets = state.markets.filter(s => s !== rm.dataset.areaRemove); changed(); }
    });
    // הצ'יפ עצמו מסומן במאזין של crm-ui.js; כאן רק מסנכרנים את המצב
    host.addEventListener('input', e => {
      const chip = e.target.closest && e.target.closest('[data-area-region] [data-ui-chip]');
      if (!chip) return;
      const s = chip.dataset.value;
      state.markets = chip.getAttribute('aria-pressed') === 'true'
        ? [...new Set(state.markets.concat(s))] : state.markets.filter(x => x !== s);
      paint();
    });

    const api = {
      set({ kind = null, markets = [], office: off = null } = {}){
        const o = off || { kind:'all', markets:[] };
        state = {
          kind: kind || null,
          markets: (markets || []).filter(s => !(scope === 'agent' && (o.markets || []).includes(s))),
          office: { kind: o.kind || 'all', markets: o.markets || [] },
          kindTouched: false,
          inherited: scope === 'agent' && !kind,
        };
        if (office && !state.kind) state.kind = 'all';
        // האזור הפתוח: הראשון שיש בו בחירה, אחרת סגור
        const sel = new Set(state.markets.concat(scope === 'agent' ? state.office.markets : []));
        const first = regions.find(r => r.items.some(m => sel.has(m.slug)));
        openRegion = first ? first.key : null;
        host.querySelectorAll('[data-area-region]').forEach(s => {
          const open = s.dataset.areaRegion === openRegion;
          s.classList.toggle('is-open', open);
          s.querySelector('[data-area-fold]').setAttribute('aria-expanded', String(open));
          s.querySelector('.ui-fold-body').hidden = !open;
        });
        paint();
      },
      read(){
        // סוכן/ת שלא נגע/ה בסוג ולא היה לו/ה סוג משלו/ה - נשאר/ת "כמו המשרד"
        const kind = scope === 'agent' && state.inherited && !state.kindTouched ? null : (state.kind || 'all');
        return { kind, markets: state.markets.slice().sort() };
      },
      host,
    };
    paint();
    return api;
  },
};
