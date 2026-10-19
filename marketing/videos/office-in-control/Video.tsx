import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "reelkit/frame";
import { BgMesh, Captions, Entrance, Grain, Music, SceneFrame, Sfx, Vignette, Voiceover, font, onWord, sceneById, wordFrame } from "reelkit/kit";
import type { VideoProps } from "reelkit/kit";
import { SceneTitle } from "./SceneTitle";
import { AppWindow } from "./AppWindow";
import { StatTile } from "./StatTile";
import { AgentTable } from "./AgentTable";
import { MentorCard } from "./MentorCard";
import { AskBox } from "./AskBox";
import { PhoneFrame } from "./PhoneFrame";
import { ChatThread } from "./ChatThread";
import { FeatureChip } from "./FeatureChip";
import { TypeCard } from "./TypeCard";
import { MatchCard } from "./MatchCard";
import { CallList } from "./CallList";
import { TeamBars } from "./TeamBars";

// "המשרד שלך, בשליטה" - fourth film of the series, for office managers and team leads, 16:9.
// Every screen is rebuilt with demo data and carries the "נתוני הדגמה" tag; demo names only.
// Sound is kept sparse on purpose: a soft chime on two payoffs and a short rise into the logo.
const P = {
  bg: "#F4F6FA",
  surface: "#FFFFFF",
  ink: "#0B1B3F",
  hero: "#003DA5",
  accent: "#DC1C2E",
  dim: "#5B6475",
  line: "#E3E8F0",
  good: "#1F8A4C",
  gold: "#E2B93B",
  panel: "#0E2557",
  meshA: "#D7E3F8",
  meshB: "#F7DDE0",
};
const heebo = font("heebo");

const IMG = {
  logo: "assets/user/a-724c0c67-logo-shuknadlan.png",
  gabriela: "assets/user/a-5d5f93d4-gabriela-avatar.png",
  mentor: "assets/user/a-4124f95e-mentor-avatar.png",
  agent: "assets/user/a-65efe14d-agent-portrait.jpg",
};
const SFX = {
  chime: "assets/lib/sfx-ui-success-chime/clip.mp3",
  riser: "assets/lib/sfx-ui-riser-short/clip.mp3",
};
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const GABI = "גבריאלה AI שוק הנדל״ן";

type Scene = VideoProps["manifest"]["scenes"][number];
type Urls = VideoProps["urls"];

const Voice: React.FC<{ s: Scene; urls: Urls; group: VideoProps["manifest"]["captions"] }> = ({ s, urls, group }) => (
  <>
    <div style={{ position: "absolute", inset: 0, transform: "scale(0.5)", transformOrigin: "50% 98%" }}>
      <Captions words={s.words} group={group} mode="pop" highlight={P.accent} face={heebo} rtl bottom={0.035} />
    </div>
    {s.voiceoverKey ? <Voiceover src={urls[s.voiceoverKey]} /> : null}
  </>
);

const Place: React.FC<{ right?: number; left?: number; top: number; children: React.ReactNode }> = ({ right, left, top, children }) => {
  const { width, height } = useVideoConfig();
  return <div style={{ position: "absolute", top: height * top, right: right !== undefined ? width * right : undefined, left: left !== undefined ? width * left : undefined }}>{children}</div>;
};

const Demo: React.FC = () => {
  const { width, height } = useVideoConfig();
  return <div style={{ position: "absolute", left: width * 0.05, top: height * 0.06, fontFamily: heebo, fontWeight: 600, fontSize: width * 0.011, color: P.dim, background: P.surface, border: `1px solid ${P.line}`, borderRadius: width * 0.02, padding: `${height * 0.005}px ${width * 0.01}px`, direction: "rtl", whiteSpace: "nowrap" }}>נתוני הדגמה</div>;
};

const chip = (label: string, glyph: React.ComponentProps<typeof FeatureChip>["glyph"], delay: number, active = false) => (
  <FeatureChip label={label} glyph={glyph} delay={delay} size={0.04} active={active} ink={P.ink} hero={P.hero} surface={P.surface} font={heebo} />
);

