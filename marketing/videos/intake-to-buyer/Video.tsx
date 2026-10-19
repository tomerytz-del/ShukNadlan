import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";
import { BgMesh, Captions, Entrance, Grain, Music, SceneFrame, Sfx, Vignette, Voiceover, font, onWord, sceneById, wordFrame } from "reelkit/kit";
import type { VideoProps } from "reelkit/kit";
import { SceneTitle } from "./SceneTitle";
import { PhoneFrame } from "./PhoneFrame";
import { ChatThread } from "./ChatThread";
import { FeatureChip } from "./FeatureChip";
import { BeforeAfter } from "./BeforeAfter";
import { StatTile } from "./StatTile";
import { AppWindow } from "./AppWindow";
import { AgentTable } from "./AgentTable";
import { OfficeNetwork } from "./OfficeNetwork";
import { SignCard } from "./SignCard";
import { SocialPost } from "./SocialPost";
import { MailAlert } from "./MailAlert";
import { TypeCard } from "./TypeCard";

// "מהגיוס ועד הקונה" - third film of the series for brokerage office owners, 16:9.
// One property travels the film: signed, created, published, posted, sent to buyers, shared, counted.
// Demo names and generic streets; the posts are rebuilt with real photos and the platform's real reach (35.4K views in 30 days).
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
  meshA: "#D7E3F8",
  meshB: "#F7DDE0",
};
const heebo = font("heebo");

const IMG = {
  logo: "assets/user/a-e1e2cbb7-logo-shuknadlan.png",
  gabriela: "assets/user/a-d6761345-gabriela-avatar.png",
  agent: "assets/user/a-c2956f46-agent-portrait.jpg",
  roomBefore: "assets/user/a-c5c6ac37-viz-room-before.jpg",
  roomAfter: "assets/user/a-8ee14b56-viz-room-after.jpg",
  site: "assets/user/a-a2365c8a-site-search.jpg",
  building: "assets/user/a-bd24dbf9-post-building.jpg",
  shop: "assets/user/a-c330645a-post-shop.jpg",
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
const GABI = "גבריאלה AI שוק הנדל״ן";

type Scene = VideoProps["manifest"]["scenes"][number];
type Urls = VideoProps["urls"];

const Voice: React.FC<{ s: Scene; urls: Urls; group: VideoProps["manifest"]["captions"] }> = ({ s, urls, group }) => (
  <>
    <div style={{ position: "absolute", inset: 0, transform: "translateX(16%) scale(0.5)", transformOrigin: "50% 98%" }}>
      <Captions words={s.words} group={group} mode="pop" highlight={P.accent} face={heebo} rtl bottom={0.035} />
    </div>
    {s.voiceoverKey ? <Voiceover src={urls[s.voiceoverKey]} /> : null}
  </>
);

const chip = (label: string, glyph: React.ComponentProps<typeof FeatureChip>["glyph"], delay: number, active = false) => (
  <FeatureChip label={label} glyph={glyph} delay={delay} size={0.042} active={active} ink={P.ink} hero={P.hero} surface={P.surface} font={heebo} />
);

const Place: React.FC<{ right?: number; left?: number; top: number; children: React.ReactNode }> = ({ right, left, top, children }) => {
  const { width, height } = useVideoConfig();
  return <div style={{ position: "absolute", top: height * top, right: right !== undefined ? width * right : undefined, left: left !== undefined ? width * left : undefined }}>{children}</div>;
};

const Hook: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const { width, height } = useVideoConfig();
  const big = { fontFamily: heebo, fontWeight: 900, fontSize: width * 0.07, whiteSpace: "nowrap" as const, textAlign: "center" as const };
  return (
    <>
      <Entrance delay={0} style={{ position: "absolute", top: height * 0.1, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <Img src={urls[IMG.logo]} style={{ height: height * 0.1 }} />
      </Entrance>
      <Entrance delay={0} style={{ position: "absolute", top: height * 0.28, left: 0, right: 0, direction: "rtl", ...big, color: P.ink }}>סוכן גייס נכס?</Entrance>
      <Entrance delay={onWord(s, "הקונים")} style={{ position: "absolute", top: height * 0.46, left: 0, right: 0, direction: "rtl", ...big, color: P.accent }}>הקונים כבר בדרך!</Entrance>
    </>
  );
};

const Intake: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const sign = onWord(s, "דיגיטלית");
  return (
    <>
      <SceneTitle kicker="קליטת נכס" title="חתימה דיגיטלית" kickerAt={2} titleAt={onWord(s, "מחתים")} ink={P.hero} accent={P.accent} font={heebo} />
      <Place right={0.07} top={0.27}>
        <SignCard title="הסכם בלעדיות" lines={["נכס: הרצל 52, דירת 4 חדרים", "תקופה: 6 חודשים", "חתימת הבעלים, מכל מכשיר"]} signLabel="חתימה" signAt={sign} stamp="נחתם" stampAt={sign + 20} delay={2} w={0.28} hero={P.hero} accent={P.accent} ink={P.ink} dim={P.dim} line={P.line} surface={P.surface} font={heebo} />
      </Place>
      <PhoneFrame x={0.2} y={0.53} h={0.8} aspect={0.55} delay={onWord(s, "ומכניס") - 6}>
        <ChatThread
          name={GABI}
          avatar={urls[IMG.gabriela]}
          phoneH={0.78}
          text={0.031}
          font={heebo}
          messages={[
            { from: "me", lines: ["דירה חדשה למכירה: 4 חדרים,", "הרצל 52, קומה 7, 128 מ״ר,", "מעלית וחניה, 1,100,000"], at: onWord(s, "ומכניס") },
            { from: "them", lines: ["הנכס נוצר ופורסם באתר."], bold: [0], at: onWord(s, "לגבריאלה") + 6 },
          ]}
        />
      </PhoneFrame>
      <Place right={0.07} top={0.79}>{chip("או ישירות ב-CRM", "check", onWord(s, "או"))}</Place>
    </>
  );
};

const Live: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const desc = onWord(s, "תיאור");
  const viz = onWord(s, "והדמיות");
  return (
    <>
      <SceneTitle kicker="באתר" title="תיאור שיווקי והדמיות AI" kickerAt={2} titleAt={onWord(s, "לאתר")} ink={P.hero} accent={P.accent} font={heebo} />
      <PhoneFrame src={urls[IMG.site]} x={0.2} y={0.53} h={0.8} aspect={0.55} delay={onWord(s, "לאתר")} />
      <Place right={0.07} top={0.25}>
        <TypeCard label="תיאור שיווקי, נכתב אוטומטית" lines={["דירת 4 חדרים מוארת ומרווחת,", "עם מרפסת שמש ונוף פתוח,", "בבניין מטופח עם מעלית וחניה."]} delay={desc} typeAt={desc + 4} cps={46} w={0.34} hero={P.hero} ink={P.ink} dim={P.dim} surface={P.surface} font={heebo} />
      </Place>
      <BeforeAfter before={urls[IMG.roomBefore]} after={urls[IMG.roomAfter]} x={0.6} y={0.68} w={0.3} delay={viz} wipeAt={viz + 3} frames={20} handle={P.accent} label="הדמיית AI" labelBg={P.hero} font={heebo} />
    </>
  );
};

