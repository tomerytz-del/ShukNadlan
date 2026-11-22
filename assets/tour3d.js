/* ============================================================================
   tour3d.js - הדף /tour3d: הסיור התלת-ממדי מתוכנית דירה (docs/plan-3d-tour.md)

   שלושה מצבים, לפי הכתובת ומי שמחובר/ת:
     /tour3d?m=<id>          צופה. כל גולש/ת, כשהדגם פורסם. בלי התחברות.
     /tour3d?m=<id>&edit=1   עורך. רק לבעלים של הדגם.
     /tour3d                 "הסיורים שלי" ויצירת סיור חדש. דורש התחברות.

   מה שהדף אינו עושה, בכוונה (הסקיל plan-3d-tour):
     * אינו כותב שורה חדשה, מחיר או סטטוס. יצירה, מראה וחיוב עוברים ב-Edge Function
       plan-model; הדפדפן מעדכן רק name, model, settings, views, lights, published.
     * אינו קורא select('*'): ההרשאה לפי עמודות, ו-* מחזיר permission denied.
     * נתיב תוכנית המקור לעולם אינו מגיע לכאן. לעורך יש כתובת חתומה לשעה (plan_url).
   ============================================================================ */
(function(){
'use strict';
var SUPABASE_URL='https://obookujgolazrwycsiyn.supabase.co';
var SUPABASE_ANON_KEY='sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
var FN_URL=SUPABASE_URL+'/functions/v1/plan-model';
var COLS='id,name,status,published,project_id,model,settings,views,lights,updated_at';
var THREE_SRC=['https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js','https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js'];
var MAX_FILE=6*1024*1024;

var $=function(id){return document.getElementById(id)};
function esc(s){return escapeHtml(s)}
var sb=window.supabase?window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY):null;
var params=new URLSearchParams(location.search);
var MID=params.get('m'), WANT_EDIT=params.get('edit')==='1';
var homeBody=$('homeBody');

/* קודים שהפונקציה והמסד מחזירים. detail בעברית מהשרת גובר; השאר דרך FriendlyError */
var CODE_TEXT={
  tier_required:'הסיור התלת-ממדי זמין ליועצי נדל״ן במסלול Elite פעיל.',
  insufficient_balance:'אין מספיק יתרה בארנק. טענו את הארנק ונסו שוב.',
  not_your_project:'הפרויקט אינו שייך לחשבון הזה.',
  mirror_source_invalid:'אי אפשר ליצור תמונת מראה מהדגם הזה.',
  forbidden:'אין לחשבון הזה הרשאה לפעולה.',
  unauthorized:'צריך להתחבר מחדש.',
  mfa_required:'נדרש אימות דו-שלבי. היכנסו מחדש לאזור האישי ונסו שוב.',
  not_found:'הסיור לא נמצא.',
  name_required:'חסר שם לדגם.',
  missing_fields:'חסרים פרטים. בדקו את השם ואת קובץ התוכנית.',
  gemini_not_configured:'קריאת התוכנית אינה זמינה כרגע. לא בוצע חיוב.'
};
function heText(e){
  if(e&&typeof e.detail==='string'&&/[֐-׿]/.test(e.detail))return e.detail;
  var code=e&&(e.error||e.code);
  if(code&&CODE_TEXT[code])return CODE_TEXT[code];
  return window.FriendlyError?FriendlyError.text(e):'משהו השתבש. נסו שוב בעוד רגע.';
}
function money(n){return '₪'+(Math.round(+n*100)/100).toLocaleString('he-IL')}
function show(html){homeBody.innerHTML=html}
function fail(text,linkHtml){show('<div class="card"><p class="msg bad">'+esc(text)+'</p>'+(linkHtml||'')+'</div>')}

async function token(){var r=await sb.auth.getSession();return r.data&&r.data.session?r.data.session.access_token:null}
async function callFn(body){
  var t=await token();if(!t)throw {error:'unauthorized'};
  var res=await fetch(FN_URL,{method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+t},body:JSON.stringify(body)});
  var data=null;try{data=await res.json()}catch(e){}
  if(!res.ok||!data||data.error)throw (data||{error:'http_'+res.status});
  return data;
}
function loadScript(list,i){
  return new Promise(function(ok,no){
    if(window.THREE)return ok();
    if(i>=list.length)return no(new Error('three'));
    var s=document.createElement('script');s.src=list[i];
    s.onload=function(){ok()};s.onerror=function(){loadScript(list,i+1).then(ok,no)};
    document.head.appendChild(s);
  });
}