const tile = (label: string, value: number, d: number, bar: string, suffix = "", delta?: string, w = 0.2) => (
  <StatTile label={label} value={value} suffix={suffix} delta={delta} delay={d} w={w} h={0.155} ink={P.ink} dim={P.dim} bar={bar} good={P.good} surface={P.surface} line={P.line} font={heebo} />
);

const Hook: React.FC<{ s: Scene; urls: Urls }> = ({ s }) => {
  const { width, height } = useVideoConfig();
  const big = { fontFamily: heebo, fontWeight: 900, fontSize: width * 0.065, whiteSpace: "nowrap" as const, textAlign: "center" as const };
  return (
    <>
      <Entrance delay={0} style={{ position: "absolute", top: height * 0.3, left: 0, right: 0, direction: "rtl", ...big, color: P.ink }}>מה קורה במשרד שלך,</Entrance>
      <Entrance delay={onWord(s, "כשאתה")} style={{ position: "absolute", top: height * 0.47, left: 0, right: 0, direction: "rtl", ...big, color: P.accent }}>כשאתה לא שם?</Entrance>
    </>
  );
};

const Dash: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const { width } = useVideoConfig();
  const reply = onWord(s, "עונה");
  return (
    <>
      <SceneTitle title="דאשבורד המשרד" titleAt={2} y={0.035} size={0.034} ink={P.hero} accent={P.accent} font={heebo} />
      <AppWindow title="דאשבורד משרד · רבעון נוכחי" tag="נתוני הדגמה" x={0.05} y={0.13} w={0.9} h={0.73} delay={2} ink={P.ink} hero={P.hero} surface={P.surface} line={P.line} font={heebo}>
        <div style={{ display: "flex", gap: width * 0.012, padding: width * 0.012, direction: "rtl" }}>
          {tile("נכסים שגויסו", 34, onWord(s, "גייס"), P.gold, "", "+12 מול הרבעון הקודם")}
          {tile("הסכמי תיווך", 21, onWord(s, "החתים"), P.good, "", "+33%")}
          {tile("נענו תוך 15 דק׳", 86, reply, P.hero, "%", "+18%")}
        </div>
        <div style={{ padding: `0 ${width * 0.014}px`, direction: "rtl" }}>
          <AgentTable
            delay={reply}
            w={0.84}
            head={["סוכן", "עמידה ביעד", "גיוסים", "החתמות", "זמן תגובה"]}
            rows={[
              { name: "יואב כהן", photo: urls[IMG.agent], pct: 118, deals: "11", leads: "7", reply: "9 דק׳", flag: "תוך רבע שעה", flagAt: onWord(s, "רבע"), tone: "good" },
              { name: "דנה לוי", pct: 104, deals: "9", leads: "6", reply: "12 דק׳" },
              { name: "מיכל אברהם", pct: 92, deals: "8", leads: "5", reply: "14 דק׳" },
              { name: "רון שגיא", pct: 64, deals: "4", leads: "2", reply: "יומיים", flag: "אחרי יומיים", flagAt: onWord(s, "יומיים"), tone: "bad" },
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
        </div>
      </AppWindow>
    </>
  );
};

const Teams: React.FC<{ s: Scene; urls: Urls }> = ({ s }) => {
  const { width } = useVideoConfig();
  const lead = onWord(s, "מנהל");
  return (
    <>
      <SceneTitle kicker="יעדים וצוותים" title="כל צוות מול היעד שלו" kickerAt={2} titleAt={onWord(s, "צוות")} ink={P.hero} accent={P.accent} font={heebo} />
      <Demo />
      <Place right={0.05} top={0.27}>
        <TypeCard label="יעד רבעוני · יואב כהן" lines={["30,000 ₪ בעמלות", "5 עסקאות"]} delay={onWord(s, "יעד")} typeAt={onWord(s, "יעד") + 3} cps={30} w={0.3} hero={P.hero} ink={P.ink} dim={P.dim} surface={P.surface} font={heebo} />
      </Place>
      <Place left={0.05} top={0.27}>
        <TeamBars title="עמידה ביעד לפי צוות" bars={[{ label: "צוות צפון", pct: 112, lead: "מנהלת: דנה לוי" }, { label: "צוות מרכז", pct: 96, lead: "מנהל: יואב כהן" }, { label: "צוות דרום", pct: 81, lead: "מנהלת: מיכל אברהם" }]} targetLabel="הקו המקווקו: 100% מהיעד" delay={onWord(s, "צוות")} w={0.48} hero={P.hero} good={P.good} bad={P.accent} ink={P.ink} dim={P.dim} line={P.line} surface={P.surface} font={heebo} />
      </Place>
      <AppWindow title="דאשבורד הצוות · צוות צפון" x={0.55} y={0.53} w={0.4} h={0.3} delay={lead} ink={P.ink} hero={P.hero} surface={P.surface} line={P.line} font={heebo}>
        <div style={{ display: "flex", gap: width * 0.01, padding: width * 0.01, direction: "rtl" }}>
          {tile("לידים בצוות", 46, lead + 4, P.hero, "", undefined, 0.12)}
          {tile("ממתינים למענה", 3, lead + 7, P.accent, "", undefined, 0.12)}
          {tile("עסקאות", 4, lead + 10, P.good, "", undefined, 0.12)}
        </div>
      </AppWindow>
    </>
  );
};

const Calls: React.FC<{ s: Scene; urls: Urls }> = ({ s }) => (
  <>
    <SceneTitle title="שיחות המשרד" titleAt={2} y={0.035} size={0.034} ink={P.hero} accent={P.accent} font={heebo} />
    <AppWindow title="שיחות המשרד · היום" tag="נתוני הדגמה" x={0.12} y={0.14} w={0.76} h={0.7} delay={2} ink={P.ink} hero={P.hero} surface={P.surface} line={P.line} font={heebo}>
      <CallList
        calls={[
          { who: "יואב כהן", with: "קונה · הרצל 52", time: "10:42", length: "6:12", summary: "סיכום: מעוניין בסיור ביום ו׳, תקציב עד 1.2 מיליון" },
          { who: "דנה לוי", with: "בעלת נכס · הגפן 14", time: "11:05", length: "4:38", summary: "סיכום: מסכימה לבלעדיות לחצי שנה" },
          { who: "מיכל אברהם", with: "שוכר · שדרות הנשיא", time: "12:20", length: "2:51", summary: "סיכום: מבקש לדחות את החתימה לשבוע הבא" },
        ]}
        delay={onWord(s, "מוקלטות")}
        per={6}
        playIndex={0}
        playAt={onWord(s, "להאזין")}
        w={0.76}
        hero={P.hero}
        accent={P.accent}
        ink={P.ink}
        dim={P.dim}
        line={P.line}
        surface={P.surface}
        font={heebo}
      />
    </AppWindow>
  </>
);

const Weekly: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const dec = onWord(s, "החלטות");
  const card = (title: string, tag: string, badge: string, d: number) => (
    <MatchCard title={title} sub="השבוע" tag={tag} badge={badge} delay={d} w={0.38} hero={P.hero} accent={P.accent} ink={P.ink} dim={P.dim} surface={P.surface} font={heebo} />
  );
  return (
    <>
      <SceneTitle kicker="כל יום ראשון" title="3 החלטות לשבוע" kickerAt={2} titleAt={dec} ink={P.hero} accent={P.accent} font={heebo} />
      <Demo />
      <Place left={0.05} top={0.27}>
        <MentorCard title="מנטור AI לבעלי משרדים" sub="סיכום שבועי" summary={["רבעון שיא בעמלות,", "2 בלעדיות פוקעות השבוע,", "4 לידים מחכים למענה"]} chip="קרא את כל המספרים" step={["34 גיוסים · 21 החתמות · 9 עסקאות", "מול השבוע הקודם ומול היעד"]} avatar={urls[IMG.mentor]} delay={onWord(s, "המנטור")} w={0.36} h={0.6} panel={P.panel} surface={P.surface} ink={P.ink} accent={P.accent} gold={P.gold} font={heebo} />
      </Place>
      <Place right={0.05} top={0.28}>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {card("לחדש 2 בלעדיות מול הבעלים", "מוביל: מנהל המשרד", "1", dec)}
          {card("לחזור היום לארבעה לידים פתוחים", "מוביל: רון שגיא", "2", dec + 6)}
          {card("שיחת 1:1 על זמן התגובה", "מובילה: דנה לוי", "3", dec + 12)}
        </div>
      </Place>
      <Sfx src={urls[SFX.chime]} at={wordFrame(s, "מוביל")} volume={0.16} />
    </>
  );
};

