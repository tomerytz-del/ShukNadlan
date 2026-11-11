/* ============================================================================
   "עצרו את התמונה" - נגן הסצנות של קורס ההכנה (/learn)

   סיפור מונפש שקופא ברגע ההחלטה. learn.js טוען את הקובץ רק כשיש בשיעור צעד
   מסוג scene, ומשתמש בו כך:

     var ctl = CourseScene.create(host, { title, subtitle, beats, freeze, freeze_a, onFreeze });
     ctl.playEnding(beats)  -> Promise   הסוף שחזר מ-course_answer
     ctl.rewind()           -> Promise   אפקט "החזרת קלטת" לפני הסוף השני
     ctl.destroy()                       עוצר הכול (מעבר קלף, יציאה למפה)

   **הסופים לא מגיעים לכאן לפני התשובה.** הם יושבים על השאלה במסד ויוצאים רק
   מ-course_answer (docs/exam-course.md, "סצנות"). הפתיחה (beats) היא עד ההקפאה.

   הקול: קבצים מוכנים ב-/assets/course-scenes/<a>.mp3 (scripts/course_scene_audio.py,
   אותם קולות של הרילסים), והמוזיקה music.mp3 היא הטראק של הרילסים
   ("Funky House", ‏CC0). בלי קול, או במצב השתקה, הטקסט מוקלד בקצב קריאה.
   ========================================================================== */
