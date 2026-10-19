import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";
import { BgMesh, Captions, Entrance, Grain, Music, SceneFrame, Sfx, Vignette, Voiceover, font, onWord, sceneById, wordFrame } from "reelkit/kit";
import type { VideoProps } from "reelkit/kit";
import { AppWindow } from "./AppWindow";
import { StatTile } from "./StatTile";
import { PhoneFrame } from "./PhoneFrame";
import { ChatThread } from "./ChatThread";
import type { ChatMessage } from "./ChatThread";
import { FeatureChip } from "./FeatureChip";
import { SceneTitle } from "./SceneTitle";
import { ShowcaseScreen } from "./ShowcaseScreen";
import { SlotPicker } from "./SlotPicker";
import { MatchCard } from "./MatchCard";

// "יום עם גבריאלה" - second film of the series for brokerage office owners, 16:9.
// The agent's WhatsApp chat with Gabriela sits on the left in every scene; what it causes lands on the right.
// Demo names only (יואב כהן, דנה לוי, מיכל אברהם, רותי), generic streets, no phone numbers or links.
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
  site: "#1E3A66",
  meshA: "#D7E3F8",
  meshB: "#F7DDE0",
};
const heebo = font("heebo");

const IMG = {
  logo: "assets/user/a-4f1348c2-logo-shuknadlan.png",
  gabriela: "assets/user/a-6122196d-gabriela-avatar.png",
  agent: "assets/user/a-72c525ed-agent-portrait.jpg",
  cma: "assets/user/a-ff244031-cma-gauges.jpg",
  room: "assets/user/a-990af4c3-viz-room-before.jpg",
  shop: "assets/user/a-8f4fe71f-viz-shop-before.jpg",
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

// The agent's phone, always in the same place, so the chat reads as one conversation through the film.
const AgentPhone: React.FC<{ urls: Urls; messages: ChatMessage[]; delay?: number }> = ({ urls, messages, delay = 0 }) => (
  <PhoneFrame x={0.2} y={0.53} h={0.8} aspect={0.55} delay={delay}>
    <ChatThread name={GABI} avatar={urls[IMG.gabriela]} phoneH={0.78} text={0.031} font={heebo} messages={messages} />
  </PhoneFrame>
);

const chip = (label: string, glyph: React.ComponentProps<typeof FeatureChip>["glyph"], delay: number, active = false) => (
  <FeatureChip label={label} glyph={glyph} delay={delay} size={0.042} active={active} ink={P.ink} hero={P.hero} surface={P.surface} font={heebo} />
);

const Column: React.FC<{ top: number; children: React.ReactNode }> = ({ top, children }) => {
  const { width, height } = useVideoConfig();
  return <div style={{ position: "absolute", right: width * 0.05, top: height * top, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: height * 0.025, direction: "ltr" }}>{children}</div>;
};

const Hook: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const at = onWord(s, "לגבריאלה");
  const sp = spring({ frame: frame - at, fps, config: { damping: 14, stiffness: 160 } });
  return (
    <>
      <SceneTitle kicker="גבריאלה" title="הודעה אחת" kickerAt={2} titleAt={onWord(s, "וואטסאפ")} ink={P.hero} accent={P.accent} font={heebo} />
      <AgentPhone
        urls={urls}
        delay={2}
        messages={[
          { from: "me", lines: ["גבריאלה, יש לי נכס חדש", "ולקוחה חדשה"], at: at },
          { from: "them", lines: ["מעולה! שלח לי פרטים,", "ואני ממשיכה משם."], at: onWord(s, "ממשיכה") },
        ]}
      />
      <div style={{ position: "absolute", left: width * 0.52, top: height * 0.36, display: "flex", alignItems: "center", gap: width * 0.02, direction: "rtl", opacity: interpolate(frame - at, [0, 3], [0, 1], clamp), transform: `scale(${0.85 + 0.15 * sp})` }}>
        <Img src={urls[IMG.gabriela]} style={{ width: height * 0.26, height: height * 0.26, borderRadius: "50%", objectFit: "cover", border: `6px solid ${P.gold}`, boxShadow: "0 18px 40px rgba(11,27,63,0.25)" }} />
        <div>
          <div style={{ fontFamily: heebo, fontWeight: 900, fontSize: width * 0.04, color: P.ink, whiteSpace: "nowrap" }}>גבריאלה</div>
          <div style={{ fontFamily: heebo, fontWeight: 600, fontSize: width * 0.018, color: P.dim, whiteSpace: "nowrap" }}>העוזרת האישית של הסוכן, בוואטסאפ</div>
        </div>
      </div>
    </>
  );
};