const Agent: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const hi = onWord(s, "מנטור");
  return (
    <>
      <SceneTitle kicker="לכל סוכן" title="מנטור אישי, כל בוקר" kickerAt={2} titleAt={hi} ink={P.hero} accent={P.accent} font={heebo} />
      <Demo />
      <div style={{ position: "absolute", right: width * 0.05, top: height * 0.27, width: width * 0.42, background: P.panel, borderRadius: width * 0.014, padding: width * 0.018, direction: "rtl", display: "flex", alignItems: "center", gap: width * 0.015, opacity: interpolate(frame - hi, [0, 4], [0, 1], clamp), transform: `translateY(${interpolate(frame - hi, [0, 10], [height * 0.03, 0], clamp)}px)` }}>
        <Img src={urls[IMG.agent]} style={{ width: width * 0.06, height: width * 0.06, borderRadius: "50%", objectFit: "cover", border: `3px solid ${P.gold}` }} />
        <div>
          <div style={{ fontFamily: heebo, fontWeight: 600, fontSize: width * 0.012, color: P.gold, whiteSpace: "nowrap" }}>בוקר טוב, יואב</div>
          <div style={{ fontFamily: heebo, fontWeight: 900, fontSize: width * 0.03, color: P.surface, whiteSpace: "nowrap" }}>עברת את היעד! 118%</div>
        </div>
      </div>
      <Place left={0.05} top={0.27}>
        <MentorCard title="מנטור סוכני נדל״ן AI" sub="עודכן הבוקר" summary={["10 פגישות השבוע,", "ועסקה אחת נסגרה"]} chip="הכי חשוב היום" step={["4 לידים מחכים לתשובה", "השפעה צפויה: מענה מהיר יותר"]} avatar={urls[IMG.mentor]} delay={onWord(s, "בוקר")} stepAt={onWord(s, "חשוב")} w={0.34} h={0.56} panel={P.panel} surface={P.surface} ink={P.ink} accent={P.accent} gold={P.gold} font={heebo} />
      </Place>
      <Place right={0.05} top={0.5}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 20, direction: "ltr" }}>
          {chip("חוזקה: 10 פגישות השבוע", "check", onWord(s, "חזק"))}
          {chip("לשיפור: זמן תגובה ללידים", "spark", onWord(s, "להשתפר"))}
          <div style={{ display: "flex", gap: 14 }}>
            {chip("מאמן ישיר", "chat", onWord(s, "בטון"))}
            {chip("חבר מקצועי", "chat", onWord(s, "בטון") + 3, frame >= onWord(s, "בוחר"))}
          </div>
        </div>
      </Place>
    </>
  );
};

