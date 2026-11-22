/* ============================================================================
   plan3d.js - הסיור התלת-ממדי מתוכנית דירה (docs/plan-3d-tour.md, הסקיל plan-3d-tour)

   מנוע אחד לצופה ולעורך. הדף (tour3d.html, assets/tour3d.js) טוען את Three.js, קורא את
   הדגם מהמסד וקורא ל-Plan3D.start({model, settings, views, lights, editable, planUrl, onSave}).
   המנוע אינו מדבר עם המסד: כל שמירה עוברת ב-onSave, ולצופה (editable=false) אין שמירה כלל.

   המודל בקואורדינטות של תמונת התוכנית (פיקסלים), וקנה המידה ב-settings.scale (ס"מ לפיקסל).
   המבנה נקבע ב-supabase/functions/_shared/plan-model.ts (PlanModel): שדה חדש נכנס שם,
   ב-mirrorModel וכאן באותו PR.

   שלושה דברים שאסור לשבור (כולם כשלים שקטים, ראו הסקיל):
     * הקירות והרצפה תמיד בגוונים שונים (ensureContrast).
     * מקשי ההליכה לפי e.code, לא e.key: במקלדת בעברית W אינו "w".
     * כפתור חדש על הבמה נכנס לשורת הכלים (.hud.tl) שנגללת בנייד, לא לפינה משלו.
   ============================================================================ */