const Social: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const ig = onWord(s, "ולאינסטגרם");
  const stat = ig + 6;
  const sp = spring({ frame: frame - stat, fps, config: { damping: 11, stiffness: 200 } });
  return (
    <>
      <SceneTitle kicker="רשתות" title="פייסבוק ואינסטגרם, אוטומטית" kickerAt={2} titleAt={onWord(s, "אוטומטית")} ink={P.hero} accent={P.accent} font={heebo} />
      <Place right={0.07} top={0.26}>
        <SocialPost platform="facebook" page="שוק הנדל״ן של עפולה והסביבה" avatar={urls[IMG.gabriela]} meta="עכשיו" lines={["חנות בוטיק על ציר מוכר, עם חזית", "שמושכת כל עובר ושב."]} details={["שדרות ארלוזורוב · 20 מ״ר", "3,000 ₪ לחודש + מע״מ", "לצפייה בתמונות ובהדמיות"]} image={urls[IMG.shop]} imageH={0.22} delay={onWord(s, "לפייסבוק")} w={0.27} font={heebo} />
      </Place>
      <Place left={0.08} top={0.26}>
        <SocialPost platform="instagram" page="shuknadlan" avatar={urls[IMG.gabriela]} meta="שוק הנדל״ן" lines={["דירה מרווחת עם מרפסת ענקית,", "בשכונה שקטה ומבוקשת."]} details={["5 חדרים · 120 מ״ר · קומה 1", "1,590,000 ₪", "#נדלן #דירהלמכירה"]} image={urls[IMG.building]} imageH={0.22} delay={ig} w={0.27} font={heebo} />
      </Place>
      {frame >= stat ? (
        <div style={{ position: "absolute", left: width * 0.38, top: height * 0.44, width: width * 0.24, background: P.accent, color: P.surface, borderRadius: width * 0.015, padding: `${height * 0.025}px 0`, textAlign: "center", direction: "rtl", fontFamily: heebo, boxShadow: "0 18px 40px rgba(220,28,46,0.35)", opacity: interpolate(frame - stat, [0, 2], [0, 1], clamp), transform: `scale(${0.7 + 0.3 * sp})` }}>
          <div style={{ fontWeight: 900, fontSize: width * 0.04, whiteSpace: "nowrap" }}>35 אלף צפיות</div>
          <div style={{ fontWeight: 700, fontSize: width * 0.015, whiteSpace: "nowrap" }}>בחודש באינסטגרם של שוק הנדל״ן</div>
        </div>
      ) : null}
    </>
  );
};