const Ask: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const frame = useCurrentFrame();
  const wa = onWord(s, "בוואטסאפ");
  const chipsOut = interpolate(frame, [wa - 6, wa + 2], [1, 0], clamp);
  return (
    <>
      <SceneTitle kicker="ידע מקצועי" title="שאל את המנטור" kickerAt={2} titleAt={onWord(s, "לשאול")} ink={P.hero} accent={P.accent} font={heebo} />
      <Place left={0.05} top={0.28}>
        <AskBox
          question="איך מטפלים בהתנגדות לבלעדיות?"
          label="שאל את המנטור:"
          avatar={urls[IMG.mentor]}
          delay={onWord(s, "התנגדות")}
          cps={34}
          answerAt={onWord(s, "תשובה")}
          per={8}
          w={0.5}
          answer={["קודם כול, לא עונים מיד: מתייגים את מה שהמוכר מרגיש.", "ההתנגדות היא לרוב עמדה, ומאחוריה פחד או חוסר שליטה.", "״שכולם יביאו קונים״: נכס של כולם, אף אחד לא משקיע בו."]}
          panel={P.panel}
          surface={P.surface}
          ink={P.ink}
          gold={P.gold}
          font={heebo}
        />
      </Place>
      <div style={{ opacity: chipsOut }}>
        <Place right={0.05} top={0.3}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 22, direction: "ltr" }}>
            {chip("התנגדות של בעלים", "chat", onWord(s, "התנגדות"))}
            {chip("משא ומתן", "chat", onWord(s, "משא"))}
            {chip("גיוס בלעדיות", "chat", onWord(s, "גיוס"))}
          </div>
        </Place>
      </div>
      <PhoneFrame x={0.8} y={0.6} h={0.66} aspect={0.55} delay={wa}>
        <ChatThread
          name={GABI}
          avatar={urls[IMG.gabriela]}
          phoneH={0.64}
          text={0.031}
          font={heebo}
          messages={[
            { from: "me", lines: ["תשאלי את המנטור איך", "מטפלים בהתנגדות לבלעדיות"], at: wa + 2 },
            { from: "them", lines: ["המנטור עונה:", "קודם כול, לא עונים מיד.", "מתייגים את מה שהמוכר מרגיש,", "ושואלים מה בדיוק מדאיג אותו."], bold: [0], at: wa + 10 },
          ]}
        />
      </PhoneFrame>
    </>
  );
};

