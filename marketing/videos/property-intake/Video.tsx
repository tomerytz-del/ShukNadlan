import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";
import { BgMesh, Captions, Grain, Icon, Music, SceneFrame, Sfx, Vignette, Voiceover, font, onWord, sceneById, wordFrame } from "reelkit/kit";
import type { VideoProps } from "reelkit/kit";

// Same series as "call-to-meeting": sapphire pin + gold shin, on a warm off-white ground.
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
  live: "#16a34a",
  pins: ["#0e2a6b", "#c9a227", "#0f766e", "#e5484d", "#6d28d9", "#ea580c"],
};
const heebo = font("heebo");

const SFX = {
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
  logo: "assets/user/a-2ade9cc5-logo-shuknadlan.png",
  portrait: "assets/user/a-d0f11836-gabriela-portrait.jpg",
  face: "assets/user/a-7d83ccb6-gabriela-face.jpg",
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
const shown = (frame: number, at: number, fps: number, H: number, from = 1.08) => (frame >= at ? enter(frame, at, fps, H, from) : { opacity: 0 });

const Line: React.FC<{ size: number; weight?: number; color?: string; style?: React.CSSProperties; children: React.ReactNode }> = ({ size, weight = 700, color = palette.ink, style, children }) => (
  <div style={{ fontFamily: heebo, fontSize: size, fontWeight: weight, color, direction: "rtl", whiteSpace: "nowrap", lineHeight: 1.15, ...style }}>{children}</div>
);

// A tap: a ring that expands and fades where a finger touches the screen. x, y are fractions of the 9:16 stage.
const Tap: React.FC<{ at: number; x: number; y: number; W: number; H: number; color?: string }> = ({ at, x, y, W, H, color = palette.accent }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < -6 || t > 16) return null;
  const finger = interpolate(t, [-6, 0, 6, 12], [0, 1, 1, 0], clamp);
  const ring = interpolate(t, [0, 14], [0.3, 1.6], clamp);
  const d = W * 0.09;
  return (
    <div style={{ position: "absolute", left: x * W - d / 2, top: y * H - d / 2, width: d, height: d }}>
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

const HouseGlyph: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 48 48">
    <path d="M7 22L24 8l17 14v18a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3z" fill={color} />
    <rect x="19" y="29" width="10" height="14" rx="2" fill="#fff" opacity="0.85" />
  </svg>
);

const CheckGlyph: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke={color} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PlusGlyph: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <path d="M12 5v14M5 12h14" fill="none" stroke={color} strokeWidth="3.4" strokeLinecap="round" />
  </svg>
);

// Two hands meeting: the co-op button.
const HandshakeGlyph: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 48 48">
    <path d="M4 18l9-6 8 4 6-3 8 2 9 6" fill="none" stroke={color} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 26l8 8c1.6 1.6 3.8 1.6 5 .4l9-9c1.4-1.4 1.2-3.4-.4-4.4l-5-3-6 4c-1.6 1-3.4.4-4-1" fill="none" stroke={color} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M38 24l-8 8M33 33l-4 4" fill="none" stroke={color} strokeWidth="3.6" strokeLinecap="round" />
  </svg>
);

const Sparkle: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <path d="M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4z" fill={color} />
  </svg>
);

