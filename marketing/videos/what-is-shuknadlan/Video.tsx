import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";
import { BgMesh, Captions, Entrance, Grain, Music, SceneFrame, Sfx, Vignette, Voiceover, font, onWord, sceneById, wordFrame } from "reelkit/kit";
import type { VideoProps } from "reelkit/kit";
import { NodeTriad } from "./NodeTriad";
import { AppWindow } from "./AppWindow";
import { StatTile } from "./StatTile";
import { PhoneFrame } from "./PhoneFrame";
import { ChatThread } from "./ChatThread";
import { BeforeAfter } from "./BeforeAfter";
import { FeatureChip } from "./FeatureChip";
import { OfficeNetwork } from "./OfficeNetwork";
import { AgentTable } from "./AgentTable";
import { MentorCard } from "./MentorCard";
import { AskBox } from "./AskBox";
import { SceneTitle } from "./SceneTitle";

// "מה זה שוק הנדל״ן" - for brokerage office owners, 16:9, for a meeting.
// Deep blue and one red accent on a pale ground. No network names or marks. Screens are rebuilt with demo data.
const P = {
  bg: "#F4F6FA",
  surface: "#FFFFFF",
  ink: "#0B1B3F",
  hero: "#003DA5",
  accent: "#DC1C2E",
  dim: "#5B6475",
  line: "#E3E8F0",
  good: "#1F8A4C",
  panel: "#0E2557",
  gold: "#E2B93B",
  meshA: "#D7E3F8",
  meshB: "#F7DDE0",
};
const heebo = font("heebo");

const IMG = {
  logo: "assets/user/a-89868cb2-logo-shuknadlan.png",
  gabriela: "assets/user/a-b743cf52-gabriela-avatar.png",
  mentor: "assets/user/a-dad4ffb2-mentor-avatar.png",
  agent: "assets/user/a-816ff4b0-agent-portrait.jpg",
  search: "assets/user/a-aa6d409b-site-search.jpg",
  map: "assets/user/a-cb9dd542-site-map.jpg",
  roomBefore: "assets/user/a-233e5c3e-viz-room-before.jpg",
  roomAfter: "assets/user/a-c25e0fbb-viz-room-after.jpg",
  shopBefore: "assets/user/a-1b5c46e5-viz-shop-before.jpg",
  shopAfter: "assets/user/a-1c7fb3e8-viz-shop-after.jpg",
};
const SFX = {
  whoosh: "assets/lib/sfx-ui-soft-whoosh/clip.mp3",
  pop: "assets/lib/sfx-ui-bubble-pop/clip.mp3",
  tap: "assets/lib/sfx-ui-glass-tap/clip.mp3",
  ping: "assets/lib/sfx-ui-notification-ping/clip.mp3",
  send: "assets/lib/sfx-ui-send-swoosh/clip.mp3",
  impact: "assets/lib/sfx-ui-soft-impact/clip.mp3",
  sparkle: "assets/lib/sfx-ui-sparkle-shimmer/clip.mp3",
  chime: "assets/lib/sfx-ui-success-chime/clip.mp3",
  whip: "assets/lib/cinematic-whooshes-whoosh-fast/clip.mp3",
  ticks: "assets/lib/sfx-ui-count-ticks/clip.mp3",
  keys: "assets/lib/sfx-ui-key-clicks/clip.mp3",
  click: "assets/lib/youtube-picks-interface-mouse-click/clip.mp3",
  riser: "assets/lib/sfx-ui-riser-short/clip.mp3",
};
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type Scene = VideoProps["manifest"]["scenes"][number];

const Voice: React.FC<{ s: Scene; urls: VideoProps["urls"]; group: VideoProps["manifest"]["captions"] }> = ({ s, urls, group }) => (
  <>
    <div style={{ position: "absolute", inset: 0, transform: "scale(0.5)", transformOrigin: "50% 98%" }}>
      <Captions words={s.words} group={group} mode="pop" highlight={P.accent} face={heebo} rtl bottom={0.035} />
    </div>
    {s.voiceoverKey ? <Voiceover src={urls[s.voiceoverKey]} /> : null}
  </>
);