/* ================= צופה ועורך ================= */
async function openModel(){
  var r=await sb.from('plan_models').select(COLS).eq('id',MID).maybeSingle();
  if(r.error)return fail(heText(r.error));
  var m=r.data;
  if(!m)return fail('הסיור אינו זמין. ייתכן שהוא עדיין לא פורסם, או שהקישור אינו נכון.');

  /* בעלות: my_plan_models מזהה לפי ה-JWT. גולש/ת לא מחובר/ת פשוט אינו/ה בעלים */
  var mine=false;
  if(await token()){
    var mm=await sb.rpc('my_plan_models');
    mine=!mm.error&&(mm.data||[]).some(function(x){return x.id===m.id});
  }
  if(m.status!=='ready'){
    return fail(m.status==='failed'?'קריאת התוכנית נכשלה, והחיוב הוחזר לארנק. אפשר לנסות שוב עם תמונה חדה יותר.':'התוכנית עדיין בקריאה. רעננו בעוד דקה.',
      mine?'<a class="btn" href="/tour3d">לכל הסיורים שלי</a>':'');
  }
  var edit=mine&&WANT_EDIT;
  var planUrl='';
  if(edit){try{planUrl=(await callFn({action:'plan_url',model_id:m.id})).url||''}catch(e){/* בלי תוכנית מקור העורך עובד, רק בלי שכבת ההשוואה */}}
  try{await loadScript(THREE_SRC,0)}catch(e){return fail('הסיור לא נטען. בדקו את החיבור לרשת ורעננו.')}

  var st=m.settings||{};
  document.title=m.name+' | סיור תלת-ממדי | שוק נדל״ן';
  $('mName').textContent=m.name;
  var sub=[];if(+st.declared_area_sqm>0)sub.push('שטח דירה '+st.declared_area_sqm+' מ"ר');
  if(+st.declared_balcony_sqm>0)sub.push('מרפסת '+st.declared_balcony_sqm+' מ"ר');
  $('mSub').textContent=sub.join(', ');
  $('grabTxt').textContent=m.name+' · הדמיה להמחשה בלבד';
  if(mine&&!edit){
    var a=document.createElement('a');a.className='back';a.href='/tour3d?m='+encodeURIComponent(m.id)+'&edit=1';a.textContent='עריכת הסיור';
    $('mSub').after(a);
  }
  $('home').hidden=true;$('app').hidden=false;

  var published=!!m.published, lastFurn=JSON.stringify((m.model&&m.model.furniture)||[]), saving=0;
  function saveState(t,bad){var el=$('saveSt');el.textContent=t;el.classList.toggle('bad',!!bad)}
  async function update(patch){
    /* RLS שחוסם מחזיר 0 שורות ולא שגיאה, ולכן סופרים את מה שחזר */
    var u=await sb.from('plan_models').update(patch).eq('id',m.id).select('id');
    if(u.error)throw u.error;
    if(!u.data||!u.data.length)throw {error:'forbidden'};
  }
  function pubUi(){$('pubBtn').textContent=published?'הסרה מפרסום':'פרסום הסיור';$('shareBtn').hidden=!published}
  if(edit){
    pubUi();
    $('pubBtn').addEventListener('click',async function(){
      this.disabled=true;
      try{await update({published:!published});published=!published;pubUi();saveState(published?'הסיור פורסם. כל מי שיש לו את הקישור יכול לצפות.':'הסיור הוסר מפרסום.')}
      catch(e){saveState(heText(e),true)}
      this.disabled=false;
    });
    $('shareBtn').addEventListener('click',function(){
      var url=location.origin+'/tour3d?m='+encodeURIComponent(m.id);
      (navigator.clipboard?navigator.clipboard.writeText(url):Promise.reject()).then(function(){saveState('הקישור הועתק.')},function(){saveState(url)});
    });
  }
  window.Plan3D.start({
    title:m.name, model:m.model, settings:st, views:m.views, lights:m.lights, planUrl:planUrl, editable:edit,
    onSave:async function(d){
      var patch={settings:d.settings,views:d.views,lights:d.lights};
      var f=JSON.stringify(d.furniture);
      /* המודל עד 800KB: נשלח רק כשהריהוט השתנה */
      if(f!==lastFurn)patch.model=Object.assign({},m.model,{furniture:d.furniture});
      var n=++saving;saveState('שומר...');
      try{await update(patch);lastFurn=f;if(n===saving)saveState('נשמר')}
      catch(e){if(n===saving)saveState('השמירה נכשלה. '+heText(e),true)}
    }
  });
}

