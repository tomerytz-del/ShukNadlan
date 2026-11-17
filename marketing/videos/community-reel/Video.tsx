import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";
import { Captions, Grain, Icon, Music, SceneFrame, Sfx, Vignette, Voiceover, font, onWord, sceneById, wordFrame } from "reelkit/kit";
import type { VideoProps } from "reelkit/kit";

// "The smart community of Israel's real estate advisors": a 27 second Reels promo that sends to a lead form.
// Wolf hook, the glowing Israel map that connects, Gabriela and the mentor, one line about closing deals, the logo.
// Key text stays inside the Reels safe zone: the top 14 percent and the bottom 35 percent are covered by Meta's UI,
// so the captions sit at 30 percent from the bottom and every headline between 14 and 62 percent of the height.
const palette = {
  night: "#020817",
  bg: "#F7F4EF", // the logo file's own ground
  ink: "#0d1b3d",
  hero: "#0e2a6b",
  accent: "#c9a227",
  glow: "#38bdf8",
  dim: "#6b7280",
};
const heebo = font("heebo");

const SFX = {
  whoosh: "assets/lib/sfx-ui-soft-whoosh/clip.mp3",
  pop: "assets/lib/sfx-ui-bubble-pop/clip.mp3",
  tap: "assets/lib/sfx-ui-glass-tap/clip.mp3",
  ping: "assets/lib/sfx-ui-notification-ping/clip.mp3",
  riser: "assets/lib/sfx-ui-riser-short/clip.mp3",
  impact: "assets/lib/sfx-ui-soft-impact/clip.mp3",
  sparkle: "assets/lib/sfx-ui-sparkle-shimmer/clip.mp3",
  chime: "assets/lib/sfx-ui-success-chime/clip.mp3",
};
const IMG = {
  wolf: "assets/img-wolf.png",
  map: "assets/user/a-fa08a330-israel-map.png",
  gabriela: "assets/user/a-9b4790f8-gabriela-face.png",
  mentor: "assets/user/a-38baf7b6-mentor-face.png",
  logo: "assets/user/a-27a1649c-logo-shuknadlan.png",
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const smooth = { damping: 18, stiffness: 120 };
const snappy = { damping: 13, stiffness: 170 };
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

const enter = (frame: number, at: number, fps: number, H: number, from = 1.08) => {
  const p = spring({ frame: frame - at, fps, config: snappy });
  return {
    opacity: interpolate(frame - at, [0, 2], [0, 1], clamp),
    transform: `translateY(${(1 - p) * H * 0.015}px) scale(${from - (from - 1) * p})`,
  };
};
const shown = (frame: number, at: number, fps: number, H: number, from = 1.08) => (frame >= at ? enter(frame, at, fps, H, from) : { opacity: 0 });

const Line: React.FC<{ size: number; weight?: number; color?: string; style?: React.CSSProperties; children: React.ReactNode }> = ({ size, weight = 800, color = "#ffffff", style, children }) => (
  <div style={{ fontFamily: heebo, fontSize: size, fontWeight: weight, color, direction: "rtl", whiteSpace: "nowrap", lineHeight: 1.15, ...style }}>{children}</div>
);

// A star-burst sticker: a spiky gold badge that bursts onto the picture.
const Burst: React.FC<{ size: number; color: string; points?: number }> = ({ size, color, points = 16 }) => {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? 0.74 : 1;
    const a = (Math.PI * i) / points;
    pts.push(`${50 + Math.cos(a) * r * 50},${50 + Math.sin(a) * r * 50}`);
  }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ filter: "drop-shadow(0 10px 24px rgba(0,0,0,0.45))" }}>
      <polygon points={pts.join(" ")} fill={color} stroke="#ffffff" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
};