// A pill in the accent colour that pops in on its word.
const Pill: React.FC<{ text: string; at: number; x: number; y: number; size?: number }> = ({ text, at, x, y, size = 0.022 }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 12, stiffness: 200 } });
  const fs = width * size;
  return (
    <div style={{ position: "absolute", right: width * (1 - x), top: height * y, background: P.accent, color: P.surface, fontFamily: heebo, fontWeight: 800, fontSize: fs, padding: `${fs * 0.3}px ${fs * 0.8}px`, borderRadius: fs * 2, direction: "rtl", whiteSpace: "nowrap", opacity: interpolate(frame - at, [0, 2], [0, 1], clamp), transform: `scale(${0.7 + 0.3 * s})`, transformOrigin: "right center", boxShadow: "0 10px 24px rgba(220,28,46,0.3)" }}>{text}</div>
  );
};

const Hook: React.FC<{ s: Scene; urls: VideoProps["urls"] }> = ({ s, urls }) => {
  const { width, height } = useVideoConfig();
  return (
    <>
      <Entrance delay={2} style={{ position: "absolute", top: height * 0.09, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: width * 0.012, direction: "rtl" }}>
        <Img src={urls[IMG.logo]} style={{ height: height * 0.09 }} />
        <div style={{ fontFamily: heebo, fontWeight: 900, fontSize: width * 0.03, color: P.hero, whiteSpace: "nowrap" }}>שוק הנדל״ן</div>
      </Entrance>
      <SceneTitle title="מערכת אחת" titleAt={onWord(s, "מערכת")} align="center" y={0.22} size={0.06} ink={P.ink} accent={P.accent} font={heebo} />
      <NodeTriad labels={["המשרד", "המשרדים", "הקונים"]} at={[onWord(s, "המשרד"), onWord(s, "המשרדים"), onWord(s, "והקונים")]} y={0.62} size={0.15} ink={P.ink} hero={P.hero} accent={P.accent} surface={P.surface} font={heebo} />
    </>
  );
};