window.Plan3D={start:function(OPTS){
'use strict';
var T=THREE;
var $=function(id){return document.getElementById(id)};
var rad=function(d){return d*Math.PI/180}, deg=function(r){return r*180/Math.PI};
var clamp=function(v,a,b){return Math.max(a,Math.min(b,v))};
var MODEL=OPTS.model;
['rooms','solids','walls','labels','lamps','furniture'].forEach(function(k){if(!Array.isArray(MODEL[k]))MODEL[k]=[]});
var PLAN_IMG=OPTS.planUrl||'';
var EDIT=!!OPTS.editable;
var SETTINGS=Object.assign({},OPTS.settings||{});
/* גבולות הדירה בפיקסלים של התוכנית: כל מה שהיה מספר קבוע של דירת הדוגמה נגזר מכאן */
var BOUNDS=(function(){var x1=1e9,y1=1e9,x2=-1e9,y2=-1e9;
  MODEL.rooms.forEach(function(r){r.r.forEach(function(q){x1=Math.min(x1,q[0]);y1=Math.min(y1,q[1]);x2=Math.max(x2,q[2]);y2=Math.max(y2,q[3])})});
  if(x1>x2){x1=0;y1=0;x2=MODEL.imgW||1000;y2=MODEL.imgH||800}
  return {x1:x1,y1:y1,x2:x2,y2:y2}})();

/* ================= קטלוג ריהוט (ס"מ) ================= */
var CAT={
  bed2:{n:'מיטה זוגית',w:160,d:200},bed1:{n:'מיטה יחיד',w:90,d:200},sofa:{n:'ספה',w:220,d:95},arm:{n:'כורסה',w:85,d:85},
  coffee:{n:'שולחן סלון',w:100,d:60},coffeeR:{n:'שולחן עגול',w:90,d:90},table:{n:'שולחן אוכל',w:240,d:100},chair:{n:'כיסא',w:44,d:44},
  wardrobe:{n:'ארון',w:200,d:60},desk:{n:'שולחן כתיבה',w:140,d:60},tv:{n:'מזנון טלוויזיה',w:200,d:40},island:{n:'אי מטבח',w:270,d:90},
  kitchen:{n:'יחידת מטבח',w:300,d:65},rug:{n:'שטיח',w:250,d:170},plant:{n:'עציץ',w:50,d:50},lamp:{n:'מנורה עומדת',w:40,d:40},
  tub:{n:'אמבטיה',w:170,d:75},toilet:{n:'אסלה',w:40,d:60},sink:{n:'כיור וארון',w:60,d:48},shower:{n:'מקלחון',w:100,d:90},
  osofa:{n:'ספת חוץ',w:220,d:90},otable:{n:'שולחן חוץ',w:220,d:90},ochair:{n:'כיסא חוץ',w:48,d:48},
  personM:{n:'דמות: גבר (178 ס"מ)',w:56,d:30},personF:{n:'דמות: אישה (165 ס"מ)',w:50,d:28},child:{n:'דמות: ילד (125 ס"מ)',w:40,d:24},lounger:{n:'מיטת שיזוף',w:70,d:190},umbrella:{n:'שמשייה',w:260,d:260},planter:{n:'אדנית',w:90,d:40}
};

/* ================= סגנונות ================= */
/* fl: [טקסטורה, צבע, גודל אריח]. הגוונים נבחרו כך שהקיר בהיר/כהה מהרצפה בלפחות 0.15 בבהירות */
var STYLES={
  base:{label:'בסיס',sub:'דגם לבן, בלי צבעים וטקסטורות',flat:1,wall:'#f1efea',
    fl:{tile:['flat','#c4c0b8'],wood:['flat','#c4c0b8'],wet:['flat','#c4c0b8'],deck:['flat','#b8b3a8']},
    f:{fabric:'#d6d3cc',wood:'#d0cdc6',dark:'#bdbab3',accent:'#d6d3cc',case:'#dedbd4',top:'#e6e3dc',rug:'#d0cdc6',green:'#cdcac3',white:'#e6e3dc'},lamp:0xfff0d8,sw:['#f1efea','#cfcbc3','#d0cdc6']},
  modern_clean:{label:'מודרני נקי',sub:'לבן, אפור בהיר ואלון טבעי',wall:'#f0f0ee',
    fl:{tile:['tile','#aeb2b4',60],wood:['plank','#a87c4f'],wet:['tile','#8c969b',30],deck:['plank','#7d684d']},
    f:{fabric:'#a9adb2',wood:'#c2a06f',dark:'#2f3237',accent:'#4b5560',case:'#f2f2f0',top:'#f7f7f5',rug:'#8e939a',green:'#5d8a58',white:'#f3f3f1'},lamp:0xfff0d8,sw:['#f0f0ee','#aeb2b4','#a87c4f']},
  mediterranean_white:{label:'ים תיכוני לבן',sub:'לבן, אבן בהירה ותכלת ים',wall:'#fcfbf7',
    fl:{tile:['stone','#d3c9b4'],wood:['plank','#c9b088'],wet:['tile','#9fbdcd',20],deck:['plank','#a77f4f']},
    f:{fabric:'#efe9dd',wood:'#c9a877',dark:'#3b3a38',accent:'#3f84ad',case:'#f8f6f0',top:'#f4f1ea',rug:'#e6dcc8',green:'#4f8a4b',white:'#fbfaf6'},lamp:0xfff1d9,sw:['#fcfbf7','#d3c9b4','#3f84ad']},
  warm_scandi:{label:'סקנדינבי חם',sub:'עץ בהיר, טקסטיל חם וחרדל',wall:'#f5efe5',
    fl:{tile:['plank','#c9a06a'],wood:['plank','#c9a06a'],wet:['tile','#c4bdae',30],deck:['plank','#9c774b']},
    f:{fabric:'#cdb99d',wood:'#dcb887',dark:'#3a352f',accent:'#c98a3c',case:'#efe3cf',top:'#e8d9bf',rug:'#e9dfce',green:'#6b8f5b',white:'#f6f1e8'},lamp:0xffe6c0,sw:['#f5efe5','#c9a06a','#c98a3c']},
  modern_luxury:{label:'יוקרתי',sub:'שיש, אגוז, קירות אפורי חום ופליז',wall:'#9a9082',
    fl:{tile:['marble','#ebe7df'],wood:['plank','#5b3d2a'],wet:['marble','#34373b'],deck:['plank','#6b5a49']},
    f:{fabric:'#2d3441',wood:'#5b3d2a',dark:'#1d1f23',accent:'#b8924a',case:'#3a3a3c',top:'#ebe7df',rug:'#8d867a',green:'#44703f',white:'#eeebe5'},lamp:0xffd9a0,sw:['#9a9082','#ebe7df','#b8924a']}
};
var STYLE_KEYS=['base','modern_clean','mediterranean_white','warm_scandi','modern_luxury'];

var CITIES={
  'עפולה':[32.6078,35.2897],'תל אביב':[32.0853,34.7818],'ירושלים':[31.7683,35.2137],'חיפה':[32.794,34.9896],'באר שבע':[31.253,34.7915],
  'נתניה':[32.3215,34.8532],'חדרה':[32.434,34.9196],'אשדוד':[31.8044,34.6553],'ראשון לציון':[31.973,34.7925],'פתח תקווה':[32.0841,34.8878],
  'רמת גן':[32.0684,34.8248],'מודיעין':[31.8969,35.0104],'טבריה':[32.7922,35.5312],'נצרת':[32.6996,35.3035],'קריית אתא':[32.8091,35.1055],'אילת':[29.5577,34.9519]
};

/* ================= מצב ================= */
function todayStr(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
var S={scale:1.56,ceil:270,wExt:22,wInt:10,sill:90,winH:130,doorH:210,
  north:0,city:'עפולה',date:todayStr(),time:11,lamps:'auto',style:'modern_clean',
  mat:null,fpGoal:null,mode:'drone',cut:false,plan:false,labels:true,edit:false,
  drone:{az:0.25,pol:0.85,rad:2700,tx:0,tz:0},fp:{x:0,z:0,yaw:0,pitch:0}};
var FURN=[];var VIEWS=[];var LIGHTS=[];var selId=null;var uid=1;

function resetFurn(){FURN=MODEL.furniture.map(function(a){return {id:'f'+(uid++),t:a[0],x:a[1],y:a[2],rot:a[3]||0,w:a[4]||0,d:a[5]||0}})}
function center(){return {x:(BOUNDS.x1+BOUNDS.x2)/2*S.scale,z:(BOUNDS.y1+BOUNDS.y2)/2*S.scale}}
function span(){return Math.max(BOUNDS.x2-BOUNDS.x1,BOUNDS.y2-BOUNDS.y1)*S.scale}
/* נקודת מבט ראשון בחדר: מרכז החדר, עם הפנים למרכז הדירה */
function roomSpot(r){var c=center(),q=r.r[0],x=(q[0]+q[2])/2*S.scale,z=(q[1]+q[3])/2*S.scale;
  return {x:x,z:z,yaw:Math.atan2(c.x-x,-(c.z-z)),pitch:-0.05}}
function startFp(){
  var pick=function(p){return MODEL.rooms.filter(function(r){return r.id.indexOf(p)===0})[0]};
  var r=pick('entry')||pick('living')||MODEL.rooms.filter(function(x){return !x.nc})[0]||MODEL.rooms[0];
  return r?roomSpot(r):{x:center().x,z:center().z,yaw:0,pitch:-0.05}}
function defaultViews(){var c=center(),R=span(),seen={},out=[
  {n:'מבט על',mode:'drone',drone:{az:0,pol:0.06,rad:R*1.65,tx:c.x,tz:c.z}},
  {n:'מבט אלכסוני',mode:'drone',drone:{az:0.45,pol:0.85,rad:R*1.55,tx:c.x,tz:c.z}}];
  MODEL.rooms.forEach(function(r){var q=r.r[0];
    if(r.svc||Math.min(q[2]-q[0],q[3]-q[1])*S.scale<150)return;
    seen[r.name]=(seen[r.name]||0)+1;
    out.push({n:r.name+(seen[r.name]>1?' '+seen[r.name]:''),mode:'fp',fp:roomSpot(r)})});
  return out}
function defaultLights(){return [
  {n:'בוקר',t:8,lamps:'off'},{n:'צהריים',t:12.5,lamps:'off'},{n:'אחר הצהריים',t:16,lamps:'off'},
  {n:'שקיעה',t:'sunset',lamps:'auto'},{n:'ערב',t:'dusk',lamps:'on'}
]}

/* ================= שמש (NOAA) ================= */
function tzOffMin(ms){
  var f=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Jerusalem',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  var p={};f.formatToParts(new Date(ms)).forEach(function(x){p[x.type]=x.value});
  var asUtc=Date.UTC(+p.year,+p.month-1,+p.day,(+p.hour)%24,+p.minute,+p.second);
  return Math.round((asUtc-ms)/60000);
}
function sunPos(lat,lng,ds,h){
  var a=ds.split('-').map(Number);
  var local=Date.UTC(a[0],a[1]-1,a[2])+h*3600000;
  var off=tzOffMin(local-2*3600000);
  var ms=local-off*60000;
  var jd=ms/86400000+2440587.5, t=(jd-2451545)/36525;
  var L0=(280.46646+t*(36000.76983+t*0.0003032))%360;
  var M=357.52911+t*(35999.05029-0.0001537*t);
  var e=0.016708634-t*(0.000042037+0.0000001267*t);
  var Mr=rad(M);
  var C=Math.sin(Mr)*(1.914602-t*(0.004817+0.000014*t))+Math.sin(2*Mr)*(0.019993-0.000101*t)+Math.sin(3*Mr)*0.000289;
  var om=125.04-1934.136*t;
  var lam=L0+C-0.00569-0.00478*Math.sin(rad(om));
  var eps0=23+(26+(21.448-t*(46.815+t*(0.00059-t*0.001813)))/60)/60;
  var eps=eps0+0.00256*Math.cos(rad(om));
  var decl=Math.asin(Math.sin(rad(eps))*Math.sin(rad(lam)));
  var yy=Math.pow(Math.tan(rad(eps)/2),2), L0r=rad(L0);
  var eq=4*deg(yy*Math.sin(2*L0r)-2*e*Math.sin(Mr)+4*e*yy*Math.sin(Mr)*Math.cos(2*L0r)-0.5*yy*yy*Math.sin(4*L0r)-1.25*e*e*Math.sin(2*Mr));
  var utcMin=((ms/60000)%1440+1440)%1440;
  var tst=((utcMin+eq+4*lng)%1440+1440)%1440;
  var ha=tst/4-180, lr=rad(lat);
  var cz=clamp(Math.sin(lr)*Math.sin(decl)+Math.cos(lr)*Math.cos(decl)*Math.cos(rad(ha)),-1,1);
  var zen=Math.acos(cz), sz=Math.sin(zen);
  var az=0;
  if(sz>1e-6){var ca=clamp((Math.sin(lr)*cz-Math.sin(decl))/(Math.cos(lr)*sz),-1,1);az=deg(Math.acos(ca));az=ha>0?(az+180)%360:(540-az)%360}
  return {el:90-deg(zen),az:az};
}
var dayCache={};
function sunDay(lat,lng,ds){
  var k=lat+'|'+lng+'|'+ds;if(dayCache[k])return dayCache[k];
  var rise=null,set=null,prev=null;
  for(var h=0;h<=24;h+=0.05){var e=sunPos(lat,lng,ds,h).el;
    if(prev!==null){if(prev<-0.833&&e>=-0.833&&rise===null)rise=h;if(prev>=-0.833&&e<-0.833)set=h}
    prev=e}
  return dayCache[k]={rise:rise,set:set};
}
function fmtH(h){if(h==null)return '-';var m=Math.round(h*60);var hh=Math.floor(m/60)%24,mm=m%60;return String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0')}
var DIRS=['צפון','צפון-מזרח','מזרח','דרום-מזרח','דרום','דרום-מערב','מערב','צפון-מערב'];
function dirName(az){return DIRS[Math.round(az/45)%8]}

/* ================= סצנה ================= */
var canvas=$('c'),stage=$('stage');
var renderer=new T.WebGLRenderer({canvas:canvas,antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
var COARSE=matchMedia('(pointer:coarse)').matches;
renderer.outputEncoding=T.sRGBEncoding;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
function lin(c){return new T.Color(c).convertSRGBToLinear()}
renderer.localClippingEnabled=true;
var scene=new T.Scene();scene.background=new T.Color('#cfe3ee');
var camera=new T.PerspectiveCamera(45,1,5,12000);camera.rotation.order='YXZ';
var hemi=new T.HemisphereLight(0xdfeeff,0xcfcabd,0.6);scene.add(hemi);
var amb=new T.AmbientLight(0xffffff,0.3);scene.add(amb);
var sun=new T.DirectionalLight(0xfff4e0,0.9);sun.castShadow=true;
sun.shadow.mapSize.set(COARSE?2048:4096,COARSE?2048:4096);sun.shadow.bias=-0.0006;sun.shadow.normalBias=1.2;
var sc=sun.shadow.camera;sc.left=-1700;sc.right=1700;sc.top=1700;sc.bottom=-1700;sc.near=50;sc.far=9000;
scene.add(sun);scene.add(sun.target);
var ground=new T.Mesh(new T.PlaneGeometry(40000,40000),new T.MeshStandardMaterial({color:lin(0xb9c3bf),roughness:1}));
ground.rotation.x=-Math.PI/2;ground.position.y=-2;ground.receiveShadow=true;scene.add(ground);
/* סביבה: כיפת שמיים פרוצדורלית שנצרבת ל-PMREM. שלוש גרסאות (יום, דמדומים, לילה), כדי שהשתקפויות בזכוכית וברצפה יתאימו לשעה */
var ENV={};
function envFor(kind){
  if(ENV[kind])return ENV[kind];
  var cols={day:['#7fb0d8','#dbe9f2','#8d8a80'],dusk:['#3f4f7a','#f0b37a','#3a3430'],night:['#05080f','#10192b','#0a0b0d']}[kind];
  var cv=document.createElement('canvas');cv.width=256;cv.height=128;var g=cv.getContext('2d'),gr=g.createLinearGradient(0,0,0,128);
  gr.addColorStop(0,cols[0]);gr.addColorStop(.5,cols[1]);gr.addColorStop(.52,cols[2]);gr.addColorStop(1,cols[2]);g.fillStyle=gr;g.fillRect(0,0,256,128);
  var tx=new T.CanvasTexture(cv);tx.encoding=T.sRGBEncoding;tx.mapping=T.EquirectangularReflectionMapping;
  var pm=new T.PMREMGenerator(renderer),rt=pm.fromEquirectangular(tx);ENV[kind]=rt.texture;pm.dispose();tx.dispose();return ENV[kind];
}
var cutPlane=new T.Plane(new T.Vector3(0,-1,0),130);

var world=new T.Group();scene.add(world);
var CUT_H=125,edgeGroup=null;
var wallGroup,floorGroup,furnGroup,labelGroup,lampGroup,ceilGroup,planMesh,boxes=[],floorMeshes=[],furnMap={};
var texCache={};
var aoTex=null;
function aoTexture(){
  if(aoTex)return aoTex;var cv=document.createElement('canvas');cv.width=4;cv.height=64;var g=cv.getContext('2d'),gr=g.createLinearGradient(0,0,0,64);
  gr.addColorStop(0,'rgba(0,0,0,.42)');gr.addColorStop(.35,'rgba(0,0,0,.14)');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,4,64);
  aoTex=new T.CanvasTexture(cv);return aoTex;
}
var aoMat=null;
function aoStrip(g,x0,z0,x1,z1,ox,oz){
  /* מקטע מהקצה (x0,z0)-(x1,z1) החוצה לפי (ox,oz): גרדיאנט כהה שמחקה הצללת פינות (AO) */
  if(!aoMat)aoMat=new T.MeshBasicMaterial({map:aoTexture(),transparent:true,depthWrite:false,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  var geo=new T.BufferGeometry();
  geo.setAttribute('position',new T.Float32BufferAttribute([x0,.5,z0, x1,.5,z1, x1+ox,.5,z1+oz, x0+ox,.5,z0+oz],3));
  geo.setAttribute('uv',new T.Float32BufferAttribute([0,1, 1,1, 1,0, 0,0],2));
  geo.setIndex([0,1,2,0,2,3]);
  var m=new T.Mesh(geo,aoMat);m.renderOrder=1;g.add(m);
}
var blobTex=null;
function blobTexture(){
  if(blobTex)return blobTex;var cv=document.createElement('canvas');cv.width=cv.height=64;var g=cv.getContext('2d'),gr=g.createRadialGradient(32,32,6,32,32,32);
  gr.addColorStop(0,'rgba(0,0,0,.55)');gr.addColorStop(.6,'rgba(0,0,0,.25)');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);
  blobTex=new T.CanvasTexture(cv);return blobTex;
}

function rng(seed){var s=seed>>>0;return function(){s=(s+0x6D2B79F5)>>>0;var t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
function shade(hex,k){var c=new T.Color(hex);c.multiplyScalar(k);return '#'+c.getHexString()}
function makeTex(spec){
  var key=JSON.stringify(spec);if(texCache[key])return texCache[key];
  var N=256,cv=document.createElement('canvas');cv.width=cv.height=N;var g=cv.getContext('2d'),R=rng(key.length*97+spec.a.charCodeAt(1));
  g.fillStyle=spec.a;g.fillRect(0,0,N,N);
  if(spec.k==='tile'){
    for(var i=0;i<2;i++)for(var j=0;j<2;j++){g.fillStyle=((i+j)%2?spec.b:spec.a);g.fillRect(i*128,j*128,128,128);
      g.fillStyle='rgba(255,255,255,'+(0.04*R())+')';g.fillRect(i*128,j*128,128,128)}
    g.strokeStyle=spec.j;g.lineWidth=3;for(var q=0;q<=2;q++){g.beginPath();g.moveTo(q*128,0);g.lineTo(q*128,N);g.moveTo(0,q*128);g.lineTo(N,q*128);g.stroke()}
  }else if(spec.k==='plank'){
    var rows=8,rh=N/rows;
    for(var r=0;r<rows;r++){var cut=R()*N;
      for(var s2=0;s2<2;s2++){var x0=s2?cut:0,x1=s2?N:cut;g.fillStyle=R()>.5?spec.a:spec.b;g.fillRect(x0,r*rh,x1-x0,rh);
        g.fillStyle='rgba(0,0,0,'+(0.03+0.1*R())+')';g.fillRect(x0,r*rh,x1-x0,rh);
        g.strokeStyle='rgba(0,0,0,.07)';g.lineWidth=1;for(var gl=0;gl<4;gl++){var yy=r*rh+R()*rh;g.beginPath();g.moveTo(x0,yy);g.lineTo(x1,yy);g.stroke()}}
      g.strokeStyle=spec.j;g.lineWidth=1.6;g.beginPath();g.moveTo(0,r*rh);g.lineTo(N,r*rh);g.moveTo(cut,r*rh);g.lineTo(cut,(r+1)*rh);g.stroke()}
  }else if(spec.k==='stone'){
    for(var a=0;a<3;a++)for(var b=0;b<3;b++){var jx=(R()-.5)*14,jy=(R()-.5)*14;g.fillStyle=R()>.5?spec.a:spec.b;
      g.fillRect(a*85+jx,b*85+jy,85,85);g.fillStyle='rgba(0,0,0,'+(0.06*R())+')';g.fillRect(a*85+jx,b*85+jy,85,85)}
    g.strokeStyle=spec.j;g.lineWidth=3;for(var m=0;m<=3;m++){g.beginPath();g.moveTo(m*85,0);g.lineTo(m*85,N);g.moveTo(0,m*85);g.lineTo(N,m*85);g.stroke()}
  }else if(spec.k==='concrete'){
    for(var n=0;n<900;n++){g.fillStyle='rgba('+(R()>.5?'255,255,255':'0,0,0')+','+(0.02+0.04*R())+')';g.fillRect(R()*N,R()*N,2+R()*10,2+R()*10)}
    g.fillStyle=spec.b;g.globalAlpha=.4;for(var q2=0;q2<5;q2++){g.beginPath();g.arc(R()*N,R()*N,30+R()*70,0,6.3);g.fill()}g.globalAlpha=1;
    g.strokeStyle=spec.j;g.lineWidth=1;g.strokeRect(0,0,N,N);
  }else if(spec.k==='marble'){
    g.fillStyle=spec.b;g.globalAlpha=.35;for(var p=0;p<6;p++){g.beginPath();g.arc(R()*N,R()*N,40+R()*80,0,6.3);g.fill()}g.globalAlpha=1;
    g.strokeStyle=spec.j;for(var v=0;v<12;v++){g.globalAlpha=.18+R()*.25;g.lineWidth=.6+R()*1.8;g.beginPath();var px=R()*N,py=0;g.moveTo(px,py);
      for(var st=0;st<9;st++){px+=(R()-.45)*50;py+=N/9;g.lineTo(px,py)}g.stroke()}g.globalAlpha=1;
    g.strokeStyle=spec.j;g.globalAlpha=.5;g.lineWidth=1.5;g.strokeRect(0,0,N,N);g.globalAlpha=1;
  }
  var t=new T.CanvasTexture(cv);t.encoding=T.sRGBEncoding;t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  texCache[key]=t;return t;
}
function texCm(spec){return spec.k==='plank'?100:spec.k==='stone'?120:spec.k==='marble'||spec.k==='concrete'?150:(spec.c||60)*2}

var MATS;
function buildMats(){
  var st=STYLES[S.style];MATS={};var wc=S.mat.wall;
  var mk=function(c,r,o){return new T.MeshStandardMaterial(Object.assign({color:lin(c),roughness:r==null?.85:r,envMapIntensity:.3},o||{}))};
  MATS.wall=mk(wc,.95,{side:T.DoubleSide,clippingPlanes:[cutPlane]});
  MATS.scr=MATS.wall;
  MATS.trim=mk(shade(wc,.68),.7,{clippingPlanes:[cutPlane]});
  /* הליבה באותו גוון של הקירות: גוון כהה יותר נקרא כ"קיר בצבע אחר" (תומר, 22.11.2026) */
  MATS.core=mk(wc,.95,{side:T.DoubleSide,clippingPlanes:[cutPlane]});
  MATS.rail=new T.MeshStandardMaterial({color:lin(0xaed0e0),roughness:.05,metalness:.1,envMapIntensity:1.2,transparent:true,opacity:.14,depthWrite:false,side:T.DoubleSide,clippingPlanes:[cutPlane]});
  MATS.glass=new T.MeshStandardMaterial({color:lin(0x9fc4d8),roughness:.03,metalness:.1,envMapIntensity:1.4,transparent:true,opacity:.22,depthWrite:false,side:T.DoubleSide,clippingPlanes:[cutPlane]});
  MATS.frame=new T.MeshStandardMaterial({color:lin(st.flat?0xc9c6bf:0x30343a),roughness:.45,metalness:.3,clippingPlanes:[cutPlane]});
  MATS.ceil=mk(mixC(wc,'#ffffff',.55),1);
  MATS.fx={};Object.keys(st.f).forEach(function(k){MATS.fx[k]=mk(st.f[k],k==='top'?.3:k==='dark'?.4:k==='wood'?.6:.9)});
  MATS.fx.lampshade=mk('#fff3dc',.9,{emissive:lin('#ffe2a8'),emissiveIntensity:.35});
  MATS.fx.sglass=new T.MeshStandardMaterial({color:lin(0xbfe0ea),roughness:.04,transparent:true,opacity:.2,envMapIntensity:1.3,depthWrite:false,side:T.DoubleSide});MATS.fx.pLeg=mk('#3b4047',.85);MATS.fx.pTop=mk('#2f7f86',.8);MATS.fx.pSkin=mk('#c8a98f',.7);
  MATS.fx.tvscreen=mk('#0b0c0e',.12,{metalness:.2,envMapIntensity:1});
  /* חומרי הריהוט. ב"בסיס" הכול נשאר אפור ובלי טקסטורה */
  var F=st.f;
  MATS.fx.cushion=mk(mixC(F.fabric,'#ffffff',.2),.95);
  MATS.fx.rug2=mk(shade(F.rug,.86),.95);
  MATS.fx.green2=mk(shade(F.green,.7),.9);
  MATS.fx.pot=mk(st.flat?F.case:'#e7e1d6',.6);
  MATS.fx.mirror=mk(st.flat?'#c4c1ba':'#cfd9dd',.05,{metalness:.9,envMapIntensity:1.4});
  if(st.flat){MATS.fx.wood2=mk(shade(F.wood,.85),.7)}
  else{MATS.fx.wood=mk('#ffffff',.55,{map:woodTex(F.wood)});MATS.fx.wood2=mk('#ffffff',.5,{map:woodTex(shade(F.wood,.6))})}
  /* מטבח: חזיתות בגוון שנבדל מהקיר, משטח בהיר, ונירוסטה. ארון לבן על קיר לבן נראה כגוש אחד
     (תומר, 22.11.2026). הגוונים לפי סגנון; ב"בסיס" הם אפורים, כמו כל השאר */
  var K=KITCHEN[S.style]||KITCHEN.modern_clean;
  MATS.fx.kcase=mk(K[0],.7);MATS.fx.ward=mk(st.flat?F.case:mixC(K[0],'#ffffff',.55),.75);MATS.fx.ktop=mk(K[1],.25);MATS.fx.ksplash=mk(K[2],.35);
  MATS.fx.steel=mk(st.flat?'#b9b6af':'#b4babf',.3,{metalness:.7,envMapIntensity:1});
  MATS.fx.hob=mk(st.flat?'#a8a59e':'#111315',.12,{metalness:.2,envMapIntensity:1});
}
function floorMat(kind,w,d){
  var spec=S.mat.fl[kind];
  if(spec.k==='flat')return new T.MeshStandardMaterial({color:lin(spec.a),roughness:.9});
  var t=makeTex(spec).clone();t.needsUpdate=true;var cm=texCm(spec);t.repeat.set(w/cm,d/cm);
  return new T.MeshStandardMaterial({map:t,roughness:spec.k==='marble'?.22:spec.k==='tile'?.4:.62,metalness:0,envMapIntensity:spec.k==='marble'||spec.k==='tile'?.9:.4});
}

/* ---- קירות ---- */
function box(g,mat,x1,x2,y0,y1,z1,z2,collide,shadow){
  if(x2-x1<.3||y1-y0<.3||z2-z1<.3)return;
  var m=new T.Mesh(new T.BoxGeometry(x2-x1,y1-y0,z2-z1),mat);
  m.position.set((x1+x2)/2,(y0+y1)/2,(z1+z2)/2);
  m.castShadow=shadow!==false;m.receiveShadow=true;g.add(m);
  if(collide&&y0<100)boxes.push({x1:x1,x2:x2,z1:z1,z2:z2});
  return m;
}
function addWall(g,w){
  var s=S.scale,H=S.ceil,rail=w.t==='rail';
  var th=w.t==='ext'?S.wExt:w.t==='int'?S.wInt:rail?4:8, hh=rail?110:H;
  var horiz=w.h!==undefined, line=(horiz?w.h:w.v)*s;
  var lo=Math.min(w.a,w.b)*s, hi=Math.max(w.a,w.b)*s;
  if(!rail){lo-=th/2;hi+=th/2}
  var mat=rail?MATS.rail:(w.t==='scr'?MATS.scr:MATS.wall);
  var P=function(a,b,y0,y1,m,coll,sh){
    if(horiz)box(g,m||mat,a,b,y0,y1,line-th/2,line+th/2,coll,sh);else box(g,m||mat,line-th/2,line+th/2,y0,y1,a,b,coll,sh);
    /* פריפרף: פס כהה יותר בתחתית הקיר, כדי להפריד בין קיר לרצפה */
    if(!m&&y0===0&&!rail&&y1>30){var e=.9,W=46;
      if(horiz){aoStrip(floorGroup,a,line-th/2,b,line-th/2,0,-W);aoStrip(floorGroup,a,line+th/2,b,line+th/2,0,W)}
      else{aoStrip(floorGroup,line-th/2,a,line-th/2,b,-W,0);aoStrip(floorGroup,line+th/2,a,line+th/2,b,W,0)}
      if(horiz)box(g,MATS.trim,a,b,0,8,line-th/2-e,line+th/2+e,false,false);else box(g,MATS.trim,line-th/2-e,line+th/2+e,0,8,a,b,false,false)}};
  var os=(w.o||[]).map(function(o){return [o[0],clamp(o[1]*s,lo,hi),clamp(o[2]*s,lo,hi)]}).sort(function(p,q){return p[1]-q[1]});
  var cur=lo;
  var glass=function(a,b,y0,y1,mull){
    var gm=MATS.glass;
    if(horiz)box(g,gm,a,b,y0,y1,line-1.5,line+1.5,false,false);else box(g,gm,line-1.5,line+1.5,y0,y1,a,b,false,false);
    var fr=MATS.frame,fw=4;
    P(a,b,y0,y0+fw,fr,false,false);P(a,b,y1-fw,y1,fr,false,false);
    if(horiz){box(g,fr,a,a+fw,y0,y1,line-th/2-.5,line+th/2+.5,false,false);box(g,fr,b-fw,b,y0,y1,line-th/2-.5,line+th/2+.5,false,false)}
    else{box(g,fr,line-th/2-.5,line+th/2+.5,y0,y1,a,a+fw,false,false);box(g,fr,line-th/2-.5,line+th/2+.5,y0,y1,b-fw,b,false,false)}
    if(mull){var n=Math.max(1,Math.round((b-a)/110));for(var i=1;i<=n;i++){var c=a+(b-a)*i/(n+1);P(c-2,c+2,y0,y1,fr,false,false)}}
  };
  os.forEach(function(o){
    P(cur,o[1],0,hh,null,true);
    if(o[0]==='d'){P(o[1],o[2],S.doorH,hh,null,false);
      var fr=MATS.frame;P(o[1]-0,o[1]+3,0,S.doorH,fr,false,false);P(o[2]-3,o[2],0,S.doorH,fr,false,false);P(o[1],o[2],S.doorH-3,S.doorH,fr,false,false)}
    else if(o[0]==='w'){P(o[1],o[2],0,S.sill,null,true);P(o[1],o[2],S.sill+S.winH,hh,null,false);glass(o[1],o[2],S.sill,S.sill+S.winH,true)}
    else{var sh=Math.min(H-20,225);P(o[1],o[2],sh,hh,null,false);glass(o[1],o[2],0,sh,true)}
    cur=o[2];
  });
  P(cur,hi,0,hh,null,true);
  if(rail){P(lo,hi,108,112,MATS.frame,false,false)}
}

/* ---- ריהוט ---- */
function B(g,mat,w,h,d,x,y,z){var m=new T.Mesh(new T.BoxGeometry(w,h,d),mat);m.position.set(x,y+h/2,z);m.castShadow=true;m.receiveShadow=true;g.add(m);return m}
function Cy(g,mat,rt,rb,h,x,y,z,seg){var m=new T.Mesh(new T.CylinderGeometry(rt,rb,h,seg||16),mat);m.position.set(x,y+h/2,z);m.castShadow=true;m.receiveShadow=true;g.add(m);return m}
/* חזיתות, משטח וחיפוי המטבח לכל סגנון: [חזית, משטח, חיפוי קיר] */
var KITCHEN={base:['#c4c1ba','#aaa79f','#d2cfc8'],modern_clean:['#7f878e','#f4f4f2','#dfe3e4'],mediterranean_white:['#3f84ad','#f6f3ec','#e3edf1'],
  warm_scandi:['#c39f6c','#f6f1e8','#ece3d2'],modern_luxury:['#2f3033','#ebe7df','#8f8672']};
/* שורת ארונות: גוף, פסי דלתות וידיות. y0 תחתית, h גובה, z חזית */
function cabRow(g,m,w,h,d,y0,zc,handleTop){
  B(g,m.kcase,w,h,d,0,y0,zc);
  var n=Math.max(2,Math.round(w/60)),zf=zc+d/2;
  for(var i=1;i<n;i++)B(g,m.dark,1,h-4,.8,-w/2+w*i/n,y0+2,zf);
  for(var j=0;j<n;j++)B(g,m.steel,Math.min(26,w/n-14),1.6,2.4,-w/2+w*(j+.5)/n,handleTop?y0+h-9:y0+7,zf+1.2);
}
/* טקסטורת עץ: סיבים לאורך ה-u. נשמרת במטמון לפי צבע, כי rebuild רץ בכל שינוי סגנון */
var woodCache={};
function woodTex(hex){
  if(woodCache[hex])return woodCache[hex];
  var cv=document.createElement('canvas');cv.width=256;cv.height=256;var c=cv.getContext('2d');
  c.fillStyle=hex;c.fillRect(0,0,256,256);
  var seed=7;var rnd=function(){seed=(seed*16807)%2147483647;return seed/2147483647};
  for(var i=0;i<110;i++){
    var y=rnd()*256,dark=rnd()>.35;c.strokeStyle=dark?'rgba(40,24,10,'+(0.03+rnd()*.06)+')':'rgba(255,240,215,'+(0.03+rnd()*.07)+')';
    c.lineWidth=.6+rnd()*2.2;c.beginPath();c.moveTo(0,y);
    var amp=rnd()*5;c.bezierCurveTo(85,y+amp,170,y-amp,256,y);c.stroke();
  }
  var t=new T.CanvasTexture(cv);t.encoding=T.sRGBEncoding;t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  woodCache[hex]=t;return t;
}
/* קופסה מעוגלת: כריות, מזרנים, פינות רכות. r רדיוס הפינה בס"מ */
function R(g,mat,w,h,d,x,y,z,r){
  r=Math.max(.4,Math.min(r==null?3:r,w/2-.2,d/2-.2,h/2-.1));
  var b=r*.6,hw=w/2-b,hd=d/2-b,rr=Math.max(.2,r-b),s=new T.Shape();
  s.moveTo(-hw+rr,-hd);s.lineTo(hw-rr,-hd);s.quadraticCurveTo(hw,-hd,hw,-hd+rr);s.lineTo(hw,hd-rr);s.quadraticCurveTo(hw,hd,hw-rr,hd);
  s.lineTo(-hw+rr,hd);s.quadraticCurveTo(-hw,hd,-hw,hd-rr);s.lineTo(-hw,-hd+rr);s.quadraticCurveTo(-hw,-hd,-hw+rr,-hd);
  var geo=new T.ExtrudeGeometry(s,{depth:Math.max(.1,h-2*b),bevelEnabled:true,bevelSize:b,bevelThickness:b,bevelSegments:2,curveSegments:4});
  geo.rotateX(-Math.PI/2);geo.center();
  var m=new T.Mesh(geo,mat);m.position.set(x,y+h/2,z);m.castShadow=true;m.receiveShadow=true;g.add(m);return m;
}
/* לוח עץ: קופסה שה-UV שלה לפי המידות, כדי שהסיבים יהיו באותו גודל בכל רהיט (חזרה כל 120 ס"מ) */
function W(g,mat,w,h,d,x,y,z){
  var geo=new T.BoxGeometry(w,h,d),uv=geo.attributes.uv,dim=[[d,h],[d,h],[w,d],[w,d],[w,h],[w,h]];
  for(var f=0;f<6;f++)for(var i=0;i<4;i++){var k=f*4+i;uv.setXY(k,uv.getX(k)*dim[f][0]/120,uv.getY(k)*dim[f][1]/120)}
  var m=new T.Mesh(geo,mat);m.position.set(x,y+h/2,z);m.castShadow=true;m.receiveShadow=true;g.add(m);return m;
}
var CORNERS=[[-1,-1],[1,-1],[-1,1],[1,1]];
/* ארבע רגליים מחודדות, נוטות מעט החוצה */
function legs(g,mat,w,d,h,inset,r0,r1,splay){
  CORNERS.forEach(function(c){var l=Cy(g,mat,r0,r1,h,c[0]*(w/2-inset),0,c[1]*(d/2-inset),10);
    if(splay){l.rotation.z=-c[0]*splay;l.rotation.x=c[1]*splay}});
}
function leaves(g,m,list){list.forEach(function(c,i){var s=new T.Mesh(new T.IcosahedronGeometry(c[3],1),i%2?m.green2:m.green);
  s.position.set(c[0],c[1],c[2]);s.scale.y=.82;s.castShadow=true;s.receiveShadow=false;g.add(s)})}
function books(g,m,x,y,z,rot){var a=R(g,m.accent,24,3,17,x,y,z,.8);a.rotation.y=rot;var b=R(g,m.white,21,2.6,15,x+1,y+3,z,.8);b.rotation.y=rot+.25}
function sofaBody(g,m,w,d,n){
  legs(g,m.dark,w,d,9,7,2.2,1.6,0);
  R(g,m.fabric,w,22,d,0,9,0,5);                                   /* בסיס */
  R(g,m.fabric,17,50,d,-w/2+8.5,11,0,7);R(g,m.fabric,17,50,d,w/2-8.5,11,0,7);  /* משענות יד */
  R(g,m.fabric,w-30,52,18,0,26,-d/2+9,7);                         /* גב */
  var cw=(w-36)/n;
  for(var i=0;i<n;i++){var x=-w/2+18+cw*(i+.5);
    R(g,m.cushion,cw-1.6,14,d-30,x,31,9,5);                       /* כרית ישיבה */
    var bc=R(g,m.cushion,cw-3,34,14,x,45,-d/2+25,6);bc.rotation.x=-.16}  /* כרית גב */
}
var BUILD={
  bed2:function(g,m,w,d){bed(g,m,w,d,2)},bed1:function(g,m,w,d){bed(g,m,w,d,1)},
  sofa:function(g,m,w,d){
    sofaBody(g,m,w,d,Math.max(2,Math.round((w-36)/72)));
    var p1=R(g,m.accent,38,36,11,-w/2+38,47,-d/2+36,5);p1.rotation.x=-.3;p1.rotation.z=.12;
    var p2=R(g,m.white,34,32,10,w/2-36,47,-d/2+36,5);p2.rotation.x=-.3;p2.rotation.z=-.1;
  },
  arm:function(g,m,w,d){sofaBody(g,Object.assign({},m,{fabric:m.accent,cushion:m.accent}),w,d,1)},
  coffee:function(g,m,w,d){
    W(g,m.wood,w,3.5,d,0,36,0);W(g,m.wood,w-16,2,d-16,0,13,0);
    CORNERS.forEach(function(c){B(g,m.dark,3,36,3,c[0]*(w/2-5),0,c[1]*(d/2-5))});
    books(g,m,-w*.2,39.5,0,.2);Cy(g,m.pot,10,6,6,w*.22,39.5,-2,20)},
  coffeeR:function(g,m,w){Cy(g,m.wood,w/2,w/2,3.5,0,36,0,36);Cy(g,m.dark,2.5,2.5,34,0,2,0,10);Cy(g,m.dark,w*.3,w*.3,2,0,0,0,24);books(g,m,-6,39.5,4,.5)},
  table:function(g,m,w,d){
    W(g,m.wood,w,4,d,0,71,0);
    W(g,m.wood2,w-26,7,2.5,0,64,d/2-13);W(g,m.wood2,w-26,7,2.5,0,64,-d/2+13);W(g,m.wood2,2.5,7,d-26,w/2-13,64,0);W(g,m.wood2,2.5,7,d-26,-w/2+13,64,0);
    legs(g,m.wood2,w,d,71,11,3.4,2.2,0);
    if(w>=150){Cy(g,m.pot,5,7,22,0,75,0,16);leaves(g,m,[[0,106,0,10],[-7,100,3,8],[7,101,-3,8]])}
  },
  otable:function(g,m,w,d){W(g,m.wood,w,4,d,0,71,0);legs(g,m.dark,w,d,71,10,2.6,2.6,0)},
  chair:function(g,m,w,d){
    legs(g,m.wood2,w,d,44,5,1.7,1.1,.07);
    R(g,m.fabric,w-3,6,d-3,0,43,1,2.5);
    var bk=R(g,m.fabric,w-5,38,4.5,0,50,-d/2+3.5,2.2);bk.rotation.x=-.13;
  },
  ochair:function(g,m,w,d){BUILD.chair(g,Object.assign({},m,{fabric:m.white,wood2:m.dark}),w,d)},
  wardrobe:function(g,m,w,d){
    B(g,m.dark,w-2,8,d-5,0,0,-1);B(g,m.ward,w,222,d-2,0,8,-1);
    var n=Math.max(2,Math.round(w/50)),dw=w/n;
    for(var i=0;i<n;i++){var x=-w/2+dw*(i+.5);
      B(g,m.ward,dw-1.2,218,2,x,10,d/2-1);                         /* דלת בולטת, והרווח ביניהן הוא הצל */
      B(g,m.steel,1.4,60,2.4,x+(i%2?-1:1)*(dw/2-5),95,d/2+1)}      /* ידית ארוכה */
  },
  desk:function(g,m,w,d){
    W(g,m.wood,w,3.5,d,0,72,0);B(g,m.dark,3,72,3,-w/2+5,0,d/2-5);B(g,m.dark,3,72,3,-w/2+5,0,-d/2+5);
    W(g,m.wood2,38,56,d-6,w/2-21,14,0);B(g,m.dark,38,.8,.8,w/2-21,42,d/2-2.6);B(g,m.steel,14,1.4,2,w/2-21,58,d/2-2);B(g,m.steel,14,1.4,2,w/2-21,30,d/2-2);
    B(g,m.tvscreen,56,32,2.2,-8,88,-d/2+13);B(g,m.dark,3,13,3,-8,75.5,-d/2+14);B(g,m.dark,20,1.2,13,-8,75.5,-d/2+14);
    B(g,m.dark,40,1.4,13,-8,75.5,d/2-18)},
  tv:function(g,m,w,d){
    /* מזנון עץ על רגליים, עם דלתות; מעליו מסך עם מסגרת, מקרן קול ופריטי נוי */
    legs(g,m.dark,w,d,12,8,1.8,1.3,0);W(g,m.wood,w,34,d,0,12,0);
    var n=Math.max(3,Math.round(w/55));for(var i=1;i<n;i++)B(g,m.dark,.8,30,.8,-w/2+w*i/n,14,d/2);
    for(var j=0;j<n;j++)B(g,m.steel,10,1.2,1.6,-w/2+w*(j+.5)/n,39,d/2+.8);
    var sw=Math.min(w*.7,150),sh=sw*.5625;
    B(g,m.dark,sw+2.4,sh+2.4,2.4,0,82,-d/2+2.2);B(g,m.tvscreen,sw,sh,1,0,83.2,-d/2+3.6);
    R(g,m.dark,Math.min(90,sw*.6),6,8,0,46,-d/2+12,2);
    if(w>=140){books(g,m,w/2-22,46,2,.15);Cy(g,m.pot,6,5,10,-w/2+18,46,2,16);leaves(g,m,[[-w/2+18,66,2,9],[-w/2+13,61,5,7],[-w/2+23,62,0,7]])}
  },
  island:function(g,m,w,d){
    B(g,m.dark,w-8,10,d-10,0,0,0);cabRow(g,m,w,78,d,10,0,true);B(g,m.ktop,w+6,4,d+26,0,88,10);
    for(var i=0;i<3;i++){var sx=-w*.3+i*w*.3;Cy(g,m.steel,2,2,62,sx,0,d/2+34,8);Cy(g,m.wood,17,17,5,sx,62,d/2+34,18);Cy(g,m.steel,14,14,1.5,sx,0,d/2+34,16)}},
  kitchen:function(g,m,w,d){
    /* תחתונים: צוקל שקוע, ארונות, משטח עם בליטה */
    B(g,m.dark,w,10,d-6,0,0,-3);cabRow(g,m,w,76,d,10,0,true);B(g,m.ktop,w,4,d+3,0,86,1.5);
    /* חיפוי קיר בין המשטח לעליונים, ועליונים */
    B(g,m.ksplash,w,60,1.5,0,90,-d/2+.8);cabRow(g,m,w,72,35,150,-d/2+17.5,false);
    /* כיריים: זכוכית שחורה וארבע להבות */
    var hx=-w*.24;B(g,m.hob,60,1,50,hx,90,0);
    [[-14,-11],[14,-11],[-14,12],[14,12]].forEach(function(c){Cy(g,m.steel,8,8,.6,hx+c[0],91,c[1],20)});
    /* כיור נירוסטה וברז */
    var sx=w*.2;B(g,m.steel,56,1,42,sx,90,2);B(g,m.dark,48,.6,34,sx,91,2);
    Cy(g,m.steel,1.6,1.6,30,sx,90,-d/2+8,8);B(g,m.steel,2.4,2.4,18,sx,119,-d/2+16);
  },
  rug:function(g,m,w,d){B(g,m.rug2,w,1,d,0,0.3,0);B(g,m.rug,w-18,1.2,d-18,0,0.3,0)},
  plant:function(g,m){Cy(g,m.pot,15,11,30,0,0,0,18);Cy(g,m.dark,13.5,13.5,1,0,29.5,0,18);Cy(g,m.wood2,1.6,2.2,44,0,30,0,8);
    leaves(g,m,[[0,92,0,24],[-14,78,8,17],[15,80,-6,16],[4,70,-14,14],[-6,104,-4,15],[10,98,10,13]])},
  lamp:function(g,m){Cy(g,m.dark,14,14,2.5,0,0,0,20);Cy(g,m.steel,1.3,1.3,150,0,2.5,0,8);Cy(g,m.lampshade,17,24,30,0,150,0,20)},
  tub:function(g,m,w,d){R(g,m.white,w,56,d,0,0,0,12);R(g,m.ksplash,w-14,1,d-14,0,55.5,0,8);
    Cy(g,m.steel,1.6,1.6,18,w/2-12,56,0,8);B(g,m.steel,12,2.2,2.2,w/2-17,72,0)},
  toilet:function(g,m,w,d){
    /* אחורה = -z (הקיר). מיכל, בסיס, קערה אליפטית, מושב ומכסה, וכפתור שטיפה */
    R(g,m.white,38,40,17,0,42,-d/2+9,3);B(g,m.steel,10,1.5,5,0,82,-d/2+9);
    B(g,m.white,28,42,18,0,0,-d/2+12);
    var bowl=Cy(g,m.white,17,13,40,0,0,2,28);bowl.scale.z=1.35;
    var seat=Cy(g,m.top,18.5,18.5,3,0,40,2,28);seat.scale.z=1.35;
    var lid=Cy(g,m.white,17.5,17.5,2,0,43,2,28);lid.scale.z=1.3;
  },
  shower:function(g,m,w,d){
    B(g,m.white,w,5,d,0,0,0);
    var s1=B(g,m.sglass,w,200,1.5,0,5,d/2-1);var s2=B(g,m.sglass,1.5,200,d,w/2-1,5,0);s1.castShadow=false;s2.castShadow=false;
    B(g,m.steel,w,3,2.5,0,203,d/2-1);B(g,m.steel,2.5,3,d,w/2-1,203,0);
    Cy(g,m.steel,1.2,1.2,150,-w/2+8,5,-d/2+8,6);Cy(g,m.steel,8,8,2,-w/2+8,152,-d/2+14,16);
  },
  sink:function(g,m,w,d){
    /* ארון תלוי מעץ, משטח, כיור מונח, ברז ומראה */
    W(g,m.wood,w,50,d-3,0,30,-1.5);B(g,m.dark,w-6,.8,.8,0,55,d/2-2.6);R(g,m.white,w+2,4,d,0,80,0,1.5);
    var bs=Cy(g,m.white,15,11,9,0,84,3,24);bs.scale.z=.82;var hole=Cy(g,m.ksplash,12.5,12.5,.5,0,92.8,3,24);hole.scale.z=.82;
    Cy(g,m.steel,1.3,1.3,20,0,84,-d/2+5,8);B(g,m.steel,2,2,11,0,103,-d/2+10);
    B(g,m.dark,w-4,74,1.2,0,112,-d/2+.6);B(g,m.mirror,w-7,71,.6,0,113.5,-d/2+1.4)},
  osofa:function(g,m,w,d){BUILD.sofa(g,Object.assign({},m,{fabric:m.wood,cushion:m.white,accent:m.accent}),w,d)},
  lounger:function(g,m,w,d){W(g,m.wood,w,22,d,0,0,0);R(g,m.white,w-6,7,d-6,0,22,0,3);var b=R(g,m.white,w-6,7,70,0,38,-d/2+18,3);b.rotation.x=-0.75},
  umbrella:function(g,m,w){Cy(g,m.dark,2.5,2.5,230,0,0,0,8);Cy(g,m.white,3,w/2,30,0,205,0,20);Cy(g,m.accent,w/2.05,w/2.05,.6,0,206,0,20)},
  planter:function(g,m,w,d){B(g,m.dark,w,45,d,0,0,0);var L=[];for(var i=0;i<4;i++)L.push([-w/2+w*(i+.5)/4,62+(i%2)*4,0,19]);leaves(g,m,L)}
};
function person(g,m,h,sw){
  var legH=h*.47,torsoH=h*.31,headR=h*.066,neck=h*.03,lw=sw*.15;
  Cy(g,m.pLeg,lw*.6,lw*.45,legH,-sw*.2,0,0,10);Cy(g,m.pLeg,lw*.6,lw*.45,legH,sw*.2,0,0,10);
  var t=Cy(g,m.pTop,sw*.42,sw*.34,torsoH,0,legH,0,14);t.scale.z=.55;
  Cy(g,m.pSkin,3.3,2.6,torsoH*1.02,-sw*.5,legH+torsoH*.0,0,8);Cy(g,m.pSkin,3.3,2.6,torsoH*1.02,sw*.5,legH+torsoH*.0,0,8);
  Cy(g,m.pSkin,4.2,4.2,neck*1.3,0,legH+torsoH,0,8);
  var hd=new T.Mesh(new T.SphereGeometry(headR,14,10),m.pSkin);hd.position.set(0,legH+torsoH+neck+headR,0);hd.castShadow=true;g.add(hd);
}
BUILD.personM=function(g,m){person(g,m,178,50)};BUILD.personF=function(g,m){person(g,m,165,42)};BUILD.child=function(g,m){person(g,m,125,32)};
function bed(g,m,w,d,n){
  legs(g,m.wood2,w,d,7,6,2.4,1.8,0);
  W(g,m.wood,w+4,20,d+4,0,7,0);                                   /* מסגרת */
  R(g,m.white,w-2,20,d-6,0,27,3,6);                                /* מזרן */
  R(g,m.fabric,w+3,9,d*.6,0,44,d*.2,4);                            /* שמיכה */
  R(g,m.white,w+3,5,18,0,49,d*.2-d*.3+9,2.5);                      /* קיפול הסדין */
  R(g,m.accent,w+4,2.6,46,0,53,d/2-44,1.2);                        /* כיסוי לרגלי המיטה */
  var pw=n===2?w/2-12:w-26;
  for(var i=0;i<n;i++){var x=n===2?(i?1:-1)*(w/4):0;
    var p=R(g,m.white,pw,13,40,x,47,-d/2+27,6);p.rotation.x=.3;
    var q=R(g,m.accent,pw*.62,11,28,x,49,-d/2+50,5);q.rotation.x=.45}
  R(g,m.accent,w+10,105,9,0,0,-d/2-4.5,4);                          /* גב מרופד */
}
function buildFurn(f){
  var def=CAT[f.t],w=f.w||def.w,d=f.d||def.d,g=new T.Group();
  BUILD[f.t](g,MATS.fx,w,d);
  if(f.t!=='rug'&&f.t!=='umbrella'){var bl=new T.Mesh(new T.PlaneGeometry(w*1.25+16,d*1.25+16),new T.MeshBasicMaterial({map:blobTexture(),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
    bl.rotation.x=-Math.PI/2;bl.position.y=.45;bl.renderOrder=1;g.add(bl)}
  g.userData.fid=f.id;g.userData.w=w;g.userData.d=d;
  g.traverse(function(o){if(o.isMesh)o.userData.fid=f.id});
  placeFurn(g,f);return g;
}
function placeFurn(g,f){g.position.set(f.x*S.scale,0,f.y*S.scale);g.rotation.y=-rad(f.rot)}

/* ---- בניית הסצנה ---- */
function dispose(g){if(!g)return;g.traverse(function(o){if(o.geometry)o.geometry.dispose()});world.remove(g)}
var selBox=null;
function rebuild(){
  [wallGroup,floorGroup,furnGroup,labelGroup,lampGroup,ceilGroup,edgeGroup].forEach(dispose);
  if(planMesh){world.remove(planMesh);planMesh=null}
  if(selBox){world.remove(selBox);selBox=null}
  boxes=[];floorMeshes=[];furnMap={};
  buildMats();
  var s=S.scale,H=S.ceil;
  scene.background=scene.background||new T.Color('#cfe3ee');
  /* רצפות ותקרות */
  floorGroup=new T.Group();ceilGroup=new T.Group();
  MODEL.rooms.forEach(function(r){r.r.forEach(function(q){
    var w=(q[2]-q[0])*s,d=(q[3]-q[1])*s;
    var m=new T.Mesh(new T.PlaneGeometry(w,d),floorMat(r.f,w,d));m.rotation.x=-Math.PI/2;
    m.position.set((q[0]+q[2])/2*s,.2,(q[1]+q[3])/2*s);m.receiveShadow=true;m.userData.room=r.id;floorGroup.add(m);floorMeshes.push(m);
    if(!r.nc){var c=new T.Mesh(new T.PlaneGeometry(w,d),MATS.ceil);c.rotation.x=Math.PI/2;c.position.set((q[0]+q[2])/2*s,H,(q[1]+q[3])/2*s);c.castShadow=true;c.receiveShadow=true;ceilGroup.add(c)}
  })});
  world.add(floorGroup);world.add(ceilGroup);
  /* קירות וליבה */
  wallGroup=new T.Group();
  MODEL.walls.forEach(function(w){addWall(wallGroup,w)});
  MODEL.solids.forEach(function(q){box(wallGroup,MATS.core,q[0]*s,q[2]*s,0,H,q[1]*s,q[3]*s,true)});
  world.add(wallGroup);
  buildCutEdges();
  /* ריהוט */
  furnGroup=new T.Group();
  FURN.forEach(function(f){var g=buildFurn(f);furnMap[f.id]=g;furnGroup.add(g)});
  world.add(furnGroup);
  /* תוויות */
  labelGroup=new T.Group();
  MODEL.labels.forEach(function(l){labelGroup.add(makeLabel(l[0],l[1]*s,l[2]*s))});
  labelGroup.visible=S.labels&&S.mode==='drone';world.add(labelGroup);
  /* מנורות */
  lampGroup=new T.Group();
  MODEL.lamps.forEach(function(p){var L=new T.PointLight(STYLES[S.style].lamp,0.5,650,1.3);L.position.set(p[0]*s,H-30,p[1]*s);lampGroup.add(L)});
  world.add(lampGroup);
  /* תוכנית מקור */
  if(PLAN_IMG){
  var tex=new T.TextureLoader().load(PLAN_IMG,function(){});tex.encoding=T.sRGBEncoding;
  planMesh=new T.Mesh(new T.PlaneGeometry(MODEL.imgW*s,MODEL.imgH*s),new T.MeshBasicMaterial({map:tex,transparent:true,opacity:.38,depthWrite:false}));
  planMesh.rotation.x=-Math.PI/2;planMesh.position.set(MODEL.imgW/2*s,1.2,MODEL.imgH/2*s);planMesh.visible=S.plan;planMesh.renderOrder=2;
  world.add(planMesh);
  }
  var c=center();sun.target.position.set(c.x,0,c.z);
  applyCut();updateSun();refreshLists();
  if(selId&&furnMap[selId])showSel();
}
var labelFont='500 30px Heebo, Rubik, sans-serif';
function makeLabel(text,x,z){
  var cv=document.createElement('canvas'),g=cv.getContext('2d');g.font=labelFont;
  var tw=Math.ceil(g.measureText(text).width)+28;cv.width=tw;cv.height=52;
  g=cv.getContext('2d');g.font=labelFont;g.fillStyle='rgba(15,28,33,.72)';
  var r=26;g.beginPath();g.moveTo(r,0);g.arcTo(tw,0,tw,52,r);g.arcTo(tw,52,0,52,r);g.arcTo(0,52,0,0,r);g.arcTo(0,0,tw,0,r);g.fill();
  g.fillStyle='#fff';g.textBaseline='middle';g.textAlign='center';g.direction='rtl';g.fillText(text,tw/2,27);
  var t=new T.CanvasTexture(cv);t.encoding=T.sRGBEncoding;var sp=new T.Sprite(new T.SpriteMaterial({map:t,depthTest:false,transparent:true}));
  sp.scale.set(tw*0.62,52*0.62,1);sp.position.set(x,45,z);sp.renderOrder=5;return sp;
}
/* ראש הקיר החתוך: משטח בגוון כהה מעט וקו מתאר כהה. בלי זה קיר לבן על רצפה בהירה
   נבלע בזוויות מסוימות, ולא ברור איפה הקיר נגמר (תומר, 22.11.2026) */
function buildCutEdges(){
  edgeGroup=new T.Group();
  var wc=new T.Color().copy(MATS.wall.color);
  /* המתאר הוא גאומטריה ולא קו: קו של פיקסל אחד נעלם במסך צפוף. משטח כהה בגודל הקיר,
     ומעליו משטח בגוון הקיר שקטן ב-EDGE מכל צד. הקו הדק נשאר כרצפה למבט רחוק */
  var EDGE=3;
  var capM=new T.MeshBasicMaterial({color:wc.clone().multiplyScalar(.74)});
  var rimM=new T.MeshBasicMaterial({color:0x1d2529});
  var lineM=new T.LineBasicMaterial({color:0x1d2529});
  var pts=[];
  var flat=function(w,d,mat,x,y,z){var c=new T.Mesh(new T.PlaneGeometry(w,d),mat);c.rotation.x=-Math.PI/2;c.position.set(x,y,z);edgeGroup.add(c)};
  wallGroup.traverse(function(m){
    if(!m.isMesh||(m.material!==MATS.wall&&m.material!==MATS.core))return;
    /* במרחב של world (ס"מ) */
    var gp=m.geometry.parameters,ps=m.position;
    /* חתוך: המתאר בגובה החיתוך. שלם: בראש הקיר, ורק לקירות שמגיעים לתקרה (לא לאדני חלונות) */
    var top=ps.y+gp.height/2,L;
    if(S.cut){if(ps.y-gp.height/2>CUT_H-1||top<CUT_H+1)return;L=CUT_H}
    else{if(top<S.ceil-1)return;L=top+.1}
    var x1=ps.x-gp.width/2,x2=ps.x+gp.width/2,z1=ps.z-gp.depth/2,z2=ps.z+gp.depth/2,y=L+.3;
    if(x2-x1<1||z2-z1<1)return;
    flat(x2-x1,z2-z1,rimM,(x1+x2)/2,L,(z1+z2)/2);
    if(x2-x1>2*EDGE+1&&z2-z1>2*EDGE+1)flat(x2-x1-2*EDGE,z2-z1-2*EDGE,capM,(x1+x2)/2,L+.15,(z1+z2)/2);
    pts.push(x1,y,z1,x2,y,z1, x2,y,z1,x2,y,z2, x2,y,z2,x1,y,z2, x1,y,z2,x1,y,z1);
  });
  var g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pts,3));
  edgeGroup.add(new T.LineSegments(g,lineM));
  edgeGroup.visible=S.mode==='drone';
  world.add(edgeGroup);
}
function applyCut(){
  cutPlane.constant=S.cut&&S.mode==='drone'?CUT_H:100000;
  /* המתאר יושב בגובה אחר בכל מצב, ולכן נבנה מחדש (כמה עשרות משטחים) */
  if(wallGroup&&MATS.wall){dispose(edgeGroup);buildCutEdges()}
  ceilGroup.visible=true;
}

/* ================= שמש ותאורה ================= */
var lastSun={el:30,az:180};
function mixC(a,b,t){return new T.Color(a).lerp(new T.Color(b),clamp(t,0,1))}
function updateSun(){
  var ll=CITIES[S.city]||CITIES['עפולה'];
  var p=sunPos(ll[0],ll[1],S.date,S.time);lastSun=p;
  var psi=rad(S.north+p.az),el=rad(p.el),c=center();
  var dx=Math.sin(psi),dz=-Math.cos(psi);
  sun.position.set(c.x+dx*Math.cos(el)*4500,Math.sin(el)*4500,c.z+dz*Math.cos(el)*4500);
  sun.target.position.set(c.x,0,c.z);
  var up=clamp(Math.sin(el)*3,0,1);
  sun.visible=p.el>0.3;
  sun.intensity=0.9*Math.pow(clamp(Math.sin(el),0,1),0.45);
  sun.color.copy(mixC(0xff9a4d,0xfff4e0,clamp(p.el/22,0,1)));
  var dayT=clamp((p.el+6)/14,0,1);
  /* מילוי אחיד חזק: בלי זה קיר מוצל וקיר מואר נראים כשני צבעים שונים */
  hemi.intensity=0.08+0.2*dayT;amb.intensity=0.05+0.36*dayT;
  hemi.color.copy(mixC(0x2a3a5c,0xdfeeff,dayT));
  var sky=mixC('#0d1626','#cfe3ee',dayT);
  if(p.el>-4&&p.el<10)sky.lerp(new T.Color('#f0c79a'),0.45*(1-Math.abs(p.el-3)/7));
  scene.background=sky;
  var ek=p.el>8?'day':p.el>-3?'dusk':'night';try{var ev=envFor(ek);if(scene.environment!==ev)scene.environment=ev}catch(err){scene.environment=null}
  renderer.toneMappingExposure=p.el>8?0.95:p.el>-3?0.9:0.85;
  ground.material.color.copy(mixC('#161d1c','#b9c3bf',dayT).convertSRGBToLinear());
  var lampsOn=S.lamps==='on'||(S.lamps==='auto'&&p.el<6);
  lampGroup.children.forEach(function(L){L.intensity=lampsOn?0.55:0});
  lampGroup.visible=true;
  var ll2=sunDay(ll[0],ll[1],S.date);
  $('timeLbl').textContent='שעה: '+fmtH(S.time);
  $('time').value=S.time;
  $('info').innerHTML='<span>'+esc(S.city)+' · '+S.date.split('-').reverse().join('.')+' · <b>'+fmtH(S.time)+'</b></span>'+
    '<span>שמש: גובה <b>'+Math.round(p.el)+'°</b> · '+(p.el>0?dirName(p.az):'מתחת לאופק')+'</span>';
  $('sunTbl').innerHTML='<tr><th>זריחה</th><td class="n">'+fmtH(ll2.rise)+'</td><th>שקיעה</th><td class="n">'+fmtH(ll2.set)+'</td></tr>'+
    '<tr><th>גובה</th><td class="n">'+Math.round(p.el)+'°</td><th>אזימוט</th><td class="n">'+Math.round(p.az)+'° ('+dirName(p.az)+')</td></tr>';
}

/* ================= מצלמה ================= */
var tmpCam=new T.PerspectiveCamera();
function poseDrone(d){
  var pos=new T.Vector3(d.tx+d.rad*Math.sin(d.pol)*Math.sin(d.az),d.rad*Math.cos(d.pol),d.tz+d.rad*Math.sin(d.pol)*Math.cos(d.az));
  tmpCam.position.copy(pos);tmpCam.up.set(0,1,0);
  if(d.pol<0.08)tmpCam.up.set(-Math.sin(d.az),0,-Math.cos(d.az));
  tmpCam.lookAt(d.tx,0,d.tz);tmpCam.updateMatrixWorld();
  return {p:pos,q:tmpCam.quaternion.clone(),fov:42};
}
function poseFP(f){
  var e=new T.Euler(f.pitch,-f.yaw,0,'YXZ');
  return {p:new T.Vector3(f.x,160,f.z),q:new T.Quaternion().setFromEuler(e),fov:72};
}
function poseOf(v){return v.mode==='fp'?poseFP(v.fp):poseDrone(v.drone)}
function applyCamera(){
  if(tw)return;
  var P=S.mode==='fp'?poseFP(S.fp):poseDrone(S.drone);
  camera.position.copy(P.p);camera.quaternion.copy(P.q);
  if(camera.fov!==P.fov){camera.fov=P.fov;camera.updateProjectionMatrix()}
}
var tw=null;
function goView(v,quick){
  var to=poseOf(v);
  if(quick){commitView(v);return}
  tw={t0:performance.now(),dur:900,p0:camera.position.clone(),q0:camera.quaternion.clone(),f0:camera.fov,to:to,v:v};
  if(v.mode==='fp')labelGroup.visible=false;
  $('dpad').classList.remove('on');
}
function commitView(v){
  S.mode=v.mode;if(v.mode==='fp')S.fp=Object.assign({},v.fp);else S.drone=Object.assign({},v.drone);
  syncMode();applyCut();applyCamera();
}
function syncMode(){
  $('mDrone').setAttribute('aria-pressed',S.mode==='drone');$('mFp').setAttribute('aria-pressed',S.mode==='fp');
  labelGroup.visible=S.labels&&S.mode==='drone';
  $('stage').dataset.mode=S.mode;
  if(S.mode==='fp'){try{canvas.focus({preventScroll:true})}catch(e){}}else{if(document.pointerLockElement)document.exitPointerLock();if(marker)marker.visible=false}
  $('dpad').classList.toggle('on',S.mode==='fp'&&matchMedia('(pointer:coarse)').matches);
  showHint();
}
function stepTween(now){
  if(!tw)return;
  var k=clamp((now-tw.t0)/tw.dur,0,1),e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
  camera.position.lerpVectors(tw.p0,tw.to.p,e);camera.quaternion.slerpQuaternions(tw.q0,tw.to.q,e);
  camera.fov=tw.f0+(tw.to.fov-tw.f0)*e;camera.updateProjectionMatrix();
  if(S.mode==='drone'&&tw.v.mode==='fp'&&k>.15){cutPlane.constant=100000;if(edgeGroup)edgeGroup.visible=false}
  if(k>=1){var v=tw.v;tw=null;commitView(v)}
}
var hintT=null;
function showHint(){
  var h=$('hint');h.style.opacity=1;
  var touch=matchMedia('(pointer:coarse)').matches;
  h.textContent=S.mode==='drone'
    ?(touch?'אצבע אחת לסיבוב, שתי אצבעות לזום ולהזזה':'גרירה לסיבוב, גלגלת לזום, לחצן ימני להזזה')
    :(touch?'גררו כדי להסתכל, החצים להליכה, הקשה על הרצפה או על המפה למעבר':'גרירה להסתכלות, W A S D להליכה, לחיצה על הרצפה או על המפה למעבר');
  clearTimeout(hintT);hintT=setTimeout(function(){h.style.opacity=0},5200);
}
function curView(name){return {n:name,mode:S.mode,drone:Object.assign({},S.drone),fp:Object.assign({},S.fp)}}

/* ---- קלט ---- */
var ptrs=new Map(),drag=null,keys={};
var ray=new T.Raycaster(),ndc=new T.Vector2();
function setNdc(e){var r=canvas.getBoundingClientRect();ndc.set((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height*2-1))}
function pickFurn(e){setNdc(e);ray.setFromCamera(ndc,camera);var h=ray.intersectObjects(furnGroup.children,true);
  for(var i=0;i<h.length;i++){var id=h[i].object.userData.fid;if(id&&!(CATF(id)==='rug'&&h.length>1&&i<h.length-1))return {id:id,pt:h[i].point}}return null}
function CATF(id){var f=FURN.filter(function(x){return x.id===id})[0];return f&&f.t}
function groundPt(e){setNdc(e);ray.setFromCamera(ndc,camera);var pl=new T.Plane(new T.Vector3(0,1,0),0),p=new T.Vector3();return ray.ray.intersectPlane(pl,p)?p:null}
canvas.addEventListener('contextmenu',function(e){e.preventDefault()});
canvas.addEventListener('pointerdown',function(e){
  if(tw)return;canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY,x0:e.clientX,y0:e.clientY,moved:0});
  if(ptrs.size===1){
    drag={kind:null,btn:e.button,shift:e.shiftKey};
    if(S.mode==='drone'&&S.edit&&e.button===0){var h=pickFurn(e);
      if(h){selectF(h.id);var f=getF(h.id),gp=groundPt(e);drag={kind:'furn',id:h.id,dx:gp?f.x*S.scale-gp.x:0,dz:gp?f.y*S.scale-gp.z:0}}}
  }else if(ptrs.size===2){drag={kind:'pinch'};var a=Array.from(ptrs.values());drag.d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);drag.mx=(a[0].x+a[1].x)/2;drag.my=(a[0].y+a[1].y)/2}
});
canvas.addEventListener('pointermove',function(e){
  var p=ptrs.get(e.pointerId);if(!p||tw)return;
  var dx=e.clientX-p.x,dy=e.clientY-p.y;p.moved+=Math.abs(dx)+Math.abs(dy);p.x=e.clientX;p.y=e.clientY;
  if(!drag)return;
  if(drag.kind==='furn'){var gp=groundPt(e);if(gp){var f=getF(drag.id);
      f.x=clamp((gp.x+drag.dx)/S.scale,BOUNDS.x1-20,BOUNDS.x2+20);f.y=clamp((gp.z+drag.dz)/S.scale,BOUNDS.y1-20,BOUNDS.y2+20);placeFurn(furnMap[f.id],f);updSel();dirty()}return}
  if(drag.kind==='pinch'&&ptrs.size>=2){
    var a=Array.from(ptrs.values()),d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),mx=(a[0].x+a[1].x)/2,my=(a[0].y+a[1].y)/2;
    if(S.mode==='drone'){S.drone.rad=clamp(S.drone.rad*drag.d/Math.max(d,1),300,6500);panDrone(mx-drag.mx,my-drag.my)}
    drag.d=d;drag.mx=mx;drag.my=my;return}
  if(S.mode==='drone'){
    if(drag.btn===2||drag.shift||drag.btn===1)panDrone(dx,dy);
    else{S.drone.az-=dx*0.006;S.drone.pol=clamp(S.drone.pol-dy*0.005,0.04,1.45)}
  }else{S.fp.yaw-=dx*0.0045;S.fp.pitch=clamp(S.fp.pitch+dy*0.004,-1.2,1.2)}
});
function panDrone(dx,dy){var d=S.drone,s=d.rad*0.0013;
  d.tx-= Math.cos(d.az)*dx*s;d.tz-=-Math.sin(d.az)*dx*s;
  d.tx+= -Math.sin(d.az)*dy*s;d.tz+=-Math.cos(d.az)*dy*s}
function endPtr(e){
  var p=ptrs.get(e.pointerId);ptrs.delete(e.pointerId);
  if(p&&p.moved<6&&ptrs.size===0&&!tw){
    if(S.mode==='fp'){tapMove(e,locked)}
    else if(S.edit){var h=pickFurn(e);selectF(h?h.id:null)}
  }
  if(ptrs.size===0)drag=null;
}
canvas.addEventListener('pointerup',endPtr);canvas.addEventListener('pointercancel',endPtr);
canvas.addEventListener('wheel',function(e){e.preventDefault();if(tw)return;
  if(S.mode==='drone')S.drone.rad=clamp(S.drone.rad*Math.exp(e.deltaY*0.0011),300,6500);
  else{var f=S.fp,st=clamp(-e.deltaY*0.4,-70,70);S.fpGoal=null;
    var r=resolve(f.x+Math.sin(f.yaw)*st,f.z-Math.cos(f.yaw)*st);f.x=r.x;f.z=r.z}},{passive:false});
function tapMove(e,center){
  if(center)ndc.set(0,0);else setNdc(e);
  ray.setFromCamera(ndc,camera);var h=ray.intersectObjects(floorMeshes,false);
  if(h.length)goTo(h[0].point.x,h[0].point.z);
}
/* סמן מעבר על הרצפה במבט ראשון (עכבר) */
var marker=null,locked=false;
canvas.addEventListener('pointermove',function(e){
  if(!marker)return;
  if(S.mode!=='fp'||e.pointerType!=='mouse'||e.buttons||locked||tw){marker.visible=false;return}
  setNdc(e);ray.setFromCamera(ndc,camera);var h=ray.intersectObjects(floorMeshes,false);
  if(h.length){marker.position.set(h[0].point.x,1.5,h[0].point.z);marker.visible=true}else marker.visible=false;
});
canvas.addEventListener('pointerleave',function(){if(marker)marker.visible=false});
function togglePerson(){
  var ex=FURN.filter(function(f){return f.auto})[0];
  if(ex){furnGroup.remove(furnMap[ex.id]);delete furnMap[ex.id];FURN=FURN.filter(function(f){return f!==ex});if(selId===ex.id)selId=null;refreshLists();selTools();$('tgPerson').setAttribute('aria-pressed',false);return}
  var f0=S.fp,fx=Math.sin(f0.yaw),fz=-Math.cos(f0.yaw),d=300,x=f0.x+fx*d,z=f0.z+fz*d;
  while(d>110&&inside(x,z)){d-=30;x=f0.x+fx*d;z=f0.z+fz*d}
  var f={id:'f'+(uid++),t:'personM',x:x/S.scale,y:z/S.scale,rot:(deg(f0.yaw)+180)%360,w:0,d:0,auto:1};
  FURN.push(f);var g=buildFurn(f);furnMap[f.id]=g;furnGroup.add(g);refreshLists();$('tgPerson').setAttribute('aria-pressed',true);dirty();
}
$('tgPerson').addEventListener('click',togglePerson);
$('tgLock').addEventListener('click',function(){
  if(document.pointerLockElement===canvas){document.exitPointerLock();return}
  try{var r=canvas.requestPointerLock();if(r&&r.catch)r.catch(function(){$('tgLock').textContent='לא נתמך כאן'})}catch(e){$('tgLock').textContent='לא נתמך כאן'}
});
document.addEventListener('pointerlockchange',function(){locked=document.pointerLockElement===canvas;$('tgLock').setAttribute('aria-pressed',locked);if(marker)marker.visible=false});
document.addEventListener('mousemove',function(e){if(!locked||S.mode!=='fp'||tw)return;S.fp.yaw+=e.movementX*0.0022;S.fp.pitch=clamp(S.fp.pitch-e.movementY*0.002,-1.2,1.2)});
/* מקשים לפי e.code ולא e.key: במקלדת בעברית W הוא פסיק עליון ולא "w", והליכה לא עבדה */
window.addEventListener('keydown',function(e){
  var tg=e.target.tagName;if(tg==='INPUT'||tg==='TEXTAREA'||tg==='SELECT')return;
  keys[e.code]=true;keys.shift=e.shiftKey;
  if(S.edit&&selId){if(e.code==='KeyR'){rotSel(e.shiftKey?-15:15)}else if(e.code==='Delete'||e.code==='Backspace'){delSel();e.preventDefault()}}
  if(e.code.indexOf('Arrow')===0||e.code==='Space')e.preventDefault();
});
window.addEventListener('keyup',function(e){keys[e.code]=false;keys.shift=e.shiftKey});
window.addEventListener('blur',function(){keys={}});
var pad={};
Array.prototype.forEach.call($('dpad').querySelectorAll('button'),function(b){
  var k=b.dataset.k;b.addEventListener('pointerdown',function(e){e.preventDefault();pad[k]=true;b.setPointerCapture(e.pointerId)});
  var up=function(){pad[k]=false};b.addEventListener('pointerup',up);b.addEventListener('pointercancel',up)});

/* ---- הליכה והתנגשות ---- */
var PR=24;
function resolve(x,z){
  for(var it=0;it<3;it++)for(var i=0;i<boxes.length;i++){var b=boxes[i];
    var cx=clamp(x,b.x1,b.x2),cz=clamp(z,b.z1,b.z2),dx=x-cx,dz=z-cz,d2=dx*dx+dz*dz;
    if(d2<PR*PR){
      if(d2>1e-6){var d=Math.sqrt(d2);x=cx+dx/d*PR;z=cz+dz/d*PR}
      else{var l=x-b.x1,r=b.x2-x,t=z-b.z1,bt=b.z2-z,m=Math.min(l,r,t,bt);
        if(m===l)x=b.x1-PR;else if(m===r)x=b.x2+PR;else if(m===t)z=b.z1-PR;else z=b.z2+PR}}}
  return {x:x,z:z};
}
function inside(x,z){var k=PR*.8;for(var i=0;i<boxes.length;i++){var b=boxes[i];if(x>b.x1-k&&x<b.x2+k&&z>b.z1-k&&z<b.z2+k)return true}return false}
function clearPath(x0,z0,x1,z1){var d=Math.hypot(x1-x0,z1-z0),n=Math.ceil(d/18);for(var i=1;i<=n;i++){var t=i/n;if(inside(x0+(x1-x0)*t,z0+(z1-z0)*t))return false}return true}
function goTo(x,z){
  var r=resolve(x,z);
  if(clearPath(S.fp.x,S.fp.z,r.x,r.z))S.fpGoal={x:r.x,z:r.z};
  else{S.fpGoal=null;goView({mode:'fp',fp:{x:r.x,z:r.z,yaw:S.fp.yaw,pitch:S.fp.pitch}})}
}
function walk(dt){
  var f=S.fp,sp=(keys.shift?300:170)*dt,mv=0,st=0,tr=0;
  if(keys.KeyW||keys.ArrowUp||pad.f)mv+=1;if(keys.KeyS||keys.ArrowDown||pad.b)mv-=1;
  if(keys.KeyD)st+=1;if(keys.KeyA)st-=1;
  if(keys.KeyE||keys.ArrowRight||pad.r)tr+=1;if(keys.KeyQ||keys.ArrowLeft||pad.l)tr-=1;
  if(tr)f.yaw+=tr*1.5*dt;
  if(mv||st){S.fpGoal=null;
    var fx=Math.sin(f.yaw),fz=-Math.cos(f.yaw),rx=Math.cos(f.yaw),rz=Math.sin(f.yaw);
    var nx=f.x+(fx*mv+rx*st)*sp,nz=f.z+(fz*mv+rz*st)*sp;var r=resolve(nx,nz);f.x=r.x;f.z=r.z}
  else if(S.fpGoal){
    var g=S.fpGoal,dx=g.x-f.x,dz=g.z-f.z,dist=Math.hypot(dx,dz);
    if(dist<10){S.fpGoal=null}else{
      var want=Math.atan2(dx,-dz),dy=((want-f.yaw+Math.PI*3)%(Math.PI*2))-Math.PI;
      if(dist>130)f.yaw+=dy*Math.min(1,dt*3.5);
      var stp=Math.min(dist,330*dt),nx2=f.x+dx/dist*stp,nz2=f.z+dz/dist*stp,r2=resolve(nx2,nz2);
      if(Math.hypot(r2.x-nx2,r2.z-nz2)>stp*.8)S.fpGoal=null;
      f.x=r2.x;f.z=r2.z}
  }
}

/* ================= מצפן ================= */
function drawCompass(){
  var fwd=new T.Vector3();camera.getWorldDirection(fwd);
  var angF=Math.atan2(fwd.x,-fwd.z),rotN=deg(rad(S.north)-angF),rotS=deg(rad(S.north+lastSun.az)-angF);
  $('compass').innerHTML='<circle r="42" fill="none" stroke="currentColor" opacity=".25"/>'+
    '<g transform="rotate('+rotN.toFixed(1)+')"><path d="M0 -36 L7 -4 L0 -10 L-7 -4Z" fill="var(--accent)"/><text y="-38" font-size="11" text-anchor="middle" fill="currentColor" font-family="Heebo" transform="translate(0,-2)">צ</text><path d="M0 36 L5 6 L0 10 L-5 6Z" fill="currentColor" opacity=".35"/></g>'+
    (lastSun.el>0?'<g transform="rotate('+rotS.toFixed(1)+')"><circle cy="-27" r="6.5" fill="var(--sun)"/></g>':'');
}

/* ================= ריהוט: בחירה ועריכה ================= */
function getF(id){return FURN.filter(function(f){return f.id===id})[0]}
function selectF(id){selId=id;if(id)showSel();else{if(selBox){world.remove(selBox);selBox=null}}refreshLists();selTools()}
function showSel(){if(selBox)world.remove(selBox);var g=furnMap[selId];if(!g)return;selBox=new T.BoxHelper(g,0x0b9aa5);selBox.material.depthTest=false;selBox.renderOrder=9;world.add(selBox)}
function updSel(){if(selBox&&furnMap[selId])selBox.update()}
function rotSel(a){var f=getF(selId);if(!f)return;f.rot=(f.rot+a+360)%360;placeFurn(furnMap[f.id],f);updSel();dirty()}
function delSel(){var f=getF(selId);if(!f)return;furnGroup.remove(furnMap[f.id]);delete furnMap[f.id];FURN=FURN.filter(function(x){return x.id!==f.id});selId=null;
  if(selBox){world.remove(selBox);selBox=null}refreshLists();selTools();dirty()}
function addFurn(){
  var t=$('cat').value,def=CAT[t];var c=new T.Vector3();
  var hit=null;setNdcCenter();ray.setFromCamera(ndc,camera);var pl=new T.Plane(new T.Vector3(0,1,0),0);
  if(S.mode==='drone'&&ray.ray.intersectPlane(pl,c))hit=c;
  var x=hit?hit.x/S.scale:(BOUNDS.x1+BOUNDS.x2)/2,y=hit?hit.z/S.scale:(BOUNDS.y1+BOUNDS.y2)/2;if(S.mode==='fp'){x=S.fp.x/S.scale+Math.sin(S.fp.yaw)*70;y=S.fp.z/S.scale-Math.cos(S.fp.yaw)*70}
  var f={id:'f'+(uid++),t:t,x:clamp(x,BOUNDS.x1,BOUNDS.x2),y:clamp(y,BOUNDS.y1,BOUNDS.y2),rot:0,w:0,d:0};FURN.push(f);
  var g=buildFurn(f);furnMap[f.id]=g;furnGroup.add(g);selectF(f.id);dirty();
}
function setNdcCenter(){ndc.set(0,0)}
function selTools(){
  var el=$('selTools'),f=getF(selId);
  if(!f){el.innerHTML='<span class="note">בחרו פריט ברשימה או לחצו עליו במודל.</span>';return}
  var d=CAT[f.t],w=f.w||d.w,dd=f.d||d.d;
  el.innerHTML='<b>'+d.n+'</b> <button class="btn sm" data-a="rl">סיבוב ‎-15°‎</button><button class="btn sm" data-a="rr">סיבוב ‎+15°‎</button>'+
    '<button class="btn sm danger" data-a="del">הסרה</button>'+
    '<div class="row" style="width:100%;margin-top:6px"><div class="f"><label for="fw">רוחב (ס"מ)</label><input id="fw" type="number" min="20" max="600" value="'+Math.round(w)+'"></div>'+
    '<div class="f"><label for="fd">עומק (ס"מ)</label><input id="fd" type="number" min="20" max="600" value="'+Math.round(dd)+'"></div></div>';
}
$('selTools').addEventListener('click',function(e){var a=e.target.dataset&&e.target.dataset.a;if(a==='rl')rotSel(-15);else if(a==='rr')rotSel(15);else if(a==='del')delSel()});
$('selTools').addEventListener('change',function(e){var f=getF(selId);if(!f)return;var v=+e.target.value;if(!(v>=20))return;
  if(e.target.id==='fw')f.w=v;else if(e.target.id==='fd')f.d=v;else return;
  furnGroup.remove(furnMap[f.id]);var g=buildFurn(f);furnMap[f.id]=g;furnGroup.add(g);showSel();dirty()});
function refreshLists(){
  $('furnList').innerHTML=FURN.map(function(f){return '<div class="li'+(f.id===selId?' sel':'')+'" data-id="'+f.id+'"><span>'+CAT[f.t].n+'</span><button class="btn sm" data-x="'+f.id+'" aria-label="הסרה">×</button></div>'}).join('');
}
$('furnList').addEventListener('click',function(e){var x=e.target.dataset&&e.target.dataset.x;if(x){selId=x;delSel();return}
  var li=e.target.closest('.li');if(li)selectF(li.dataset.id)});

/* ================= שמירה ================= */
var saveT=null;
function dirty(){clearTimeout(saveT);saveT=setTimeout(save,400)}
/* מה שנשמר: בלי תאריך, שעה ומנורות (מצב של צפייה, לא של הדגם). שדות שהמנוע אינו מכיר
   (scale_source, checks, declared_*, mirrored) עוברים כמו שהם */
function settingsOut(){var o=Object.assign({},SETTINGS);['scale','ceil','wExt','wInt','sill','winH','doorH','north','city','style','labels','mat'].forEach(function(k){o[k]=S[k]});return o}
function furnOut(){return FURN.filter(function(f){return !f.auto}).map(function(f){var a=[f.t,Math.round(f.x),Math.round(f.y),Math.round(f.rot)||0];if(f.w||f.d)a.push(Math.round(f.w)||0);if(f.d)a.push(Math.round(f.d));return a})}
function dataOut(){return {v:1,settings:settingsOut(),furniture:FURN,views:VIEWS,lights:LIGHTS}}
function save(){if(EDIT&&OPTS.onSave)OPTS.onSave({settings:settingsOut(),furniture:furnOut(),views:VIEWS,lights:LIGHTS})}
function load(o){
  if(!o)return false;
  if(o.settings)Object.keys(o.settings).forEach(function(k){if(k in S&&k!=='date'&&k!=='mat')S[k]=o.settings[k]});
  if(!STYLES[S.style])S.style='modern_clean';
  S.mat=(o.settings&&validMat(o.settings.mat))||styleMat(S.style);
  if(Array.isArray(o.furniture)&&o.furniture.every(function(f){return CAT[f.t]})){FURN=o.furniture.map(function(f){return {id:'f'+(uid++),t:f.t,x:+f.x,y:+f.y,rot:+f.rot||0,w:+f.w||0,d:+f.d||0}})}
  if(Array.isArray(o.views))VIEWS=o.views;if(Array.isArray(o.lights))LIGHTS=o.lights;
  return true;
}

/* ================= ממשק ================= */
function fillCities(){$('city').innerHTML=Object.keys(CITIES).map(function(c){return '<option>'+c+'</option>'}).join('')}
function fillCat(){$('cat').innerHTML=Object.keys(CAT).map(function(k){return '<option value="'+k+'">'+CAT[k].n+'</option>'}).join('')}
function fillStyles(){
  $('styles').innerHTML=STYLE_KEYS.map(function(k){var s=STYLES[k];
    return '<button class="style" data-k="'+k+'" aria-pressed="'+(S.style===k)+'"><span class="sw">'+s.sw.map(function(c){return '<i style="background:'+c+'"></i>'}).join('')+'</span><b>'+s.label+'</b><small>'+s.sub+'</small></button>'}).join('');
}
function fillCal(){
  $('calRoom').innerHTML=MODEL.rooms.filter(function(r){return !r.svc}).map(function(r,i){return '<option value="'+r.id+'">'+esc(r.name)+'</option>'}).join('');
  calHint();
}
function roomBox(id){var r=MODEL.rooms.filter(function(x){return x.id===id})[0]||MODEL.rooms[0];if(!r)return {w:1,d:1};var q=r.r[0];return {w:q[2]-q[0],d:q[3]-q[1]}}
function calHint(){var b=roomBox($('calRoom').value),ax=$('calAxis').value;$('calCm').value=Math.round((ax==='w'?b.w:b.d)*S.scale)}
$('calRoom').addEventListener('change',calHint);$('calAxis').addEventListener('change',calHint);
$('calGo').addEventListener('click',function(){
  var cm=+$('calCm').value;if(!(cm>=50))return;var b=roomBox($('calRoom').value),px=$('calAxis').value==='w'?b.w:b.d;
  S.scale=Math.round(clamp(cm/px,0.2,12)*1000)/1000;SETTINGS.scale_source='manual';dropChecks(['scale_estimated','scale_inconsistent']);rebuildAll()});
function areas(){
  var rows=[],apt=0,bal=0,ln=0;
  MODEL.rooms.forEach(function(r){var a=0;r.r.forEach(function(q){a+=(q[2]-q[0])*(q[3]-q[1])});a=a*S.scale*S.scale/10000;
    if(r.bal)bal+=a;else if(!r.svc)apt+=a;else ln+=a;
    if(!r.svc)rows.push([r.name,a])});
  return {rows:rows,apt:apt,bal:bal};
}
function fillAreas(){
  var A=areas(),pct=function(v,t){var d=(v-t)/t*100;return '<span class="'+(Math.abs(d)<=3?'ok':'bad')+'">'+(d>0?'+':'')+d.toFixed(1)+'%</span>'};
  $('areaTbl').innerHTML='<tr><th>חלל</th><th class="n">מ"ר</th></tr>'+A.rows.map(function(r){return '<tr><td>'+esc(r[0])+'</td><td class="n">'+r[1].toFixed(1)+'</td></tr>'}).join('')+
    '<tr><th>סה"כ דירה (בלי קירות)</th><th class="n">'+A.apt.toFixed(1)+'</th></tr><tr><th>מרפסת</th><th class="n">'+A.bal.toFixed(1)+'</th></tr>';
  var da=+SETTINGS.declared_area_sqm,db=+SETTINGS.declared_balcony_sqm,parts=[];
  if(da>0)parts.push('דירה '+da+' מ"ר ('+pct(A.apt,da)+')');
  if(db>0&&A.bal>0)parts.push('מרפסת '+db+' מ"ר ('+pct(A.bal,db)+')');
  $('areaNote').innerHTML=parts.length?'לפי התוכנית: '+parts.join(', ')+'. סטייה קטנה מ-3% טבעית, כי השטח הרשמי כולל עובי קירות.':'בתוכנית לא נמצא שטח כתוב להשוואה.';
}
function syncInputs(){
  $('scale').value=+(+S.scale).toFixed(3);$('ceil').value=S.ceil;$('wExt').value=S.wExt;$('wInt').value=S.wInt;$('sill').value=S.sill;$('winH').value=S.winH;$('doorH').value=S.doorH;
  $('city').value=S.city;$('date').value=S.date;$('north').value=S.north;$('time').value=S.time;$('lamps').value=S.lamps;
  $('labels').checked=S.labels;$('edit').checked=S.edit;
  $('tgCut').setAttribute('aria-pressed',S.cut);$('tgPlan').setAttribute('aria-pressed',S.plan);
  fillStyles();fillAreas();
}
function rebuildAll(){syncInputs();calHint();rebuild();dirty()}
['scale','ceil','wExt','wInt','sill','winH','doorH'].forEach(function(id){$(id).addEventListener('change',function(){var v=+this.value;if(!isFinite(v)||v<=0){syncInputs();return}S[id]=id==='scale'?Math.round(v*1000)/1000:v;rebuildAll()})});
$('city').addEventListener('change',function(){S.city=this.value;updateSun();dirty()});
$('date').addEventListener('change',function(){if(this.value){S.date=this.value;updateSun();dirty()}});
$('north').addEventListener('change',function(){var v=+this.value;if(isFinite(v)){S.north=clamp(v,-180,180);dropChecks(['no_north']);updateSun();dirty()}});
$('time').addEventListener('input',function(){S.time=+this.value;updateSun();dirty()});
$('lamps').addEventListener('change',function(){S.lamps=this.value;updateSun();dirty()});
$('labels').addEventListener('change',function(){S.labels=this.checked;labelGroup.visible=S.labels&&S.mode==='drone';dirty()});
$('edit').addEventListener('change',function(){S.edit=this.checked;if(!S.edit)selectF(null);else if(S.mode!=='drone')goView(curDroneView())});
function curDroneView(){var c=center();return {mode:'drone',drone:{az:S.drone.az,pol:S.drone.pol,rad:S.drone.rad,tx:S.drone.tx||c.x,tz:S.drone.tz||c.z}}}
$('styles').addEventListener('click',function(e){var b=e.target.closest('.style');if(!b)return;S.style=b.dataset.k;S.mat=styleMat(S.style);syncMat();$('contrastNote').hidden=true;fillStyles();rebuild();dirty()});
$('tgCut').addEventListener('click',function(){S.cut=!S.cut;this.setAttribute('aria-pressed',S.cut);applyCut()});
$('tgPlan').addEventListener('click',function(){S.plan=!S.plan;this.setAttribute('aria-pressed',S.plan);if(planMesh)planMesh.visible=S.plan});
$('tgPlan').hidden=!PLAN_IMG;
$('mDrone').addEventListener('click',function(){if(S.mode==='drone')return;var c=center(),d=S.drone;
  goView({mode:'drone',drone:{az:d.az,pol:d.pol,rad:d.rad,tx:d.tx||c.x,tz:d.tz||c.z}})});
$('mFp').addEventListener('click',function(){if(S.mode==='fp')return;
  var f=S.fp;if(!f.x&&!f.z){f=startFp()}goView({mode:'fp',fp:f})});
$('addF').addEventListener('click',addFurn);
$('resetF').addEventListener('click',function(){resetFurn();selId=null;rebuild();selTools();dirty()});
function selTab(t){
  Array.prototype.forEach.call(document.querySelectorAll('.tab'),function(b){b.setAttribute('aria-selected',b.dataset.t===t)});
  Array.prototype.forEach.call(document.querySelectorAll('.sec'),function(s){s.classList.toggle('on',s.dataset.s===t)})}
/* בנייד הלוח הוא מגירה תחתונה: סגורה היא שורת הלשוניות בלבד, והסיור על כל המסך.
   לשונית פותחת אותה, נגיעה בסיור סוגרת. במחשב המחלקה sheet-open אינה משנה דבר */
var appEl=$('app');
function sheet(open){appEl.classList.toggle('sheet-open',open);$('grab').setAttribute('aria-expanded',open)}
$('tabs').addEventListener('click',function(e){var b=e.target.closest('.tab');if(!b)return;
  var same=b.getAttribute('aria-selected')==='true'&&appEl.classList.contains('sheet-open');
  selTab(b.dataset.t);sheet(!same)});
$('grab').addEventListener('click',function(){sheet(!appEl.classList.contains('sheet-open'))});
$('c').addEventListener('pointerdown',function(){if(appEl.classList.contains('sheet-open'))sheet(false)});
$('info').addEventListener('click',function(){selTab('sun');sheet(true)});
/* מסך מלא: הלוח נעלם לגמרי. באייפון אין requestFullscreen לאלמנט, והמחלקה לבדה עושה את העבודה */
function setFull(on){
  appEl.classList.toggle('full',on);$('tgFull').setAttribute('aria-pressed',on);sheet(false);
  try{
    if(on&&appEl.requestFullscreen&&!document.fullscreenElement)appEl.requestFullscreen().catch(function(){});
    else if(!on&&document.fullscreenElement)document.exitFullscreen();
  }catch(e){}
}
$('tgFull').addEventListener('click',function(){setFull(!appEl.classList.contains('full'))});
document.addEventListener('fullscreenchange',function(){if(!document.fullscreenElement&&appEl.classList.contains('full'))setFull(false)});

/* זמן: מקשי קיצור והפעלת יום */
var playing=false,playT=0;
$('play').addEventListener('click',function(){playing=!playing;this.textContent=playing?'עצירה':'הפעלת יום';playT=performance.now()});
document.querySelectorAll('[data-q]').forEach(function(b){b.addEventListener('click',function(){
  var ll=CITIES[S.city],d=sunDay(ll[0],ll[1],S.date),q=b.dataset.q;
  S.time=q==='sunset'?Math.max(0,(d.set||18)-0.35):+q;playing=false;$('play').textContent='הפעלת יום';updateSun();dirty()})});

/* זוויות ותבניות */
function chipHtml(arr,kind){return arr.map(function(v,i){return '<span class="chip" tabindex="0" role="button" data-k="'+kind+'" data-i="'+i+'"><b>'+esc(v.n)+'</b>'+(EDIT?'<button class="x" data-del="'+i+'" aria-label="מחיקה">×</button>':'')+'</span>'}).join('')}
function fillChips(){$('viewChips').innerHTML=chipHtml(VIEWS,'v');$('lightChips').innerHTML=chipHtml(LIGHTS,'l');
  $('fpSel').innerHTML='<option value="">קפיצה לחדר...</option>'+VIEWS.map(function(v,i){return v.mode==='fp'?'<option value="'+i+'">'+esc(v.n)+'</option>':''}).join('')}
$('fpSel').addEventListener('change',function(){var v=VIEWS[+this.value];this.value='';if(v)goView(v)});
function chipClick(e,kind,arr){
  var del=e.target.dataset&&e.target.dataset.del;if(EDIT&&del!==undefined&&del!==''){arr.splice(+del,1);fillChips();dirty();return}
  var c=e.target.closest('.chip');if(!c)return;var v=arr[+c.dataset.i];if(!v)return;
  if(kind==='v'){goView(v);sheet(false)}
  else{var ll=CITIES[v.city||S.city],d=sunDay(ll[0],ll[1],v.date||S.date);
    if(v.city){S.city=v.city;}if(v.date)S.date=v.date;if(v.north!=null)S.north=v.north;
    S.time=v.t==='sunset'?Math.max(0,(d.set||18)-0.35):v.t==='dusk'?Math.min(24,(d.set||18)+0.9):v.t;
    if(v.lamps)S.lamps=v.lamps;syncInputs();updateSun();dirty()}
}
$('viewChips').addEventListener('click',function(e){chipClick(e,'v',VIEWS)});$('lightChips').addEventListener('click',function(e){chipClick(e,'l',LIGHTS)});
['viewChips','lightChips'].forEach(function(id){$(id).addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();e.target.click()}})});
$('saveView').addEventListener('click',function(){var n=$('viewName').value.trim();if(!n)n='זווית '+(VIEWS.length+1);VIEWS.push(curView(n));$('viewName').value='';fillChips();dirty()});
$('saveLight').addEventListener('click',function(){var n=$('lightName').value.trim();if(!n)n='תאורה '+(LIGHTS.length+1);
  LIGHTS.push({n:n,city:S.city,date:S.date,north:S.north,t:S.time,lamps:S.lamps});$('lightName').value='';fillChips();dirty()});
$('expJson').addEventListener('click',function(){$('json').value=JSON.stringify(dataOut(),null,1);$('jsonMsg').textContent='הנתונים מוכנים להעתקה.'});
$('copyJson').addEventListener('click',function(){var t=$('json');if(!t.value)t.value=JSON.stringify(dataOut(),null,1);t.select();
  var ok=function(){$('jsonMsg').textContent='הועתק.'},no=function(){$('jsonMsg').textContent='ההעתקה נחסמה. הטקסט מסומן, לחצו Ctrl+C.'};
  try{navigator.clipboard.writeText(t.value).then(ok,no)}catch(e){no()}});
$('impJson').addEventListener('click',function(){try{var o=JSON.parse($('json').value);if(!load(o))throw 0;selId=null;
  fillChips();rebuildAll();selTools();$('jsonMsg').textContent='נטען.'}catch(e){$('jsonMsg').textContent='הנתונים אינם תקינים.'}});

/* ================= צבעים, חומרים והבחנה בין קיר לרצפה ================= */
var ZONES=[['tile','ריצוף ראשי: סלון, מסדרונות, מחסן'],['wood','חדרי שינה וממ"ד'],['wet','חדרים רטובים'],['deck','מרפסת']];
var TEXKINDS=[['tile','אריחי פורצלן'],['plank','פרקט או עץ'],['stone','אבן'],['marble','שיש'],['concrete','בטון מוחלק'],['flat','חלק, בלי טקסטורה']];
var HEX=/^#[0-9a-fA-F]{6}$/, MIN_DL=0.15;
function hslOf(hex){var o={};new T.Color(hex).getHSL(o);return o}
function hexHSL(h,sat,l){return '#'+new T.Color().setHSL(h,sat,clamp(l,.04,.98)).getHexString()}
function withL(hex,l){var o=hslOf(hex);return hexHSL(o.h,o.s,l)}
function mkSpec(k,a,zone,cell){
  var dark=hslOf(a).l<.4,sp={k:k,a:a,c:cell||(zone==='wet'?30:60)};
  var d={tile:[.95,.78],plank:[.9,.7],stone:[.94,.8],marble:[.88,.6],concrete:[.96,.9],flat:[1,1]}[k]||[.95,.78];
  sp.b=shade(a,d[0]);sp.j=shade(a,d[1]);if(k==='plank'){sp.b=shade(a,.84);sp.j=shade(a,.6)}if(k==='stone'){sp.b=shade(a,.88);sp.j=shade(a,.68)}
  if(dark&&(k==='marble')){sp.j=withL(a,.55);sp.b=withL(a,.3)}
  return sp;
}
function styleMat(key){var st=STYLES[key],m={wall:st.wall,fl:{}};
  ['tile','wood','wet','deck'].forEach(function(z){var f=st.fl[z];m.fl[z]=mkSpec(f[0],f[1],z,f[2])});return m}
function validMat(m){
  if(!m||!HEX.test(m.wall||'')||!m.fl)return null;var out={wall:m.wall,fl:{}};
  for(var i=0;i<ZONES.length;i++){var z=ZONES[i][0],f=m.fl[z];
    if(!f||!HEX.test(f.a||'')||!TEXKINDS.some(function(t){return t[0]===f.k}))return null;
    out.fl[z]=mkSpec(f.k,f.a,z,+f.c>=10&&+f.c<=200?+f.c:0)}
  return out;
}
/* ensureContrast: הקיר והרצפה (ראשי, שינה, רטוב) חייבים להיות שונים בבהירות. מי שלא שונה הוא מה שהמשתמש/ת לא נגע/ה בו */
function ensureContrast(changed){
  var zs=['tile','wood','wet'],note='';var wl=hslOf(S.mat.wall).l;
  var bad=zs.filter(function(z){return Math.abs(hslOf(S.mat.fl[z].a).l-wl)<MIN_DL});
  if(!bad.length)return '';
  if(changed==='wall'){
    bad.forEach(function(z){var fl=hslOf(S.mat.fl[z].a).l,nl=wl>=fl?wl-MIN_DL-.01:wl+MIN_DL+.01;
      if(nl<.04||nl>.98)nl=wl>=.5?wl-MIN_DL-.01:wl+MIN_DL+.01;
      S.mat.fl[z]=mkSpec(S.mat.fl[z].k,withL(S.mat.fl[z].a,nl),z,S.mat.fl[z].c)});
    note='הרצפה הייתה קרובה מדי בגוון לקירות, ולכן שינינו את גוון הריצוף כדי שיהיה קל להבדיל.';
  }else{
    var ls=zs.map(function(z){return hslOf(S.mat.fl[z].a).l});
    var lighter=wl>=(ls.reduce(function(a,b){return a+b},0)/ls.length);
    var target=lighter?Math.max.apply(null,ls)+MIN_DL+.01:Math.min.apply(null,ls)-MIN_DL-.01;
    if(target>.98||target<.04)target=lighter?Math.min.apply(null,ls)-MIN_DL-.01:Math.max.apply(null,ls)+MIN_DL+.01;
    S.mat.wall=withL(S.mat.wall,clamp(target,.04,.98));
    note='הקירות היו קרובים מדי בגוון לרצפה, ולכן שינינו את גוון הקירות כדי שיהיה קל להבדיל.';
  }
  return note;
}
function buildMatUI(){
  $('floorBox').innerHTML=ZONES.map(function(z){return '<div class="mrow"><div class="f"><label for="fk_'+z[0]+'">'+z[1]+'</label><select id="fk_'+z[0]+'" data-z="'+z[0]+'">'+
    TEXKINDS.map(function(t){return '<option value="'+t[0]+'">'+t[1]+'</option>'}).join('')+'</select></div><div class="f"><label for="fc_'+z[0]+'">צבע</label><input id="fc_'+z[0]+'" data-z="'+z[0]+'" type="color"></div></div>'}).join('');
}
function syncMat(){
  $('wallColor').value=S.mat.wall;
  ZONES.forEach(function(z){var sp=S.mat.fl[z[0]];$('fk_'+z[0]).value=sp.k;$('fc_'+z[0]).value=sp.a})
}
var rbT=null;
function matChanged(src){
  var n=ensureContrast(src);var el=$('contrastNote');el.hidden=!n;el.textContent=n;
  syncMat();clearTimeout(rbT);rbT=setTimeout(function(){rebuild();dirty()},140);
}
$('wallColor').addEventListener('input',function(){S.mat.wall=this.value;matChanged('wall')});
$('floorBox').addEventListener('input',function(e){var z=e.target.dataset.z;if(!z)return;var sp=S.mat.fl[z];
  if(e.target.type==='color')S.mat.fl[z]=mkSpec(sp.k,e.target.value,z);
  else S.mat.fl[z]=mkSpec(e.target.value,sp.a,z);
  matChanged(z)});
$('matReset').addEventListener('click',function(){S.mat=styleMat(S.style);syncMat();$('contrastNote').hidden=true;rebuild();dirty()});

/* ================= מיני-מפה במבט ראשון ================= */
var planImg=new Image();if(PLAN_IMG){planImg.crossOrigin='anonymous';planImg.src=PLAN_IMG}
var MM={x0:BOUNDS.x1-20,y0:BOUNDS.y1-20,w:BOUNDS.x2-BOUNDS.x1+40,h:BOUNDS.y2-BOUNDS.y1+40},miniC=$('miniC'),mctx=miniC.getContext('2d');
function drawMini(){
  if(S.mode!=='fp')return;
  var W=miniC.width,H=miniC.height,k=Math.min(W/MM.w,H/MM.h);
  mctx.fillStyle='#fff';mctx.fillRect(0,0,W,H);
  if(planImg.complete&&planImg.naturalWidth){var sx=planImg.naturalWidth/MODEL.imgW;mctx.drawImage(planImg,MM.x0*sx,MM.y0*sx,MM.w*sx,MM.h*sx,0,0,MM.w*k,MM.h*k)}
  else{
    /* לצופה אין תוכנית מקור (הדלי פרטי): המפה מצוירת מהמודל עצמו */
    MODEL.rooms.forEach(function(r){r.r.forEach(function(q){mctx.fillStyle=r.bal?'#e7dcc8':'#e9eef0';mctx.fillRect((q[0]-MM.x0)*k,(q[1]-MM.y0)*k,(q[2]-q[0])*k,(q[3]-q[1])*k)})});
    mctx.strokeStyle='#6f8188';mctx.lineWidth=2.5;
    MODEL.walls.forEach(function(w){mctx.beginPath();
      if(w.h!==undefined){mctx.moveTo((w.a-MM.x0)*k,(w.h-MM.y0)*k);mctx.lineTo((w.b-MM.x0)*k,(w.h-MM.y0)*k)}
      else{mctx.moveTo((w.v-MM.x0)*k,(w.a-MM.y0)*k);mctx.lineTo((w.v-MM.x0)*k,(w.b-MM.y0)*k)}
      mctx.stroke()});
  }
  var px=(S.fp.x/S.scale-MM.x0)*k,py=(S.fp.z/S.scale-MM.y0)*k;
  if(S.fpGoal){var gx=(S.fpGoal.x/S.scale-MM.x0)*k,gy=(S.fpGoal.z/S.scale-MM.y0)*k;mctx.strokeStyle='#0b9aa5';mctx.lineWidth=3;mctx.beginPath();mctx.arc(gx,gy,9,0,6.3);mctx.stroke()}
  mctx.save();mctx.translate(px,py);mctx.rotate(S.fp.yaw);mctx.fillStyle='rgba(11,154,165,.3)';
  mctx.beginPath();mctx.moveTo(0,0);mctx.arc(0,0,70,-Math.PI/2-0.7,-Math.PI/2+0.7);mctx.closePath();mctx.fill();mctx.restore();
  mctx.fillStyle='#0b9aa5';mctx.strokeStyle='#fff';mctx.lineWidth=3;mctx.beginPath();mctx.arc(px,py,8,0,6.3);mctx.fill();mctx.stroke();
}
function inRooms(x,y){return MODEL.rooms.some(function(r){return !r.svc&&r.r.some(function(q){return x>=q[0]&&x<=q[2]&&y>=q[1]&&y<=q[3]})})}
$('mini').addEventListener('pointerdown',function(e){
  e.preventDefault();e.stopPropagation();
  var r=this.getBoundingClientRect(),k=Math.min(miniC.width/MM.w,miniC.height/MM.h);
  var px=(e.clientX-r.left)/r.width*miniC.width/k+MM.x0,py=(e.clientY-r.top)/r.height*miniC.height/k+MM.y0;
  if(inRooms(px,py))goTo(px*S.scale,py*S.scale);
});

/* ================= לולאה ================= */
function resize(){var r=stage.getBoundingClientRect();if(!r.width)return;renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix()}
new ResizeObserver(resize).observe(stage);
var last=performance.now();
function loop(now){
  requestAnimationFrame(loop);
  var dt=Math.min(.05,(now-last)/1000);last=now;
  if(playing){S.time=(S.time+dt*1.6)%24;updateSun()}
  stepTween(now);
  if(!tw&&S.mode==='fp')walk(dt);
  applyCamera();updSel();drawCompass();drawMini();
  renderer.render(scene,camera);
}

/* ================= אתחול ================= */
/* מה שדורש בדיקה אחרי קריאה אוטומטית (settings.checks, קודים מ-_shared/plan-model.ts). הניסוח כאן */
var CHECK_TEXT={
  rooms_dropped:function(c){return c.n+' חללים לא זוהו והושמטו. השוו לתוכנית המקור.'},
  diagonal_walls:function(c){return c.n+' קירות אלכסוניים לא נכנסו למודל.'},
  scale_estimated:function(c){return 'קנה המידה משוער ('+({area:'לפי השטח הכתוב',door:'לפי רוחב דלת',default:'ברירת מחדל'}[c.source]||'הערכה')+'). כיילו לפי מידה ידועה.'},
  scale_inconsistent:function(){return 'המידות הכתובות בתוכנית אינן עקביות. כיילו לפי מידה ידועה.'},
  no_north:function(){return 'לא נמצא חץ צפון בתוכנית. הזינו את כיוון הצפון בלשונית "שמש".'}
};
function fillChecks(){
  var box=$('checksBox');if(!box)return;
  var list=(Array.isArray(SETTINGS.checks)?SETTINGS.checks:[]).filter(function(c){return c&&CHECK_TEXT[c.code]});
  box.hidden=!EDIT||!list.length;
  box.innerHTML=list.length?'<b>מה לבדוק לפני פרסום</b><ul>'+list.map(function(c){return '<li>'+esc(CHECK_TEXT[c.code](c))+'</li>'}).join('')+'</ul>':'';
}
function dropChecks(codes){
  if(!Array.isArray(SETTINGS.checks))return;
  SETTINGS.checks=SETTINGS.checks.filter(function(c){return codes.indexOf(c&&c.code)<0});fillChecks();
}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]})}