// City nodes on the map plate (pixel positions in the 1080 x 1081 picture). They sit on the glowing outline.
const NODES = [
  { x: 579, y: 304 }, // the valley
  { x: 531, y: 269 },
  { x: 618, y: 269 },
  { x: 498, y: 358 },
  { x: 487, y: 406 },
  { x: 566, y: 464 },
  { x: 476, y: 455 },
  { x: 500, y: 564 },
  { x: 640, y: 205 },
  { x: 525, y: 880 },
  { x: 540, y: 640 },
  { x: 510, y: 720 },
  { x: 525, y: 790 },
  { x: 470, y: 520 },
];
// Links between nodes (indexes), drawn in this order as the network connects.
const LINKS: [number, number][] = [[0, 1], [0, 2], [1, 3], [3, 4], [0, 5], [4, 6], [5, 7], [2, 8], [6, 7], [7, 9], [4, 5], [1, 8], [7, 10], [10, 11], [11, 12], [12, 9], [4, 13], [13, 5]];

export const Video: React.FC<VideoProps> = ({ manifest, urls }) => {
  const frame = useCurrentFrame();
  const real = useVideoConfig();
  const fps = real.fps;
  const W = real.width;
  const H = real.height;

  const wolf = sceneById(manifest, "wolf");
  const map = sceneById(manifest, "map");
  const helpers = sceneById(manifest, "helpers");
  const close = sceneById(manifest, "close");
  const cta = sceneById(manifest, "cta");
  type S = typeof wolf;
  const on = (s: S, w: string, o?: { nth?: number }) => onWord(s, w, o);
  const wf = (s: S, w: string, o?: { nth?: number }) => wordFrame(s, w, o);

  const voice = (s: S, dark = true) => (
    <>
      <Captions words={s.words} group={manifest.captions} rtl face={heebo} highlight={palette.accent} mode="highlight" bottom={0.3} />
      {s.voiceoverKey ? <Voiceover src={urls[s.voiceoverKey]} /> : null}
    </>
  );

  const mapPlate = (f: number, opacity: number, scale = 1, top = 0.2, size = 0.86) => (
    <div style={{ position: "absolute", left: W * (1 - size) / 2, top: H * top, width: W * size, height: W * size * (1081 / 1080), opacity, transform: `scale(${scale})` }}>
      <Img src={urls[IMG.map]} style={{ width: "100%", height: "100%" }} />
    </div>
  );

  return (
    <AbsoluteFill style={{ background: palette.night }}>
      {/* ---------- 1. The hook: a lone wolf, and a sticker that bursts ---------- */}
      <SceneFrame from={wolf.startFrame} durationInFrames={wolf.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - wolf.startFrame;
          const bAt = on(wolf, "זאב");
          const p = spring({ frame: f - bAt, fps, config: { damping: 8, stiffness: 190 } });
          const shake = f >= bAt && f < bAt + 14 ? Math.sin((f - bAt) * 2.6) * (1 - (f - bAt) / 14) * 14 : 0;
          const push = interpolate(f, [0, wolf.durationFrames], [1.0, 1.14], clamp);
          const rays = interpolate(f - bAt, [0, 10], [0, 1], { ...clamp, easing: easeOut });
          return (
            <AbsoluteFill>
              <Img src={urls[IMG.wolf]} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: `scale(${push})`, transformOrigin: "70% 55%" }} />
              <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(2,8,23,0.35), rgba(2,8,23,0) 30%, rgba(2,8,23,0) 55%, rgba(2,8,23,0.6))" }} />
              {f >= bAt ? (
                <div style={{ position: "absolute", left: W * 0.04, top: H * 0.3, width: W * 0.62, height: W * 0.62, transform: `translateX(${shake}px) rotate(${-9 + (1 - p) * 20}deg) scale(${0.2 + 0.85 * p})`, opacity: interpolate(f - bAt, [0, 2], [0, 1], clamp) }}>
                  {/* shock rays behind the sticker */}
                  <svg width="100%" height="100%" viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, overflow: "visible", opacity: 1 - rays * 0.6 }}>
                    {Array.from({ length: 14 }).map((_, i) => {
                      const a = (Math.PI * 2 * i) / 14;
                      const r1 = 52 + rays * 6, r2 = 52 + rays * 26;
                      return <line key={i} x1={50 + Math.cos(a) * r1} y1={50 + Math.sin(a) * r1} x2={50 + Math.cos(a) * r2} y2={50 + Math.sin(a) * r2} stroke="#f5dfa0" strokeWidth="1.6" strokeLinecap="round" />;
                    })}
                  </svg>
                  <Burst size={W * 0.62} color={palette.accent} />
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0 }}>
                    <Line size={W * 0.125} color={palette.ink} weight={900}>זאב</Line>
                    <Line size={W * 0.125} color={palette.ink} weight={900}>בודד?</Line>
                  </div>
                </div>
              ) : null}
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.riser]} at={Math.max(0, wf(wolf, "זאב") - 20)} volume={0.2} />
        <Sfx src={urls[SFX.impact]} at={wf(wolf, "זאב") + 1} volume={0.32} />
        <Sfx src={urls[SFX.pop]} at={wf(wolf, "זאב") + 2} volume={0.22} />
        {voice(wolf)}
      </SceneFrame>

      {/* ---------- 2. The map connects ---------- */}
      <SceneFrame from={map.startFrame} durationInFrames={map.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - map.startFrame;
          const t0 = 4, per = 7;
          const lit = (i: number) => f >= t0 + i * per;
          const link = (k: number) => interpolate(f, [t0 + 20 + k * 6, t0 + 20 + k * 6 + 14], [0, 1], { ...clamp, easing: easeOut });
          const bright = interpolate(f, [0, 90], [0.38, 1], clamp);
          const chips = [
            { text: "נכסים", at: on(map, "נכסים") },
            { text: "לקוחות", at: on(map, "לקוחות") },
            { text: "שיתופי פעולה", at: on(map, "ושיתופי") },
            { text: "במקום אחד", at: on(map, "במקום") },
          ];
          const chip = [...chips].reverse().find((c) => f >= c.at);
          const size = 1.03;
          const top = 0.122;
          const sx = (W * size) / 1080, ox = (W * (1 - size)) / 2, oy = H * top;
          const tr = (n: { x: number; y: number }) => ({ x: ox + n.x * sx, y: oy + n.y * sx });
          return (
            <AbsoluteFill>
              <div style={{ position: "absolute", top: H * 0.145, width: "100%", display: "flex", justifyContent: "center" }}>
                <div style={shown(f, on(map, "מחוברים") - 18, fps, H, 1.12)}><Line size={W * 0.08}>מה אם כולם <span style={{ color: palette.glow }}>מחוברים?</span></Line></div>
              </div>
              {mapPlate(f, bright, 1, top, size)}
              <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
                <defs>
                  <filter id="glow"><feGaussianBlur stdDeviation="6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                </defs>
                {LINKS.map(([a, b], k) => {
                  const A = tr(NODES[a]), B = tr(NODES[b]);
                  const p = link(k);
                  return <line key={k} x1={A.x} y1={A.y} x2={A.x + (B.x - A.x) * p} y2={A.y + (B.y - A.y) * p} stroke={palette.glow} strokeWidth={3.2} strokeLinecap="round" filter="url(#glow)" opacity={0.9} />;
                })}
                {NODES.map((n, i) => {
                  if (!lit(i)) return null;
                  const P = tr(n);
                  const pop = spring({ frame: f - (t0 + i * per), fps, config: { damping: 10, stiffness: 200 } });
                  const pulse = 1 + 0.25 * Math.sin((f + i * 5) / 5);
                  return (
                    <g key={i} filter="url(#glow)">
                      <circle cx={P.x} cy={P.y} r={26 * pop * pulse} fill={palette.glow} opacity={0.22} />
                      <circle cx={P.x} cy={P.y} r={11 * pop} fill="#ffffff" />
                      <circle cx={P.x} cy={P.y} r={6.5 * pop} fill={palette.glow} />
                    </g>
                  );
                })}
                {/* small property cards travelling along the links */}
                {[4, 6, 9, 3, 12].map((li, k) => {
                  const [a, b] = LINKS[li];
                  const start = t0 + 40 + k * 9;
                  if (f < start) return null;
                  const A = tr(NODES[a]), B = tr(NODES[b]);
                  const t = ((f - start) % 38) / 38;
                  const x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t;
                  const w = W * 0.065;
                  return (
                    <g key={`c${k}`} transform={`translate(${x - w / 2},${y - w * 0.4})`} opacity={interpolate(t, [0, 0.1, 0.9, 1], [0, 1, 1, 0], clamp)}>
                      <rect width={w} height={w * 0.8} rx={w * 0.14} fill="#ffffff" />
                      <path d={`M${w * 0.18} ${w * 0.42} L${w * 0.5} ${w * 0.16} L${w * 0.82} ${w * 0.42} V${w * 0.66} H${w * 0.18} Z`} fill={palette.hero} />
                    </g>
                  );
                })}
              </svg>
              {chip ? (
                <div style={{ position: "absolute", top: H * 0.205, width: "100%", display: "flex", justifyContent: "center" }}>
                  <div key={chip.text} style={enter(f, chip.at, fps, H, 1.25)}>
                    <div style={{ background: palette.accent, borderRadius: W * 0.08, padding: `${H * 0.007}px ${W * 0.06}px`, boxShadow: "0 10px 30px rgba(0,0,0,0.4)" }}>
                      <Line size={W * 0.055} color={palette.ink}>{chip.text}</Line>
                    </div>
                  </div>
                </div>
              ) : null}
            </AbsoluteFill>
          );
        })()}
        {NODES.slice(0, 6).map((_, i) => <Sfx key={i} src={urls[SFX.ping]} at={4 + i * 7} volume={0.07} />)}
        <Sfx src={urls[SFX.whoosh]} at={2} volume={0.2} />
        <Sfx src={urls[SFX.tap]} at={on(map, "נכסים") + 1} volume={0.18} />
        <Sfx src={urls[SFX.tap]} at={on(map, "לקוחות") + 1} volume={0.18} />
        <Sfx src={urls[SFX.tap]} at={on(map, "ושיתופי") + 1} volume={0.18} />
        <Sfx src={urls[SFX.impact]} at={on(map, "במקום") + 2} volume={0.2} />
        {voice(map)}
      </SceneFrame>

      {/* ---------- 3. Gabriela and the mentor ---------- */}
      <SceneFrame from={helpers.startFrame} durationInFrames={helpers.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - helpers.startFrame;
          const gAt = on(helpers, "עוזרת");
          const mAt = on(helpers, "ומנטור");
          const gP = spring({ frame: f - gAt, fps, config: { damping: 11, stiffness: 150 } });
          const mP = spring({ frame: f - mAt, fps, config: { damping: 11, stiffness: 150 } });
          const D = W * 0.4;
          const person = (x: number, p: number, at: number, img: string, label: string, sub: string, wa: boolean) =>
            f >= at ? (
              <div style={{ position: "absolute", left: x * W - D / 2, top: H * 0.27, width: D, display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.012, opacity: interpolate(f - at, [0, 2], [0, 1], clamp), transform: `translateY(${(1 - p) * H * 0.05}px) scale(${0.6 + 0.4 * p})` }}>
                <div style={{ position: "relative", width: D, height: D }}>
                  <div style={{ width: D, height: D, borderRadius: "50%", overflow: "hidden", border: `${W * 0.01}px solid ${palette.accent}`, boxShadow: "0 0 60px rgba(56,189,248,0.35)", background: "#14284f" }}>
                    <Img src={urls[img]} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 20%" }} />
                  </div>
                  {wa ? (
                    <div style={{ position: "absolute", right: -W * 0.015, bottom: W * 0.01, width: W * 0.13, height: W * 0.13, borderRadius: "50%", background: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 22px rgba(0,0,0,0.4)" }}>
                      <Icon name="whatsapp" size={W * 0.09} color="brand" />
                    </div>
                  ) : null}
                </div>
                <div style={{ background: palette.accent, borderRadius: W * 0.06, padding: `${H * 0.005}px ${W * 0.05}px` }}>
                  <Line size={W * 0.052} color={palette.ink}>{label}</Line>
                </div>
                <Line size={W * 0.037} weight={600} color="#dbe3f5">{sub}</Line>
              </div>
            ) : null;
          return (
            <AbsoluteFill>
              <div style={{ position: "absolute", top: H * 0.145, width: "100%", display: "flex", justifyContent: "center" }}>
                <div style={shown(f, 2, fps, H, 1.12)}><Line size={W * 0.075}>ומה אם הייתה לך <span style={{ color: palette.glow }}>עזרה?</span></Line></div>
              </div>
              {person(0.74, gP, gAt, IMG.gabriela, "גבריאלה", "העוזרת האישית בוואטסאפ", true)}
              {person(0.26, mP, mAt, IMG.mentor, "מנטור AI", "מלווה אותך להצלחה", false)}
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.pop]} at={on(helpers, "עוזרת") + 1} volume={0.24} />
        <Sfx src={urls[SFX.ping]} at={on(helpers, "בוואטסאפ") + 1} volume={0.18} />
        <Sfx src={urls[SFX.pop]} at={on(helpers, "ומנטור") + 1} volume={0.24} />
        <Sfx src={urls[SFX.sparkle]} at={on(helpers, "ומנטור") + 3} volume={0.12} />
        {voice(helpers)}
      </SceneFrame>

      {/* ---------- 4. The hit: you only close the deals ---------- */}
      <SceneFrame from={close.startFrame} durationInFrames={close.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - close.startFrame;
          const dAt = on(close, "עסקאות");
          const p = spring({ frame: f - dAt, fps, config: { damping: 9, stiffness: 180 } });
          return (
            <AbsoluteFill>
              {mapPlate(f, 0.35, 1.25 + f * 0.0015, 0.12, 0.86)}
              <div style={{ position: "absolute", top: H * 0.28, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.01 }}>
                <div style={shown(f, on(close, "ולך"), fps, H, 1.12)}><Line size={W * 0.085}>לך נשאר רק</Line></div>
                <div style={shown(f, on(close, "לסגור"), fps, H, 1.12)}><Line size={W * 0.1}>לסגור</Line></div>
                {f >= dAt ? (
                  <div style={{ opacity: interpolate(f - dAt, [0, 2], [0, 1], clamp), transform: `scale(${0.5 + 0.5 * p})` }}>
                    <Line size={W * 0.15} color={palette.accent} weight={900} style={{ textShadow: "0 0 40px rgba(201,162,39,0.55)" }}>עסקאות</Line>
                  </div>
                ) : null}
              </div>
              {f >= dAt ? (
                <div style={{ position: "absolute", top: H * 0.5, width: "100%", display: "flex", justifyContent: "center", gap: W * 0.05 }}>
                  {[0, 1, 2].map((i) => {
                    const q = spring({ frame: f - dAt - 2 - i * 3, fps, config: { damping: 10, stiffness: 190 } });
                    return (
                      <div key={i} style={{ width: W * 0.13, height: W * 0.13, borderRadius: "50%", background: palette.accent, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${q})`, boxShadow: "0 10px 26px rgba(0,0,0,0.4)" }}>
                        <svg width={W * 0.07} height={W * 0.07} viewBox="0 0 48 48"><path d="M10 25l9 9 19-21" fill="none" stroke={palette.ink} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.whoosh]} at={1} volume={0.18} />
        <Sfx src={urls[SFX.impact]} at={wf(close, "עסקאות") + 1} volume={0.3} />
        <Sfx src={urls[SFX.chime]} at={wf(close, "עסקאות") + 4} volume={0.16} />
        {voice(close)}
      </SceneFrame>

      {/* ---------- 5. The close: logo, community line, verbs, URL ---------- */}
      <SceneFrame from={cta.startFrame} durationInFrames={cta.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - cta.startFrame;
          const reveal = interpolate(f, [0, 14], [0, 1], { ...clamp, easing: easeOut });
          const logoP = spring({ frame: f - 4, fps, config: { damping: 12, stiffness: 120 } });
          const jAt = on(cta, "השאירו");
          const jP = spring({ frame: f - jAt, fps, config: { damping: 10, stiffness: 150 } });
          const verbs = [
            { t: "מתחברים", at: on(cta, "מתחברים") },
            { t: "משתפים", at: on(cta, "משתפים") },
            { t: "סוגרים עסקאות", at: on(cta, "סוגרים") },
          ];
          const logo = W * 0.46;
          return (
            <AbsoluteFill style={{ clipPath: `circle(${reveal * 150}% at 50% 40%)`, background: palette.bg }}>
              <div style={{ position: "absolute", left: (W - logo) / 2, top: H * 0.075, width: logo, height: logo, opacity: interpolate(f, [2, 6], [0, 1], clamp), transform: `translateY(${(1 - logoP) * H * 0.02}px) scale(${1.1 - 0.1 * logoP})`, WebkitMaskImage: "radial-gradient(closest-side, #000 90%, transparent 100%)", maskImage: "radial-gradient(closest-side, #000 90%, transparent 100%)" }}>
                <Img src={urls[IMG.logo]} style={{ width: "100%", height: "100%" }} />
              </div>
              <div style={{ position: "absolute", top: H * 0.35, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.004 }}>
                <div style={shown(f, 8, fps, H, 1.1)}><Line size={W * 0.085} color={palette.hero}>שוק נדל״ן</Line></div>
                <div style={shown(f, on(cta, "מצטרפים"), fps, H, 1.1)}><Line size={W * 0.06} color={palette.ink}>מצטרפים לקהילה <span style={{ color: palette.accent }}>החכמה</span></Line></div>
                <div style={shown(f, on(cta, "יועצי"), fps, H, 1.1)}><Line size={W * 0.045} weight={700} color={palette.ink}>של יועצי הנדל״ן של ישראל</Line></div>
              </div>
              <div style={{ position: "absolute", top: H * 0.495, width: "100%", display: "flex", justifyContent: "center", gap: W * 0.025, direction: "rtl" }}>
                {verbs.map((v, i) => (
                  <React.Fragment key={v.t}>
                    <div style={shown(f, v.at, fps, H, 1.15)}><Line size={W * 0.04} color={palette.hero}>{v.t}</Line></div>
                    {i < 2 ? <div style={{ ...shown(f, v.at, fps, H, 1.0), color: palette.accent, fontSize: W * 0.04, fontFamily: heebo }}>▪</div> : null}
                  </React.Fragment>
                ))}
              </div>
              <div style={{ position: "absolute", top: H * 0.535, width: "100%", display: "flex", justifyContent: "center", ...shown(f, on(cta, "סוגרים") + 4, fps, H, 1.05) }}>
                <div style={{ fontFamily: heebo, fontWeight: 800, fontSize: W * 0.05, color: palette.hero, direction: "ltr", letterSpacing: 0.5 }}>shuknadlan.co.il</div>
              </div>
              {f >= jAt ? (
                <div style={{ position: "absolute", top: H * 0.575, width: "100%", display: "flex", justifyContent: "center", opacity: interpolate(f - jAt, [0, 2], [0, 1], clamp), transform: `scale(${0.8 + 0.2 * jP})` }}>
                  <div style={{ background: palette.accent, borderRadius: W * 0.08, padding: `${H * 0.01}px ${W * 0.08}px`, boxShadow: "0 16px 40px rgba(201,162,39,0.5)" }}>
                    <Line size={W * 0.07} color={palette.ink}>השאירו פרטים</Line>
                  </div>
                </div>
              ) : null}
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.whoosh]} at={1} volume={0.2} />
        <Sfx src={urls[SFX.sparkle]} at={4} volume={0.2} />
        <Sfx src={urls[SFX.pop]} at={wf(cta, "מתחברים") + 1} volume={0.16} />
        <Sfx src={urls[SFX.pop]} at={wf(cta, "משתפים") + 1} volume={0.16} />
        <Sfx src={urls[SFX.pop]} at={wf(cta, "סוגרים") + 1} volume={0.16} />
        <Sfx src={urls[SFX.impact]} at={wf(cta, "השאירו") + 1} volume={0.22} />
        <Sfx src={urls[SFX.chime]} at={wf(cta, "פרטים") + 3} volume={0.16} />
        {voice(cta, false)}
      </SceneFrame>

      {manifest.music ? <Music src={urls[manifest.music.key]} duckTo={0.3} /> : null}
      <Grain blend="multiply" opacity={0.04} />
      <Vignette strength={0.1} />
    </AbsoluteFill>
  );
};