const Office: React.FC<{ s: Scene; urls: VideoProps["urls"] }> = ({ s, urls }) => {
  const { width, height } = useVideoConfig();
  const crm = onWord(s, "מערכת");
  return (
    <>
      <SceneTitle kicker="בתוך המשרד" title="CRM + עוזרת AI" kickerAt={2} titleAt={crm} ink={P.hero} accent={P.accent} font={heebo} />
      <Pill text="חוסכת שעות לכל סוכן" at={onWord(s, "שעות")} x={0.95} y={0.245} />
      <AppWindow title="דף הבית · הסוכן" x={0.4} y={0.33} w={0.55} h={0.52} delay={crm} ink={P.ink} hero={P.hero} surface={P.surface} line={P.line} font={heebo}>
        <div style={{ display: "flex", gap: width * 0.012, padding: width * 0.014, direction: "rtl" }}>
          <StatTile label="עמלות פוטנציאליות" value={1.6} decimals={1} prefix="₪" suffix=" מ'" delta="+₪265 א' החודש" delay={crm + 6} w={0.165} h={0.19} ink={P.ink} dim={P.dim} bar={P.hero} good={P.good} surface={P.surface} line={P.line} font={heebo} />
          <StatTile label="נכסים פעילים" value={67} delta="+7 החודש" delay={crm + 10} w={0.165} h={0.19} ink={P.ink} dim={P.dim} bar={P.gold} good={P.good} surface={P.surface} line={P.line} font={heebo} />
          <StatTile label="לקוחות מחפשים" value={25} delta="+34 החודש" delay={crm + 14} w={0.165} h={0.19} ink={P.ink} dim={P.dim} bar={P.good} good={P.good} surface={P.surface} line={P.line} font={heebo} />
        </div>
        <div style={{ display: "flex", gap: width * 0.012, padding: `0 ${width * 0.014}px`, direction: "rtl" }}>
          {[["60 התאמות נכס ללקוחות", crm + 18], ["3 פגישות ומשימות להיום", crm + 22]].map(([t, d]) => (
            <Entrance key={t as string} delay={d as number} style={{ flex: 1, background: P.bg, borderRadius: width * 0.008, padding: `${height * 0.022}px ${width * 0.012}px`, fontFamily: heebo, fontWeight: 700, fontSize: width * 0.0135, color: P.ink, whiteSpace: "nowrap" }}>{t}</Entrance>
          ))}
        </div>
      </AppWindow>
      <PhoneFrame x={0.2} y={0.53} h={0.8} aspect={0.55} delay={onWord(s, "וגבריאלה")}>
        <ChatThread
          name="גבריאלה AI שוק הנדל״ן"
          avatar={urls[IMG.gabriela]}
          phoneH={0.78}
          text={0.033}
          font={heebo}
          messages={[
            { from: "me", lines: ["תוסיפי לקוחה חדשה, דנה לוי,", "מחפשת 4 חדרים עד 1.2 מיליון"], at: onWord(s, "עוזרת") },
            { from: "them", lines: ["פתחתי כרטיס לדנה לוי.", "יש לה שתי התאמות של 100%:"], at: onWord(s, "מלאכותית") },
            { from: "them", lines: ["• הרצל 52 - הדירה שלך", "• הנרקיסים 65 - ששותפה מהמשרד"], bold: [], at: onWord(s, "סוכן") },
          ]}
        />
      </PhoneFrame>
      <Sfx src={urls[SFX.pop]} at={wordFrame(s, "מערכת")} volume={0.24} />
      <Sfx src={urls[SFX.ticks]} at={crm + 6} volume={0.2} />
      <Sfx src={urls[SFX.send]} at={wordFrame(s, "עוזרת")} volume={0.24} />
      <Sfx src={urls[SFX.ping]} at={wordFrame(s, "מלאכותית")} volume={0.24} />
      <Sfx src={urls[SFX.ping]} at={wordFrame(s, "סוכן")} volume={0.22} />
    </>
  );
};

const Offices: React.FC<{ s: Scene; urls: VideoProps["urls"] }> = ({ s, urls }) => {
  const share = onWord(s, "שיתופי");
  return (
    <>
      <SceneTitle kicker="בין המשרדים" title="שיתופי פעולה והתאמות" kickerAt={2} titleAt={share} ink={P.hero} accent={P.accent} font={heebo} />
      <OfficeNetwork
        nodes={[
          { x: 0.6, y: 0.56, label: "המשרד שלך", at: 2, main: true },
          { x: 0.84, y: 0.5, label: "משרד ב׳", at: share },
          { x: 0.36, y: 0.38, label: "משרד ג׳", at: share + 4 },
          { x: 0.8, y: 0.8, label: "משרד ד׳", at: share + 8 },
          { x: 0.33, y: 0.74, label: "משרד ה׳", at: share + 12 },
        ]}
        linkAt={onWord(s, "מקומיים")}
        from={0}
        to={2}
        travelAt={onWord(s, "הנכסים")}
        cardLabel="הנכס שלך · 4 חדרים"
        clientAt={onWord(s, "ללקוחות")}
        clientLabel="הלקוחה שלהם"
        matchAt={onWord(s, "שלהם")}
        matchLabel="100% התאמה"
        ink={P.ink}
        hero={P.hero}
        accent={P.accent}
        surface={P.surface}
        font={heebo}
      />
      <Sfx src={urls[SFX.tap]} at={wordFrame(s, "שיתופי")} volume={0.24} />
      <Sfx src={urls[SFX.whoosh]} at={wordFrame(s, "הנכסים")} volume={0.24} />
      <Sfx src={urls[SFX.chime]} at={wordFrame(s, "שלהם")} volume={0.28} />
    </>
  );
};

