import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";
import { BgMesh, Captions, Grain, Icon, Music, SceneFrame, Sfx, Vignette, Voiceover, font, onWord, sceneById, wordFrame } from "reelkit/kit";
import type { VideoProps } from "reelkit/kit";

// Shuk Nadlan brand: sapphire pin + gold shin, on a warm off-white ground.
const palette = {
  bg: "#F7F5F0",
  ink: "#0d1b3d",
  hero: "#0e2a6b",
  accent: "#c9a227",
  dim: "#6b7280",
  card: "#ffffff",
  line: "#e7e3da",
  soft: "#eef2fa",
  waBubble: "#d9fdd3",
  rec: "#e5484d",
  pins: ["#0e2a6b", "#c9a227", "#0f766e", "#e5484d", "#6d28d9", "#ea580c"],
};
const heebo = font("heebo");

const SFX = {
  ring: "assets/lib/synths-of-the-past-phone-mobile-phone-ring/clip.mp3",
  whoosh: "assets/lib/sfx-ui-soft-whoosh/clip.mp3",
  pop: "assets/lib/sfx-ui-bubble-pop/clip.mp3",
  tap: "assets/lib/sfx-ui-glass-tap/clip.mp3",
  ping: "assets/lib/sfx-ui-notification-ping/clip.mp3",
  send: "assets/lib/sfx-ui-send-swoosh/clip.mp3",
  riser: "assets/lib/sfx-ui-riser-short/clip.mp3",
  impact: "assets/lib/sfx-ui-soft-impact/clip.mp3",
  sparkle: "assets/lib/sfx-ui-sparkle-shimmer/clip.mp3",
  chime: "assets/lib/sfx-ui-success-chime/clip.mp3",
};
const IMG = {
  logo: "assets/user/a-b9d59616-logo-shuknadlan.png",
  portrait: "assets/user/a-2e911190-gabriela-portrait.jpg",
  face: "assets/user/a-a18f6157-gabriela-face.jpg",
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const smooth = { damping: 18, stiffness: 120 };
const snappy = { damping: 13, stiffness: 170 };

type Box = { x: number; y: number; w: number; h: number; r?: number; o?: number };
type Key = Box & { f: number };

// Moves a box through keyframes; each move starts `lead` frames before its key and lands on it.
function tween(frame: number, fps: number, keys: Key[], lead = 12): Box {
  let cur: Box = keys[0];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    const start = Math.max(a.f, b.f - lead);
    if (frame >= b.f) { cur = b; continue; }
    if (frame <= start) break;
    const p = spring({ frame: frame - start, fps, config: smooth, durationInFrames: b.f - start });
    const mix = (u: number, v: number) => u + (v - u) * p;
    cur = { x: mix(a.x, b.x), y: mix(a.y, b.y), w: mix(a.w, b.w), h: mix(a.h, b.h), r: mix(a.r ?? 0.04, b.r ?? 0.04), o: mix(a.o ?? 1, b.o ?? 1) };
    break;
  }
  return cur;
}

// A whole Hebrew word or line entering: opacity is full within 2 frames, short rise, small settle.
const enter = (frame: number, at: number, fps: number, H: number, from = 1.08) => {
  const p = spring({ frame: frame - at, fps, config: snappy });
  return {
    opacity: interpolate(frame - at, [0, 2], [0, 1], clamp),
    transform: `translateY(${(1 - p) * H * 0.015}px) scale(${from - (from - 1) * p})`,
  };
};
const leave = (frame: number, at: number) => interpolate(frame - at, [0, 6], [1, 0], clamp);

const Line: React.FC<{ size: number; weight?: number; color?: string; style?: React.CSSProperties; children: React.ReactNode }> = ({ size, weight = 700, color = palette.ink, style, children }) => (
  <div style={{ fontFamily: heebo, fontSize: size, fontWeight: weight, color, direction: "rtl", whiteSpace: "nowrap", lineHeight: 1.15, ...style }}>{children}</div>
);

// A tap: a ring that expands and fades where a finger touches the screen.
const Tap: React.FC<{ at: number; x: number; y: number; color?: string }> = ({ at, x, y, color = palette.accent }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const t = frame - at;
  if (t < -6 || t > 16) return null;
  const finger = interpolate(t, [-6, 0, 6, 12], [0, 1, 1, 0], clamp);
  const ring = interpolate(t, [0, 14], [0.3, 1.6], clamp);
  const d = width * 0.09;
  return (
    <div style={{ position: "absolute", left: x * width - d / 2, top: 0, width: d, height: d, transform: `translateY(${y * width * 16 / 9 - d / 2}px)` }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(13,27,61,0.18)", opacity: finger, transform: `scale(${interpolate(t, [-6, 0], [1.3, 1], clamp)})` }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `${d * 0.06}px solid ${color}`, opacity: interpolate(t, [0, 14], [1, 0], clamp), transform: `scale(${ring})` }} />
    </div>
  );
};

const Chip: React.FC<{ text: string; bg?: string; color?: string; size: number; icon?: React.ReactNode }> = ({ text, bg = palette.accent, color = palette.ink, size, icon }) => (
  <div style={{ display: "inline-flex", alignItems: "center", gap: size * 0.4, background: bg, color, padding: `${size * 0.35}px ${size * 0.8}px`, borderRadius: size * 2, fontFamily: heebo, fontWeight: 800, fontSize: size, direction: "rtl", whiteSpace: "nowrap", boxShadow: "0 10px 30px rgba(14,42,107,0.18)" }}>
    {icon}
    <span>{text}</span>
  </div>
);

const Waveform: React.FC<{ frame: number; bars: number; w: number; h: number; color: string }> = ({ frame, bars, w, h, color }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: w, height: h }}>
    {Array.from({ length: bars }, (_, i) => {
      const v = 0.25 + 0.75 * Math.abs(Math.sin(frame * 0.35 + i * 0.9) * Math.cos(frame * 0.13 + i * 0.37));
      return <div key={i} style={{ width: w / bars * 0.55, height: h * v, borderRadius: w, background: color }} />;
    })}
  </div>
);