const Close: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const { width, height } = useVideoConfig();
  const line = { fontFamily: heebo, fontWeight: 900, fontSize: width * 0.05, whiteSpace: "nowrap" as const, textAlign: "center" as const };
  return (
    <>
      <Entrance delay={0} style={{ position: "absolute", top: height * 0.1, left: 0, right: 0, direction: "rtl", ...line, color: P.ink }}>אתה מנהל.</Entrance>
      <Entrance delay={onWord(s, "המנטור")} style={{ position: "absolute", top: height * 0.22, left: 0, right: 0, direction: "rtl", ...line, color: P.hero }}>המנטור מאמן.</Entrance>
      <Entrance delay={onWord(s, "והסוכנים")} style={{ position: "absolute", top: height * 0.34, left: 0, right: 0, direction: "rtl", ...line, color: P.accent }}>והסוכנים מתקדמים.</Entrance>
      <Entrance delay={onWord(s, "שוק")} style={{ position: "absolute", top: height * 0.54, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: height * 0.015 }}>
        <div style={{ display: "flex", alignItems: "center", gap: width * 0.012, direction: "rtl" }}>
          <Img src={urls[IMG.logo]} style={{ height: height * 0.13 }} />
          <div style={{ fontFamily: heebo, fontWeight: 900, fontSize: width * 0.046, color: P.ink, whiteSpace: "nowrap" }}>שוק הנדל״ן</div>
        </div>
        <div style={{ fontFamily: heebo, fontWeight: 700, fontSize: width * 0.019, color: P.dim, direction: "ltr" }}>shuknadlan.co.il</div>
      </Entrance>
      <Sfx src={urls[SFX.riser]} at={Math.max(0, wordFrame(s, "שוק") - 18)} volume={0.18} />
      <Sfx src={urls[SFX.chime]} at={wordFrame(s, "שוק")} volume={0.16} />
    </>
  );
};

export const Video: React.FC<VideoProps> = ({ manifest, urls }) => {
  const g = manifest.captions;
  const scenes: [string, React.FC<{ s: Scene; urls: Urls }>][] = [
    ["hook", Hook],
    ["dash", Dash],
    ["teams", Teams],
    ["calls", Calls],
    ["weekly", Weekly],
    ["agent", Agent],
    ["ask", Ask],
    ["close", Close],
  ];
  return (
    <AbsoluteFill style={{ background: P.bg }}>
      <BgMesh bg={P.bg} hero={P.meshA} accent={P.meshB} />
      {scenes.map(([id, Body]) => {
        const s = sceneById(manifest, id) as Scene;
        return (
          <SceneFrame key={id} from={s.startFrame} durationInFrames={s.durationFrames}>
            <Body s={s} urls={urls} />
            <Voice s={s} urls={urls} group={g} />
          </SceneFrame>
        );
      })}
      {manifest.music ? <Music src={urls[manifest.music.key]} /> : null}
      <Grain blend="multiply" opacity={0.03} />
      <Vignette strength={0.15} />
    </AbsoluteFill>
  );
};