export const Video: React.FC<VideoProps> = ({ manifest, urls }) => {
  const frame = useCurrentFrame();
  const real = useVideoConfig();
  const fps = real.fps;
  // Laid out on a 9:16 stage. In a square frame (feed posts) the stage is scaled down to the band that holds every
  // scene's content; the captions and the avatar sit on the square frame itself.
  const square = real.height / real.width < 1.2;
  const W = real.width;
  const H = square ? Math.round((real.width * 16) / 9) : real.height;
  const STAGE = square ? 0.66 : 1;
  const WIN_TOP = square ? 130 : 0;
  const AV_Y = square ? 0.11 : 0.055;

  const hook = sceneById(manifest, "hook");
  const intake = sceneById(manifest, "intake");
  const live = sceneById(manifest, "live");
  const ai = sceneById(manifest, "ai");
  const alerts = sceneById(manifest, "alerts");
  const coop = sceneById(manifest, "coop");
  const payoff = sceneById(manifest, "payoff");
  type S = typeof hook;

  // Absolute frames of the moments the story turns on.
  const on = (s: S, w: string, o?: { nth?: number }) => s.startFrame + onWord(s, w, o);

  const clickAt = on(intake, "ובלחיצה");
  const savedAt = on(intake, "במאגר");
  const crmAt = on(intake, "ב-CRM");
  const liveAt = on(live, "באוויר");
  const vizAt = on(ai, "הדמיות");
  const descAt = on(ai, "תיאור");
  const coopAt = on(coop, "שת״פ");

  const voice = (s: S) => (
    <>
      {square ? null : <Captions words={s.words} group={manifest.captions} rtl face={heebo} highlight={palette.accent} mode="highlight" />}
      {s.voiceoverKey ? <Voiceover src={urls[s.voiceoverKey]} /> : null}
    </>
  );

  // ---------- The property card: one object from the first frame to the payoff ----------
  const top = { x: 0.5, y: 0.2, w: 0.5, h: 0.19 };
  const cardKeys: Key[] = [
    { f: 0, x: 0.5, y: 0.42, w: 0.78, h: 0.3 },
    { f: hook.startFrame + hook.durationFrames - 4, x: 0.5, y: 0.42, w: 0.78, h: 0.3 },
    { f: intake.startFrame + 6, x: 0.5, y: 0.5, w: 0.5, h: 0.19, o: 0 },
    { f: clickAt + 2, x: 0.5, y: 0.66, w: 0.3, h: 0.115, o: 0 },
    { f: clickAt + 14, ...top, o: 1 },
    { f: live.startFrame, ...top, o: 1 },
    { f: liveAt, x: 0.5, y: 0.47, w: 0.62, h: 0.236, o: 1 },
    { f: ai.startFrame + 2, x: 0.5, y: 0.47, w: 0.62, h: 0.236, o: 1 },
    { f: vizAt + 2, x: 0.5, y: 0.37, w: 0.84, h: 0.4, o: 1 },
    { f: alerts.startFrame + 2, x: 0.5, y: 0.37, w: 0.84, h: 0.4, o: 1 },
    { f: alerts.startFrame + 14, ...top, o: 1 },
    { f: payoff.startFrame + 2, ...top, o: 1 },
    { f: payoff.startFrame + 12, ...top, o: 0 },
  ];
  const cardBox = tween(frame, fps, cardKeys);
  const DESIGN = W * 0.78; // the card is drawn at this width and scaled to the box
  const cardScale = (cardBox.w * W) / DESIGN;
  const designH = (cardBox.h * H) / cardScale;

  // Before / after: the bare room becomes a staged one on "הדמיות".
  const wipe = interpolate(frame, [vizAt, vizAt + 14], [0, 1], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
  const descText = "דירת 4 חדרים מוארת, מרפסת שמש ונוף פתוח";
  const typed = Math.round(interpolate(frame, [descAt, descAt + 28], [0, descText.length], clamp));
  const showDesc = frame >= descAt && frame < alerts.startFrame + 6;
  const photoH = showDesc ? designH * 0.62 : designH * 0.68;
  const inDb = frame >= savedAt;
  const isLive = frame >= liveAt;

  const room = (staged: boolean) => (
    <div style={{ position: "absolute", inset: 0, background: staged ? "linear-gradient(160deg, #f3e7c9 0%, #e9d9b4 55%, #c9b48a 100%)" : "linear-gradient(160deg, #e8e8e6 0%, #d8d8d4 60%, #c4c4bf 100%)" }}>
      {/* floor and window */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "30%", background: staged ? "#b08d5b" : "#bdbab2" }} />
      <div style={{ position: "absolute", right: "12%", top: "14%", width: "26%", height: "38%", borderRadius: DESIGN * 0.012, background: staged ? "#bfe0f5" : "#e4eef4", border: `${DESIGN * 0.01}px solid #ffffff` }} />
      {staged ? (
        <>
          {/* sofa, rug, lamp, plant */}
          <div style={{ position: "absolute", left: "14%", bottom: "20%", width: "44%", height: "22%", borderRadius: DESIGN * 0.03, background: palette.hero }} />
          <div style={{ position: "absolute", left: "17%", bottom: "36%", width: "38%", height: "12%", borderRadius: DESIGN * 0.03, background: "#1f3f86" }} />
          <div style={{ position: "absolute", left: "8%", bottom: "6%", width: "60%", height: "9%", borderRadius: "50%", background: palette.accent, opacity: 0.8 }} />
          <div style={{ position: "absolute", left: "64%", bottom: "20%", width: "3%", height: "34%", background: palette.ink }} />
          <div style={{ position: "absolute", left: "60%", bottom: "52%", width: "11%", height: "9%", borderRadius: `${DESIGN * 0.03}px ${DESIGN * 0.03}px 0 0`, background: "#fff4cf" }} />
          <div style={{ position: "absolute", right: "6%", bottom: "20%", width: "10%", height: "26%", borderRadius: "50% 50% 10% 10%", background: "#2f7d5b" }} />
        </>
      ) : null}
    </div>
  );

  const cardContent = (
    <div style={{ width: DESIGN, height: designH, display: "flex", flexDirection: "column", direction: "rtl" }}>
      <div style={{ position: "relative", height: photoH, overflow: "hidden", flex: "none" }}>
        {frame < vizAt ? (
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, #c7d3ea, #ffffff)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <HouseGlyph size={DESIGN * 0.2} color={palette.hero} />
          </div>
        ) : (
          <>
            {room(false)}
            <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 0 0 ${(1 - wipe) * 100}%)` }}>{room(true)}</div>
            {wipe > 0 && wipe < 1 ? <div style={{ position: "absolute", top: 0, bottom: 0, left: `${(1 - wipe) * 100}%`, width: DESIGN * 0.008, background: "#ffffff", boxShadow: "0 0 18px rgba(255,255,255,0.9)" }} /> : null}
            <div style={{ position: "absolute", top: DESIGN * 0.035, right: DESIGN * 0.035, ...enter(frame, vizAt + 6, fps, H, 1.2) }}>
              <Chip text="הדמיית AI" size={DESIGN * 0.045} bg={palette.hero} color="#ffffff" icon={<Sparkle size={DESIGN * 0.045} color={palette.accent} />} />
            </div>
          </>
        )}
        {isLive && frame < vizAt ? (
          <div style={{ position: "absolute", top: DESIGN * 0.035, right: DESIGN * 0.035, ...enter(frame, liveAt, fps, H, 1.25) }}>
            <Chip text="חדש" size={DESIGN * 0.05} />
          </div>
        ) : null}
      </div>
      <div style={{ flex: 1, background: palette.card, padding: `${DESIGN * 0.035}px ${DESIGN * 0.05}px`, display: "flex", flexDirection: "column", justifyContent: "center", gap: DESIGN * 0.018 }}>
        <div style={{ display: "flex", alignItems: "center", gap: DESIGN * 0.03 }}>
          <Line size={DESIGN * 0.068} weight={800}>נכס חדש · 4 חדרים</Line>
          <div style={{ flex: 1 }} />
          {inDb && frame < live.startFrame + 4 ? (
            <div style={enter(frame, savedAt, fps, H, 1.25)}>
              <Chip text="במאגר" size={DESIGN * 0.048} icon={<CheckGlyph size={DESIGN * 0.05} color={palette.ink} />} />
            </div>
          ) : null}
        </div>
        {showDesc ? (
          <Line size={DESIGN * 0.044} weight={600} color={palette.ink}>
            {descText.slice(0, typed)}
            <span style={{ opacity: frame < descAt + 30 && Math.floor(frame / 6) % 2 === 0 ? 1 : 0, color: palette.accent }}>|</span>
          </Line>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: DESIGN * 0.016 }}>
            <div style={{ width: DESIGN * 0.5, height: DESIGN * 0.028, borderRadius: DESIGN, background: palette.line }} />
            <div style={{ width: DESIGN * 0.32, height: DESIGN * 0.028, borderRadius: DESIGN, background: palette.line }} />
          </div>
        )}
      </div>
    </div>
  );
  const cardVisible = frame < payoff.startFrame + 14 && (cardBox.o ?? 1) > 0.01;

  // ---------- Gabriela: in the chat in scene 2, then an avatar in the corner ----------
  const chatOut = crmAt - 2;
  const avatarKeys: Key[] = [
    { f: chatOut, x: 0.885, y: AV_Y, w: 0.13, h: 0.073, o: 0 },
    { f: chatOut + 10, x: 0.885, y: AV_Y, w: 0.13, h: 0.073, o: 1 },
    { f: payoff.startFrame + 2, x: 0.885, y: AV_Y, w: 0.13, h: 0.073, o: 1 },
    { f: payoff.startFrame + 12, x: 0.885, y: AV_Y, w: 0.13, h: 0.073, o: 0 },
  ];
  const av = tween(frame, fps, avatarKeys, 10);

  // ---------- Hook: buyers converge on the card ----------
  const buyersAt = on(hook, "הקונים");
  const buyers = [
    { from: [-0.15, 0.5], to: [0.2, 0.625] },
    { from: [1.15, 0.5], to: [0.8, 0.625] },
    { from: [-0.15, 0.75], to: [0.32, 0.625] },
    { from: [1.15, 0.75], to: [0.68, 0.625] },
    { from: [0.4, 1.05], to: [0.44, 0.625] },
    { from: [0.6, 1.05], to: [0.56, 0.625] },
  ];

  // ---------- Coop: offices across the map ----------
  const pinPos = [
    { x: 0.24, y: 0.52 }, { x: 0.62, y: 0.49 }, { x: 0.8, y: 0.6 }, { x: 0.42, y: 0.63 }, { x: 0.18, y: 0.69 }, { x: 0.66, y: 0.7 },
  ];
  const chain: React.ReactNode[] = [
    <HouseGlyph key="h" size={W * 0.065} color="#ffffff" />,
    <Sparkle key="s" size={W * 0.06} color="#ffffff" />,
    <Icon key="f" name="facebook" size={W * 0.055} color="#ffffff" />,
    <Icon key="b" name="bell" size={W * 0.06} color="#ffffff" />,
    <HandshakeGlyph key="c" size={W * 0.075} color={palette.ink} />,
  ];

  return (
    <AbsoluteFill style={{ background: palette.bg }}>
      <style>{"*{box-sizing:border-box}"}</style>
      <BgMesh bg={palette.bg} hero={palette.hero} accent={palette.accent} />
      <div style={{ position: "absolute", left: (W - W * STAGE) / 2, top: -WIN_TOP * STAGE, width: W, height: H, transform: `scale(${STAGE})`, transformOrigin: "top left" }}>

      {/* Scene 1: a new listing, and the buyers are already on their way */}
      <SceneFrame from={hook.startFrame} durationInFrames={hook.durationFrames} exit="cut">
        {(() => {
          const f = frame - hook.startFrame;
          return (
            <AbsoluteFill>
              <div style={{ position: "absolute", top: H * 0.15, width: "100%", display: "flex", justifyContent: "center", ...shown(f, onWord(hook, "גייסת"), fps, H, 1.2) }}>
                <Line size={W * 0.095} weight={800} color={palette.hero}>גייסת נכס?</Line>
              </div>
              <div style={{ position: "absolute", top: H * 0.675, width: "100%", display: "flex", justifyContent: "center", ...shown(f, onWord(hook, "הקונים"), fps, H, 1.2) }}>
                <Line size={W * 0.085} weight={800} color={palette.hero}>
                  הקונים <span style={{ color: palette.accent }}>כבר בדרך!</span>
                </Line>
              </div>
              {buyers.map((b, i) => {
                const at = onWord(hook, "הקונים") + i * 2;
                const p = interpolate(f, [at, at + 14], [0, 1], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
                const s = W * 0.1;
                const x = (b.from[0] + (b.to[0] - b.from[0]) * p) * W;
                const y = (b.from[1] + (b.to[1] - b.from[1]) * p) * H;
                return f >= at ? (
                  <div key={i} style={{ position: "absolute", left: x - s / 2, top: y - s / 2, width: s, height: s, borderRadius: "50%", background: palette.pins[i], border: `${W * 0.006}px solid #ffffff`, boxShadow: "0 10px 24px rgba(13,27,61,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name="user" size={s * 0.55} color="#ffffff" />
                  </div>
                ) : null;
              })}
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.impact]} at={2} volume={0.24} />
        <Sfx src={urls[SFX.whoosh]} at={wordFrame(hook, "הקונים") - 2} volume={0.22} />
        <Sfx src={urls[SFX.pop]} at={wordFrame(hook, "בדרך")} volume={0.2} />
        {voice(hook)}
      </SceneFrame>

      {/* Scene 2: signed, one click and it is in the catalogue; or a message to Gabriela; or the CRM */}
      <SceneFrame from={intake.startFrame} durationInFrames={intake.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - intake.startFrame;
          const sign = onWord(intake, "מחתימים");
          const click = onWord(intake, "ובלחיצה");
          const gab = onWord(intake, "לגבריאלה") - 4;
          const crm = onWord(intake, "ב-CRM") - 3;
          const draw = interpolate(f, [sign + 2, sign + 18], [0, 1], clamp);
          const docOut = interpolate(f, [gab - 2, gab + 6], [0, 1], clamp);
          const chatOn = f >= gab && f < crm + 2;
          const chatP = spring({ frame: f - gab, fps, config: smooth });
          const crmP = spring({ frame: f - crm, fps, config: smooth });
          const panel = { left: W * 0.08, top: H * 0.335, width: W * 0.84, height: H * 0.4 };
          return (
            <AbsoluteFill>
              {/* the agreement */}
              {docOut < 1 ? (
                <div style={{ position: "absolute", ...panel, background: "#ffffff", borderRadius: W * 0.045, boxShadow: "0 20px 50px rgba(13,27,61,0.14)", padding: W * 0.06, display: "flex", flexDirection: "column", gap: H * 0.016, direction: "rtl", opacity: interpolate(f, [0, 3], [0, 1], clamp) * (1 - docOut), transform: `translateX(${docOut * -W * 0.3}px)` }}>
                  <Line size={W * 0.052} weight={800}>הסכם בלעדיות</Line>
                  {[78, 92, 64, 85].map((w, i) => (
                    <div key={i} style={{ width: `${w}%`, height: H * 0.011, borderRadius: W, background: palette.line }} />
                  ))}
                  <div style={{ height: H * 0.075, borderBottom: `${W * 0.004}px solid ${palette.line}`, position: "relative", width: "62%" }}>
                    <svg width="100%" height="100%" viewBox="0 0 200 60" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
                      <path d="M8 44 C 22 6, 34 6, 38 40 S 58 52, 66 24 S 84 4, 92 38 S 120 54, 132 26 C 140 12, 150 16, 152 34 S 176 44, 192 18" fill="none" stroke={palette.hero} strokeWidth="4" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
                    </svg>
                  </div>
                  <Line size={W * 0.034} weight={600} color={palette.dim}>חתימת הבעלים</Line>
                  <div style={{ flex: 1 }} />
                  <div style={{ alignSelf: "center", display: "flex", alignItems: "center", gap: W * 0.02, padding: `${H * 0.014}px ${W * 0.05}px`, borderRadius: W * 0.03, background: f >= click ? palette.accent : palette.hero, color: f >= click ? palette.ink : "#ffffff", fontFamily: heebo, fontWeight: 800, fontSize: W * 0.045, whiteSpace: "nowrap", transform: `scale(${1 - 0.06 * Math.sin(interpolate(f, [click, click + 8], [0, Math.PI], clamp))})` }}>
                    <PlusGlyph size={W * 0.045} color={f >= click ? palette.ink : "#ffffff"} />
                    <span>הוספת הנכס למאגר שלי</span>
                  </div>
                </div>
              ) : null}

              {/* a message to Gabriela */}
              {chatOn ? (
                <div style={{ position: "absolute", ...panel, background: "#efeae2", borderRadius: W * 0.045, overflow: "hidden", boxShadow: "0 20px 50px rgba(13,27,61,0.16)", opacity: interpolate(f - gab, [0, 3], [0, 1], clamp) * interpolate(f, [crm - 3, crm + 2], [1, 0], clamp), transform: `translateX(${(1 - chatP) * W * 0.3}px)` }}>
                  <div style={{ height: H * 0.07, background: "#ffffff", display: "flex", alignItems: "center", gap: W * 0.025, padding: `0 ${W * 0.04}px`, direction: "rtl" }}>
                    <Img src={urls[IMG.face]} style={{ width: H * 0.05, height: H * 0.05, borderRadius: "50%", objectFit: "cover" }} />
                    <Line size={W * 0.045} weight={800}>גבריאלה</Line>
                    <div style={{ flex: 1 }} />
                    <Icon name="whatsapp" size={W * 0.06} color="brand" />
                  </div>
                  <div style={{ position: "absolute", right: W * 0.04, top: H * 0.1, width: W * 0.6, background: palette.waBubble, borderRadius: W * 0.035, padding: W * 0.035, direction: "rtl", ...shown(f, gab + 2, fps, H, 1.05) }}>
                    <Line size={W * 0.04} weight={700}>תעלי נכס: 4 חדרים, מרפסת</Line>
                    <Line size={W * 0.04} weight={700}>+ 6 תמונות</Line>
                  </div>
                  <div style={{ position: "absolute", left: W * 0.04, top: H * 0.24, background: "#ffffff", borderRadius: W * 0.035, padding: W * 0.035, display: "flex", alignItems: "center", gap: W * 0.02, direction: "rtl", ...shown(f, gab + 10, fps, H, 1.05) }}>
                    <CheckGlyph size={W * 0.045} color={palette.live} />
                    <Line size={W * 0.04} weight={700}>הנכס במאגר</Line>
                  </div>
                </div>
              ) : null}

              {/* or the CRM */}
              {f >= crm ? (
                <div style={{ position: "absolute", ...panel, background: "#ffffff", borderRadius: W * 0.045, boxShadow: "0 20px 50px rgba(13,27,61,0.14)", padding: W * 0.06, display: "flex", flexDirection: "column", gap: H * 0.018, direction: "rtl", opacity: interpolate(f - crm, [0, 3], [0, 1], clamp), transform: `translateX(${(1 - crmP) * W * 0.3}px)` }}>
                  <Line size={W * 0.052} weight={800}>נכס חדש</Line>
                  {["כתובת", "חדרים", "מחיר"].map((l) => (
                    <div key={l} style={{ display: "flex", alignItems: "center", gap: W * 0.03 }}>
                      <Line size={W * 0.036} weight={700} color={palette.dim} style={{ width: W * 0.14 }}>{l}</Line>
                      <div style={{ flex: 1, height: H * 0.038, borderRadius: W * 0.02, background: palette.soft }} />
                    </div>
                  ))}
                  <div style={{ flex: 1 }} />
                  <div style={{ alignSelf: "center", padding: `${H * 0.014}px ${W * 0.08}px`, borderRadius: W * 0.03, background: palette.hero, color: "#ffffff", fontFamily: heebo, fontWeight: 800, fontSize: W * 0.045, whiteSpace: "nowrap" }}>פרסום הנכס</div>
                </div>
              ) : null}
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.whoosh]} at={0} volume={0.18} />
        <Sfx src={urls[SFX.sparkle]} at={wordFrame(intake, "מחתימים") + 2} volume={0.16} />
        <Sfx src={urls[SFX.tap]} at={wordFrame(intake, "ובלחיצה")} volume={0.26} />
        <Sfx src={urls[SFX.chime]} at={wordFrame(intake, "במאגר")} volume={0.22} />
        <Sfx src={urls[SFX.send]} at={wordFrame(intake, "לגבריאלה") - 4} volume={0.22} />
        <Sfx src={urls[SFX.tap]} at={wordFrame(intake, "ב-CRM") + 4} volume={0.22} />
        {voice(intake)}
      </SceneFrame>
      <Tap at={clickAt} x={0.5} y={0.66} W={W} H={H} />
      <Tap at={crmAt + 4} x={0.5} y={0.682} W={W} H={H} />

      {/* Scene 3: live on the site within seconds */}
      <SceneFrame from={live.startFrame} durationInFrames={live.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - live.startFrame;
          const p = spring({ frame: f, fps, config: smooth });
          const la = onWord(live, "באוויר");
          return (
            <AbsoluteFill>
              <div style={{ position: "absolute", left: W * 0.08, top: H * 0.27, width: W * 0.84, height: H * 0.47, background: "#ffffff", borderRadius: W * 0.04, overflow: "hidden", boxShadow: "0 24px 60px rgba(13,27,61,0.16)", opacity: interpolate(f, [0, 3], [0, 1], clamp), transform: `translateY(${(1 - p) * H * 0.03}px)` }}>
                <div style={{ height: H * 0.05, background: palette.soft, display: "flex", alignItems: "center", gap: W * 0.02, padding: `0 ${W * 0.035}px` }}>
                  {["#e5484d", "#f5b83d", "#2fb344"].map((c) => <div key={c} style={{ width: W * 0.022, height: W * 0.022, borderRadius: "50%", background: c }} />)}
                  <div style={{ flex: 1, height: H * 0.03, borderRadius: W, background: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: heebo, fontWeight: 700, fontSize: W * 0.032, color: palette.dim, direction: "ltr" }}>shuknadlan.co.il</div>
                </div>
                {/* other listings under the new one */}
                <div style={{ position: "absolute", left: W * 0.04, right: W * 0.04, bottom: H * 0.02, display: "flex", gap: W * 0.03 }}>
                  {[0, 1].map((i) => (
                    <div key={i} style={{ flex: 1, height: H * 0.07, borderRadius: W * 0.025, background: palette.soft, opacity: 0.8 }} />
                  ))}
                </div>
              </div>
              <div style={{ position: "absolute", top: H * 0.15, width: "100%", display: "flex", justifyContent: "center", ...shown(f, la, fps, H, 1.25) }}>
                <Chip text="באוויר באתר" size={W * 0.05} bg={palette.hero} color="#ffffff" icon={<div style={{ width: W * 0.028, height: W * 0.028, borderRadius: "50%", background: "#4ade80", boxShadow: `0 0 0 ${W * 0.008 * (1 + Math.sin(f * 0.4))}px rgba(74,222,128,0.35)` }} />} />
              </div>
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.whoosh]} at={2} volume={0.2} />
        <Sfx src={urls[SFX.impact]} at={wordFrame(live, "באוויר")} volume={0.24} />
        {voice(live)}
      </SceneFrame>

      {/* Scene 4: AI staging, a description that writes itself, a post on Facebook and Instagram */}
      <SceneFrame from={ai.startFrame} durationInFrames={ai.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - ai.startFrame;
          const fb = onWord(ai, "בפייסבוק"), ig = onWord(ai, "ובאינסטגרם");
          const icon = (at: number, name: "facebook" | "instagram") => {
            const p = spring({ frame: f - at, fps, config: snappy });
            return (
              <div style={{ width: W * 0.17, height: W * 0.17, borderRadius: W * 0.045, background: "#ffffff", boxShadow: "0 14px 34px rgba(13,27,61,0.16)", display: "flex", alignItems: "center", justifyContent: "center", opacity: interpolate(f - at, [0, 2], [0, 1], clamp), transform: `scale(${0.5 + 0.5 * p}) rotate(${(1 - p) * -12}deg)` }}>
                <Icon name={name} size={W * 0.1} color="brand" />
              </div>
            );
          };
          return (
            <AbsoluteFill>
              <div style={{ position: "absolute", top: H * 0.615, width: "100%", display: "flex", justifyContent: "center", gap: W * 0.06 }}>
                {f >= ig ? icon(ig, "instagram") : null}
                {f >= fb ? icon(fb, "facebook") : null}
              </div>
              <div style={{ position: "absolute", top: H * 0.73, width: "100%", display: "flex", justifyContent: "center", ...shown(f, fb + 4, fps, H, 1.1) }}>
                <Line size={W * 0.04} weight={700} color={palette.dim}>פוסט בעמודים של שוק נדל״ן</Line>
              </div>
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.sparkle]} at={wordFrame(ai, "הדמיות")} volume={0.22} />
        <Sfx src={urls[SFX.tap]} at={wordFrame(ai, "תיאור")} volume={0.16} />
        <Sfx src={urls[SFX.pop]} at={wordFrame(ai, "בפייסבוק")} volume={0.22} />
        <Sfx src={urls[SFX.pop]} at={wordFrame(ai, "ובאינסטגרם")} volume={0.2} />
        {voice(ai)}
      </SceneFrame>

      {/* Scene 5: buyers who searched for exactly this get an alert */}
      <SceneFrame from={alerts.startFrame} durationInFrames={alerts.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - alerts.startFrame;
          const al = onWord(alerts, "התראה");
          const xs = [0.2, 0.5, 0.8];
          return (
            <AbsoluteFill>
              {xs.map((x, i) => {
                const pin = onWord(alerts, "קונים") + 4 + i * 3;
                const p = spring({ frame: f - pin, fps, config: smooth });
                const pw = W * 0.25, ph = H * 0.25;
                const nAt = al + i * 4;
                const nP = spring({ frame: f - nAt, fps, config: snappy });
                return f >= pin ? (
                  <div key={i} style={{ position: "absolute", left: x * W - pw / 2, top: H * 0.37, width: pw, height: ph, borderRadius: pw * 0.14, background: palette.ink, padding: pw * 0.04, opacity: interpolate(f - pin, [0, 3], [0, 1], clamp), transform: `translateY(${(1 - p) * H * 0.04}px)`, boxShadow: "0 18px 40px rgba(13,27,61,0.22)" }}>
                    <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: pw * 0.1, background: "#f1f3f8", overflow: "hidden" }}>
                      <div style={{ position: "absolute", top: ph * 0.08, width: "100%", display: "flex", justifyContent: "center" }}>
                        <div style={{ width: pw * 0.3, height: pw * 0.3, borderRadius: "50%", background: palette.pins[i * 2], display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Icon name="user" size={pw * 0.18} color="#ffffff" />
                        </div>
                      </div>
                      {f >= nAt ? (
                        <div style={{ position: "absolute", left: pw * 0.05, right: pw * 0.05, top: ph * 0.36, background: "#ffffff", borderRadius: pw * 0.07, padding: pw * 0.05, display: "flex", flexDirection: "column", alignItems: "center", gap: ph * 0.02, boxShadow: "0 6px 16px rgba(13,27,61,0.16)", opacity: interpolate(f - nAt, [0, 2], [0, 1], clamp), transform: `translateY(${(1 - nP) * -ph * 0.1}px) scale(${0.85 + 0.15 * nP})` }}>
                          <div style={{ width: pw * 0.2, height: pw * 0.2, borderRadius: "50%", background: palette.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <Icon name="bell" size={pw * 0.13} color={palette.ink} />
                          </div>
                          <Line size={pw * 0.1} weight={800}>נכס חדש</Line>
                          <Line size={pw * 0.08} weight={600} color={palette.dim}>בדיוק מה שחיפשת</Line>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null;
              })}
              <div style={{ position: "absolute", top: H * 0.66, width: "100%", display: "flex", justifyContent: "center", ...shown(f, al + 8, fps, H, 1.2) }}>
                <Chip text="התראה לקונים" size={W * 0.05} icon={<Icon name="bell" size={W * 0.05} color={palette.ink} />} />
              </div>
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.whoosh]} at={wordFrame(alerts, "קונים") + 4} volume={0.18} />
        <Sfx src={urls[SFX.ping]} at={wordFrame(alerts, "התראה")} volume={0.26} />
        <Sfx src={urls[SFX.ping]} at={wordFrame(alerts, "התראה") + 8} volume={0.16} />
        {voice(alerts)}
      </SceneFrame>

      {/* Scene 6: one click on co-op, and every broker on the platform gets matches */}
      <SceneFrame from={coop.startFrame} durationInFrames={coop.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - coop.startFrame;
          const ca = onWord(coop, "שת״פ");
          const ba = onWord(coop, "המתווכים");
          const ma = onWord(coop, "התאמות");
          const mp = spring({ frame: f - ba + 4, fps, config: smooth });
          const pressed = f >= ca;
          return (
            <AbsoluteFill>
              <div style={{ position: "absolute", top: H * 0.315, width: "100%", display: "flex", justifyContent: "center", ...shown(f, 2, fps, H, 1.1) }}>
                <div style={{ display: "flex", alignItems: "center", gap: W * 0.025, padding: `${H * 0.012}px ${W * 0.07}px`, borderRadius: W, background: pressed ? palette.accent : "#ffffff", border: `${W * 0.005}px solid ${palette.accent}`, fontFamily: heebo, fontWeight: 800, fontSize: W * 0.05, color: palette.ink, whiteSpace: "nowrap", direction: "rtl", boxShadow: "0 10px 26px rgba(13,27,61,0.14)", transform: `scale(${1 - 0.07 * Math.sin(interpolate(f, [ca, ca + 8], [0, Math.PI], clamp))})` }}>
                  <HandshakeGlyph size={W * 0.065} color={palette.ink} />
                  <span>שת״פ</span>
                </div>
              </div>
              {/* the platform's offices */}
              <div style={{ position: "absolute", left: W * 0.08, top: H * 0.41, width: W * 0.84, height: H * 0.34, borderRadius: W * 0.05, background: "#e4ebf6", overflow: "hidden", opacity: mp, transform: `scale(${1.06 - 0.06 * mp})` }}>
                <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
                  {["M0 30 L100 22", "M0 62 L100 70", "M28 0 L36 100", "M70 0 L60 100", "M0 88 L100 80"].map((d) => (
                    <path key={d} d={d} stroke="#ffffff" strokeWidth="3.2" fill="none" />
                  ))}
                </svg>
                <div style={{ position: "absolute", top: H * 0.018, width: "100%", display: "flex", justifyContent: "center", ...shown(f, ma, fps, H, 1.2) }}>
                  <Chip text="התאמות ללקוחות שלהם" size={W * 0.04} bg={palette.hero} color="#ffffff" />
                </div>
              </div>
              {pinPos.map((pp, i) => {
                const pinIn = spring({ frame: f - ba - 2 - i * 2, fps, config: snappy });
                const fa = ma + i * 3;
                const fly = interpolate(f, [fa - 10, fa + 4], [0, 1], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
                const fx = (0.5 + (pp.x - 0.5) * fly) * W;
                const fy = (0.24 + (pp.y - 0.24) * fly - Math.sin(fly * Math.PI) * 0.05) * H;
                const s = W * 0.08;
                const hit = f >= fa + 4;
                return (
                  <React.Fragment key={i}>
                    <div style={{ position: "absolute", left: pp.x * W - s * 0.35, top: pp.y * H - s * 0.9, opacity: pinIn, transform: `scale(${pinIn * (hit ? 1 + 0.2 * Math.sin(interpolate(f, [fa + 4, fa + 12], [0, Math.PI], clamp)) : 1)})`, transformOrigin: "50% 100%" }}>
                      <svg width={s * 0.7} height={s * 0.9} viewBox="0 0 28 36"><path d="M14 35C14 35 2 21 2 13a12 12 0 1 1 24 0c0 8-12 22-12 22z" fill={palette.pins[i]} /><circle cx="14" cy="13" r="4.5" fill="#fff" /></svg>
                    </div>
                    {f >= fa - 10 && f < fa + 6 ? (
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
        <Sfx src={urls[SFX.tap]} at={wordFrame(coop, "שת״פ")} volume={0.28} />
        <Sfx src={urls[SFX.whoosh]} at={wordFrame(coop, "המתווכים") - 2} volume={0.2} />
        <Sfx src={urls[SFX.pop]} at={wordFrame(coop, "התאמות") + 4} volume={0.2} />
        <Sfx src={urls[SFX.pop]} at={wordFrame(coop, "התאמות") + 13} volume={0.16} />
        {voice(coop)}
      </SceneFrame>
      <Tap at={coopAt} x={0.5} y={0.34} W={W} H={H} />

      {/* Scene 7: the chain, the payoff and the logo */}
      <SceneFrame from={payoff.startFrame} durationInFrames={payoff.durationFrames}>
        {(() => {
          const f = frame - payoff.startFrame;
          const ja = onWord(payoff, "הצטרפו");
          const logoP = spring({ frame: f - ja, fps, config: { damping: 12, stiffness: 140 } });
          return (
            <AbsoluteFill>
              <div style={{ position: "absolute", top: H * 0.12, width: "100%", display: "flex", justifyContent: "center", gap: W * 0.035, direction: "rtl" }}>
                {chain.map((c, i) => {
                  const at = 6 + i * 4;
                  const p = spring({ frame: f - at, fps, config: snappy });
                  const last = i === chain.length - 1;
                  return (
                    <div key={i} style={{ width: W * 0.13, height: W * 0.13, borderRadius: "50%", background: last ? palette.accent : palette.hero, display: "flex", alignItems: "center", justifyContent: "center", opacity: interpolate(f - at, [0, 2], [0, 1], clamp), transform: `scale(${0.6 + 0.4 * p})` }}>
                      {c}
                    </div>
                  );
                })}
              </div>
              <div style={{ position: "absolute", top: H * 0.3, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.012 }}>
                <div style={shown(f, onWord(payoff, "שיתופי"), fps, H, 1.12)}><Line size={W * 0.085} weight={800} color={palette.hero}>יותר שיתופי פעולה</Line></div>
                <div style={shown(f, onWord(payoff, "עסקאות"), fps, H, 1.2)}><Line size={W * 0.085} weight={800} color={palette.hero}>יותר <span style={{ color: palette.accent }}>עסקאות</span></Line></div>
              </div>
              {f >= ja ? (
                <div style={{ position: "absolute", top: H * 0.5, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.018 }}>
                  <Img src={urls[IMG.logo]} style={{ height: H * 0.12, opacity: interpolate(f - ja, [0, 2], [0, 1], clamp), transform: `translateY(${(1 - logoP) * H * 0.02}px) scale(${1.15 - 0.15 * logoP})` }} />
                  <div style={enter(f, ja + 4, fps, H, 1.06)}>
                    <Line size={W * 0.068} weight={800} color={palette.hero}>הצטרפו לשוק נדל״ן</Line>
                  </div>
                  <div style={{ ...enter(f, ja + 8, fps, H, 1.04), fontFamily: heebo, fontWeight: 700, fontSize: W * 0.045, color: palette.dim, direction: "ltr" }}>shuknadlan.co.il</div>
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

      {/* The property card, carried from the first frame to the payoff */}
      {cardVisible ? (
        <div style={{ position: "absolute", left: cardBox.x * W - (cardBox.w * W) / 2, top: cardBox.y * H - (cardBox.h * H) / 2, width: cardBox.w * W, height: cardBox.h * H, opacity: (cardBox.o ?? 1) * interpolate(frame, [0, 2], [0, 1], clamp), transform: `scale(${frame < 10 ? 1.08 - 0.08 * spring({ frame, fps, config: snappy }) : 1})` }}>
          <div style={{ width: "100%", height: "100%", borderRadius: W * 0.045, background: palette.card, boxShadow: "0 24px 60px rgba(13,27,61,0.18)", overflow: "hidden", position: "relative", border: isLive ? `${W * 0.005}px solid ${palette.accent}` : `${W * 0.005}px solid #ffffff` }}>
            <div style={{ position: "absolute", top: 0, right: 0, transform: `scale(${cardScale})`, transformOrigin: "top right" }}>{cardContent}</div>
          </div>
        </div>
      ) : null}

      {/* Gabriela's avatar in the corner after the chat */}
      {frame >= chatOut && frame < payoff.startFrame + 14 ? (
        <div style={{ position: "absolute", left: av.x * W - (av.w * W) / 2, top: av.y * H - (av.h * H) / 2, width: av.w * W, height: av.h * H, borderRadius: "50%", overflow: "hidden", opacity: av.o ?? 1, boxShadow: "0 18px 40px rgba(13,27,61,0.22)", border: `${W * 0.007}px solid #ffffff` }}>
          <Img src={urls[IMG.portrait]} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 18%" }} />
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