const CalendarGlyph: React.FC<{ size: number; color: string; fill: string }> = ({ size, color, fill }) => (
  <svg width={size} height={size} viewBox="0 0 48 48">
    <rect x="5" y="9" width="38" height="34" rx="7" fill={fill} stroke={color} strokeWidth="3.5" />
    <path d="M5 19h38" stroke={color} strokeWidth="3.5" />
    <path d="M15 5v8M33 5v8" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
    <path d="M16 30l6 6 11-12" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const HouseGlyph: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 48 48">
    <path d="M7 22L24 8l17 14v18a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3z" fill={color} />
    <rect x="19" y="29" width="10" height="14" rx="2" fill="#fff" opacity="0.85" />
  </svg>
);

const HeartGlyph: React.FC<{ size: number; color: string; filled: boolean }> = ({ size, color, filled }) => (
  <svg width={size} height={size} viewBox="0 0 48 48">
    <path d="M24 41S6 30 6 17.5A9.5 9.5 0 0 1 24 13a9.5 9.5 0 0 1 18 4.5C42 30 24 41 24 41z" fill={filled ? color : "none"} stroke={color} strokeWidth="4" strokeLinejoin="round" />
  </svg>
);

const Check: React.FC<{ size: number; on: number }> = ({ size, on }) => (
  <div style={{ width: size, height: size, borderRadius: "50%", background: on > 0.5 ? palette.accent : "transparent", border: `${size * 0.1}px solid ${palette.accent}`, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${1 + 0.25 * Math.sin(Math.min(on, 1) * Math.PI)})`, flex: "none" }}>
    <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" style={{ opacity: on }}>
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke={palette.ink} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
);

export const Video: React.FC<VideoProps> = ({ manifest, urls }) => {
  const frame = useCurrentFrame();
  const real = useVideoConfig();
  const fps = real.fps;
  // The film is laid out on a 9:16 stage. In a square frame (feed posts) the same stage is scaled down and the band that holds
  // every scene's content is shown; the captions, the badge and the avatar sit on the square frame itself.
  const square = real.height / real.width < 1.2;
  const W = real.width;
  const H = square ? Math.round((real.width * 16) / 9) : real.height;
  const STAGE = square ? 0.66 : 1;
  const WIN_TOP = square ? 130 : 0;
  const AV_Y = square ? 0.11 : 0.055;

  const call = sceneById(manifest, "call");
  const record = sceneById(manifest, "record");
  const gab = sceneById(manifest, "gabriela");
  const matches = sceneById(manifest, "matches");
  const showcase = sceneById(manifest, "showcase");
  const choose = sceneById(manifest, "choose");
  const meeting = sceneById(manifest, "meeting");
  const payoff = sceneById(manifest, "payoff");

  // Absolute frames of the moments the story turns on.
  const abs = (s: typeof call, w: string, o?: { nth?: number }) => s.startFrame + wordFrame(s, w, o);
  const on = (s: typeof call, w: string) => s.startFrame + onWord(s, w);
  const flipAt = abs(call, "פגישה");
  const clickAt = abs(call, "בקליק");
  const rewindAt = record.startFrame + 2;
  const recAt = on(record, "מוקלטת");
  const textAt = on(record, "ומתומללת");
  const bubbleAt = on(gab, "ההוראות");
  const gabEnd = gab.startFrame + gab.durationFrames;
  const phoneIn = showcase.startFrame;
  const phoneOut = payoff.startFrame + 8;

  const voice = (s: typeof call) => (
    <>
      {square ? null : <Captions words={s.words} group={manifest.captions} rtl face={heebo} highlight={palette.accent} mode="highlight" />}
      {s.voiceoverKey ? <Voiceover src={urls[s.voiceoverKey]} /> : null}
    </>
  );

  // ---------- The client card: one object from the first frame to the chat bubble ----------
  const cardKeys: Key[] = [
    { f: 0, x: 0.5, y: 0.4, w: 0.8, h: 0.22 },
    { f: recAt + 8, x: 0.5, y: 0.4, w: 0.8, h: 0.22 },
    { f: textAt + 10, x: 0.5, y: 0.41, w: 0.8, h: 0.33 },
    { f: bubbleAt + 12, x: 0.37, y: 0.53, w: 0.6, h: 0.15 },
  ];
  const cardBox = tween(frame, fps, cardKeys);
  const DESIGN = W * 0.8; // the card is drawn at this width and scaled to the box
  const cardScale = (cardBox.w * W) / DESIGN;
  const flipWin = (f: number, at: number) => Math.abs(Math.cos(interpolate(f, [at - 6, at + 6], [0, Math.PI], clamp)));
  const isMeeting = frame >= flipAt && frame < rewindAt + 6;
  const flipScale = frame < rewindAt - 4 ? flipWin(frame, flipAt) : flipWin(frame, rewindAt + 6);
  const isBubble = frame >= bubbleAt + 2;
  const cardVisible = frame < gabEnd;

  const ringing = frame < flipAt;
  const callContent = (
    <div style={{ display: "flex", alignItems: "center", gap: DESIGN * 0.05, padding: DESIGN * 0.06, direction: "rtl" }}>
      <div style={{ position: "relative", width: DESIGN * 0.2, height: DESIGN * 0.2, flex: "none" }}>
        {ringing
          ? [0, 1, 2].map((i) => {
              const t = ((frame + i * 10) % 30) / 30;
              return <div key={i} style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `${DESIGN * 0.008}px solid ${palette.hero}`, opacity: 1 - t, transform: `scale(${1 + t * 0.45})` }} />;
            })
          : null}
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: palette.hero, display: "flex", alignItems: "center", justifyContent: "center", transform: `rotate(${ringing ? Math.sin(frame * 1.6) * 12 : 0}deg)` }}>
          <Icon name="phone" size={DESIGN * 0.1} color="#ffffff" />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: DESIGN * 0.015 }}>
        <Line size={DESIGN * 0.085} weight={800}>שיחה נכנסה?</Line>
        <Line size={DESIGN * 0.05} weight={600} color={palette.dim}>מספר וירטואלי</Line>
      </div>
    </div>
  );
  const meetingContent = (
    <div style={{ display: "flex", alignItems: "center", gap: DESIGN * 0.05, padding: DESIGN * 0.06, direction: "rtl" }}>
      <div style={{ width: DESIGN * 0.2, height: DESIGN * 0.2, borderRadius: "50%", background: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        <CalendarGlyph size={DESIGN * 0.12} color={palette.hero} fill="#ffffff" />
      </div>
      <Line size={DESIGN * 0.095} weight={800}>פגישה נקבעה!</Line>
    </div>
  );
  const recOn = interpolate(frame, [recAt, recAt + 3], [0, 1], clamp);
  const textOn = interpolate(frame, [textAt, textAt + 3], [0, 1], clamp);
  const lines = ["לקוח: מחפש דירה לקנייה", "דרישות: חדרים, אזור, תקציב", "צעד הבא: לשלוח התאמות"];
  const recordContent = (
    <div style={{ display: "flex", flexDirection: "column", padding: DESIGN * 0.06, gap: DESIGN * 0.035, direction: "rtl" }}>
      <div style={{ display: "flex", alignItems: "center", gap: DESIGN * 0.04 }}>
        <div style={{ width: DESIGN * 0.13, height: DESIGN * 0.13, borderRadius: "50%", background: palette.hero, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <Icon name="phone" size={DESIGN * 0.065} color="#ffffff" />
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: DESIGN * 0.03, opacity: recOn }}>
          <div style={{ width: DESIGN * 0.035, height: DESIGN * 0.035, borderRadius: "50%", background: palette.rec, opacity: 0.55 + 0.45 * Math.abs(Math.sin(frame * 0.2)) }} />
          <Line size={DESIGN * 0.06} weight={800} color={palette.ink}>{textOn > 0.5 ? "מתומללת" : "מוקלטת"}</Line>
        </div>
        <div style={{ opacity: recOn * (1 - textOn * 0.6) }}>
          <Waveform frame={frame < textAt ? frame : textAt} bars={14} w={DESIGN * 0.3} h={DESIGN * 0.1} color={palette.hero} />
        </div>
      </div>
      {lines.map((l, i) => {
        const at = textAt + 3 + i * 4;
        return (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: DESIGN * 0.025, ...(frame >= at ? enter(frame, at, fps, H, 1.04) : { opacity: 0 }) }}>
            <div style={{ width: DESIGN * 0.018, height: DESIGN * 0.018, borderRadius: "50%", background: palette.accent, flex: "none" }} />
            <Line size={DESIGN * 0.056} weight={600}>{l}</Line>
          </div>
        );
      })}
    </div>
  );
  const bubbleContent = (
    <div style={{ display: "flex", flexDirection: "column", padding: DESIGN * 0.06, gap: DESIGN * 0.03, direction: "rtl" }}>
      <Line size={DESIGN * 0.07} weight={800}>סיכום שיחה + הוראות</Line>
      {lines.map((l) => (
        <Line key={l} size={DESIGN * 0.056} weight={600} color={palette.ink}>{l}</Line>
      ))}
    </div>
  );
  const content = isBubble ? bubbleContent : isMeeting ? meetingContent : frame >= recAt ? recordContent : callContent;
  const cardBg = isBubble ? palette.waBubble : isMeeting ? palette.accent : palette.card;

  // ---------- Gabriela: a portrait in scene 3 that shrinks to an avatar for the rest of the film ----------
  const gabIn = on(gab, "לגבריאלה");
  const avatarKeys: Key[] = [
    { f: gabIn, x: 0.5, y: 0.235, w: 0.42, h: 0.235, r: 0.05, o: 1 },
    { f: gabEnd - 2, x: 0.5, y: 0.235, w: 0.42, h: 0.235, r: 0.05, o: 1 },
    { f: gabEnd + 10, x: 0.885, y: AV_Y, w: 0.13, h: 0.073, r: 0.065, o: 1 },
    { f: payoff.startFrame + 2, x: 0.885, y: AV_Y, w: 0.13, h: 0.073, r: 0.065, o: 1 },
    { f: payoff.startFrame + 12, x: 0.885, y: AV_Y, w: 0.13, h: 0.073, r: 0.065, o: 0 },
  ];
  const av = tween(frame, fps, avatarKeys, 10);
  const avIn = spring({ frame: frame - gabIn, fps, config: snappy });

  // ---------- The phone: the client's mini-site, scenes 5 to 7 ----------
  const phoneW = W * 0.64, phoneH = H * 0.6;
  const phoneP = spring({ frame: frame - phoneIn, fps, config: smooth });
  const phoneGone = interpolate(frame, [phoneOut, phoneOut + 12], [1, 0], clamp);
  const brandAt = on(showcase, "ממותג");
  const branded = spring({ frame: frame - brandAt, fps, config: snappy });
  const feedAt = on(showcase, "ההצעות");
  const loveAt = abs(choose, "אוהב");
  const noAt = abs(choose, "לא");
  const calAt = on(meeting, "וקובע");
  const meetAt = abs(meeting, "פגישה");
  const feedOut = interpolate(frame, [calAt, calAt + 8], [1, 0], clamp);

  const PropertyCard: React.FC<{ i: number }> = ({ i }) => {
    const cw = phoneW * 0.88;
    const at = feedAt + i * 5;
    const loved = i === 0 && frame >= loveAt;
    const rejected = i === 1 && frame >= noAt;
    const goneX = rejected ? interpolate(frame, [noAt + 2, noAt + 12], [0, -phoneW], clamp) : 0;
    const shiftUp = i === 2 ? interpolate(frame, [noAt + 8, noAt + 18], [0, 1], clamp) : 0;
    const pulse = loved ? 1 + 0.04 * Math.sin(interpolate(frame, [loveAt, loveAt + 10], [0, Math.PI], clamp)) : 1;
    const p = spring({ frame: frame - at, fps, config: smooth });
    const tones = ["#c7d3ea", "#e9dcb6", "#cfe3dc"];
    const btn = (label: string, active: boolean, heart: boolean) => (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: cw * 0.025, height: cw * 0.13, borderRadius: cw * 0.07, background: active ? palette.accent : palette.soft, fontFamily: heebo, fontWeight: 800, fontSize: W * 0.034, color: palette.ink, direction: "rtl", whiteSpace: "nowrap" }}>
        {heart ? <HeartGlyph size={W * 0.04} color={active ? palette.ink : palette.hero} filled={active} /> : null}
        {label}
      </div>
    );
    return (
      <div style={{ width: cw, background: "#fff", borderRadius: cw * 0.06, overflow: "hidden", boxShadow: "0 8px 22px rgba(13,27,61,0.12)", border: loved ? `${W * 0.006}px solid ${palette.accent}` : `${W * 0.006}px solid transparent`, opacity: frame < at ? 0 : interpolate(frame - at, [0, 3], [0, 1], clamp) * (rejected ? interpolate(frame, [noAt + 4, noAt + 12], [1, 0], clamp) : 1), transform: `translate(${goneX}px, ${(1 - p) * -H * 0.05 - shiftUp * 0}px) scale(${pulse})`, flex: "none" }}>
        <div style={{ height: cw * 0.34, background: `linear-gradient(135deg, ${tones[i]}, #ffffff)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <HouseGlyph size={cw * 0.17} color={palette.hero} />
        </div>
        <div style={{ padding: cw * 0.05, display: "flex", flexDirection: "column", gap: cw * 0.035 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: cw * 0.02, alignItems: "flex-end" }}>
            <div style={{ width: cw * 0.55, height: cw * 0.035, borderRadius: cw, background: palette.line }} />
            <div style={{ width: cw * 0.35, height: cw * 0.035, borderRadius: cw, background: palette.line }} />
          </div>
          <div style={{ display: "flex", gap: cw * 0.04, direction: "rtl" }}>
            {btn("אהבתי", loved, true)}
            {btn("לא בשבילי", false, false)}
          </div>
        </div>
      </div>
    );
  };

  // ---------- Scene 4: the client is saved and matches arrive from the whole city ----------
  const savedAt = on(matches, "נשמר");
  const mapAt = on(matches, "התאמות");
  const flyAt = on(matches, "המתווכים");
  const pinPos = [
    { x: 0.27, y: 0.53 }, { x: 0.62, y: 0.5 }, { x: 0.78, y: 0.62 }, { x: 0.4, y: 0.66 }, { x: 0.2, y: 0.7 }, { x: 0.66, y: 0.71 },
  ];

  // ---------- Scene 8: the chain as a row of icons, then the logo ----------
  const chain: { name: "phone" | "message" | "user" | "heart" | "calendar" }[] = [
    { name: "phone" }, { name: "message" }, { name: "user" }, { name: "heart" }, { name: "calendar" },
  ];
  const coopAt = on(payoff, "שיתופי");
  const dealsAt = on(payoff, "עסקאות");
  const joinAt = on(payoff, "הצטרפו");
  const badgeAt = clickAt + 6;

  return (
    <AbsoluteFill style={{ background: palette.bg }}>
      <style>{"*{box-sizing:border-box}"}</style>
      <BgMesh bg={palette.bg} hero={palette.hero} accent={palette.accent} />
      <div style={{ position: "absolute", left: (W - W * STAGE) / 2, top: -WIN_TOP * STAGE, width: W, height: H, transform: `scale(${STAGE})`, transformOrigin: "top left" }}>

      {/* Scene 1: incoming call that flips into a booked meeting */}
      <SceneFrame from={call.startFrame} durationInFrames={call.durationFrames} exit="cut">
        <AbsoluteFill>
          <div style={{ position: "absolute", top: H * 0.58, width: "100%", display: "flex", justifyContent: "center", ...enter(useLocal(frame, call.startFrame), onWord(call, "והכל"), fps, H, 1.2) }}>
            <Line size={W * 0.085} weight={800} color={palette.hero}>
              והכל <span style={{ color: palette.accent }}>בקליק.</span>
            </Line>
          </div>
          <Tap at={wordFrame(call, "בקליק")} x={0.5} y={0.4} />
        </AbsoluteFill>
        <Sequence from={0} durationInFrames={Math.max(1, wordFrame(call, "פגישה"))} layout="none">
          <Sfx src={urls[SFX.ring]} at={0} volume={0.22} />
        </Sequence>
        <Sfx src={urls[SFX.whoosh]} at={wordFrame(call, "פגישה") - 4} volume={0.22} />
        <Sfx src={urls[SFX.chime]} at={wordFrame(call, "נקבעה")} volume={0.22} />
        <Sfx src={urls[SFX.tap]} at={wordFrame(call, "בקליק")} volume={0.26} />
        {voice(call)}
      </SceneFrame>

      {/* Scene 2: back to the call, recorded and transcribed */}
      <SceneFrame from={record.startFrame} durationInFrames={record.durationFrames} enter="cut" exit="cut">
        <Sfx src={urls[SFX.whoosh]} at={0} volume={0.2} />
        <Sfx src={urls[SFX.pop]} at={wordFrame(record, "מוקלטת")} volume={0.2} />
        <Sfx src={urls[SFX.sparkle]} at={wordFrame(record, "ומתומללת")} volume={0.18} />
        {voice(record)}
      </SceneFrame>

      {/* Scene 3: the instructions go to Gabriela on WhatsApp */}
      <SceneFrame from={gab.startFrame} durationInFrames={gab.durationFrames} enter="cut">
        <AbsoluteFill>
          {(() => {
            const f = frame - gab.startFrame;
            const p = spring({ frame: f, fps, config: smooth });
            const replyAt = onWord(gab, "העוזרת");
            const items = ["לשמור את הלקוח", "למצוא התאמות", "לשלוח למיניסייט"];
            return (
              <div style={{ position: "absolute", left: W * 0.06, top: H * 0.375, width: W * 0.88, height: H * 0.4, background: "#efeae2", borderRadius: W * 0.05, overflow: "hidden", boxShadow: "0 20px 50px rgba(13,27,61,0.16)", opacity: interpolate(f, [0, 3], [0, 1], clamp), transform: `translateY(${(1 - p) * H * 0.03}px)` }}>
                <div style={{ height: H * 0.07, background: "#ffffff", display: "flex", alignItems: "center", gap: W * 0.025, padding: `0 ${W * 0.04}px`, direction: "rtl" }}>
                  <Img src={urls[IMG.face]} style={{ width: H * 0.05, height: H * 0.05, borderRadius: "50%", objectFit: "cover" }} />
                  <Line size={W * 0.045} weight={800}>גבריאלה</Line>
                  <div style={{ flex: 1 }} />
                  <Icon name="whatsapp" size={W * 0.06} color="brand" />
                </div>
                <div style={{ position: "absolute", right: W * 0.04, top: H * 0.25, width: W * 0.56, background: "#ffffff", borderRadius: W * 0.035, padding: W * 0.035, display: "flex", flexDirection: "column", gap: W * 0.022, direction: "rtl", ...(f >= replyAt ? enter(f, replyAt, fps, H, 1.05) : { opacity: 0 }) }}>
                  {items.map((t, i) => {
                    const tickAt = replyAt + 8 + i * 7;
                    return (
                      <div key={t} style={{ display: "flex", alignItems: "center", gap: W * 0.025 }}>
                        <Check size={W * 0.05} on={interpolate(f, [tickAt, tickAt + 4], [0, 1], clamp)} />
                        <Line size={W * 0.04} weight={700}>{t}</Line>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          <div style={{ position: "absolute", top: H * 0.355, left: 0, width: "100%", display: "flex", justifyContent: "center" }} />
        </AbsoluteFill>
        <Sfx src={urls[SFX.send]} at={wordFrame(gab, "ההוראות")} volume={0.24} />
        <Sfx src={urls[SFX.pop]} at={wordFrame(gab, "לגבריאלה")} volume={0.22} />
        <Sfx src={urls[SFX.ping]} at={wordFrame(gab, "העוזרת")} volume={0.24} />
        {voice(gab)}
      </SceneFrame>

      {/* Scene 4: saved to the client list, matches fly in from offices across the city */}
      <SceneFrame from={matches.startFrame} durationInFrames={matches.durationFrames}>
        {(() => {
          const f = frame - matches.startFrame;
          const sv = spring({ frame: f - onWord(matches, "נשמר"), fps, config: smooth });
          const mp = spring({ frame: f - onWord(matches, "התאמות"), fps, config: smooth });
          const cardY = interpolate(sv, [0, 1], [H * 0.16, H * 0.215]);
          const cardTarget = { x: 0.22, y: 0.248 };
          return (
            <AbsoluteFill>
              {/* the client list */}
              <div style={{ position: "absolute", left: W * 0.08, top: H * 0.15, width: W * 0.84, height: H * 0.2, background: "#ffffff", borderRadius: W * 0.045, boxShadow: "0 14px 40px rgba(13,27,61,0.12)", opacity: sv, transform: `scale(${0.94 + 0.06 * sv})`, padding: W * 0.04, display: "flex", flexDirection: "column", gap: W * 0.03, direction: "rtl" }}>
                <div style={{ display: "flex", alignItems: "center", gap: W * 0.03 }}>
                  <Line size={W * 0.042} weight={800}>מאגר הלקוחות</Line>
                  <div style={{ flex: 1 }} />
                  {f >= onWord(matches, "נשמר") + 4 ? <div style={enter(f, onWord(matches, "נשמר") + 4, fps, H, 1.2)}><Chip text="נשמר במאגר" size={W * 0.036} /></div> : null}
                </div>
                <div style={{ height: H * 0.055 }} />
                {[0, 1].map((i) => (
                  <div key={i} style={{ height: H * 0.022, width: `${70 - i * 18}%`, borderRadius: W, background: palette.line }} />
                ))}
              </div>
              {/* the client card */}
              <div style={{ position: "absolute", left: W * 0.12, top: cardY, width: W * 0.76, height: H * 0.065, background: palette.soft, borderRadius: W * 0.03, border: `${W * 0.004}px solid ${palette.hero}`, display: "flex", alignItems: "center", gap: W * 0.03, padding: `0 ${W * 0.035}px`, direction: "rtl", ...enter(f, 0, fps, H, 1.05) }}>
                <div style={{ width: H * 0.045, height: H * 0.045, borderRadius: "50%", background: palette.hero, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <Icon name="user" size={W * 0.045} color="#ffffff" />
                </div>
                <Line size={W * 0.04} weight={800}>לקוח חדש · קונה</Line>
              </div>
              {/* the city */}
              <div style={{ position: "absolute", left: W * 0.08, top: H * 0.4, width: W * 0.84, height: H * 0.36, borderRadius: W * 0.05, background: "#e4ebf6", overflow: "hidden", opacity: mp, transform: `scale(${1.06 - 0.06 * mp})` }}>
                <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
                  {["M0 30 L100 22", "M0 62 L100 70", "M28 0 L36 100", "M70 0 L60 100", "M0 88 L100 80"].map((d) => (
                    <path key={d} d={d} stroke="#ffffff" strokeWidth="3.2" fill="none" />
                  ))}
                </svg>
                <div style={{ position: "absolute", top: H * 0.02, width: "100%", display: "flex", justifyContent: "center" }}>
                  {f >= onWord(matches, "התאמות") ? <div style={enter(f, onWord(matches, "התאמות"), fps, H, 1.2)}><Chip text="התאמות מכל העיר" size={W * 0.042} bg={palette.hero} color="#ffffff" /></div> : null}
                </div>
              </div>
              {pinPos.map((pp, i) => {
                const pinIn = spring({ frame: f - onWord(matches, "התאמות") - 3 - i * 2, fps, config: snappy });
                const fa = onWord(matches, "המתווכים") + i * 3;
                const fly = interpolate(f, [fa, fa + 12], [0, 1], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
                const fx = (pp.x + (cardTarget.x - pp.x) * fly) * W;
                const fy = (pp.y + (cardTarget.y - pp.y) * fly - Math.sin(fly * Math.PI) * 0.06) * H;
                const s = W * 0.08;
                return (
                  <React.Fragment key={i}>
                    <div style={{ position: "absolute", left: pp.x * W - s * 0.35, top: pp.y * H - s * 0.9, opacity: pinIn, transform: `scale(${pinIn})`, transformOrigin: "50% 100%" }}>
                      <svg width={s * 0.7} height={s * 0.9} viewBox="0 0 28 36"><path d="M14 35C14 35 2 21 2 13a12 12 0 1 1 24 0c0 8-12 22-12 22z" fill={palette.pins[i]} /><circle cx="14" cy="13" r="4.5" fill="#fff" /></svg>
                    </div>
                    {f >= fa ? (
                      <div style={{ position: "absolute", left: fx - s * 0.5, top: fy - s * 0.5, width: s, height: s, borderRadius: s * 0.2, background: "#ffffff", border: `${W * 0.004}px solid ${palette.pins[i]}`, display: "flex", alignItems: "center", justifyContent: "center", opacity: interpolate(fly, [0, 0.1, 0.9, 1], [0, 1, 1, 0], clamp), transform: `scale(${1 - fly * 0.35})`, boxShadow: "0 6px 16px rgba(13,27,61,0.18)" }}>
                        <HouseGlyph size={s * 0.6} color={palette.pins[i]} />
                      </div>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.impact]} at={wordFrame(matches, "נשמר")} volume={0.26} />
        <Sfx src={urls[SFX.whoosh]} at={wordFrame(matches, "התאמות") - 2} volume={0.2} />
        <Sfx src={urls[SFX.pop]} at={wordFrame(matches, "המתווכים") + 10} volume={0.2} />
        <Sfx src={urls[SFX.pop]} at={wordFrame(matches, "המתווכים") + 19} volume={0.16} />
        {voice(matches)}
      </SceneFrame>

      {/* Scenes 5-7 keep their words here; the phone itself is one layer below */}
      <SceneFrame from={showcase.startFrame} durationInFrames={showcase.durationFrames}>
        <AbsoluteFill>
          {(() => {
            const f = frame - showcase.startFrame;
            const a = onWord(showcase, "למיניסייט"), b = onWord(showcase, "ממותג");
            return (
              <div style={{ position: "absolute", top: H * 0.1, width: "100%", display: "flex", justifyContent: "center" }}>
                {f >= a && f < b + 2 ? <div style={{ ...enter(f, a, fps, H, 1.15), opacity: f >= b ? leave(f, b - 2) : 1 }}><Chip text="מיניסייט אישי" size={W * 0.045} bg={palette.hero} color="#ffffff" /></div> : null}
                {f >= b ? <div style={enter(f, b, fps, H, 1.2)}><Chip text="ממותג בשם שלכם" size={W * 0.045} /></div> : null}
              </div>
            );
          })()}
        </AbsoluteFill>
        <Sfx src={urls[SFX.whoosh]} at={wordFrame(showcase, "ההצעות") - 2} volume={0.2} />
        <Sfx src={urls[SFX.pop]} at={wordFrame(showcase, "ממותג")} volume={0.24} />
        {voice(showcase)}
      </SceneFrame>
      <SceneFrame from={choose.startFrame} durationInFrames={choose.durationFrames}>
        <Sfx src={urls[SFX.tap]} at={wordFrame(choose, "אוהב")} volume={0.26} />
        <Sfx src={urls[SFX.tap]} at={wordFrame(choose, "לא")} volume={0.22} />
        <Sfx src={urls[SFX.whoosh]} at={wordFrame(choose, "לא") + 2} volume={0.18} />
        {voice(choose)}
      </SceneFrame>
      <SceneFrame from={meeting.startFrame} durationInFrames={meeting.durationFrames}>
        <AbsoluteFill>
          {(() => {
            const f = frame - meeting.startFrame;
            const m = wordFrame(meeting, "פגישה") - 2;
            return f >= m ? (
              <div style={{ position: "absolute", top: H * 0.1, width: "100%", display: "flex", justifyContent: "center", ...enter(f, m, fps, H, 1.25) }}>
                <Chip text="פגישה נקבעה" size={W * 0.055} icon={<CalendarGlyph size={W * 0.06} color={palette.ink} fill={palette.accent} />} />
              </div>
            ) : null;
          })()}
        </AbsoluteFill>
        <Sfx src={urls[SFX.chime]} at={wordFrame(meeting, "פגישה")} volume={0.26} />
        {voice(meeting)}
      </SceneFrame>

      {/* The phone, carried across scenes 5 to 7 */}
      {frame >= phoneIn && frame < phoneOut + 12 ? (
        <div style={{ position: "absolute", left: (W - phoneW) / 2, top: H * 0.17, width: phoneW, height: phoneH, borderRadius: phoneW * 0.11, background: palette.ink, padding: phoneW * 0.025, boxShadow: "0 30px 70px rgba(13,27,61,0.28)", opacity: phoneGone * interpolate(frame - phoneIn, [0, 3], [0, 1], clamp), transform: `translateY(${(1 - phoneP) * H * 0.06}px) scale(${(0.9 + 0.1 * phoneP) * (0.85 + 0.15 * phoneGone)})` }}>
          <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: phoneW * 0.09, background: palette.bg, overflow: "hidden" }}>
            {/* brand bar: grey until "branded", then the agent's own colour */}
            <div style={{ height: phoneH * 0.15, background: interpolate(branded, [0, 1], [0, 1]) > 0.5 ? palette.hero : "#d9dde5", display: "flex", alignItems: "center", gap: phoneW * 0.04, padding: `${phoneH * 0.025}px ${phoneW * 0.06}px 0`, direction: "rtl", transition: "none" }}>
              <div style={{ width: phoneW * 0.16, height: phoneW * 0.16, borderRadius: "50%", background: branded > 0.5 ? palette.accent : "#c3c8d2", transform: `scale(${0.8 + 0.2 * branded})`, flex: "none" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: phoneH * 0.006, opacity: branded }}>
                <Line size={W * 0.04} weight={800} color="#ffffff">הסוכן/ת שלך</Line>
                <Line size={W * 0.032} weight={600} color="#dbe3f5">המשרד שלך</Line>
              </div>
            </div>
            {/* feed */}
            <div style={{ position: "absolute", top: phoneH * 0.18, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: phoneH * 0.025, opacity: feedOut }}>
              {[0, 1, 2].map((i) => (frame >= noAt + 12 && i === 1 ? null : <PropertyCard key={i} i={i} />))}
            </div>
            {/* calendar */}
            {frame >= calAt ? (
              <div style={{ position: "absolute", top: phoneH * 0.2, left: phoneW * 0.06, right: phoneW * 0.06, background: "#ffffff", borderRadius: phoneW * 0.06, padding: phoneW * 0.05, display: "flex", flexDirection: "column", gap: phoneH * 0.018, direction: "rtl", ...enter(frame, calAt, fps, H, 1.06) }}>
                <div style={{ display: "flex", alignItems: "center", gap: phoneW * 0.03 }}>
                  <CalendarGlyph size={W * 0.06} color={palette.hero} fill="#ffffff" />
                  <Line size={W * 0.045} weight={800}>יומן</Line>
                </div>
                {[0, 1, 2, 3, 4].map((i) => {
                  const hit = i === 2;
                  const lit = hit ? spring({ frame: frame - (meetAt - 2), fps, config: snappy }) : 0;
                  return (
                    <div key={i} style={{ height: phoneH * 0.06, borderRadius: phoneW * 0.03, background: lit > 0.5 ? palette.accent : palette.soft, display: "flex", alignItems: "center", gap: phoneW * 0.03, padding: `0 ${phoneW * 0.04}px`, transform: `scale(${1 + 0.05 * Math.sin(Math.min(lit, 1) * Math.PI)})` }}>
                      {hit && lit > 0.5 ? (
                        <>
                          <HouseGlyph size={W * 0.045} color={palette.ink} />
                          <Line size={W * 0.036} weight={800}>סיור בנכס</Line>
                        </>
                      ) : (
                        <div style={{ width: `${40 + ((i * 23) % 35)}%`, height: phoneH * 0.012, borderRadius: W, background: palette.line }} />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {/* taps on the phone */}
      <Sequence from={0} layout="none">
        <Tap at={loveAt} x={0.64} y={0.474} />
        <Tap at={noAt} x={0.31} y={0.715} />
      </Sequence>

      {/* Scene 8: the chain, the payoff and the logo */}
      <SceneFrame from={payoff.startFrame} durationInFrames={payoff.durationFrames}>
        {(() => {
          const f = frame - payoff.startFrame;
          const logoP = spring({ frame: f - onWord(payoff, "הצטרפו"), fps, config: { damping: 12, stiffness: 140 } });
          return (
            <AbsoluteFill>
              <div style={{ position: "absolute", top: H * 0.12, width: "100%", display: "flex", justifyContent: "center", gap: W * 0.035, direction: "rtl" }}>
                {chain.map((c, i) => {
                  const at = 6 + i * 4;
                  const p = spring({ frame: f - at, fps, config: snappy });
                  return (
                    <div key={c.name} style={{ width: W * 0.13, height: W * 0.13, borderRadius: "50%", background: i === chain.length - 1 ? palette.accent : palette.hero, display: "flex", alignItems: "center", justifyContent: "center", opacity: interpolate(f - at, [0, 2], [0, 1], clamp), transform: `scale(${0.6 + 0.4 * p})` }}>
                      <Icon name={c.name} size={W * 0.06} color={i === chain.length - 1 ? palette.ink : "#ffffff"} />
                    </div>
                  );
                })}
              </div>
              <div style={{ position: "absolute", top: H * 0.3, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.012 }}>
                {f >= onWord(payoff, "שיתופי") ? <div style={enter(f, onWord(payoff, "שיתופי"), fps, H, 1.12)}><Line size={W * 0.085} weight={800} color={palette.hero}>יותר שיתופי פעולה</Line></div> : null}
                {f >= onWord(payoff, "עסקאות") ? <div style={enter(f, onWord(payoff, "עסקאות"), fps, H, 1.2)}><Line size={W * 0.085} weight={800} color={palette.hero}>יותר <span style={{ color: palette.accent }}>עסקאות</span></Line></div> : null}
              </div>
              {f >= onWord(payoff, "הצטרפו") ? (
                <div style={{ position: "absolute", top: H * 0.5, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.02 }}>
                  <Img src={urls[IMG.logo]} style={{ height: H * 0.13, opacity: interpolate(f - onWord(payoff, "הצטרפו"), [0, 2], [0, 1], clamp), transform: `translateY(${(1 - logoP) * H * 0.02}px) scale(${1.15 - 0.15 * logoP})` }} />
                  <div style={enter(f, onWord(payoff, "הצטרפו") + 4, fps, H, 1.06)}>
                    <Line size={W * 0.07} weight={800} color={palette.hero}>הצטרפו לשוק נדל״ן</Line>
                  </div>
                </div>
              ) : null}
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.whoosh]} at={4} volume={0.18} />
        <Sfx src={urls[SFX.riser]} at={Math.max(0, wordFrame(payoff, "הצטרפו") - 60)} volume={0.18} />
        <Sfx src={urls[SFX.impact]} at={wordFrame(payoff, "הצטרפו")} volume={0.28} />
        {voice(payoff)}
      </SceneFrame>

      {/* The client card, carried from scene 1 into the chat in scene 3 */}
      {cardVisible ? (
        <div style={{ position: "absolute", left: cardBox.x * W - (cardBox.w * W) / 2, top: cardBox.y * H - (cardBox.h * H) / 2, width: cardBox.w * W, height: cardBox.h * H, opacity: interpolate(frame, [gabEnd - 6, gabEnd], [1, 0], clamp) * interpolate(frame, [0, 2], [0, 1], clamp), transform: `scaleX(${Math.max(0.02, flipScale)})` }}>
          <div style={{ width: "100%", height: "100%", borderRadius: W * 0.05, background: cardBg, boxShadow: "0 24px 60px rgba(13,27,61,0.16)", overflow: isBubble ? "hidden" : "visible", position: "relative", filter: frame >= rewindAt - 2 && frame < rewindAt + 8 ? `blur(${interpolate(frame, [rewindAt - 2, rewindAt + 2, rewindAt + 8], [0, 6, 0], clamp)}px)` : undefined }}>
            <div style={{ width: DESIGN, height: (cardBox.h * H) / cardScale, display: "flex", flexDirection: "column", justifyContent: "center", transform: `scale(${cardScale})`, transformOrigin: "top right", position: "absolute", top: 0, right: 0 }}>{content}</div>
          </div>
        </div>
      ) : null}

      {/* Gabriela's portrait, then her avatar in the corner */}
      {frame >= gabIn && frame < payoff.startFrame + 14 ? (
        <div style={{ position: "absolute", left: av.x * W - (av.w * W) / 2, top: av.y * H - (av.h * H) / 2, width: av.w * W, height: av.h * H, borderRadius: (av.r ?? 0.05) * W, overflow: "hidden", opacity: (av.o ?? 1) * interpolate(frame - gabIn, [0, 2], [0, 1], clamp), transform: `translateY(${(1 - avIn) * H * 0.02}px)`, boxShadow: "0 18px 40px rgba(13,27,61,0.22)", border: `${W * 0.007}px solid #ffffff` }}>
          <Img src={urls[IMG.portrait]} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 18%" }} />
        </div>
      ) : null}
      {frame >= gabIn && frame < gabEnd ? (
        <div style={{ position: "absolute", top: H * 0.325, left: 0, width: W, display: "flex", justifyContent: "center", ...enter(frame, gabIn + 6, fps, H, 1.2), opacity: interpolate(frame, [gabEnd - 6, gabEnd], [1, 0], clamp) * interpolate(frame - gabIn - 6, [0, 2], [0, 1], clamp) }}>
          <Chip text="העוזרת האישית" size={W * 0.036} />
        </div>
      ) : null}

      {/* the "automatic" badge, from the first click to the end */}
      {frame >= badgeAt && !(square && frame >= payoff.startFrame + 6) ? (
        <div style={{ position: "absolute", top: H * (square ? 0.1 : 0.035), left: W * 0.05, ...enter(frame, badgeAt, fps, H, 1.2) }}>
          <Chip text="אוטומטי" size={W * 0.036} />
        </div>
      ) : null}

      </div>
      {square
        ? manifest.scenes.map((s) => (
            <SceneFrame key={s.id} from={s.startFrame} durationInFrames={s.durationFrames} enter="cut" exit="cut">
              <Captions words={s.words} group={manifest.captions} rtl face={heebo} highlight={palette.accent} mode="highlight" bottom={0.03} />
            </SceneFrame>
          ))
        : null}
      {manifest.music ? <Music src={urls[manifest.music.key]} duckTo={0.32} /> : null}
      <Grain blend="multiply" opacity={0.05} />
      <Vignette strength={0.12} />
    </AbsoluteFill>
  );
};

// Scene-local frame for elements written with the absolute clock.
function useLocal(frame: number, start: number) {
  return frame - start;
}