/* ================= הסיורים שלי ויצירה ================= */
var STATUS_TEXT={draft:'בהכנה',reading:'התוכנית בקריאה',ready:'מוכן',failed:'נכשל, החיוב הוחזר'};
async function openHome(){
  if(!(await token())){
    return show('<h1>סיור תלת-ממדי מתוכנית דירה</h1><p class="sub">מעלים תמונה של תוכנית, ומקבלים דירה שאפשר ללכת בה, להחליף בה סגנון ולראות את השמש לפי שעה.</p>'+
      '<div class="card"><p class="msg">כדי ליצור סיור צריך להתחבר לאזור האישי.</p><div class="chips">'+
      '<a class="btn pri" href="/crm">כניסה ליועצי נדל״ן</a><a class="btn" href="/developer-crm">כניסה ליזמים ומשווקים</a></div></div>');
  }
  var ids=await Promise.all([sb.rpc('current_agent_id'),sb.rpc('current_developer_id')]);
  var kinds=[];if(ids[0].data)kinds.push('agent');if(ids[1].data)kinds.push('developer');
  if(!kinds.length)return fail('לחשבון הזה אין אזור אישי של יועץ/ת נדל״ן או של יזם.','<a class="btn" href="/">לדף הבית</a>');
  var res=await Promise.all([sb.rpc('my_plan_models')].concat(kinds.map(function(k){return sb.rpc('plan_model_quote',{p_owner_kind:k})})));
  if(res[0].error)return fail(heText(res[0].error));
  var models=res[0].data||[], quotes={};
  kinds.forEach(function(k,i){quotes[k]=res[i+1].data||{}});

  var KIND_NAME={agent:'יועץ/ת נדל״ן',developer:'יזם / משווק'};
  var list=models.length?models.map(function(x){
    var open=x.status==='ready';
    return '<div class="mrow2"><div class="nm"><b>'+esc(x.name)+'</b><small>'+esc(STATUS_TEXT[x.status]||x.status)+
      (x.mirrored_from?' · תמונת מראה':'')+'</small></div>'+
      (open?'<span class="pill'+(x.published?' on':'')+'">'+(x.published?'מפורסם':'לא מפורסם')+'</span>'+
        '<a class="btn sm pri" href="/tour3d?m='+encodeURIComponent(x.id)+'&edit=1">עריכה</a>'+
        '<a class="btn sm" href="/tour3d?m='+encodeURIComponent(x.id)+'">צפייה</a>'+
        '<button class="btn sm" type="button" data-mirror="'+esc(x.id)+'" data-kind="'+esc(x.owner_kind)+'" data-name="'+esc(x.name)+'">תמונת מראה</button>':'')+
      '</div>'}).join(''):'<p class="msg">עדיין אין סיורים. הראשון נוצר מהטופס שלמטה.</p>';

  show('<h1>הסיורים התלת-ממדיים שלי</h1><p class="sub">סיור אחד לכל דגם דירה. כל הדירות מאותו דגם מציגות את אותו סיור.</p>'+
    '<div class="card"><h2>הדגמים שלי</h2>'+list+'<p class="msg" id="listMsg" role="status"></p></div>'+
    '<div class="card"><h2>סיור חדש</h2>'+
      (kinds.length>1?'<div class="f"><label for="nKind">החשבון שמשלם</label><select id="nKind">'+kinds.map(function(k){return '<option value="'+k+'">'+KIND_NAME[k]+'</option>'}).join('')+'</select></div>':'')+
      '<div id="quoteBox"></div>'+
      '<div class="f"><label for="nName">שם הדגם</label><input id="nName" maxlength="120" placeholder="למשל: דגם A, 4 חדרים"></div>'+
      '<div class="f"><label for="nFile">תמונת התוכנית (JPG, PNG או WebP, עד 6MB)</label><input id="nFile" type="file" accept="image/jpeg,image/png,image/webp"></div>'+
      '<p class="note">תוכנית חדה, ישרה ועם מידות כתובות נותנת את התוצאה המדויקת ביותר. אחרי הקריאה אפשר לכייל מידות ולתקן.</p>'+
      '<div class="ck"><input type="checkbox" id="nOk"><label for="nOk" id="nOkLbl"></label></div>'+
      '<div><button class="btn pri" id="nGo" type="button" disabled>יצירת הסיור</button></div>'+
      '<p class="msg" id="nMsg" role="status"></p>'+
    '</div>');

  function kind(){return $('nKind')?$('nKind').value:kinds[0]}
  function quoteUi(){
    var k=kind(),q=quotes[k]||{},price=+q.price||49,bal=+q.balance||0,html='';
    if(!q.eligible)html='<p class="msg bad">'+(k==='agent'?'הסיור התלת-ממדי זמין במסלול Elite פעיל. ':'החשבון אינו פעיל. ')+'</p>'+(k==='agent'?'<a class="btn sm" href="/pricing">למסלולים</a>':'');
    else{
      html='<p class="msg"><b>'+money(price)+' לדגם</b>, לפני מע״מ, מהארנק. כולל '+(+q.renders_included||20)+' הדמיות. היתרה בארנק: '+money(bal)+'.</p>';
      if(bal<price)html+='<a class="btn sm" href="/checkout?product='+(k==='agent'?'wallet':'developer_wallet')+'&amount='+encodeURIComponent(Math.max(50,Math.ceil(price-bal)))+'">טעינת הארנק</a>';
    }
    $('quoteBox').innerHTML=html;
    $('nOkLbl').textContent='אני מאשר/ת חיוב של '+money(price)+' מהארנק על הדגם הזה';
    $('nOk').checked=false;gate();
  }
  function gate(){var q=quotes[kind()]||{};$('nGo').disabled=!(q.eligible&&(+q.balance||0)>=(+q.price||49)&&$('nOk').checked&&$('nName').value.trim()&&$('nFile').files.length)}
  ['nOk','nName','nFile'].forEach(function(id){$(id).addEventListener('input',gate);$(id).addEventListener('change',gate)});
  if($('nKind'))$('nKind').addEventListener('change',quoteUi);
  quoteUi();

  function msg(el,t,bad){el.textContent=t;el.classList.toggle('bad',!!bad)}
  $('nGo').addEventListener('click',async function(){
    var file=$('nFile').files[0],btn=this,out=$('nMsg');
    if(!file)return;
    if(file.size>MAX_FILE)return msg(out,'התמונה גדולה מדי. עד 6MB.',true);
    btn.disabled=true;msg(out,'קוראים את התוכנית. זה לוקח עד דקה, לא לסגור את הדף.');
    try{
      var b64=await new Promise(function(ok,no){var fr=new FileReader();fr.onload=function(){ok(String(fr.result).split(',')[1]||'')};fr.onerror=no;fr.readAsDataURL(file)});
      var d=await callFn({action:'create',owner_kind:kind(),name:$('nName').value.trim(),image_base64:b64});
      location.href='/tour3d?m='+encodeURIComponent(d.model_id)+'&edit=1';
    }catch(e){msg(out,heText(e),true);btn.disabled=false}
  });
  homeBody.addEventListener('click',async function(e){
    var b=e.target.closest('[data-mirror]');if(!b)return;
    var q=quotes[b.dataset.kind]||{},out=$('listMsg');
    if(!confirm('תמונת מראה היא דגם נוסף, בחיוב של '+money(+q.price||49)+' מהארנק. להמשיך?'))return;
    b.disabled=true;msg(out,'יוצרים את תמונת המראה...');
    try{
      var d=await callFn({action:'mirror',owner_kind:b.dataset.kind,source_model_id:b.dataset.mirror});
      location.href='/tour3d?m='+encodeURIComponent(d.model_id)+'&edit=1';
    }catch(err){msg(out,heText(err),true);b.disabled=false}
  });
}

(async function(){
  if(!sb)return fail('הדף לא נטען במלואו. בדקו את החיבור לרשת ורעננו.');
  try{await (MID?openModel():openHome())}
  catch(e){fail(heText(e))}
})();
})();
