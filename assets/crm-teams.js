/* ==========================================================================
   צוותים בתוך המשרד - "צוותים וסוכנים" (accTeam)
   --------------------------------------------------------------------------
   שלב 3 בשדרוג ה-CRM (docs/handoff/crm-redesign/HANDOFF.md, סעיף 3.4;
   docs/teams.md). מנהל/ת המשרד יוצר/ת צוותים, משייך/ת אליהם סוכנים, ממנה
   מנהל/ת לכל צוות, ומסמן/ת מנהל/ת שאינו/ה עובד/ת כמתווך/ת ("גם סוכן/ת
   פעיל/ה").

   **הכול דרך ה-RLS**, כמו מינוי מנהל/ת (setMemberRole): ‏agency_teams פתוחה
   לכתיבה למנהל/ת המשרד בלבד, ו-protect_sensitive_agency_member_fields מחזיר
   ‏team_id לקדמותו בעדכון עצמי. **RLS שחוסם מחזיר 0 שורות ולא שגיאה**, ולכן
   כל עדכון נעשה עם ‎.select('id')‎ ונבדק שחזרה שורה.

   **מסד שהמיגרציה (20270601130000) עוד לא רצה בו:** loadTeam נופל לשאילתה
   הקודמת, teamsLoad מחזיר ok:false, וכל מה שכאן פשוט לא מוצג - בדקה שבין
   פרסום ה-HTML לריצת הצינור "צוות המשרד" עובד בדיוק כמו קודם.

   שני מפתחות זרים בין agency_members ל-agency_teams, ולכן אין כאן embed
   ביניהן (PGRST201) - שתי שאילתות נפרדות.

   הקובץ נטען לפני assets/crm.js, והפונקציות כאן נקראות רק מתוך loadTeam.
   ========================================================================== */

const TEAM_COLUMNS = ', team_id, is_active_agent';

function teamsSchemaMissing(error){
  return !!error && /team_id|is_active_agent|agency_teams/.test(error.message || '');
}

async function teamsLoad(agencyId){
  const { data, error } = await sb.from('agency_teams')
    .select('id, name, lead_member_id')
    .eq('agency_id', agencyId)
    .order('name');
  if (error){
    if (!teamsSchemaMissing(error) && !isMissingTableError(error)) console.warn('טעינת הצוותים נכשלה:', error.message);
    return { ok:false, teams:[] };
  }
  return { ok:true, teams: data || [] };
}

/* עדכון שורה אחת דרך ה-RLS, עם בדיקה שהשורה באמת עודכנה */
async function teamsWrite(query, okMsg){
  const { data, error } = await query.select('id');
  if (error){
    showToast(error.code === '23505' ? 'כבר יש צוות בשם הזה, או שהמנהל/ת כבר מנהל/ת צוות אחר'
      : 'שגיאה: ' + heErr(error));
    return false;
  }
  if (!data || !data.length){ showToast('העדכון לא נשמר. נסו לרענן את הדף.'); return false; }
  if (okMsg) showToast(okMsg);
  return true;
}

function teamsName(raw){
  const name = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!name) return null;
  if (name.length > 60){ showToast('שם הצוות ארוך מדי (עד 60 תווים)'); return null; }
  return name;
}

/* ---------- הלוח שמעל רשימת הסוכנים ---------- */
function teamsPanel(ctx){
  const { teams, members, agencyId, callerId } = ctx;
  const active = members.filter(m => m.user_id && !m.released_at && m.active);
  const nameOf = id => (members.find(m => m.id === id) || {}).display_name || '';
  const box = document.createElement('section');
  box.className = 'teams-panel';
  box.setAttribute('aria-label', 'הצוותים במשרד');
  box.innerHTML = '<div class="teams-head"><h3>הצוותים במשרד</h3></div>'
    + (teams.length ? '' : '<p class="teams-empty">עוד אין צוותים. צוות הוא קבוצת סוכנים עם מנהל/ת משלה - '
        + 'מנהל/ת הצוות רואה את המספרים של הצוות שלו/ה. אפשר גם בלי.</p>');

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn-ghost teams-add';
  add.textContent = '+ צוות חדש';
  add.addEventListener('click', async ()=>{
    const name = teamsName(prompt('שם הצוות (למשל "צוות צפון" או "השכרות"):', ''));
    if (!name) return;
    if (await teamsWrite(sb.from('agency_teams').insert({ agency_id: agencyId, name }), 'הצוות נוצר')){
      await loadTeam(agencyId, callerId);
    }
  });
  box.querySelector('.teams-head').appendChild(add);

  teams.forEach(t=>{
    const size = members.filter(m => m.team_id === t.id && !m.released_at).length;
    const row = document.createElement('div');
    row.className = 'teams-row';
    row.innerHTML =
        '<div class="teams-info"><b>' + esc(t.name) + '</b>'
      + '<span>' + esc(plural(size, 'סוכן/ת אחד/ת', 'סוכנים')) + ' · '
      + (t.lead_member_id ? 'מנהל/ת: ' + esc(nameOf(t.lead_member_id)) : '<span class="teams-warn">בלי מנהל/ת צוות</span>')
      + '</span></div>';
    const acts = document.createElement('div');
    acts.className = 'teams-acts';

    // מנהל/ת הצוות: מכל חברי המשרד הפעילים שאינם מנהלים כבר צוות אחר
    const sel = document.createElement('select');
    sel.className = 'rm-sel';
    sel.setAttribute('aria-label', 'מנהל/ת הצוות ' + t.name);
    const taken = new Set(teams.filter(x => x.id !== t.id && x.lead_member_id).map(x => x.lead_member_id));
    sel.innerHTML = '<option value="">בלי מנהל/ת צוות</option>'
      + active.filter(m => !taken.has(m.id))
          .map(m => '<option value="' + esc(m.id) + '"' + (m.id === t.lead_member_id ? ' selected' : '') + '>'
            + esc(m.display_name || 'סוכן/ת') + '</option>').join('');
    sel.addEventListener('change', async ()=>{
      const lead = sel.value || null;
      const ok = await teamsWrite(
        sb.from('agency_teams').update({ lead_member_id: lead }).eq('id', t.id),
        lead ? nameOf(lead) + ' מנהל/ת עכשיו את ' + t.name : 'לצוות ' + t.name + ' אין עכשיו מנהל/ת');
      // מנהל/ת הצוות הוא/היא גם חבר/ת הצוות - אחרת המספרים שלו/ה לא בדאשבורד הצוות
      if (ok && lead){
        const m = members.find(x => x.id === lead);
        if (m && m.team_id !== t.id){
          await teamsWrite(sb.from('agency_members').update({ team_id: t.id }).eq('id', lead));
        }
      }
      await loadTeam(agencyId, callerId);
    });
    acts.appendChild(sel);

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'btn btn-ghost';
    rename.textContent = 'שינוי שם';
    rename.addEventListener('click', async ()=>{
      const name = teamsName(prompt('השם החדש של הצוות:', t.name));
      if (!name || name === t.name) return;
      if (await teamsWrite(sb.from('agency_teams').update({ name }).eq('id', t.id), 'השם עודכן')){
        await loadTeam(agencyId, callerId);
      }
    });
    acts.appendChild(rename);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-ghost teams-del';
    del.textContent = 'מחיקה';
    del.addEventListener('click', async ()=>{
      if (!confirm('למחוק את הצוות "' + t.name + '"? הסוכנים נשארים במשרד, רק בלי צוות.')) return;
      if (await teamsWrite(sb.from('agency_teams').delete().eq('id', t.id), 'הצוות נמחק')){
        await loadTeam(agencyId, callerId);
      }
    });
    acts.appendChild(del);

    row.appendChild(acts);
    box.appendChild(row);
  });
  return box;
}

