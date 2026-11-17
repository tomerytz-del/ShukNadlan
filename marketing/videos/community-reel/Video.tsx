import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";
import { Captions, Grain, Icon, Music, SceneFrame, Sfx, Vignette, Voiceover, font, onWord, sceneById, wordFrame } from "reelkit/kit";
import type { VideoProps } from "reelkit/kit";

// v3: the same story as the first cut, edited like a native short-form video.
// Hard cuts on the words, a punch-in on every beat, a screen shake and a flash on each hit, and three ideas that tie it
// together instead of generic stock motion:
//   1. the moon of the hook becomes the first glowing dot of the map (a match cut, same screen position),
//   2. the network spreads outward from that dot with a sonar ring, as if the howl was answered,
//   3. "close" is a rubber stamp: נסגר! lands three times.
// The ending is a clean, quiet card: no captions (the text is already on screen), the URL at the very bottom.
// Safe zone for Reels: headlines between 14 and 62 percent of the height, captions at 30 percent from the bottom.
const palette = {
  night: "#020817",
  bg: "#F7F4EF", // the logo file's own ground
  ink: "#0d1b3d",
  hero: "#0e2a6b",
  accent: "#c9a227",
  glow: "#38bdf8",
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
  mentorCard: "assets/user/a-d97d4b5c-mentor-crop.png",
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

// A beat: 1 at the hit, easing to 0 over `len` frames. Used for punch-ins, shakes and flashes.
const beat = (f: number, at: number, len = 8) => (f < at ? 0 : Math.max(0, 1 - (f - at) / len));
const shakeX = (f: number, at: number, amp: number, len = 10) => beat(f, at, len) * Math.sin((f - at) * 3.1) * amp;
const shakeY = (f: number, at: number, amp: number, len = 10) => beat(f, at, len) * Math.cos((f - at) * 2.7) * amp;

const Line: React.FC<{ size: number; weight?: number; color?: string; style?: React.CSSProperties; children: React.ReactNode }> = ({ size, weight = 800, color = "#ffffff", style, children }) => (
  <div style={{ fontFamily: heebo, fontSize: size, fontWeight: weight, color, direction: "rtl", whiteSpace: "nowrap", lineHeight: 1.15, ...style }}>{children}</div>
);

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

// A hard white flash over everything: used as the cut between shots.
const Flash: React.FC<{ f: number; at: number; len?: number; color?: string }> = ({ f, at, len = 4, color = "#ffffff" }) => {
  const o = beat(f, at, len) * 0.85;
  return o > 0 ? <AbsoluteFill style={{ background: color, opacity: o }} /> : null;
};

// City nodes on the map plate (pixel positions in the 1080 x 1081 picture).
const NODES = [
  { x: 579, y: 304 }, // the valley: the dot the moon turns into
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

  const voice = (s: S, captions = true) => (
    <>
      {captions ? <Captions words={s.words} group={manifest.captions} rtl face={heebo} highlight={palette.accent} mode="highlight" bottom={0.3} /> : null}
      {s.voiceoverKey ? <Voiceover src={urls[s.voiceoverKey]} /> : null}
    </>
  );

  // the moon in the wolf picture, in screen pixels (the 1024 x 1536 picture covers the 1080 x 1920 frame)
  const MOON = { x: 815 * 1.25 - 100, y: 215 * 1.25 };

  return (
    <AbsoluteFill style={{ background: palette.night }}>
      {/* ---------- 1. The hook: the howl, the sticker, a cut in tight, then into the moon ---------- */}
      <SceneFrame from={wolf.startFrame} durationInFrames={wolf.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - wolf.startFrame;
          const bAt = on(wolf, "זאב");
          const cutAt = on(wolf, "בודד");
          const endAt = wolf.durationFrames - 10;
          const p = spring({ frame: f - bAt, fps, config: { damping: 8, stiffness: 190 } });
          const rays = interpolate(f - bAt, [0, 10], [0, 1], { ...clamp, easing: easeOut });
          // the camera: slow push, a hard cut in on the wolf's head, then a dive into the moon
          const tight = f >= cutAt && f < endAt;
          const dive = interpolate(f, [endAt, wolf.durationFrames], [0, 1], { ...clamp, easing: (t) => t * t });
          const scale = (tight ? 1.7 : 1.0 + 0.1 * (f / wolf.durationFrames)) + dive * 2.4;
          const origin = f >= endAt ? `${MOON.x}px ${MOON.y}px` : tight ? "65% 38%" : "70% 55%";
          return (
            <AbsoluteFill style={{ transform: `translate(${shakeX(f, bAt, 16)}px, ${shakeY(f, bAt, 10)}px)` }}>
              <Img src={urls[IMG.wolf]} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})`, transformOrigin: origin }} />
              <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(2,8,23,0.35), rgba(2,8,23,0) 30%, rgba(2,8,23,0) 55%, rgba(2,8,23,0.6))" }} />
              {f >= bAt && !tight ? (
                <div style={{ position: "absolute", left: W * 0.04, top: H * 0.3, width: W * 0.62, height: W * 0.62, transform: `rotate(${-9 + (1 - p) * 20}deg) scale(${0.2 + 0.85 * p})`, opacity: interpolate(f - bAt, [0, 2], [0, 1], clamp) }}>
                  <svg width="100%" height="100%" viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, overflow: "visible", opacity: 1 - rays * 0.6 }}>
                    {Array.from({ length: 14 }).map((_, i) => {
                      const a = (Math.PI * 2 * i) / 14;
                      const r1 = 52 + rays * 6, r2 = 52 + rays * 26;
                      return <line key={i} x1={50 + Math.cos(a) * r1} y1={50 + Math.sin(a) * r1} x2={50 + Math.cos(a) * r2} y2={50 + Math.sin(a) * r2} stroke="#f5dfa0" strokeWidth="1.6" strokeLinecap="round" />;
                    })}
                  </svg>
                  <Burst size={W * 0.62} color={palette.accent} />
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                    <Line size={W * 0.125} color={palette.ink} weight={900}>זאב</Line>
                    <Line size={W * 0.125} color={palette.ink} weight={900}>בודד?</Line>
                  </div>
                </div>
              ) : null}
              {tight ? (
                <div style={{ position: "absolute", left: 0, right: 0, top: H * 0.16, display: "flex", justifyContent: "center", ...shown(f, cutAt, fps, H, 1.4) }}>
                  <div style={{ background: palette.accent, borderRadius: W * 0.05, padding: `${H * 0.006}px ${W * 0.06}px`, transform: "rotate(-3deg)", boxShadow: "0 12px 30px rgba(0,0,0,0.45)" }}>
                    <Line size={W * 0.085} color={palette.ink} weight={900}>עובד לבד</Line>
                  </div>
                </div>
              ) : null}
              <Flash f={f} at={cutAt} len={4} />
              <Flash f={f} at={endAt + 8} len={5} />
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.riser]} at={Math.max(0, wf(wolf, "זאב") - 16)} volume={0.18} />
        <Sfx src={urls[SFX.impact]} at={wf(wolf, "זאב") + 1} volume={0.34} />
        <Sfx src={urls[SFX.pop]} at={wf(wolf, "זאב") + 2} volume={0.2} />
        <Sfx src={urls[SFX.impact]} at={wf(wolf, "בודד")} volume={0.28} />
        <Sfx src={urls[SFX.riser]} at={wolf.durationFrames - 16} volume={0.2} />
        {voice(wolf)}
      </SceneFrame>

      {/* ---------- 2. The map: the moon is the first dot, the network answers ---------- */}
      <SceneFrame from={map.startFrame} durationInFrames={map.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - map.startFrame;
          const size = 1.03, top = 0.122;
          const sx = (W * size) / 1080, ox = (W * (1 - size)) / 2, oy = H * top;
          const tr = (n: { x: number; y: number }) => ({ x: ox + n.x * sx, y: oy + n.y * sx });
          const first = tr(NODES[0]);
          const travel = interpolate(f, [0, 9], [0, 1], { ...clamp, easing: easeOut });
          const dotX = MOON.x + (first.x - MOON.x) * travel, dotY = MOON.y + (first.y - MOON.y) * travel;
          const t0 = 9, per = 4;
          const lit = (i: number) => f >= t0 + i * per;
          const link = (k: number) => interpolate(f, [t0 + 4 + k * 3, t0 + 4 + k * 3 + 9], [0, 1], { ...clamp, easing: easeOut });
          const bright = interpolate(f, [0, 40], [0.3, 1], clamp);
          const slams = [
            { text: "נכסים", at: on(map, "נכסים"), rot: -4 },
            { text: "לקוחות", at: on(map, "לקוחות"), rot: 3 },
            { text: "שיתופי פעולה", at: on(map, "ושיתופי"), rot: -3 },
            { text: "במקום אחד", at: on(map, "במקום"), rot: 2 },
          ];
          const slam = [...slams].reverse().find((s) => f >= s.at);
          const hit = slams.reduce((m, s) => Math.max(m, beat(f, s.at, 8)), 0);
          const ring = interpolate(f - 9, [0, 26], [0, 1], { ...clamp, easing: easeOut });
          return (
            <AbsoluteFill style={{ transform: `translate(${slams.reduce((a, s) => a + shakeX(f, s.at, 9, 8), 0)}px, ${slams.reduce((a, s) => a + shakeY(f, s.at, 6, 8), 0)}px) scale(${1 + hit * 0.035})` }}>
              <div style={{ position: "absolute", left: W * (1 - size) / 2, top: H * top, width: W * size, height: W * size * (1081 / 1080), opacity: bright }}>
                <Img src={urls[IMG.map]} style={{ width: "100%", height: "100%" }} />
              </div>
              <div style={{ position: "absolute", top: H * 0.145, width: "100%", display: "flex", justifyContent: "center", opacity: interpolate(f, [8, 12], [0, 1], clamp) }}>
                <Line size={W * 0.08}>מה אם כולם <span style={{ color: palette.glow }}>מחוברים?</span></Line>
              </div>
              <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
                <defs>
                  <filter id="glow"><feGaussianBlur stdDeviation="6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                </defs>
                {/* the sonar ring of the howl, answered by the network */}
                {f >= 9 ? <circle cx={first.x} cy={first.y} r={ring * W * 0.7} fill="none" stroke={palette.glow} strokeWidth={4} opacity={(1 - ring) * 0.8} filter="url(#glow)" /> : null}
                {f >= 12 ? <circle cx={first.x} cy={first.y} r={Math.max(0, ring - 0.18) * W * 0.7} fill="none" stroke="#ffffff" strokeWidth={2} opacity={(1 - ring) * 0.6} /> : null}
                {LINKS.map(([a, b], k) => {
                  const A = tr(NODES[a]), B = tr(NODES[b]);
                  const q = link(k);
                  return <line key={k} x1={A.x} y1={A.y} x2={A.x + (B.x - A.x) * q} y2={A.y + (B.y - A.y) * q} stroke={palette.glow} strokeWidth={3.2} strokeLinecap="round" filter="url(#glow)" opacity={0.9} />;
                })}
                {NODES.map((n, i) => {
                  if (i === 0 || !lit(i)) return null;
                  const P = tr(n);
                  const pop = spring({ frame: f - (t0 + i * per), fps, config: { damping: 10, stiffness: 200 } });
                  const pulse = 1 + 0.25 * Math.sin((f + i * 5) / 4);
                  return (
                    <g key={i} filter="url(#glow)">
                      <circle cx={P.x} cy={P.y} r={26 * pop * pulse} fill={palette.glow} opacity={0.22} />
                      <circle cx={P.x} cy={P.y} r={11 * pop} fill="#ffffff" />
                      <circle cx={P.x} cy={P.y} r={6.5 * pop} fill={palette.glow} />
                    </g>
                  );
                })}
                {/* the moon, travelling to become the first dot */}
                <g filter="url(#glow)">
                  <circle cx={dotX} cy={dotY} r={(70 - 58 * travel)} fill="#e8f1ff" opacity={f < 9 ? 1 : 0.0} />
                  {f >= 9 ? (<><circle cx={first.x} cy={first.y} r={30 + 8 * Math.sin(f / 3)} fill={palette.glow} opacity={0.3} /><circle cx={first.x} cy={first.y} r={12} fill="#ffffff" /><circle cx={first.x} cy={first.y} r={7} fill={palette.glow} /></>) : null}
                </g>
                {[2, 4, 6, 9].map((li, k) => {
                  const [a, b] = LINKS[li];
                  const start = t0 + 30 + k * 7;
                  if (f < start) return null;
                  const A = tr(NODES[a]), B = tr(NODES[b]);
                  const t = ((f - start) % 26) / 26;
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
              {slam ? (
                <div style={{ position: "absolute", top: H * 0.22, width: "100%", display: "flex", justifyContent: "center" }}>
                  <div key={slam.text} style={{ ...enter(f, slam.at, fps, H, 1.7), transform: `rotate(${slam.rot}deg) scale(${1 + beat(f, slam.at, 6) * 0.3})` }}>
                    <div style={{ background: palette.accent, borderRadius: W * 0.04, padding: `${H * 0.008}px ${W * 0.07}px`, boxShadow: "0 14px 34px rgba(0,0,0,0.5)" }}>
                      <Line size={W * 0.095} color={palette.ink} weight={900}>{slam.text}</Line>
                    </div>
                  </div>
                </div>
              ) : null}
              <Flash f={f} at={0} len={4} />
              {slams.map((s) => <Flash key={s.text} f={f} at={s.at} len={3} />)}
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.impact]} at={1} volume={0.3} />
        <Sfx src={urls[SFX.sparkle]} at={8} volume={0.2} />
        {NODES.slice(1, 9).map((_, i) => <Sfx key={i} src={urls[SFX.ping]} at={13 + i * 4} volume={0.06} />)}
        <Sfx src={urls[SFX.whoosh]} at={on(map, "נכסים") - 2} volume={0.2} />
        <Sfx src={urls[SFX.impact]} at={on(map, "נכסים")} volume={0.24} />
        <Sfx src={urls[SFX.impact]} at={on(map, "לקוחות")} volume={0.24} />
        <Sfx src={urls[SFX.impact]} at={on(map, "ושיתופי")} volume={0.24} />
        <Sfx src={urls[SFX.impact]} at={on(map, "במקום")} volume={0.3} />
        {voice(map)}
      </SceneFrame>

      {/* ---------- 3. Gabriela and the mentor: three quick cuts ---------- */}
      <SceneFrame from={helpers.startFrame} durationInFrames={helpers.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - helpers.startFrame;
          const gAt = 2; // the cut lands at the start of the scene; the sound still sits on the word
          const waAt = on(helpers, "בוואטסאפ");
          const mAt = on(helpers, "ומנטור");
          const D = W * 0.62;
          const showG = f < mAt;
          const gP = spring({ frame: f - gAt, fps, config: { damping: 11, stiffness: 150 } });
          const mP = spring({ frame: f - mAt, fps, config: { damping: 11, stiffness: 160 } });
          const dots = Math.floor(f / 4) % 3;
          return (
            <AbsoluteFill style={{ background: showG ? "radial-gradient(circle at 50% 38%, #12306e, #020817 70%)" : "radial-gradient(circle at 50% 38%, #3a2a08, #020817 70%)", transform: `translate(${shakeX(f, gAt, 10, 8) + shakeX(f, mAt, 12, 8)}px, ${shakeY(f, mAt, 8, 8)}px)` }}>
              {showG ? (
                <>
                  <div style={{ position: "absolute", top: H * 0.16, width: "100%", display: "flex", justifyContent: "center", ...shown(f, gAt, fps, H, 1.4) }}>
                    <Line size={W * 0.11}>עוזרת <span style={{ color: "#5ee38b" }}>אישית</span></Line>
                  </div>
                  <div style={{ position: "absolute", left: (W - D) / 2, top: H * 0.27, width: D, height: D, borderRadius: "50%", overflow: "hidden", border: `${W * 0.012}px solid ${palette.accent}`, boxShadow: "0 0 80px rgba(56,189,248,0.4)", background: "#14284f", opacity: interpolate(f - gAt, [0, 2], [0, 1], clamp), transform: `scale(${0.5 + 0.5 * gP})` }}>
                    <Img src={urls[IMG.gabriela]} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 20%" }} />
                  </div>
                  {f >= waAt ? (
                    <div style={{ position: "absolute", left: W * 0.5, top: H * 0.5 + D * 0.0, ...enter(f, waAt, fps, H, 1.5) }}>
                      <div style={{ position: "absolute", left: W * 0.05, top: -W * 0.04, display: "flex", alignItems: "center", gap: W * 0.025, background: "#ffffff", borderRadius: W * 0.06, padding: `${H * 0.01}px ${W * 0.04}px`, boxShadow: "0 14px 34px rgba(0,0,0,0.5)" }}>
                        <Icon name="whatsapp" size={W * 0.085} color="brand" />
                        <div style={{ display: "flex", gap: W * 0.012 }}>
                          {[0, 1, 2].map((d) => <div key={d} style={{ width: W * 0.022, height: W * 0.022, borderRadius: "50%", background: "#8a94a6", opacity: dots === d ? 1 : 0.35 }} />)}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div style={{ position: "absolute", top: H * 0.16, width: "100%", display: "flex", justifyContent: "center", ...shown(f, mAt, fps, H, 1.4) }}>
                    <Line size={W * 0.11}>מנטור <span style={{ color: palette.accent }}>AI</span></Line>
                  </div>
                  <div style={{ position: "absolute", left: W * 0.06, width: W * 0.88, top: H * 0.27, opacity: interpolate(f - mAt, [0, 2], [0, 1], clamp), transform: `scale(${0.55 + 0.45 * mP}) rotate(${(1 - mP) * -4}deg)` }}>
                    <div style={{ borderRadius: W * 0.04, overflow: "hidden", border: `${W * 0.007}px solid ${palette.accent}`, boxShadow: "0 28px 70px rgba(0,0,0,0.55)" }}>
                      <Img src={urls[IMG.mentorCard]} style={{ width: "100%", display: "block" }} />
                    </div>
                  </div>
                  <div style={{ position: "absolute", left: W * 0.05, top: H * 0.27 - W * 0.08, width: W * 0.2, height: W * 0.2, borderRadius: "50%", overflow: "hidden", border: `${W * 0.008}px solid ${palette.accent}`, background: "#14284f", opacity: interpolate(f - mAt, [3, 6], [0, 1], clamp) }}>
                    <Img src={urls[IMG.mentor]} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 15%" }} />
                  </div>
                </>
              )}
              <Flash f={f} at={mAt} len={4} />
              <Flash f={f} at={gAt} len={3} />
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.whoosh]} at={on(helpers, "עוזרת") - 2} volume={0.22} />
        <Sfx src={urls[SFX.impact]} at={on(helpers, "עוזרת")} volume={0.22} />
        <Sfx src={urls[SFX.ping]} at={on(helpers, "בוואטסאפ") + 1} volume={0.22} />
        <Sfx src={urls[SFX.whoosh]} at={on(helpers, "ומנטור") - 2} volume={0.22} />
        <Sfx src={urls[SFX.impact]} at={on(helpers, "ומנטור")} volume={0.28} />
        <Sfx src={urls[SFX.sparkle]} at={on(helpers, "ומנטור") + 3} volume={0.12} />
        {voice(helpers)}
      </SceneFrame>

      {/* ---------- 4. The hit: a rubber stamp, three times ---------- */}
      <SceneFrame from={close.startFrame} durationInFrames={close.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - close.startFrame;
          const a1 = on(close, "לסגור");
          const a2 = on(close, "עסקאות");
          const stamps = [
            { at: a1 + 2, x: 0.3, y: 0.41, rot: -12, s: 0.9 },
            { at: a2, x: 0.68, y: 0.46, rot: 9, s: 1.0 },
            { at: a2 + 7, x: 0.45, y: 0.52, rot: -4, s: 1.15 },
          ];
          const shake = stamps.reduce((a, s) => a + shakeX(f, s.at, 12, 8), 0);
          const shakeV = stamps.reduce((a, s) => a + shakeY(f, s.at, 10, 8), 0);
          return (
            <AbsoluteFill style={{ transform: `translate(${shake}px, ${shakeV}px)` }}>
              <div style={{ position: "absolute", left: W * 0.07, top: H * 0.12, width: W * 0.86, height: W * 0.86 * (1081 / 1080), opacity: 0.32 + 0.0 * f, transform: `scale(${1.15 + f * 0.0015})` }}>
                <Img src={urls[IMG.map]} style={{ width: "100%", height: "100%" }} />
              </div>
              <div style={{ position: "absolute", top: H * 0.18, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.004 }}>
                <div style={shown(f, on(close, "ולך"), fps, H, 1.2)}><Line size={W * 0.09}>לך נשאר רק</Line></div>
                <div style={shown(f, a1, fps, H, 1.25)}><Line size={W * 0.11}>לסגור</Line></div>
                {f >= a2 ? <div style={enter(f, a2, fps, H, 1.5)}><Line size={W * 0.15} color={palette.accent} weight={900} style={{ textShadow: "0 0 40px rgba(201,162,39,0.55)" }}>עסקאות</Line></div> : null}
              </div>
              {stamps.map((s, i) => {
                if (f < s.at) return null;
                const k = spring({ frame: f - s.at, fps, config: { damping: 7, stiffness: 260 } });
                const w = W * 0.5 * s.s;
                return (
                  <div key={i} style={{ position: "absolute", left: s.x * W - w / 2, top: s.y * H, width: w, opacity: interpolate(f - s.at, [0, 1], [0, 1], clamp), transform: `rotate(${s.rot}deg) scale(${1.9 - 0.9 * k})` }}>
                    <div style={{ border: `${W * 0.012}px solid ${palette.accent}`, borderRadius: W * 0.025, padding: `${H * 0.004}px 0`, textAlign: "center", boxShadow: `0 0 0 ${W * 0.004}px rgba(201,162,39,0.5) inset`, background: "rgba(2,8,23,0.35)" }}>
                      <Line size={W * 0.12 * s.s} color={palette.accent} weight={900} style={{ textAlign: "center", justifyContent: "center", display: "flex" }}>נסגר!</Line>
                    </div>
                  </div>
                );
              })}
              {stamps.map((s) => <Flash key={s.at} f={f} at={s.at} len={3} color="#f5dfa0" />)}
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.whoosh]} at={1} volume={0.16} />
        <Sfx src={urls[SFX.impact]} at={on(close, "לסגור") + 2} volume={0.3} />
        <Sfx src={urls[SFX.impact]} at={on(close, "עסקאות")} volume={0.34} />
        <Sfx src={urls[SFX.impact]} at={on(close, "עסקאות") + 7} volume={0.34} />
        <Sfx src={urls[SFX.chime]} at={on(close, "עסקאות") + 9} volume={0.14} />
        {voice(close)}
      </SceneFrame>

      {/* ---------- 5. The ending: one clean, quiet card ---------- */}
      <SceneFrame from={cta.startFrame} durationInFrames={cta.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - cta.startFrame;
          const reveal = interpolate(f, [0, 12], [0, 1], { ...clamp, easing: easeOut });
          const logoP = spring({ frame: f - 3, fps, config: { damping: 14, stiffness: 110 } });
          const logo = W * 0.44;
          const jAt = on(cta, "הצטרפו");
          const jP = spring({ frame: f - jAt, fps, config: { damping: 12, stiffness: 140 } });
          const hair = (w: number): React.CSSProperties => ({ height: 2, width: w, background: `linear-gradient(90deg, transparent, ${palette.accent}, transparent)` });
          const verbs = [
            { t: "מתחברים", at: on(cta, "מתחברים") },
            { t: "משתפים", at: on(cta, "משתפים") },
            { t: "סוגרים עסקאות", at: on(cta, "סוגרים") },
          ];
          return (
            <AbsoluteFill style={{ clipPath: `circle(${reveal * 150}% at 50% 36%)`, background: palette.bg }}>
              {/* a fine gold frame */}
              <div style={{ position: "absolute", inset: W * 0.045, border: `1.5px solid rgba(201,162,39,0.55)`, borderRadius: W * 0.02 }} />
              <div style={{ position: "absolute", left: (W - logo) / 2, top: H * 0.1, width: logo, height: logo, opacity: interpolate(f, [2, 6], [0, 1], clamp), transform: `translateY(${(1 - logoP) * H * 0.02}px) scale(${1.08 - 0.08 * logoP})`, WebkitMaskImage: "radial-gradient(closest-side, #000 90%, transparent 100%)", maskImage: "radial-gradient(closest-side, #000 90%, transparent 100%)" }}>
                <Img src={urls[IMG.logo]} style={{ width: "100%", height: "100%" }} />
              </div>
              <div style={{ position: "absolute", top: H * 0.35, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.012 }}>
                <div style={{ ...shown(f, 8, fps, H, 1.0) }}><Line size={W * 0.052} weight={600} color={palette.accent} style={{ letterSpacing: W * 0.012 }}>שוק נדל״ן</Line></div>
                <div style={{ ...hair(W * 0.32), opacity: interpolate(f, [8, 14], [0, 1], clamp) }} />
                <div style={shown(f, on(cta, "מצטרפים"), fps, H, 1.06)}><Line size={W * 0.066} color={palette.ink}>מצטרפים לקהילה החכמה</Line></div>
                <div style={shown(f, on(cta, "יועצי"), fps, H, 1.06)}><Line size={W * 0.05} weight={600} color={palette.hero}>של יועצי הנדל״ן של ישראל</Line></div>
              </div>
              <div style={{ position: "absolute", top: H * 0.515, width: "100%", display: "flex", justifyContent: "center", gap: W * 0.03, direction: "rtl", alignItems: "center" }}>
                {verbs.map((v, i) => (
                  <React.Fragment key={v.t}>
                    <div style={shown(f, v.at, fps, H, 1.1)}><Line size={W * 0.038} weight={600} color={"#6b7280"}>{v.t}</Line></div>
                    {i < 2 ? <div style={{ ...shown(f, v.at, fps, H, 1.0), width: W * 0.012, height: W * 0.012, background: palette.accent, borderRadius: "50%" }} /> : null}
                  </React.Fragment>
                ))}
              </div>
              {f >= jAt ? (
                <div style={{ position: "absolute", top: H * 0.565, width: "100%", display: "flex", justifyContent: "center", opacity: interpolate(f - jAt, [0, 2], [0, 1], clamp), transform: `scale(${0.85 + 0.15 * jP})` }}>
                  <div style={{ background: palette.hero, borderRadius: W * 0.08, padding: `${H * 0.011}px ${W * 0.1}px`, boxShadow: "0 18px 44px rgba(14,42,107,0.32)", border: `2px solid ${palette.accent}` }}>
                    <Line size={W * 0.066} color={palette.accent}>הצטרפו עכשיו</Line>
                  </div>
                </div>
              ) : null}
              {/* the address, at the very bottom of the area Meta covers */}
              <div style={{ position: "absolute", left: 0, right: 0, bottom: H * 0.045, display: "flex", justifyContent: "center", opacity: interpolate(f, [on(cta, "סוגרים") + 6, on(cta, "סוגרים") + 12], [0, 1], clamp) }}>
                <div style={{ fontFamily: heebo, fontWeight: 600, fontSize: W * 0.038, color: palette.hero, direction: "ltr", letterSpacing: W * 0.004 }}>shuknadlan.co.il</div>
              </div>
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.whoosh]} at={1} volume={0.2} />
        <Sfx src={urls[SFX.sparkle]} at={4} volume={0.18} />
        <Sfx src={urls[SFX.pop]} at={wf(cta, "מתחברים") + 1} volume={0.14} />
        <Sfx src={urls[SFX.pop]} at={wf(cta, "משתפים") + 1} volume={0.14} />
        <Sfx src={urls[SFX.pop]} at={wf(cta, "סוגרים") + 1} volume={0.14} />
        <Sfx src={urls[SFX.impact]} at={wf(cta, "הצטרפו") + 1} volume={0.22} />
        <Sfx src={urls[SFX.chime]} at={wf(cta, "עכשיו") + 3} volume={0.16} />
        {voice(cta, false)}
      </SceneFrame>

      {manifest.music ? <Music src={urls[manifest.music.key]} duckTo={0.28} /> : null}
      <Grain blend="multiply" opacity={0.04} />
      <Vignette strength={0.1} />
    </AbsoluteFill>
  );
};