const Intake: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => (
  <>
    <SceneTitle kicker="קליטת נכס" title="נכס חדש" kickerAt={2} titleAt={onWord(s, "נכס")} ink={P.hero} accent={P.accent} font={heebo} />
    <AgentPhone
      urls={urls}
      messages={[
        { from: "me", lines: ["דירה חדשה למכירה: 3 חדרים,", "הדקל 19, קומה 4, 80 מ״ר,", "חניה, ממ״ד ומעלית, 1,490,000"], at: onWord(s, "לכתוב") },
        { from: "me", image: urls[IMG.shop], lines: ["חנות 45 מ״ר להשכרה, 3,500"], at: onWord(s, "תמונה") },
        { from: "them", lines: ["שני הנכסים נוצרו במערכת."], at: onWord(s, "פותחת") },
        { from: "them", lines: ["פרסמתי אותם באתר,", "והקישורים מוכנים."], at: onWord(s, "מפרסמת") },
        { from: "them", lines: ["ולדירה בהדקל כבר יש קונה:", "מיכל אברהם, התאמה 100%."], bold: [1], at: onWord(s, "קונה") },
      ]}
    />
    <Column top={0.34}>
      {chip("נכס חדש נפתח", "check", onWord(s, "פותחת"))}
      {chip("פורסם באתר", "spark", onWord(s, "מפרסמת"))}
      {chip("התאמה 100% לקונה", "lead", onWord(s, "קונה"), true)}
    </Column>
    <Sfx src={urls[SFX.chime]} at={wordFrame(s, "קונה")} volume={0.16} />
  </>
);

const Client: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const { width, height } = useVideoConfig();
  return (
    <>
      <SceneTitle kicker="לקוחות" title="כרטיס לקוחה והתאמות" kickerAt={2} titleAt={onWord(s, "כרטיס")} ink={P.hero} accent={P.accent} font={heebo} />
      <AgentPhone
        urls={urls}
        messages={[
          { from: "me", lines: ["תוסיפי לקוחה חדשה, דנה לוי,", "4 חדרים עד 1.2 מיליון, עם מעלית"], at: 4 },
          { from: "them", lines: ["פתחתי כרטיס לדנה לוי."], at: onWord(s, "כרטיס") },
          { from: "them", lines: ["יש לה שתי התאמות של 100%:", "• הרצל 52 - הדירה שלך", "• הנרקיסים 65 - ששותפה מהמשרד"], at: onWord(s, "התאמות") },
        ]}
      />
      <div style={{ position: "absolute", right: width * 0.05, top: height * 0.36, display: "flex", flexDirection: "column", gap: height * 0.03 }}>
        <MatchCard title="הרצל 52" sub="4 חדרים · 1,100,000 ₪" tag="הנכס שלך" delay={onWord(s, "אצלך")} w={0.34} hero={P.hero} accent={P.accent} ink={P.ink} dim={P.dim} surface={P.surface} font={heebo} />
        <MatchCard title="הנרקיסים 65" sub="4 חדרים · 1,150,000 ₪" tag="משרד שותף" delay={onWord(s, "ובמשרדים")} w={0.34} hero={P.hero} accent={P.accent} ink={P.ink} dim={P.dim} surface={P.surface} font={heebo} />
      </div>
    </>
  );
};