(function () {
  'use strict';
  if (window.CourseScene) return;
  var BASE = '/assets/course-scenes/';
  var MENTOR_IMG = '/assets/mentor-cutout.webp';
  var RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // הבריחה: עותק מלא משלו, כי סדר הטעינה מול esc.js אינו מובטח (CLAUDE.md, "בריחת HTML")
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---------------------------------------------------------------- עיצוב
  var CSS = [
    '.cs{position:relative;background:#0d1b3d;border-radius:20px;padding:8px;box-shadow:0 24px 50px -28px rgba(13,27,61,.6)}',
    '.cs-stage{position:relative;width:100%;aspect-ratio:16/10;border-radius:14px;overflow:hidden;background:#cfe0ff;container-type:inline-size;isolation:isolate;direction:rtl}',
    '@media (max-width:560px){.cs-stage{aspect-ratio:4/5}}',
    '.cs-cam{position:absolute;inset:0;transition:transform 1.4s cubic-bezier(.3,.7,.2,1),filter .5s;transform-origin:50% 70%}',
    '.cs-stage.frozen .cs-cam{filter:grayscale(1) contrast(1.05) brightness(.92)}',
    '.cs-bg{position:absolute;inset:0;transition:opacity .6s}.cs-bg.off{opacity:0}',
    '.cs-bg svg{width:100%;height:100%;display:block}',
    '.cs-chip{position:absolute;top:4cqw;right:4cqw;background:rgba(13,27,61,.82);color:#fff;font-weight:700;font-size:clamp(11px,1.9cqw,15px);padding:.45em .9em;border-radius:99px;z-index:6;transition:opacity .4s,transform .4s}',
    '.cs-chip.hide{opacity:0;transform:translateY(-8px)}',
    '.cs-ch{position:absolute;bottom:9%;width:15%;transition:left 2.2s cubic-bezier(.4,.1,.3,1),opacity .5s;z-index:3}',
    '@media (max-width:560px){.cs-ch{width:24%;bottom:12%}}',
    '.cs-ch svg{width:100%;height:auto;display:block;overflow:visible}',
    '.cs-ch .bob{animation:csBob 3.2s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 100%}',
    '.cs-ch.walk .bob{animation:csWalk .5s ease-in-out infinite}',
    '.cs-ch .eye{animation:csBlink 4.6s infinite;transform-box:fill-box;transform-origin:center}',
    '.cs-ch .mouth{transform-box:fill-box;transform-origin:center}',
    '.cs-ch.talk .mouth{animation:csTalk .22s ease-in-out infinite alternate}',
    '.cs-ch .arm-wave{transform-box:fill-box;transform-origin:50% 8%}',
    '.cs-ch.wave .arm-wave{animation:csWave .5s ease-in-out 3 alternate}',
    '.cs-ch.flip svg{transform:scaleX(-1)}',
    '@keyframes csBob{50%{transform:translateY(-1.2%)}}@keyframes csWalk{50%{transform:translateY(-3%) rotate(1deg)}}',
    '@keyframes csBlink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}@keyframes csTalk{from{transform:scaleY(.4)}to{transform:scaleY(1.5)}}',
    '@keyframes csWave{to{transform:rotate(-55deg)}}',
    '.cs-bubble{position:absolute;z-index:5;max-width:44%;background:#fff;color:#0d1b3d;border-radius:18px;padding:.6em .85em .7em;font-size:clamp(12px,2.3cqw,18px);line-height:1.35;font-weight:500;box-shadow:0 10px 24px -12px rgba(13,27,61,.5);transform-origin:50% 100%;animation:csPop .28s cubic-bezier(.3,1.6,.5,1)}',
    '@media (max-width:560px){.cs-bubble{max-width:64%;font-size:clamp(12px,3.6cqw,16px)}}',
    '.cs-bubble b{display:block;font-size:.72em;color:#b8952e;margin-bottom:.1em}',
    '.cs-bubble::after{content:"";position:absolute;bottom:-8px;width:18px;height:18px;background:inherit;transform:rotate(45deg);border-radius:3px;left:var(--tail,24px)}',
    '.cs-bubble.out{animation:csOut .25s forwards}@keyframes csPop{from{transform:scale(.6);opacity:0}}@keyframes csOut{to{opacity:0;transform:translateY(-6px)}}',
    '.cs-poster{position:absolute;inset:0;z-index:12;display:grid;place-items:center;background:#0e2a6b;color:#fff;text-align:center;transition:opacity .6s;cursor:pointer;border:0;width:100%;font:inherit;padding:0}',
    '.cs-poster.hide{opacity:0;pointer-events:none}',
    '.cs-poster span{display:block}.cs-poster .pl{display:grid}',
    '.cs-poster .t1{font-size:clamp(12px,2cqw,15px);letter-spacing:.14em;color:#e5c76a;font-weight:700}',
    '.cs-poster .t2{font-weight:800;font-size:clamp(24px,6.5cqw,58px);line-height:1.08;margin:.15em .4em .2em}',
    '.cs-poster .t3{font-size:clamp(13px,2.4cqw,18px);color:#c9d3ee;padding:0 1em}',
    '.cs-poster .pl{width:clamp(56px,11cqw,84px);height:clamp(56px,11cqw,84px);margin:1em auto 0;border-radius:50%;background:#e5c76a;color:#0d1b3d;display:grid;place-items:center;animation:csPulse 2s infinite}',
    '.cs-poster .pl svg{width:42%;height:42%}',
    '@keyframes csPulse{0%{box-shadow:0 0 0 0 rgba(229,199,106,.6)}70%{box-shadow:0 0 0 18px rgba(229,199,106,0)}100%{box-shadow:0 0 0 0 rgba(229,199,106,0)}}',
    '.cs-cut{position:absolute;inset:0;z-index:7;display:grid;place-items:center;background:rgba(13,27,61,.9);color:#fff;opacity:0;pointer-events:none;transition:opacity .4s;text-align:center}',
    '.cs-cut.on{opacity:1}.cs-cut div{font-weight:800;font-size:clamp(24px,6cqw,50px);line-height:1.1}',
    '.cs-cut small{display:block;font-weight:500;font-size:.4em;color:#e5c76a;letter-spacing:.1em;margin-top:.5em}',
    '.cs-freeze{position:absolute;inset:0;z-index:9;pointer-events:none;opacity:0;transition:opacity .3s}',
    '.cs-stage.frozen .cs-freeze{opacity:1}',
    '.cs-freeze .stamp{position:absolute;top:8%;left:6%;font-weight:900;font-size:clamp(22px,6cqw,54px);color:#d92d20;border:.12em solid #d92d20;border-radius:.25em;padding:.02em .35em;transform:rotate(-8deg) scale(1.6);opacity:0;background:rgba(255,255,255,.88)}',
    '.cs-stage.frozen .cs-freeze .stamp{animation:csStamp .35s .1s cubic-bezier(.2,1.4,.4,1) forwards}',
    '@keyframes csStamp{to{transform:rotate(-8deg) scale(1);opacity:1}}',
    '.cs-freeze img{position:absolute;bottom:0;left:2%;height:72%;transform:translateX(-110%);transition:transform .6s cubic-bezier(.2,.9,.3,1) .35s;filter:drop-shadow(0 10px 20px rgba(0,0,0,.35))}',
    '@media (max-width:560px){.cs-freeze img{height:44%;left:0}}',
    '.cs-stage.frozen .cs-freeze img{transform:none}',
    '.cs-freeze .scan{position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(255,255,255,.05) 0 2px,transparent 2px 5px)}',
    '.cs-stage.rewind .cs-cam{animation:csRew .9s steps(9) both}',
    '.cs-stage.rewind::after{content:"\\23EA";position:absolute;inset:0;display:grid;place-items:center;font-size:12cqw;color:#fff;background:repeating-linear-gradient(0deg,rgba(13,27,61,.35) 0 3px,transparent 3px 7px);z-index:9}',
    '@keyframes csRew{20%{transform:translateX(2%) skewX(-3deg)}40%{transform:translateX(-2%) skewX(3deg)}60%{transform:translateX(1%)}100%{transform:none}}',
    '.cs-ov{position:absolute;z-index:6;left:50%;top:50%;transform:translate(-50%,-44%) scale(.92);opacity:0;transition:opacity .45s,transform .45s cubic-bezier(.2,.9,.3,1);pointer-events:none}',
    '.cs-ov.on{opacity:1;transform:translate(-50%,-50%) scale(1)}',
    '.cs-doc{width:min(62cqw,460px);background:#fff;border-radius:16px;padding:1.1em 1.2em;box-shadow:0 30px 60px -20px rgba(13,27,61,.6);border:10px solid #1c2747;font-size:clamp(11px,2cqw,15px);color:#0d1b3d}',
    '.cs-doc h4{margin:0 0 .5em;font-size:1.25em;color:#0e2a6b}',
    '.cs-doc .row{display:flex;justify-content:space-between;gap:1em;border-bottom:1px dashed #e3e8f4;padding:.35em 0}',
    '.cs-doc .row span:first-child{color:#4a5578}.cs-doc .row span:last-child{font-weight:700;opacity:0;transition:opacity .3s}.cs-doc .row.f span:last-child{opacity:1}',
    '.cs-doc svg{width:60%;height:3.2em;display:block;margin:.5em 0 0 auto}',
    '.cs-doc svg path{fill:none;stroke:#0e2a6b;stroke-width:3;stroke-linecap:round;stroke-dasharray:600;stroke-dashoffset:600}',
    '.cs-doc.signed svg path{transition:stroke-dashoffset 1.6s ease-in-out;stroke-dashoffset:0}',
    '.cs-doc .sl{font-size:.85em;color:#4a5578;border-top:1px solid #4a5578;width:60%;margin-inline-start:auto;text-align:center}',
    '.cs-phone{width:min(40cqw,270px);background:#111827;border-radius:30px;padding:12px;box-shadow:0 30px 60px -20px rgba(0,0,0,.6)}',
    '.cs-phone .scr{background:#e8edf6;border-radius:20px;padding:12% 8% 10%;min-height:min(56cqw,380px);display:flex;flex-direction:column;gap:.55em;font-size:clamp(11px,2cqw,14px);color:#0d1b3d}',
    '.cs-phone .who{font-weight:800;text-align:center;margin-bottom:.4em}',
    '.cs-msg{max-width:85%;padding:.45em .7em;border-radius:12px;line-height:1.35;opacity:0;transform:translateY(6px);transition:opacity .3s,transform .3s}',
    '.cs-msg.on{opacity:1;transform:none}.cs-msg.me{align-self:flex-start;background:#d6f5d9}.cs-msg.them{align-self:flex-end;background:#fff}',
    '.cs-court{width:min(66cqw,480px);background:#fdfaf2;border:2px solid #d8c9a0;border-radius:6px;padding:1.2em 1.4em;text-align:center;font-size:clamp(12px,2.2cqw,16px);box-shadow:0 30px 60px -20px rgba(0,0,0,.5);position:relative;color:#0d1b3d}',
    '.cs-court .crest{font-size:.85em;letter-spacing:.12em;color:#7a6a3c;font-weight:700}',
    '.cs-court h4{font-weight:800;font-size:1.5em;margin:.3em 0}.cs-court p{margin:.2em 0;color:#4a5578}',
    '.cs-court .verdict{display:inline-block;margin-top:.6em;font-weight:900;font-size:1.45em;color:#d92d20;border:3px solid #d92d20;border-radius:6px;padding:.05em .5em;transform:rotate(-6deg) scale(2);opacity:0}',
    '.cs-court.hit .verdict{animation:csStamp2 .35s cubic-bezier(.2,1.4,.4,1) forwards}@keyframes csStamp2{to{transform:rotate(-6deg) scale(1);opacity:1}}',
    '.cs-badge{position:absolute;z-index:6;top:16%;left:50%;transform:translateX(-50%) scale(.8);opacity:0;background:#1f9d55;color:#fff;font-weight:800;font-size:clamp(13px,2.8cqw,22px);padding:.4em 1em;border-radius:99px;transition:all .4s cubic-bezier(.2,1.4,.4,1);white-space:nowrap}',
    '.cs-badge.on{opacity:1;transform:translateX(-50%) scale(1)}',
    '.cs-bar{display:flex;align-items:center;gap:10px;padding:8px 4px 2px;color:#fff;direction:rtl}',
    '.cs-btn{width:40px;height:40px;border-radius:50%;border:0;background:#e5c76a;color:#0d1b3d;display:grid;place-items:center;cursor:pointer;flex:none}',
    '.cs-btn.ghost{background:rgba(255,255,255,.12);color:#fff}.cs-btn svg{width:18px;height:18px}',
    '.cs-btn:focus-visible,.cs-skip:focus-visible,.cs-poster:focus-visible{outline:3px solid #e5c76a;outline-offset:2px}',
    '.cs-skip{margin-inline-start:auto;background:none;border:0;color:#c9d3ee;font:inherit;font-size:14px;cursor:pointer;text-decoration:underline;padding:8px}',
    '@media (prefers-reduced-motion:reduce){.cs *{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important}}'
  ].join('\n');

  // ---------------------------------------------------------------- רקעים
  var BG = {
    street: '<svg viewBox="0 0 800 500" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><defs><linearGradient id="csSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9cc3ff"/><stop offset="1" stop-color="#dfeaff"/></linearGradient></defs><rect width="800" height="500" fill="url(#csSky)"/><circle cx="680" cy="80" r="36" fill="#ffe7a3"/><g fill="#fff" opacity=".85"><ellipse cx="160" cy="90" rx="60" ry="16"/><ellipse cx="200" cy="78" rx="38" ry="16"/><ellipse cx="520" cy="60" rx="50" ry="12"/></g><rect x="0" y="330" width="800" height="170" fill="#c9d1e3"/><rect x="0" y="420" width="800" height="80" fill="#8f9bb6"/><rect x="250" y="70" width="300" height="300" rx="6" fill="#f3e7cf"/><rect x="250" y="70" width="300" height="20" fill="#e2d0ab"/><g fill="#7da3d9"><rect x="280" y="110" width="50" height="42" rx="4"/><rect x="375" y="110" width="50" height="42" rx="4"/><rect x="470" y="110" width="50" height="42" rx="4"/><rect x="280" y="180" width="50" height="42" rx="4"/><rect x="375" y="180" width="50" height="42" rx="4"/><rect x="470" y="180" width="50" height="42" rx="4"/><rect x="280" y="250" width="50" height="42" rx="4"/><rect x="470" y="250" width="50" height="42" rx="4"/></g><rect x="372" y="262" width="56" height="108" rx="6" fill="#0e2a6b"/><circle cx="418" cy="318" r="3.5" fill="#e5c76a"/><rect x="378" y="240" width="44" height="14" rx="3" fill="#fff"/><text x="400" y="251" font-size="10" text-anchor="middle" fill="#0d1b3d">12</text><rect x="596" y="250" width="10" height="120" fill="#7a5b3a"/><circle cx="601" cy="230" r="46" fill="#5fae6e"/><circle cx="575" cy="250" r="30" fill="#4f9a5e"/><circle cx="628" cy="252" r="28" fill="#6cbc7b"/><rect x="120" y="282" width="6" height="88" fill="#4a5578"/><rect x="70" y="250" width="106" height="44" rx="6" fill="#fff" stroke="#0e2a6b" stroke-width="3"/><text x="123" y="279" font-size="20" font-weight="800" text-anchor="middle" fill="#0e2a6b">למכירה</text></svg>',
    room: '<svg viewBox="0 0 800 500" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><rect width="800" height="500" fill="#f6efe2"/><rect x="0" y="360" width="800" height="140" fill="#d9c3a0"/><g stroke="#cdb38a" stroke-width="2"><line x1="0" y1="400" x2="800" y2="400"/><line x1="0" y1="450" x2="800" y2="450"/></g><rect x="80" y="70" width="190" height="150" rx="6" fill="#9cc3ff" stroke="#fff" stroke-width="10"/><line x1="175" y1="70" x2="175" y2="220" stroke="#fff" stroke-width="8"/><rect x="520" y="90" width="120" height="86" rx="4" fill="#e5c76a"/><rect x="530" y="100" width="100" height="66" fill="#0e2a6b" opacity=".85"/><circle cx="580" cy="133" r="16" fill="#e5c76a" opacity=".8"/><rect x="300" y="300" width="230" height="16" rx="4" fill="#7a5b3a"/><rect x="316" y="316" width="10" height="64" fill="#7a5b3a"/><rect x="504" y="316" width="10" height="64" fill="#7a5b3a"/><rect x="360" y="282" width="70" height="18" rx="2" fill="#fff"/><g transform="translate(450 286)"><circle r="7" fill="none" stroke="#b8952e" stroke-width="3"/><rect x="5" y="-2" width="18" height="4" fill="#b8952e"/></g></svg>',
    office: '<svg viewBox="0 0 800 500" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><rect width="800" height="500" fill="#eef2fb"/><rect x="0" y="372" width="800" height="128" fill="#c7cfe0"/><rect x="0" y="366" width="800" height="8" fill="#b3bdd3"/><rect x="520" y="70" width="210" height="160" rx="6" fill="#9cc3ff" stroke="#fff" stroke-width="10"/><g fill="#7da3d9"><rect x="540" y="150" width="34" height="75"/><rect x="584" y="125" width="40" height="100"/><rect x="634" y="160" width="30" height="65"/><rect x="674" y="140" width="38" height="85"/></g><line x1="625" y1="70" x2="625" y2="230" stroke="#fff" stroke-width="7"/><rect x="70" y="70" width="230" height="150" rx="8" fill="#fff" stroke="#e3e8f4" stroke-width="3"/><text x="185" y="98" font-size="17" font-weight="800" text-anchor="middle" fill="#0e2a6b">נכסים למכירה</text><g fill="#e5c76a"><rect x="92" y="114" width="56" height="40" rx="4"/><rect x="157" y="114" width="56" height="40" rx="4"/><rect x="222" y="114" width="56" height="40" rx="4"/></g><g fill="#c9d3ee"><rect x="92" y="162" width="56" height="40" rx="4"/><rect x="157" y="162" width="56" height="40" rx="4"/><rect x="222" y="162" width="56" height="40" rx="4"/></g><rect x="300" y="292" width="250" height="16" rx="4" fill="#0e2a6b"/><rect x="318" y="308" width="12" height="66" fill="#0e2a6b"/><rect x="520" y="308" width="12" height="66" fill="#0e2a6b"/><rect x="392" y="252" width="80" height="40" rx="4" fill="#4a5578"/><rect x="398" y="257" width="68" height="30" rx="2" fill="#9cc3ff"/><rect x="380" y="290" width="104" height="5" rx="2" fill="#4a5578"/><rect x="700" y="300" width="40" height="72" rx="6" fill="#b8952e"/><circle cx="720" cy="282" r="28" fill="#5fae6e"/><circle cx="702" cy="296" r="18" fill="#4f9a5e"/><circle cx="740" cy="294" r="18" fill="#6cbc7b"/></svg>'
  };

  // ---------------------------------------------------------------- דמויות
  // דמות חדשה: שורה כאן, ושורה ב-PROFILES וב-CHARACTERS שב-scripts/course_scene_voices.py
  var LOOK = {
    noa: { name: 'נועה', pitch: 520, skin: '#f1c7a5', hair: '#3b2416', style: 'long', top: '#e5c76a', shirt: '#ffffff', pants: '#0e2a6b' },
    dana: { name: 'דנה', pitch: 610, skin: '#e8b48e', hair: '#9b4a24', style: 'bob', top: '#2f9e8f', shirt: '#2f9e8f', pants: '#3b4a6b' },
    ido: { name: 'עידו', pitch: 300, skin: '#d9a27a', hair: '#1d1d1d', style: 'short', top: '#5b6bd6', shirt: '#5b6bd6', pants: '#2c3550', beard: true },
    avi: { name: 'אבי, הבעלים', pitch: 260, skin: '#e3b08a', hair: '#5a4632', style: 'short', top: '#3f6e8c', shirt: '#3f6e8c', pants: '#2f3542', glasses: true },
    shira: { name: 'שירה, השכנה', pitch: 560, skin: '#f0c9ab', hair: '#2b2b2b', style: 'long', top: '#c0587e', shirt: '#c0587e', pants: '#3b3f58' },
    yael: { name: 'יעל, אחותה של נועה', pitch: 590, skin: '#f1c7a5', hair: '#3b2416', style: 'bob', top: '#7a5cc4', shirt: '#7a5cc4', pants: '#2c3550' },
    eli: { name: 'אלי, הקבלן', pitch: 250, skin: '#d8a07a', hair: '#2e2a26', style: 'short', top: '#e07b39', shirt: '#e07b39', pants: '#3a3f4b', beard: true },
    tal: { name: 'טל', pitch: 330, skin: '#e9b892', hair: '#6b4a2b', style: 'short', top: '#2f7f6f', shirt: '#2f7f6f', pants: '#2c3550' },
    rina: { name: 'רינה', pitch: 470, skin: '#efc6a6', hair: '#d6d6d6', style: 'bob', top: '#5f8f6b', shirt: '#5f8f6b', pants: '#4a4f63', glasses: true },
    moshe: { name: 'משה, הבעלים', pitch: 230, skin: '#efc09a', hair: '#b9b9b9', style: 'bald', top: '#8a6d4b', shirt: '#8a6d4b', pants: '#4a3b2a', mus: true }
  };
  function charSvg(L) {
    var back = L.style === 'long' ? '<path d="M32 40 Q30 84 40 98 L80 98 Q90 84 88 40 Z" fill="' + L.hair + '"/>' : '';
    var top = {
      long: '<path d="M32 44 Q34 14 60 14 Q88 14 88 46 Q76 30 60 30 Q44 30 32 44Z" fill="' + L.hair + '"/>',
      bob: '<path d="M30 52 Q30 14 60 14 Q90 14 90 52 L84 64 Q84 34 60 32 Q36 34 36 64Z" fill="' + L.hair + '"/>',
      short: '<path d="M34 42 Q36 16 60 16 Q86 16 86 42 Q74 28 60 28 Q46 28 34 42Z" fill="' + L.hair + '"/>',
      bald: '<path d="M34 50 Q34 40 38 36 L40 52Z M86 50 Q86 40 82 36 L80 52Z" fill="' + L.hair + '"/>'
    }[L.style];
    var beard = L.beard ? '<path d="M40 60 Q42 82 60 84 Q78 82 80 60 Q72 72 60 72 Q48 72 40 60Z" fill="' + L.hair + '" opacity=".9"/>' : '';
    var mus = L.mus ? '<path d="M50 66 Q60 60 70 66 Q60 64 50 66Z" fill="#8d8d8d"/>' : '';
    var jacket = L.top !== L.shirt
      ? '<path d="M30 108 L54 108 L60 150 L66 108 L90 108 L96 190 L24 190Z" fill="' + L.top + '"/><path d="M54 108 L60 150 L66 108Z" fill="' + L.shirt + '"/>'
      : '<rect x="26" y="106" width="68" height="84" rx="16" fill="' + L.top + '"/>';
    var brow = L.style === 'bald' ? '#8d8d8d' : L.hair;
    return '<svg viewBox="0 0 120 300" aria-hidden="true"><g class="bob">' +
      '<rect x="40" y="186" width="17" height="96" rx="7" fill="' + L.pants + '"/><rect x="63" y="186" width="17" height="96" rx="7" fill="' + L.pants + '"/>' +
      '<ellipse cx="46" cy="286" rx="14" ry="7" fill="#1f2433"/><ellipse cx="74" cy="286" rx="14" ry="7" fill="#1f2433"/>' + back +
      '<rect x="18" y="112" width="15" height="74" rx="7" fill="' + L.top + '"/>' +
      '<g class="arm-wave"><rect x="87" y="112" width="15" height="74" rx="7" fill="' + L.top + '"/><circle cx="94.5" cy="188" r="7" fill="' + L.skin + '"/></g>' +
      '<circle cx="25.5" cy="188" r="7" fill="' + L.skin + '"/>' +
      '<rect x="52" y="84" width="16" height="26" rx="5" fill="' + L.skin + '"/>' + jacket +
      '<ellipse cx="60" cy="54" rx="27" ry="31" fill="' + L.skin + '"/>' + top + beard +
      '<ellipse class="eye" cx="50" cy="54" rx="3.2" ry="4" fill="#1f2433"/><ellipse class="eye" cx="70" cy="54" rx="3.2" ry="4" fill="#1f2433"/>' +
      '<path d="M44 45 Q50 42 55 45 M65 45 Q70 42 76 45" stroke="' + brow + '" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
      '<path d="M60 56 Q64 63 59 64" stroke="#b9805e" stroke-width="2" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="44" cy="64" rx="5" ry="3" fill="#f08a7a" opacity=".35"/><ellipse cx="76" cy="64" rx="5" ry="3" fill="#f08a7a" opacity=".35"/>' +
      (L.glasses ? '<g fill="none" stroke="#1f2433" stroke-width="2"><circle cx="50" cy="54" r="7.5"/><circle cx="70" cy="54" r="7.5"/><path d="M57.5 54 L62.5 54"/></g>' : '') +
      mus + '<rect class="mouth" x="54" y="69" width="12" height="4" rx="2" fill="#8a2c2c"/></g></svg>';
  }

  var I_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
  var I_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';
  var I_SND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
  var I_MUTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  // ---------------------------------------------------------------- סאונד
  // הקשר אחד לכל הדף: דפדפנים מגבילים את מספר ה-AudioContext, ושיעור עם כמה סצנות פותח כמה נגנים
  var AC = null, master = null, NB = null, muted = false, musicBuf = null, musicP = null, bufs = {};
  try { muted = localStorage.getItem('cs-muted') === '1'; } catch (e) { /* אחסון חסום */ }
  function audio() {
    if (!AC) {
      try {
        AC = new (window.AudioContext || window.webkitAudioContext)();
        master = AC.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(AC.destination);
      } catch (e) { AC = null; }
    }
    if (AC && AC.state === 'suspended') AC.resume();
    return AC;
  }
  function tone(f, dur, type, vol, when, glide) {
    if (!AC) return;
    var t = AC.currentTime + (when || 0), o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol, freq, ftype, when, sweep) {
    if (!AC) return;
    var t = AC.currentTime + (when || 0);
    if (!NB) { NB = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate); var d = NB.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    var s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
    s.buffer = NB; f.type = ftype || 'lowpass'; f.frequency.setValueAtTime(freq || 1200, t); if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.1, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05);
  }
  var SFX = {
    voice: function (p) { var f = p * (0.86 + Math.random() * 0.3); tone(f, 0.07, 'triangle', 0.07); tone(f * 2, 0.05, 'sine', 0.025); },
    step: function () { noise(0.06, 0.05, 700, 'lowpass'); },
    whoosh: function () { noise(0.55, 0.12, 300, 'bandpass', 0, 3500); },
    thud: function () { tone(62, 0.5, 'sine', 0.55); noise(0.15, 0.2, 300, 'lowpass'); },
    stamp: function () { tone(85, 0.3, 'sine', 0.6); noise(0.14, 0.25, 420, 'lowpass'); },
    gavel: function () { tone(140, 0.12, 'square', 0.12); noise(0.1, 0.35, 1600, 'bandpass'); tone(70, 0.4, 'sine', 0.5, 0.02); },
    ding: function () { tone(1318, 0.35, 'sine', 0.12); tone(1975, 0.45, 'sine', 0.07, 0.07); },
    tick: function () { tone(2400, 0.03, 'square', 0.03); },
    scribble: function () { for (var i = 0; i < 9; i++) noise(0.11, 0.05, 2200 + Math.random() * 1800, 'bandpass', i * 0.16); },
    rewind: function () { tone(160, 0.9, 'square', 0.04, 0, 1600); noise(0.9, 0.05, 4000, 'highpass'); },
    cash: function () { tone(1046, 0.12, 'triangle', 0.15); tone(1568, 0.7, 'triangle', 0.13, 0.1); noise(0.35, 0.06, 6000, 'highpass', 0.1); }
  };
  function fetchBuf(url) {
    if (bufs[url]) return Promise.resolve(bufs[url]);
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(function (ab) { return new Promise(function (res, rej) { AC.decodeAudioData(ab, res, rej); }); })
      .then(function (b) { bufs[url] = b; return b; })
      .catch(function () { return null; });
  }
  // לא מחכים לנצח לרשת איטית: מה שלא הגיע תוך 6 שניות מוקלד בלי קול
  function preload(names) {
    if (!AC) return Promise.resolve();
    var all = names.map(function (n) { return fetchBuf(BASE + n + '.mp3'); });
    // כישלון אחד לא משתיק את שאר הביקור: הבטחה שנכשלה מתאפסת וננסה בפעם הבאה
    if (!musicP) musicP = fetchBuf(BASE + 'music.mp3').then(function (b) { musicBuf = b; if (!b) musicP = null; });
    all.push(musicP);
    return Promise.race([Promise.all(all), new Promise(function (r) { setTimeout(r, 6000); })]);
  }
  function audioNames(beats) {
    var out = [];
    (beats || []).forEach(function (b) {
      if (b.a) out.push(b.a);
      if (b.cut && b.cut.a) out.push(b.cut.a);
      if (b.court && b.court.a) out.push(b.court.a);
    });
    return out;
  }

  // מוזיקה: אותו טראק, שלושה טיפולים. הקפאה = "עצירת קלטת"
  var MOODS = { day: { vol: 0.16, cut: 20000, rate: 1 }, tense: { vol: 0.18, cut: 650, rate: 0.94 }, warm: { vol: 0.18, cut: 20000, rate: 1 } };
  function setMuted(v) {
    muted = v;
    try { localStorage.setItem('cs-muted', v ? '1' : '0'); } catch (e) { /* אחסון חסום */ }
    if (master) master.gain.value = v ? 0 : 0.9;
  }

  // ---------------------------------------------------------------- נגן
  function create(host, opt) {
    if (!document.getElementById('cs-style')) {
      var st = document.createElement('style'); st.id = 'cs-style'; st.textContent = CSS; document.head.appendChild(st);
    }
    host.innerHTML =
      '<div class="cs"><div class="cs-stage" role="group" aria-label="' + esc('סצנה: ' + (opt.title || '')) + '">' +
      '<div class="cs-cam"><div class="cs-cast"></div></div>' +
      '<span class="cs-chip hide"></span><div class="cs-cut"><div></div></div>' +
      '<div class="cs-ov" data-ov="doc"></div><div class="cs-ov" data-ov="phone"></div><div class="cs-ov" data-ov="court"></div>' +
      '<div class="cs-badge"></div>' +
      '<div class="cs-freeze" aria-hidden="true"><div class="scan"></div><span class="stamp">עצרו!</span><img alt="" src="' + MENTOR_IMG + '"></div>' +
      '<button type="button" class="cs-poster"><span><span class="t1">עצרו את התמונה</span><span class="t2">' + esc(opt.title) + '</span>' +
      '<span class="t3">' + esc(opt.subtitle || '') + '</span><span class="pl">' + I_PLAY + '</span></span></button>' +
      '</div><div class="cs-bar"><button type="button" class="cs-btn" data-act="play" aria-label="הפעלה">' + I_PLAY + '</button>' +
      '<button type="button" class="cs-btn ghost" data-act="mute"></button>' +
      '<button type="button" class="cs-skip" data-act="skip">דילוג לשאלה</button></div></div>';
    var root = host.querySelector('.cs'), stage = root.querySelector('.cs-stage'), cam = root.querySelector('.cs-cam'), castEl = root.querySelector('.cs-cast');
    var poster = root.querySelector('.cs-poster'), playBtn = root.querySelector('[data-act="play"]'), muteBtn = root.querySelector('[data-act="mute"]'), skipBtn = root.querySelector('[data-act="skip"]');
    var actors = {}, bubbles = [], run = 0, paused = false, ff = false, music = null, speaking = null, dead = false, phase = 'poster';

    function q(sel) { return root.querySelector(sel); }
    function setPlayIcon(p) { playBtn.innerHTML = p ? I_PAUSE : I_PLAY; playBtn.setAttribute('aria-label', p ? 'השהיה' : 'הפעלה'); }
    function setMuteIcon() { muteBtn.innerHTML = muted ? I_MUTE : I_SND; muteBtn.setAttribute('aria-label', muted ? 'הפעלת סאונד' : 'השתקה'); }
    setMuteIcon();

    // זמן שנעצר עם ההשהיה, ומתבטל כשהנגן נסגר או מתחיל מחדש
    function wait(ms) {
      var my = run;
      return new Promise(function (res, rej) {
        if (ff) return res();
        var left = RM ? Math.min(ms, 250) : ms, last = performance.now();
        (function step(now) {
          if (my !== run || dead) return rej('cancel');
          if (!paused) left -= now - last;
          last = now;
          if (left <= 0) return res();
          requestAnimationFrame(step);
        })(last);
      });
    }
    function sfx(name) { if (!ff && !muted && AC) SFX[name](); }
    function speak(name) {
      var b = name && bufs[BASE + name + '.mp3'];
      if (!b || !AC || muted || ff) return 0;
      shush();
      var src = AC.createBufferSource(), g = AC.createGain(); src.buffer = b; g.gain.value = 1.15; src.connect(g); g.connect(master); src.start();
      speaking = src; duck(true); src.onended = function () { if (speaking === src) { speaking = null; duck(false); } };
      return b.duration;
    }
    function shush() { if (speaking) { try { speaking.stop(); } catch (e) { /* כבר נעצר */ } speaking = null; duck(false); } }
    function duck(on) {
      if (!music || !music.gain || !AC) return;
      var t = AC.currentTime; music.gain.gain.cancelScheduledValues(t); music.gain.gain.setTargetAtTime(on ? 0.05 : MOODS[music.mood].vol, t, 0.12);
    }
    function musicStart(mood) {
      musicStop(); if (!AC || !musicBuf || ff) return;
      var m = MOODS[mood] || MOODS.day, src = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain(), t = AC.currentTime;
      src.buffer = musicBuf; src.loop = true; src.playbackRate.value = m.rate; f.type = 'lowpass'; f.frequency.value = m.cut;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(m.vol, t + 0.8);
      src.connect(f); f.connect(g); g.connect(master); src.start(t);
      music = { src: src, gain: g, mood: mood in MOODS ? mood : 'day' };
    }
    function musicStop(tape) {
      var m = music; music = null; if (!m || !AC) return;
      var t = AC.currentTime;
      if (tape) { m.src.playbackRate.cancelScheduledValues(t); m.src.playbackRate.setValueAtTime(m.src.playbackRate.value, t); m.src.playbackRate.exponentialRampToValueAtTime(0.18, t + 0.55); }
      m.gain.gain.cancelScheduledValues(t); m.gain.gain.setValueAtTime(m.gain.gain.value || 0.15, t); m.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      m.src.stop(t + 0.7);
    }

    function narrow() { return stage.clientWidth < 520; }
    // רקע נבנה רק כשסצנה משתמשת בו, ישר מ-BG: רקע חדש הוא שורה אחת שם
    function showBg(name) {
      if (!BG[name]) return;
      if (!root.querySelector('.cs-bg[data-bg="' + name + '"]')) {
        var el = document.createElement('div'); el.className = 'cs-bg off'; el.setAttribute('data-bg', name); el.innerHTML = BG[name];
        cam.insertBefore(el, castEl); void el.offsetWidth;
      }
      Array.prototype.forEach.call(root.querySelectorAll('.cs-bg'), function (el) { el.classList.toggle('off', el.getAttribute('data-bg') !== name); });
    }
    function spawn(who, left, flip) {
      var el = document.createElement('div'); el.className = 'cs-ch' + (flip ? ' flip' : ''); el.style.left = left + '%';
      el.innerHTML = charSvg(LOOK[who] || LOOK.noa); castEl.appendChild(el); actors[who] = el;
    }
    function hush() { bubbles.forEach(function (b) { b.classList.add('out'); setTimeout(function () { b.remove(); }, 260); }); bubbles = []; }
    function chip(t) { var c = q('.cs-chip'); if (!t) { c.classList.add('hide'); return; } c.textContent = t; c.classList.remove('hide'); }
    function zoom(z) {
      if (!z || z === 1) { cam.style.transform = ''; return; }
      cam.style.transformOrigin = (z[1] || 50) + '% ' + (z[2] || 70) + '%'; cam.style.transform = 'scale(' + z[0] + ')';
    }
    function ov(kind, html) {
      var el = q('[data-ov="' + kind + '"]');
      if (html == null) { el.classList.remove('on'); return el; }
      el.innerHTML = html; void el.offsetWidth; el.classList.add('on'); return el;
    }
    function resetOverlays() { ['doc', 'phone', 'court'].forEach(function (k) { ov(k, null); }); q('.cs-badge').classList.remove('on'); q('.cs-cut').classList.remove('on'); hush(); chip(); }

    function say(who, text, a) {
      var actor = actors[who];
      if (!actor) return Promise.resolve();
      hush();
      var b = document.createElement('div'); b.className = 'cs-bubble';
      b.innerHTML = '<b>' + esc((LOOK[who] || {}).name || '') + '</b><span></span>';
      var span = b.querySelector('span'), i = 0;
      span.textContent = text; b.style.visibility = 'hidden'; stage.appendChild(b);
      var sr = stage.getBoundingClientRect(), ar = actor.getBoundingClientRect(), bw = b.offsetWidth;
      var cx = ar.left + ar.width / 2 - sr.left, L = Math.max(8, Math.min(sr.width - bw - 8, cx - bw * 0.35));
      b.style.width = bw + 'px'; b.style.left = L + 'px'; b.style.bottom = (sr.bottom - ar.top + 14) + 'px';
      b.style.setProperty('--tail', Math.max(14, Math.min(bw - 32, cx - L - 9)) + 'px');
      span.textContent = ''; b.style.visibility = ''; bubbles.push(b);
      if (ff) { span.textContent = text; return Promise.resolve(); }
      actor.classList.add('talk');
      var dur = speak(a), per = dur ? Math.max(18, dur * 1000 * 0.82 / text.length) : 26;
      return new Promise(function (res, rej) {
        var my = run;
        (function typeNext() {
          if (my !== run || dead) { actor.classList.remove('talk'); return rej('cancel'); }
          if (paused) return setTimeout(typeNext, 60);
          if (RM || ff) { span.textContent = text; i = text.length; }
          if (i < text.length) {
            span.textContent = text.slice(0, ++i);
            if (!dur && !muted && AC && i % 2 === 0 && text.charAt(i - 1) !== ' ') SFX.voice((LOOK[who] || {}).pitch || 400);
            return setTimeout(typeNext, per);
          }
          var rest = dur ? Math.max(0, dur * 1000 * 0.18) + 550 : 900 + text.length * 45;
          wait(rest).then(function () { actor.classList.remove('talk'); res(); }, rej);
        })();
      });
    }
    function walk(moves, ms) {
      var my = run;
      ms = ms || 2200;
      if (!ff) for (var s = 0; s < ms; s += 300) setTimeout(function () { if (my === run && !paused) sfx('step'); }, s);
      moves.forEach(function (m) {
        var a = actors[m[0]]; if (!a) return;
        a.classList.add('walk'); a.style.transitionDuration = (ff ? 0 : ms / 1000) + 's'; a.style.left = m[1] + '%';
      });
      return wait(ms).then(function () { moves.forEach(function (m) { var a = actors[m[0]]; if (a) a.classList.remove('walk'); }); });
    }
    function narrate(a) { var d = speak(a); return d ? wait(d * 1000 + 250) : Promise.resolve(); }

    // צעד אחד בתסריט. המפתחות נבדקים ב-SCENE_BEAT_KEYS שב-course_content_sql.py
    function beat(b) {
      // סגירת מסמך או טלפון קודמת לכל השאר, כדי שאפשר יהיה לסגור ולדבר באותו צעד
      if (b.doc === null) ov('doc', null);
      if (b.phone === null) ov('phone', null);
      if (b.music !== undefined) { if (b.music) musicStart(b.music); else musicStop(); }
      if (b.scene) {
        showBg(b.scene);
        castEl.innerHTML = ''; actors = {}; hush(); zoom(1);
        (b.cast || []).forEach(function (c) { spawn(c[0], c[1], c[2] === 'flip'); });
      }
      if (b.chip !== undefined) chip(b.chip);
      if (b.zoom) zoom(b.zoom);
      if (b.wave && actors[b.wave]) actors[b.wave].classList.add('wave');
      if (b.badge) { var bd = q('.cs-badge'); bd.textContent = b.badge; bd.classList.add('on'); sfx('cash'); }
      if (b.say) return say(b.say, b.text, b.a);
      if (b.walk) return walk(b.walk, b.ms);
      if (b.inside) {
        var door = narrow() ? 42 : 43;
        return walk(b.inside.map(function (w) { return [w, door]; }), b.ms || 1900).then(function () {
          b.inside.forEach(function (w) { if (actors[w]) actors[w].style.opacity = '0'; });
          return wait(700);
        });
      }
      if (b.cut) {
        var c = q('.cs-cut'); c.firstChild.innerHTML = esc(b.cut.title) + (b.cut.sub ? '<small>' + esc(b.cut.sub) + '</small>' : '');
        hush(); c.classList.add('on'); sfx('whoosh');
        var d = speak(b.cut.a);
        return wait(Math.max(1700, d * 1000 + 500)).then(function () { c.classList.remove('on'); return wait(400); });
      }
      if (b.phone) {
        hush();
        var el = ov('phone', '<div class="cs-phone"><div class="scr"><div class="who">' + esc(b.phone.who || '') + '</div>' +
          (b.phone.msgs || []).map(function (m) { return '<div class="cs-msg ' + (m[0] === 'me' ? 'me' : 'them') + '">' + esc(m[1]) + '</div>'; }).join('') + '</div></div>');
        var msgs = el.querySelectorAll('.cs-msg'), k = 0;
        return wait(500).then(function next() {
          if (k >= msgs.length) return wait(1800);
          msgs[k].classList.add('on'); sfx('ding');
          var len = msgs[k].textContent.length; k++;
          return wait(Math.min(2600, 900 + len * 28)).then(next);
        });
      }
      if (b.doc) {
        hush();
        var de = ov('doc', '<div class="cs-doc"><h4>' + esc(b.doc.title) + '</h4>' +
          (b.doc.rows || []).map(function (r) { return '<div class="row"><span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span></div>'; }).join('') +
          (b.doc.sign ? '<svg viewBox="0 0 300 60" aria-hidden="true"><path d="M10 40 C 40 5, 60 55, 85 30 S 120 10, 135 38 S 170 50, 190 22 C 205 5, 215 50, 240 30 L 290 28"/></svg><div class="sl">' + esc(b.doc.sign) + '</div>' : '') + '</div>');
        var rows = de.querySelectorAll('.row'), j = 0;
        return wait(600).then(function next() {
          if (j < rows.length) { rows[j++].classList.add('f'); sfx('tick'); return wait(450).then(next); }
          if (!b.doc.sign) return wait(1200);
          de.firstChild.classList.add('signed'); sfx('scribble');
          return wait(2200);
        });
      }
      if (b.court) {
        castEl.innerHTML = ''; actors = {}; hush();
        var ce = ov('court', '<div class="cs-court"><div class="crest">' + esc(b.court.court || '') + '</div><h4>' + esc(b.court.title || '') + '</h4>' +
          (b.court.lines || []).map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') +
          '<span class="verdict">' + esc(b.court.verdict || '') + '</span>' + (b.court.ref ? '<p style="margin-top:.7em;font-size:.85em">' + esc(b.court.ref) + '</p>' : '') + '</div>');
        return wait(1300).then(function () {
          ce.firstChild.classList.add('hit'); sfx('gavel'); setTimeout(function () { sfx('stamp'); }, 260); musicStop();
          return wait(700);
        }).then(function () { return narrate(b.court.a); }).then(function () { return wait(500); });
      }
      if (b.vo) { hush(); return narrate(b.a); }
      if (b.wait) return wait(b.wait);
      // צעד שרק סגר מסמך או טלפון: רגע קצר עד שהסגירה נגמרת
      if (b.doc === null || b.phone === null) return wait(400);
      return Promise.resolve();
    }
    function runBeats(beats) {
      var i = 0;
      return (function next() {
        if (dead) return Promise.reject('cancel');
        if (i >= beats.length) return Promise.resolve();
        return beat(beats[i++]).then(next);
      })();
    }

    function freeze() {
      // "עצירת קלטת" רק כשהמוזיקה באמת התנגנה, לא אחרי דילוג
      var skipped = ff;
      phase = 'frozen'; ff = false; paused = false; setPlayIcon(false); skipBtn.hidden = true;
      musicStop(!skipped); hush();
      stage.classList.add('frozen');
      setTimeout(function () { sfx('thud'); }, 380); setTimeout(function () { sfx('stamp'); }, 520);
      var my = run; setTimeout(function () { if (my === run && !dead) speak(opt.freeze_a); }, 1250);
      if (opt.onFreeze) opt.onFreeze();
    }
    function unfreeze() { stage.classList.remove('frozen'); zoom(1); }

    function start() {
      audio(); run++; ff = false; paused = false; dead = false; phase = 'playing';
      resetOverlays(); unfreeze(); poster.classList.add('hide'); skipBtn.hidden = false; setPlayIcon(true);
      var my = run;
      preload(audioNames(opt.beats).concat(opt.freeze_a ? [opt.freeze_a] : [])).then(function () {
        if (my !== run || dead) return;
        musicStart('day');
        runBeats(opt.beats).then(function () { if (my === run) return wait(400).then(freeze); }).catch(function (e) { if (e !== 'cancel') throw e; });
      });
    }
    // דילוג: מריצים את התסריט בלי זמן ובלי קול, כדי שהבמה תעמוד במקום הנכון
    function skip() {
      audio(); run++; ff = true; shush(); musicStop(); poster.classList.add('hide');
      var my = run;
      preload(opt.freeze_a ? [opt.freeze_a] : []);
      resetOverlays();
      runBeats(opt.beats).then(function () { if (my === run) { ff = false; freeze(); } }).catch(function () { /* בוטל */ });
    }

    poster.addEventListener('click', start);
    playBtn.addEventListener('click', function () {
      if (phase === 'poster' || phase === 'done') { start(); return; }
      if (phase === 'frozen') return;
      paused = !paused; setPlayIcon(!paused);
      if (AC) { if (paused) AC.suspend(); else AC.resume(); }
    });
    muteBtn.addEventListener('click', function () { audio(); setMuted(!muted); setMuteIcon(); if (muted) shush(); });
    skipBtn.addEventListener('click', function () { if (phase === 'poster' || phase === 'playing') skip(); });

    return {
      // הסוף שחזר מ-course_answer. נגמר בהבטחה, ו-learn.js מציג אחריה את ההמשך
      playEnding: function (beats) {
        if (dead || !beats || !beats.length) return Promise.resolve();
        audio(); run++; ff = false; paused = false; phase = 'playing'; skipBtn.hidden = true; setPlayIcon(true);
        var my = run;
        // חזרה לסצנה שכבר נענתה מציגה את הפוסטר; הסוף מתנגן על הבמה, לא מתחתיו
        shush(); unfreeze(); poster.classList.add('hide');
        return preload(audioNames(beats)).then(function () {
          if (my !== run || dead) return;
          return runBeats(beats).then(function () { phase = 'done'; setPlayIcon(false); musicStop(); });
        }).catch(function (e) { if (e !== 'cancel') throw e; });
      },
      rewind: function () {
        if (dead) return Promise.resolve();
        audio(); run++; shush(); musicStop(); resetOverlays(); sfx('rewind');
        stage.classList.add('rewind');
        return new Promise(function (r) { setTimeout(function () { stage.classList.remove('rewind'); r(); }, RM ? 50 : 950); });
      },
      showPoster: function (label) {
        run++; shush(); musicStop(); resetOverlays(); unfreeze(); phase = 'poster'; setPlayIcon(false); skipBtn.hidden = false;
        if (label) poster.querySelector('.t3').textContent = label;
        poster.classList.remove('hide');
      },
      destroy: function () { dead = true; run++; shush(); musicStop(); if (AC && AC.state === 'suspended') AC.resume(); host.innerHTML = ''; }
    };
  }

  window.CourseScene = { create: create };
})();