/* ---------- בכרטיס של כל סוכן/ת ----------
   התגיות (הצוות, "לא סוכן/ת פעיל/ה") והפקדים: בורר צוות, ולמנהל/ת גם המתג
   "גם סוכן/ת פעיל/ה". המתג מוצג גם בכרטיס של המנהל/ת עצמו/ה - הטריגר מתיר
   למנהל/ת לקבוע את זה לעצמו/ה, אחרת במשרד עם מנהל/ת אחד/ת אין מי שיסמן. */
function teamsMemberTags(m, ctx){
  if (!ctx || !ctx.ok) return [];
  const team = ctx.teams.find(t => t.id === m.team_id);
  const leads = ctx.teams.find(t => t.lead_member_id === m.id);
  return [
    team && { text:'👥 ' + team.name + (leads && leads.id === team.id ? ' · מנהל/ת הצוות' : ''), cls:'tag-info' },
    leads && (!team || leads.id !== team.id) && { text:'👥 מנהל/ת ' + leads.name, cls:'tag-info' },
    m.role === 'manager' && m.is_active_agent === false && { text:'לא פעיל/ה כיועץ נדל״ן' },
  ];
}

function teamsMemberControls(actions, m, ctx){
  if (!ctx || !ctx.ok || !m.user_id || m.released_at) return;
  const { teams, agencyId, callerId } = ctx;
  const wrap = document.createElement('div');
  wrap.className = 'teams-member';

  if (teams.length){
    const label = document.createElement('label');
    label.className = 'teams-field';
    label.innerHTML = '<span>צוות</span>';
    const sel = document.createElement('select');
    sel.className = 'rm-sel';
    sel.innerHTML = '<option value="">בלי צוות</option>'
      + teams.map(t => '<option value="' + esc(t.id) + '"' + (t.id === m.team_id ? ' selected' : '') + '>'
          + esc(t.name) + '</option>').join('');
    sel.addEventListener('change', async ()=>{
      const name = m.display_name || 'הסוכן/ת';
      const team = teams.find(t => t.id === sel.value);
      await teamsWrite(sb.from('agency_members').update({ team_id: sel.value || null }).eq('id', m.id),
        team ? name + ' בצוות ' + team.name : name + ' בלי צוות');
      await loadTeam(agencyId, callerId);
    });
    label.appendChild(sel);
    wrap.appendChild(label);
  }

  if (m.role === 'manager'){
    const label = document.createElement('label');
    label.className = 'teams-check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = m.is_active_agent !== false;
    label.appendChild(box);
    label.insertAdjacentHTML('beforeend',
      '<span>גם סוכן/ת פעיל/ה <small>מקבל/ת לידים ברוטציה, נספר/ת בממוצע המשרד ומופיע/ה במדריך הסוכנים</small></span>');
    box.addEventListener('change', async ()=>{
      const on = box.checked;
      const name = m.id === callerId ? 'את/ה' : (m.display_name || 'המנהל/ת');
      if (!on && !confirm(name + ' לא יקבל/תקבל לידים ברוטציה ולא יופיע/תופיע במדריך הסוכנים באתר. '
          + 'דף הסוכן/ת ודף המשרד נשארים. להמשיך?')){
        box.checked = true;
        return;
      }
      const ok = await teamsWrite(sb.from('agency_members').update({ is_active_agent: on }).eq('id', m.id),
        on ? 'מסומן/ת כסוכן/ת פעיל/ה' : 'מסומן/ת כמנהל/ת בלבד');
      if (!ok) box.checked = !on;
      else await loadTeam(agencyId, callerId);
    });
    wrap.appendChild(label);
  }

  if (wrap.children.length) actions.parentElement.insertBefore(wrap, actions);
}