const Minisite: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const { width, height } = useVideoConfig();
  const pick = onWord(s, "מועד");
  return (
    <>
      <SceneTitle kicker="ללקוחה" title="מיניסייט אישי" kickerAt={2} titleAt={onWord(s, "מיניסייט")} ink={P.hero} accent={P.accent} font={heebo} />
      <PhoneFrame x={0.2} y={0.53} h={0.8} aspect={0.55} delay={onWord(s, "מיניסייט")}>
        <ShowcaseScreen
          brand="משרד הדגמה"
          agentName="יואב כהן"
          agentSub="מתווך מוסמך"
          agentPhoto={urls[IMG.agent]}
          headline="דנה, בחרתי בשבילך 2 נכסים"
          photo={urls[IMG.room]}
          price="₪1,100,000"
          title="דירה · 4 חדרים למכירה"
          place="הרצל, עפולה"
          likeLabel="אהבתי"
          skipLabel="לא בשבילי"
          likeAt={onWord(s, "אהבה")}
          toast="נשמר ב״אהבתי״"
          phoneH={0.78}
          hero={P.site}
          ink={P.ink}
          dim={P.dim}
          surface={P.surface}
          font={heebo}
        />
      </PhoneFrame>
      <div style={{ position: "absolute", right: width * 0.08, top: height * 0.3 }}>
        <SlotPicker
          title="באיזה יום ושעה?"
          days={["יום ב׳ 26.10", "יום ג׳ 27.10", "יום ד׳ 28.10", "יום ה׳ 29.10", "יום ו׳ 30.10", "יום א׳ 1.11"]}
          pick={4}
          pickAt={pick}
          times={["09:30", "11:00", "17:30"]}
          timePick={0}
          timeAt={onWord(s, "לסיור")}
          button="שליחת בקשה לסיור"
          buttonAt={onWord(s, "לסיור") + 8}
          delay={onWord(s, "ובוחרת")}
          w={0.32}
          hero={P.site}
          ink={P.ink}
          line={P.line}
          surface={P.surface}
          font={heebo}
        />
      </div>
    </>
  );
};

const Coord: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const owner = onWord(s, "הבעלים");
  const press = onWord(s, "והמתווכים") + 6;
  return (
    <>
      <SceneTitle kicker="תיאום" title="תיאום הביקור" kickerAt={2} titleAt={onWord(s, "מתאמת")} ink={P.hero} accent={P.accent} font={heebo} />
      <AgentPhone
        urls={urls}
        messages={[
          { from: "them", lines: ["דנה ביקשה סיור ביום ו׳ 30.10, 09:30.", "לשלוח לבעלים ולמתווכים בקשה לתאם?"], at: 0, buttons: ["כן, לשלוח לכולם", "לא, אתאם בעצמי"], pressed: 0, pressAt: 10 },
          { from: "them", lines: ["רותי אישרה את הביקור:", "הרצל 52 · יום ו׳ 30.10 · 09:30"], bold: [0], at: press + 10 },
          { from: "them", lines: ["בדקתי ביומן במערכת וביומן Google:", "אתה פנוי בשעה הזו."], at: onWord(s, "היומן") },
          { from: "them", lines: ["קבעתי את הסיור. דנה קיבלה אישור", "עם הוספה ליומן, ותזכורת שעה לפני."], at: onWord(s, "אישור") },
        ]}
      />
      <PhoneFrame x={0.6} y={0.55} h={0.72} aspect={0.55} delay={owner}>
        <ChatThread
          name={GABI}
          avatar={urls[IMG.gabriela]}
          phoneH={0.7}
          text={0.031}
          font={heebo}
          messages={[
            { from: "them", lines: ["שלום רותי, כאן יואב כהן ממשרד הדגמה.", "אני מבקש לתאם איתך ביקור בנכס", "בהרצל 52 עם לקוחות, ביום ו׳ 30.10", "בסביבות 09:30. האם זה מתאים לך?"], at: owner + 2, buttons: ["מאשרת", "מבקשת לדחות", "לא מתאים, מועד אחר"], pressed: 0, pressAt: press },
            { from: "me", lines: ["מאשרת"], at: press + 6 },
          ]}
        />
      </PhoneFrame>
      <Column top={0.34}>
        {chip("בעלים ומתווכים", "chat", owner)}
        {chip("בדיקת יומן", "check", onWord(s, "היומן"))}
        {chip("אישור ותזכורת", "lead", onWord(s, "אישור"), true)}
      </Column>
      <Sfx src={urls[SFX.chime]} at={wordFrame(s, "אישור")} volume={0.16} />
    </>
  );
};