const Buyers: React.FC<{ s: Scene; urls: VideoProps["urls"] }> = ({ s, urls }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const viz = onWord(s, "הדמיות");
  const shop = onWord(s, "מלאכותית");
  const lead = onWord(s, "פנייה");
  const vizOut = interpolate(frame, [lead - 4, lead + 6], [1, 0], clamp);
  const t = interpolate(frame, [lead, lead + 20], [0, 1], { ...clamp, easing: (v: number) => 1 - Math.pow(1 - v, 3) });
  return (
    <>
      <SceneTitle kicker="מול הקונים" title="כל נכס עולה לאתר" kickerAt={2} titleAt={onWord(s, "עולה")} ink={P.hero} accent={P.accent} font={heebo} />
      <PhoneFrame src={urls[IMG.search]} src2={urls[IMG.map]} swapAt={onWord(s, "המפה")} x={0.86} y={0.56} h={0.7} delay={onWord(s, "לאתר")} />
      <div style={{ position: "absolute", right: width * 0.25, top: height * 0.34, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: height * 0.025, direction: "ltr" }}>
        <FeatureChip label="חיפוש בגבריאלה" glyph="chat" delay={onWord(s, "בגבריאלה")} size={0.042} ink={P.ink} hero={P.hero} surface={P.surface} font={heebo} />
        <FeatureChip label="חיפוש על המפה" glyph="pin" delay={onWord(s, "המפה")} size={0.042} ink={P.ink} hero={P.hero} surface={P.surface} font={heebo} />
        <FeatureChip label="הדמיות AI" glyph="spark" delay={viz} size={0.042} ink={P.ink} hero={P.hero} surface={P.surface} font={heebo} />
        <FeatureChip label="מחשבון משכנתא" glyph="calc" delay={onWord(s, "ומחשבון")} size={0.042} ink={P.ink} hero={P.hero} surface={P.surface} font={heebo} />
      </div>
      <div style={{ position: "absolute", inset: 0, opacity: vizOut }}>
        <BeforeAfter before={urls[IMG.roomBefore]} after={urls[IMG.roomAfter]} x={0.27} y={0.56} w={0.4} delay={viz} wipeAt={viz + 3} frames={20} handle={P.accent} label="סלון · מודרני נקי" labelBg={P.hero} font={heebo} />
        {frame >= shop - 2 ? (
          <BeforeAfter before={urls[IMG.shopBefore]} after={urls[IMG.shopAfter]} x={0.27} y={0.56} w={0.4} delay={shop - 2} wipeAt={shop + 3} frames={20} handle={P.accent} label="חלל עסק · מינימרקט" labelBg={P.hero} font={heebo} />
        ) : null}
      </div>
      {frame >= lead ? (
        <div style={{ position: "absolute", left: width * (0.62 - 0.4 * t), top: height * (0.6 - 0.1 * t), opacity: interpolate(frame - lead, [0, 3], [0, 1], clamp), direction: "rtl", background: P.surface, border: `3px solid ${P.hero}`, borderRadius: width * 0.012, padding: `${height * 0.02}px ${width * 0.015}px`, boxShadow: "0 16px 36px rgba(11,27,63,0.22)", display: "flex", alignItems: "center", gap: width * 0.01 }}>
          <div style={{ width: width * 0.03, height: width * 0.03, borderRadius: "50%", background: P.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 24 24" width={width * 0.018} height={width * 0.018} fill="none" stroke={P.surface} strokeWidth={2.2} strokeLinecap="round"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
          </div>
          <div>
            <div style={{ fontFamily: heebo, fontWeight: 800, fontSize: width * 0.016, color: P.ink, whiteSpace: "nowrap" }}>ליד חדש מהאתר</div>
            <div style={{ fontFamily: heebo, fontWeight: 500, fontSize: width * 0.012, color: P.dim, whiteSpace: "nowrap" }}>נכנס ישר ל-CRM של הסוכן</div>
          </div>
        </div>
      ) : null}
      <Pill text="כל פנייה היא ליד" at={onWord(s, "כליד")} x={0.5} y={0.4} size={0.028} />
      <Sfx src={urls[SFX.whoosh]} at={wordFrame(s, "לאתר")} volume={0.22} />
      <Sfx src={urls[SFX.pop]} at={wordFrame(s, "בגבריאלה")} volume={0.22} />
      <Sfx src={urls[SFX.pop]} at={wordFrame(s, "המפה")} volume={0.22} />
      <Sfx src={urls[SFX.sparkle]} at={wordFrame(s, "הדמיות")} volume={0.24} />
      <Sfx src={urls[SFX.pop]} at={wordFrame(s, "ומחשבון")} volume={0.22} />
      <Sfx src={urls[SFX.send]} at={wordFrame(s, "פנייה")} volume={0.26} />
      <Sfx src={urls[SFX.impact]} at={wordFrame(s, "כליד")} volume={0.26} />
    </>
  );
};

const Dashboard: React.FC<{ s: Scene; urls: VideoProps["urls"] }> = ({ s, urls }) => {
  const { width, height } = useVideoConfig();
  const dash = onWord(s, "בדאשבורד");
  const excl = onWord(s, "בלעדיות");
  const tile = (label: string, value: number, d: number, bar: string, suffix = "", delta?: string) => (
    <StatTile label={label} value={value} suffix={suffix} delta={delta} delay={dash + d} w={0.155} h={0.155} ink={P.ink} dim={P.dim} bar={bar} good={P.good} surface={P.surface} line={P.line} font={heebo} />
  );
  return (
    <>
      <SceneTitle title="הכול בדאשבורד אחד" titleAt={dash} y={0.035} size={0.034} ink={P.hero} accent={P.accent} font={heebo} />
      <AppWindow title="דאשבורד משרד · רבעון נוכחי" tag="נתוני הדגמה" x={0.05} y={0.13} w={0.9} h={0.73} delay={dash} ink={P.ink} hero={P.hero} surface={P.surface} line={P.line} font={heebo}>
        <div style={{ display: "flex", gap: width * 0.011, padding: width * 0.012, direction: "rtl" }}>
          {tile("עסקאות שנסגרו", 9, 4, P.hero, "", "+3 מול הרבעון הקודם")}
          {tile("נכסים שגויסו", 34, 7, P.gold, "", "+12 מול הרבעון הקודם")}
          {tile("הסכמי תיווך", 21, 10, P.good, "", "+33%")}
          {tile("נענו תוך 15 דק׳", 86, 13, P.hero, "%", "+18%")}
          {tile("שיעור בלעדיות", 42, 16, P.accent, "%", "+9%")}
        </div>
        <div style={{ display: "flex", gap: width * 0.02, padding: `0 ${width * 0.014}px`, direction: "rtl" }}>
          <AgentTable
            delay={dash + 10}
            w={0.56}
            head={["סוכן", "עמידה ביעד", "עסקאות", "לידים", "זמן תגובה"]}
            rows={[
              { name: "יואב כהן", photo: urls[IMG.agent], pct: 118, deals: "4", leads: "22", reply: "9 דק׳", flag: "בעניינים", flagAt: onWord(s, "בעניינים"), tone: "good" },
              { name: "דנה לוי", pct: 104, deals: "3", leads: "18", reply: "12 דק׳" },
              { name: "מיכל אברהם", pct: 92, deals: "2", leads: "15", reply: "14 דק׳" },
              { name: "רון שגיא", pct: 64, deals: "0", leads: "11", reply: "3 שעות", flag: "4 לידים ממתינים", flagAt: onWord(s, "מאחר"), tone: "bad" },
            ]}
            ink={P.ink}
            dim={P.dim}
            hero={P.hero}
            good={P.good}
            bad={P.accent}
            surface={P.surface}
            line={P.line}
            font={heebo}
          />
          <Entrance delay={excl} style={{ flex: 1, background: P.bg, border: `2px solid ${P.accent}`, borderRadius: width * 0.01, padding: width * 0.012, direction: "rtl", alignSelf: "flex-start" }}>
            <div style={{ fontFamily: heebo, fontWeight: 800, fontSize: width * 0.0145, color: P.accent, whiteSpace: "nowrap", marginBottom: height * 0.012 }}>בלעדיות שפוקעות השבוע</div>
            {["הרצל 52 · עוד 5 ימים", "הגפן 14 · עוד 6 ימים"].map((r) => (
              <div key={r} style={{ fontFamily: heebo, fontWeight: 600, fontSize: width * 0.0125, color: P.ink, whiteSpace: "nowrap", padding: `${height * 0.008}px 0`, borderTop: `1px solid ${P.line}` }}>{r}</div>
            ))}
          </Entrance>
        </div>
      </AppWindow>
      <Sfx src={urls[SFX.whoosh]} at={wordFrame(s, "בדאשבורד")} volume={0.22} />
      <Sfx src={urls[SFX.ticks]} at={dash + 4} volume={0.2} />
      <Sfx src={urls[SFX.tap]} at={wordFrame(s, "בעניינים")} volume={0.24} />
      <Sfx src={urls[SFX.tap]} at={wordFrame(s, "מאחר")} volume={0.24} />
      <Sfx src={urls[SFX.pop]} at={wordFrame(s, "בלעדיות")} volume={0.24} />
    </>
  );
};

const Mentor: React.FC<{ s: Scene; urls: VideoProps["urls"] }> = ({ s, urls }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const ask = onWord(s, "לשאול");
  const steps = onWord(s, "צעדים");
  const out = interpolate(frame, [ask - 8, ask + 2], [1, 0], clamp);
  const card = (k: number, delay: number, props: Partial<React.ComponentProps<typeof MentorCard>>) => (
    <div style={{ position: "absolute", left: width * (0.79 - k * 0.29) - width * 0.14, top: height * 0.27 }}>
      <MentorCard avatar={urls[IMG.mentor]} delay={delay} stepAt={steps + k * 3} w={0.28} h={0.56} panel={P.panel} surface={P.surface} ink={P.ink} accent={P.accent} gold={P.gold} font={heebo} {...props} />
    </div>
  );
  return (
    <>
      <SceneTitle kicker="המנטור" title="מנטור לסוכן · לצוות · למשרד" kickerAt={2} titleAt={onWord(s, "מנטור")} ink={P.hero} accent={P.accent} font={heebo} />
      <div style={{ position: "absolute", inset: 0, opacity: out }}>
        {card(0, onWord(s, "הסוכן"), { title: "מנטור סוכני נדל״ן AI", sub: "עודכן הבוקר", summary: ["10 פגישות השבוע,", "ועסקה אחת נסגרה"], chip: "עדיפות גבוהה", step: ["4 לידים מחכים לתשובה", "השפעה צפויה: מענה מהיר יותר"] })}
        {card(1, onWord(s, "הצוות"), { title: "מנטור מנהלי צוותים AI", sub: "סיכום שבועי", summary: ["הצוות מעל היעד,", "זמן התגובה עלה אצל סוכן אחד"], chip: "עדיפות גבוהה", step: ["שיחת 1:1 עם רון השבוע", "השפעה צפויה: הצוות עונה מהר יותר"] })}
        {card(2, onWord(s, "המשרד"), { title: "מנטור AI לבעלי משרדים", sub: "סיכום שבועי", summary: ["רבעון שיא בעמלות,", "2 בלעדיות פוקעות השבוע"], chip: "עדיפות גבוהה", step: ["לחדש בלעדיות מול הבעלים", "מוביל: מנהל המשרד"] })}
      </div>
      {frame >= ask - 2 ? (
        <div style={{ position: "absolute", left: width * 0.19, top: height * 0.3 }}>
          <AskBox
            question="למה הגיוסים שלי ירדו?"
            label="שאל את המנטור:"
            avatar={urls[IMG.mentor]}
            delay={ask - 2}
            cps={34}
            answerAt={ask + 22}
            per={6}
            w={0.62}
            answer={["הפעילות שלך לא ירדה: 10 פגישות השבוע מול 8.", "הירידה היא בפניות הנכנסות: 5 מול 11.", "הצעד שבשליטתך: לחזור היום לארבעה לידים שמחכים."]}
            panel={P.panel}
            surface={P.surface}
            ink={P.ink}
            gold={P.gold}
            font={heebo}
          />
        </div>
      ) : null}
      <div style={{ position: "absolute", left: width * 0.05, top: height * 0.09, fontFamily: heebo, fontWeight: 600, fontSize: width * 0.011, color: P.dim, background: P.surface, border: `1px solid ${P.line}`, borderRadius: width * 0.02, padding: `${height * 0.005}px ${width * 0.01}px`, direction: "rtl", whiteSpace: "nowrap" }}>נתוני הדגמה</div>
      <Sfx src={urls[SFX.pop]} at={wordFrame(s, "הסוכן")} volume={0.24} />
      <Sfx src={urls[SFX.pop]} at={wordFrame(s, "הצוות")} volume={0.24} />
      <Sfx src={urls[SFX.pop]} at={wordFrame(s, "המשרד")} volume={0.24} />
      <Sfx src={urls[SFX.sparkle]} at={wordFrame(s, "צעדים")} volume={0.22} />
      <Sfx src={urls[SFX.keys]} at={ask} volume={0.22} />
      <Sfx src={urls[SFX.click]} at={ask + 18} volume={0.24} />
      <Sfx src={urls[SFX.ping]} at={ask + 22} volume={0.2} />
      <Sfx src={urls[SFX.click]} at={steps} volume={0.2} />
    </>
  );
};

const Close: React.FC<{ s: Scene; urls: VideoProps["urls"] }> = ({ s, urls }) => {
  const { width, height } = useVideoConfig();
  const line = { fontFamily: heebo, fontWeight: 900, fontSize: width * 0.06, whiteSpace: "nowrap" as const, textAlign: "center" as const };
  return (
    <>
      <Entrance delay={onWord(s, "יותר")} style={{ position: "absolute", top: height * 0.16, left: 0, right: 0, direction: "rtl", ...line, color: P.hero }}>יותר התאמות.</Entrance>
      <Entrance delay={onWord(s, "יותר", { nth: 2 })} style={{ position: "absolute", top: height * 0.3, left: 0, right: 0, direction: "rtl", ...line, color: P.accent }}>יותר עסקאות.</Entrance>
      <Entrance delay={onWord(s, "שוק")} style={{ position: "absolute", top: height * 0.5, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: height * 0.015 }}>
        <div style={{ display: "flex", alignItems: "center", gap: width * 0.012, direction: "rtl" }}>
          <Img src={urls[IMG.logo]} style={{ height: height * 0.14 }} />
          <div style={{ fontFamily: heebo, fontWeight: 900, fontSize: width * 0.05, color: P.ink, whiteSpace: "nowrap" }}>שוק הנדל״ן</div>
        </div>
        <div style={{ fontFamily: heebo, fontWeight: 700, fontSize: width * 0.02, color: P.dim, direction: "ltr" }}>shuknadlan.co.il</div>
      </Entrance>
      <Sfx src={urls[SFX.impact]} at={wordFrame(s, "התאמות")} volume={0.24} />
      <Sfx src={urls[SFX.impact]} at={wordFrame(s, "עסקאות")} volume={0.24} />
      <Sfx src={urls[SFX.riser]} at={Math.max(0, wordFrame(s, "שוק") - 18)} volume={0.22} />
      <Sfx src={urls[SFX.chime]} at={wordFrame(s, "שוק")} volume={0.26} />
    </>
  );
};

export const Video: React.FC<VideoProps> = ({ manifest, urls }) => {
  const hook = sceneById(manifest, "hook");
  const office = sceneById(manifest, "office");
  const offices = sceneById(manifest, "offices");
  const buyers = sceneById(manifest, "buyers");
  const dashboard = sceneById(manifest, "dashboard");
  const mentor = sceneById(manifest, "mentor");
  const close = sceneById(manifest, "close");
  const g = manifest.captions;
  return (
    <AbsoluteFill style={{ background: P.bg }}>
      <BgMesh bg={P.bg} hero={P.meshA} accent={P.meshB} />
      <SceneFrame from={hook.startFrame} durationInFrames={hook.durationFrames} exit="zoom-through" origin={{ x: 0.8, y: 0.62 }}>
        <Hook s={hook} urls={urls} />
        <Voice s={hook} urls={urls} group={g} />
        <Sfx src={urls[SFX.pop]} at={wordFrame(hook, "המשרד")} volume={0.26} />
        <Sfx src={urls[SFX.pop]} at={wordFrame(hook, "המשרדים")} volume={0.26} />
        <Sfx src={urls[SFX.pop]} at={wordFrame(hook, "והקונים")} volume={0.26} />
      </SceneFrame>
      <SceneFrame from={office.startFrame} durationInFrames={office.durationFrames} enter="zoom-through" origin={{ x: 0.8, y: 0.62 }}>
        <Sfx src={urls[SFX.whip]} at={0} volume={0.26} />
        <Office s={office} urls={urls} />
        <Voice s={office} urls={urls} group={g} />
      </SceneFrame>
      <SceneFrame from={offices.startFrame} durationInFrames={offices.durationFrames}>
        <Sfx src={urls[SFX.whip]} at={0} volume={0.26} />
        <Offices s={offices} urls={urls} />
        <Voice s={offices} urls={urls} group={g} />
      </SceneFrame>
      <SceneFrame from={buyers.startFrame} durationInFrames={buyers.durationFrames}>
        <Sfx src={urls[SFX.whip]} at={0} volume={0.26} />
        <Buyers s={buyers} urls={urls} />
        <Voice s={buyers} urls={urls} group={g} />
      </SceneFrame>
      <SceneFrame from={dashboard.startFrame} durationInFrames={dashboard.durationFrames}>
        <Sfx src={urls[SFX.whip]} at={0} volume={0.26} />
        <Dashboard s={dashboard} urls={urls} />
        <Voice s={dashboard} urls={urls} group={g} />
      </SceneFrame>
      <SceneFrame from={mentor.startFrame} durationInFrames={mentor.durationFrames}>
        <Sfx src={urls[SFX.whip]} at={0} volume={0.26} />
        <Mentor s={mentor} urls={urls} />
        <Voice s={mentor} urls={urls} group={g} />
      </SceneFrame>
      <SceneFrame from={close.startFrame} durationInFrames={close.durationFrames}>
        <Sfx src={urls[SFX.whip]} at={0} volume={0.26} />
        <Close s={close} urls={urls} />
        <Voice s={close} urls={urls} group={g} />
      </SceneFrame>
      {manifest.music ? <Music src={urls[manifest.music.key]} /> : null}
      <Grain blend="multiply" opacity={0.03} />
      <Vignette strength={0.15} />
    </AbsoluteFill>
  );
};