const Alert: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const mail = onWord(s, "מקבלים");
  return (
    <>
      <SceneTitle kicker="קונים" title="התראה מיידית לקונים" kickerAt={2} titleAt={onWord(s, "מקבלים")} ink={P.hero} accent={P.accent} font={heebo} />
      <Place right={0.07} top={0.32}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 24, direction: "ltr" }}>
          {chip("חיפוש שמור: 4 חדרים, עד 1.2 מיליון", "pin", onWord(s, "חיפוש"))}
          {chip("נכס חדש מתאים", "spark", onWord(s, "מקבלים"))}
          {chip("נשלח מיד במייל", "check", onWord(s, "מיד"), true)}
        </div>
      </Place>
      <PhoneFrame x={0.25} y={0.53} h={0.8} aspect={0.55} delay={2}>
        <MailAlert
          from="שוק הנדל״ן"
          subject="נכס חדש שמתאים לחיפוש שלך"
          time="עכשיו"
          greeting="שלום דנה, עלה נכס חדש בשבילך:"
          photo={urls[IMG.roomAfter]}
          price="1,100,000 ₪"
          title="דירה · 4 חדרים למכירה"
          place="הרצל, עפולה"
          button="לצפייה בנכס"
          bannerAt={mail}
          openAt={onWord(s, "התראה") + 6}
          phoneH={0.78}
          hero={P.hero}
          ink={P.ink}
          dim={P.dim}
          surface={P.surface}
          font={heebo}
        />
      </PhoneFrame>
      <Sfx src={urls[SFX.chime]} at={wordFrame(s, "מיד")} volume={0.16} />
    </>
  );
};

const Share: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const net = onWord(s, "משותף");
  return (
    <>
      <SceneTitle kicker="שיתוף" title="שיתוף בלחיצה" kickerAt={2} titleAt={onWord(s, "בלחיצת")} ink={P.hero} accent={P.accent} font={heebo} />
      <Place right={0.07} top={0.25}>{chip("שיתוף: כל המתווכים", "lead", onWord(s, "כפתור"), true)}</Place>
      <PhoneFrame x={0.2} y={0.53} h={0.8} aspect={0.55} delay={onWord(s, "בהודעה") - 6}>
        <ChatThread
          name={GABI}
          avatar={urls[IMG.gabriela]}
          phoneH={0.78}
          text={0.031}
          font={heebo}
          messages={[
            { from: "me", lines: ["תשתפי את הרצל 52", "עם כל המתווכים"], at: onWord(s, "בהודעה") },
            { from: "them", lines: ["שיתפתי את הרצל 52", "עם כל המתווכים בפלטפורמה."], bold: [1], at: onWord(s, "לגבריאלה") + 8 },
          ]}
        />
      </PhoneFrame>
      <OfficeNetwork
        nodes={[
          { x: 0.66, y: 0.58, label: "המשרד שלך", at: net, main: true },
          { x: 0.86, y: 0.44, label: "משרד ב׳", at: onWord(s, "המתווכים") },
          { x: 0.47, y: 0.42, label: "משרד ג׳", at: onWord(s, "המתווכים") + 3 },
          { x: 0.86, y: 0.76, label: "משרד ד׳", at: onWord(s, "המתווכים") + 6 },
          { x: 0.47, y: 0.76, label: "משרד ה׳", at: onWord(s, "המתווכים") + 9 },
        ]}
        linkAt={onWord(s, "בפלטפורמה")}
        travelAt={9999}
        clientAt={9999}
        matchAt={9999}
        ink={P.ink}
        hero={P.hero}
        accent={P.accent}
        surface={P.surface}
        font={heebo}
      />
    </>
  );
};