const Data: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const cma = onWord(s, "ודוח");
  const sp = spring({ frame: frame - cma, fps, config: { damping: 15, stiffness: 150 } });
  return (
    <>
      <SceneTitle kicker="נתונים" title="עסקאות אמת ודוח שוק" kickerAt={2} titleAt={onWord(s, "עסקאות")} ink={P.hero} accent={P.accent} font={heebo} />
      <AgentPhone
        urls={urls}
        messages={[
          { from: "me", lines: ["אילו עסקאות היו ברחוב הרצל", "לדירות 3 חדרים בשנה האחרונה?"], at: onWord(s, "נתונים") },
          { from: "them", lines: ["נמכרו 12 דירות 3 חדרים:", "• הרצל 18, 63 מ״ר - 1,040,000", "• הרצל 20, 67 מ״ר - 1,060,000", "• הרצל 28, 70 מ״ר - 1,050,000"], bold: [0], at: onWord(s, "ברחוב") },
        ]}
      />
      {frame >= cma - 1 ? (
        <div style={{ position: "absolute", right: width * 0.05, top: height * 0.3, width: width * 0.44, background: P.surface, borderRadius: width * 0.012, overflow: "hidden", boxShadow: "0 18px 44px rgba(11,27,63,0.2)", opacity: interpolate(frame - cma, [0, 3], [0, 1], clamp), transform: `translateY(${(1 - sp) * height * 0.04}px)` }}>
          <div style={{ background: P.site, padding: `${height * 0.018}px ${width * 0.014}px`, direction: "rtl", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontFamily: heebo, fontWeight: 800, fontSize: width * 0.016, color: P.surface, whiteSpace: "nowrap" }}>דוח השוואת שוק</div>
            <div style={{ fontFamily: heebo, fontWeight: 600, fontSize: width * 0.011, color: P.surface, opacity: 0.8, whiteSpace: "nowrap" }}>ממותג במשרד שלך</div>
          </div>
          <Img src={urls[IMG.cma]} style={{ display: "block", width: "100%" }} />
        </div>
      ) : null}
    </>
  );
};

const Close: React.FC<{ s: Scene; urls: Urls }> = ({ s, urls }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const dash = onWord(s, "נרשם");
  const out = interpolate(frame, [onWord(s, "פחות") - 6, onWord(s, "פחות") + 2], [1, 0], clamp);
  const line = { fontFamily: heebo, fontWeight: 900, fontSize: width * 0.055, whiteSpace: "nowrap" as const, textAlign: "center" as const };
  const tile = (label: string, value: number, d: number, bar: string) => (
    <StatTile label={label} value={value} delay={dash + d} w={0.18} h={0.17} ink={P.ink} dim={P.dim} bar={bar} good={P.good} surface={P.surface} line={P.line} font={heebo} />
  );
  return (
    <>
      <div style={{ position: "absolute", inset: 0, opacity: out }}>
        <AppWindow title="הדשבורד שלך · השבוע" tag="נתוני הדגמה" x={0.1} y={0.3} w={0.8} h={0.3} delay={dash} ink={P.ink} hero={P.hero} surface={P.surface} line={P.line} font={heebo}>
          <div style={{ display: "flex", gap: width * 0.012, padding: width * 0.016, direction: "rtl", justifyContent: "center" }}>
            {tile("פגישות", 10, 4, P.hero)}
            {tile("נכסים חדשים", 7, 7, P.gold)}
            {tile("לקוחות חדשים", 12, 10, P.good)}
            {tile("סיורים שתואמו", 5, 13, P.accent)}
          </div>
        </AppWindow>
      </div>
      <Entrance delay={onWord(s, "פחות")} style={{ position: "absolute", top: height * 0.16, left: 0, right: 0, direction: "rtl", ...line, color: P.hero }}>פחות עבודה שחורה.</Entrance>
      <Entrance delay={onWord(s, "יותר")} style={{ position: "absolute", top: height * 0.3, left: 0, right: 0, direction: "rtl", ...line, color: P.accent }}>יותר עסקאות.</Entrance>
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
    ["client", Client],
    ["minisite", Minisite],
    ["coord", Coord],
    ["data", Data],
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