function init(){
  fillCities();fillCat();fillCal();buildMatUI();
  resetFurn();
  /* ההגדרות קודם: זוויות ברירת המחדל תלויות בקנה המידה */
  load({settings:OPTS.settings||{},views:OPTS.views,lights:OPTS.lights});
  if(!VIEWS.length)VIEWS=defaultViews();
  if(!LIGHTS.length)LIGHTS=defaultLights();
  if(!CITIES[S.city])S.city='עפולה';
  var c=center();S.fp=startFp();
  S.drone={az:0.35,pol:0.95,rad:span()*1.55,tx:c.x,tz:c.z};
  $('app').classList.toggle('viewer',!EDIT);
  selTab(EDIT?'dims':'style');
  fillChecks();
  marker=new T.Mesh(new T.RingGeometry(14,22,32),new T.MeshBasicMaterial({color:lin(0x0b9aa5),transparent:true,opacity:.9,depthTest:false,side:T.DoubleSide}));
  marker.rotation.x=-Math.PI/2;marker.renderOrder=8;marker.visible=false;scene.add(marker);
  syncInputs();syncMat();fillChips();rebuild();selTools();resize();syncMode();applyCamera();
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(function(){rebuild()});
  if(OPTS.debug)window.__p3d={togglePerson:togglePerson,scene:scene,renderer:renderer,sun:sun,hemi:hemi,S:S,ensureContrast:ensureContrast,styleMat:styleMat,hslOf:hslOf,STYLES:STYLES,matChanged:matChanged,syncMat:syncMat,goTo:goTo,goView:goView,commitView:commitView,VIEWS:VIEWS,rebuild:rebuild,setStyle:function(k){S.style=k;S.mat=styleMat(k);syncMat();fillStyles();rebuild()},updateSun:updateSun};
  requestAnimationFrame(loop);
}
init();
return {data:function(){return {settings:settingsOut(),furniture:furnOut(),views:VIEWS,lights:LIGHTS}}};
}};