const Manager: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const { width } = useVideoConfig();
  const g = onWord(s, "גיוס");
  const e = onWord(s, "בלעדיות");
  const team = onWord(s, "לנהל");
  const tile = (label: string, value: number, d: number, bar: string, suffix = "", delta?: string) => (
    <StatTile label={label} value={value} suffix={suffix} delta={delta} delay={d} w={0.19} h={0.155} ink={P.ink} dim={P.dim} bar={bar} good={P.good} surface={P.surface} line={P.line} font={heebo} />
  );
  return (
    <>
      <SceneTitle title="כל מה שצריך לצוות מנצח" titleAt={team} y={0.035} size={0.034} ink={P.hero} accent={P.accent} font={heebo} />
      <AppWindow title="דאשבורד משרד · רבעון נוכחי" tag="נתוני הדגמה" x={0.05} y={0.13} w={0.9} h={0.73} delay={2} ink={P.ink} hero={P.hero} surface={P.surface} line={P.line} font={heebo}>
        <div style={{ display: "flex", gap: width * 0.012, padding: width * 0.012, direction: "rtl" }}>
          {tile("נכסים שגויסו", 34, g, P.gold, "", "+12 מול הרבעון הקודם")}
          {tile("בלעדיות פעילות", 14, e, P.accent, "", "2 פוקעות השבוע")}
          {tile("עסקאות שנסגרו", 9, team, P.hero, "", "+3")}
          {tile("נענו תוך 15 דק׳", 86, team + 4, P.good, "%", "+18%")}
        </div>
        <div style={{ padding: `0 ${width * 0.014}px`, direction: "rtl" }}>
          <AgentTable
            delay={team}
            w={0.84}
            head={["סוכן", "עמידה ביעד", "גיוסים", "בלעדיות", "זמן תגובה"]}
            rows={[
              { name: "יואב כהן", photo: urls[IMG.agent], pct: 118, deals: "11", leads: "5", reply: "9 דק׳", flag: "מוביל הרבעון", flagAt: onWord(s, "מנצח"), tone: "good" },
              { name: "דנה לוי", pct: 104, deals: "9", leads: "4", reply: "12 דק׳" },
              { name: "מיכל אברהם", pct: 92, deals: "8", leads: "3", reply: "14 דק׳" },
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
      <Sfx src={urls[SFX.chime]} at={wordFrame(s, "מנצח")} volume={0.16} />
    </>
  );
};

const Close: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const { width, height } = useVideoConfig();
  const line = { fontFamily: heebo, fontWeight: 900, fontSize: width * 0.055, whiteSpace: "nowrap" as const, textAlign: "center" as const };
  return (
    <>
      <Entrance delay={0} style={{ position: "absolute", top: height * 0.16, left: 0, right: 0, direction: "rtl", ...line, color: P.hero }}>גיוס אחד.</Entrance>
      <Entrance delay={onWord(s, "חשיפה")} style={{ position: "absolute", top: height * 0.3, left: 0, right: 0, direction: "rtl", ...line, color: P.accent }}>חשיפה בכל הערוצים.</Entrance>
      <Entrance delay={onWord(s, "שוק")} style={{ position: "absolute", top: height * 0.5, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: height * 0.015 }}>
        <div style={{ display: "flex", alignItems: "center", gap: width * 0.012, direction: "rtl" }}>
          <Img src={urls[IMG.logo]} style={{ height: height * 0.14 }} />
          <div style={{ fontFamily: heebo, fontWeight: 900, fontSize: width * 0.05, color: P.ink, whiteSpace: "nowrap" }}>שוק הנדל״ן</div>
        </div>
        <div style={{ fontFamily: heebo, fontWeight: 700, fontSize: width * 0.02, color: P.dim, direction: "ltr" }}>shuknadlan.co.il</div>
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
    ["intake", Intake],
    ["live", Live],
    ["social", Social],
    ["alert", Alert],
    ["share", Share],
    ["manager", Manager],
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
