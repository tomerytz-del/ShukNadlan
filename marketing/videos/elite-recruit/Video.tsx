import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";
import { BgMesh, Captions, Grain, Icon, Music, SceneFrame, Sfx, Vignette, Voiceover, font, onWord, sceneById, wordFrame } from "reelkit/kit";
import type { VideoProps } from "reelkit/kit";

// "Elite recruitment": a 29 second promo for brokers. Same series as one-place / call-to-meeting:
// warm off-white ground, sapphire hero, gold accent, heebo, RTL. Every screen is drawn in code, except the mentor
// card, which is a real screenshot from the CRM. No numbers, no prices: the only figure is "2 months", from the offer.
const palette = {
  bg: "#F7F4EF", // the same ground as the logo file, so the logo sits on it without an edge
  ink: "#0d1b3d",
  hero: "#0e2a6b",
  accent: "#c9a227",
  teal: "#0f766e",
  dim: "#6b7280",
  line: "#e7e3da",
  soft: "#eef2fa",
  dark: "#0f1f4a",
  red: "#e5484d",
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
  logo: "assets/user/a-a78033d5-logo-shuknadlan.png",
  mentor: "assets/user/a-2001e807-mentor-crop.png",
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

const Line: React.FC<{ size: number; weight?: number; color?: string; style?: React.CSSProperties; children: React.ReactNode }> = ({ size, weight = 800, color = palette.hero, style, children }) => (
  <div style={{ fontFamily: heebo, fontSize: size, fontWeight: weight, color, direction: "rtl", whiteSpace: "nowrap", lineHeight: 1.15, ...style }}>{children}</div>
);

// Plain glyphs for the feature tiles (stroke icons, no brand marks).
const Glyph: React.FC<{ kind: string; size: number; color: string }> = ({ kind, size, color }) => {
  const p = { fill: "none", stroke: color, strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      {kind === "house" ? (
        <>
          <path {...p} d="M6 22L24 7l18 15" />
          <path {...p} d="M11 20v21h26V20" />
          <path {...p} d="M20 41V29h8v12" />
        </>
      ) : null}
      {kind === "megaphone" ? (
        <>
          <path {...p} d="M8 20v8l6 1 18 9V11L14 19z" />
          <path {...p} d="M36 18c3 2 3 10 0 12" />
          <path {...p} d="M13 29l3 11h5l-2-9" />
        </>
      ) : null}
      {kind === "funnel" ? (
        <>
          <path {...p} d="M6 9h36L28 26v14l-8-4V26z" />
        </>
      ) : null}
      {kind === "link" ? (
        <>
          <circle {...p} cx="12" cy="24" r="6" />
          <circle {...p} cx="36" cy="12" r="6" />
          <circle {...p} cx="36" cy="36" r="6" />
          <path {...p} d="M17 21l14-7M17 27l14 7" />
        </>
      ) : null}
      {kind === "sparkle" ? (
        <>
          <path fill={color} d="M20 5l4.2 12.8L37 22l-12.8 4.2L20 39l-4.2-12.8L3 22l12.8-4.2z" />
          <path fill={color} d="M38 26l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
        </>
      ) : null}
      {kind === "bell" ? (
        <>
          <path {...p} d="M12 34V22a12 12 0 0 1 24 0v12l3 4H9z" />
          <path {...p} d="M20 41a4 4 0 0 0 8 0" />
        </>
      ) : null}
      {kind === "calendar" ? (
        <>
          <rect {...p} x="7" y="10" width="34" height="31" rx="5" />
          <path {...p} d="M7 20h34M16 6v8M32 6v8" />
        </>
      ) : null}
      {kind === "check" ? (
        <>
          <rect {...p} x="8" y="8" width="32" height="32" rx="8" />
          <path {...p} d="M16 25l6 6 11-13" />
        </>
      ) : null}
      {kind === "chat" ? (
        <>
          <path {...p} d="M8 10h32v22H22l-8 7v-7H8z" />
        </>
      ) : null}
      {kind === "mail" ? (
        <>
          <rect {...p} x="6" y="11" width="36" height="26" rx="5" />
          <path {...p} d="M8 14l16 12 16-12" />
        </>
      ) : null}
      {kind === "phone" ? (
        <>
          <path {...p} d="M13 7l6 2 2 8-4 3c2 6 6 10 12 12l3-4 8 2 2 6c-1 5-6 7-12 5C18 38 9 28 7 17c-1-5 1-9 6-10z" />
        </>
      ) : null}
      {kind === "sheet" ? (
        <>
          <rect {...p} x="8" y="7" width="32" height="34" rx="4" />
          <path {...p} d="M8 18h32M8 28h32M20 7v34" />
        </>
      ) : null}
      {kind === "users" ? (
        <>
          <circle {...p} cx="24" cy="16" r="7" />
          <path {...p} d="M9 41c1-9 7-13 15-13s14 4 15 13" />
        </>
      ) : null}
    </svg>
  );
};

// The mess: seven loose "systems" a broker juggles. Positions are fractions of the frame (centre of each card).
const MESS = [
  { kind: "chat", label: "הודעות", x: 0.19, y: 0.33, rot: -7 },
  { kind: "calendar", label: "יומן", x: 0.81, y: 0.35, rot: 6 },
  { kind: "phone", label: "שיחות", x: 0.17, y: 0.5, rot: 5 },
  { kind: "sheet", label: "גיליון", x: 0.83, y: 0.52, rot: -5 },
  { kind: "mail", label: "מייל", x: 0.22, y: 0.69, rot: -4 },
  { kind: "bell", label: "התראות", x: 0.78, y: 0.7, rot: 7 },
  { kind: "check", label: "משימות", x: 0.5, y: 0.34, rot: 3 },
];

// The broker: a plain silhouette in the hero colour, one hand on the head.
const Broker: React.FC<{ size: number; frame: number }> = ({ size, frame }) => (
  <svg width={size} height={size * 1.05} viewBox="0 0 200 210">
    <ellipse cx="100" cy="205" rx="70" ry="6" fill="rgba(13,27,61,0.12)" />
    <path d="M24 205c0-52 28-78 76-78s76 26 76 78z" fill={palette.hero} />
    <path d="M86 127l14 30 14-30z" fill="#ffffff" />
    <circle cx="100" cy="82" r="38" fill="#2b4a9a" />
    <path d="M62 78c2-24 18-36 40-36s34 12 36 34c-14-12-52-14-76 2z" fill={palette.dark} />
    <g transform={`rotate(${Math.sin(frame / 6) * 4} 160 100)`}>
      <circle cx="160" cy="100" r="13" fill="#2b4a9a" />
      <path d="M150 112l-20 36" stroke="#2b4a9a" strokeWidth="14" strokeLinecap="round" />
    </g>
  </svg>
);

const MessCard: React.FC<{ c: (typeof MESS)[number]; W: number; H: number; scale?: number; opacity?: number; dx?: number; dy?: number; bob?: number; showBadge?: boolean }> = ({ c, W, H, scale = 1, opacity = 1, dx = 0, dy = 0, bob = 0, showBadge = true }) => {
  const w = W * 0.28, h = H * 0.078;
  return (
    <div style={{ position: "absolute", left: c.x * W - w / 2 + dx, top: c.y * H - h / 2 + dy + bob, width: w, height: h, opacity, transform: `rotate(${c.rot}deg) scale(${scale})`, background: "#ffffff", borderRadius: W * 0.035, boxShadow: "0 18px 44px rgba(13,27,61,0.2)", border: `${W * 0.004}px solid ${palette.line}`, display: "flex", alignItems: "center", justifyContent: "center", gap: W * 0.025, direction: "rtl" }}>
      <Glyph kind={c.kind} size={W * 0.075} color={palette.hero} />
      <Line size={W * 0.04} weight={700} color={palette.ink}>{c.label}</Line>
      {showBadge ? <div style={{ position: "absolute", top: -W * 0.015, left: -W * 0.015, width: W * 0.04, height: W * 0.04, borderRadius: "50%", background: palette.red, border: `${W * 0.005}px solid #ffffff` }} /> : null}
    </div>
  );
};

const FEATURES = [
  { id: "crm", kind: "house", title: "CRM", sub: "ניהול נכסים ולקוחות", word: "לקוחות", nth: 1 },
  { id: "mkt", kind: "megaphone", title: "שיווק", sub: "פרסום ושיווק נכסים", word: "שיווק", nth: 1 },
  { id: "leads", kind: "funnel", title: "לידים", sub: "הזדמנויות עסקיות", word: "וחשיפה", nth: 1 },
  { id: "collab", kind: "link", title: "שיתופי פעולה", sub: "בין מתווכים", word: "שיתופי", nth: 1 },
  { id: "ai", kind: "sparkle", title: "כלי AI", sub: "בינה מלאכותית מתקדמת", word: "AI", nth: 1 },
  { id: "gab", kind: "wa", title: "גבריאלה", sub: "העוזרת האישית בוואטסאפ", word: "מתקדמים", nth: 1 },
];

export const Video: React.FC<VideoProps> = ({ manifest, urls }) => {
  const frame = useCurrentFrame();
  const real = useVideoConfig();
  const fps = real.fps;
  const W = real.width;
  const H = real.height;

  const hook = sceneById(manifest, "hook");
  const one = sceneById(manifest, "one");
  const tools = sceneById(manifest, "tools");
  const offer = sceneById(manifest, "offer");
  const cta = sceneById(manifest, "cta");
  type S = typeof hook;
  const on = (s: S, w: string, o?: { nth?: number }) => onWord(s, w, o);
  const wf = (s: S, w: string, o?: { nth?: number }) => wordFrame(s, w, o);

  const voice = (s: S) => (
    <>
      <Captions words={s.words} group={manifest.captions} rtl face={heebo} highlight={palette.accent} mode="highlight" />
      {s.voiceoverKey ? <Voiceover src={urls[s.voiceoverKey]} /> : null}
    </>
  );

  return (
    <AbsoluteFill style={{ background: palette.bg }}>
      <BgMesh bg={palette.bg} hero={palette.hero} accent={palette.accent} />

      {/* ---------- 1. The hook: too many systems ---------- */}
      <SceneFrame from={hook.startFrame} durationInFrames={hook.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - hook.startFrame;
          const t1 = on(hook, "מתווך");
          const t2 = on(hook, "מערכות");
          const brokerP = spring({ frame: f - 2, fps, config: smooth });
          return (
            <AbsoluteFill>
              <div style={{ position: "absolute", top: H * 0.07, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.008 }}>
                <div style={shown(f, t1, fps, H, 1.25)}><Line size={W * 0.15} color={palette.hero}>מתווך<span style={{ color: palette.accent }}>?</span></Line></div>
                <div style={shown(f, t2, fps, H, 1.12)}><Line size={W * 0.066} color={palette.ink}>כמה מערכות אתה צריך?</Line></div>
              </div>
              <div style={{ position: "absolute", left: W * 0.5 - W * 0.17, top: H * 0.5, opacity: interpolate(f, [0, 3], [0, 1], clamp), transform: `translateY(${(1 - brokerP) * H * 0.04}px)` }}>
                <Broker size={W * 0.34} frame={f} />
              </div>
              {MESS.map((c, i) => {
                const at = 6 + i * 11;
                const p = spring({ frame: f - at, fps, config: { damping: 11, stiffness: 160 } });
                return f >= at ? (
                  <MessCard key={c.kind} c={c} W={W} H={H} scale={0.5 + 0.5 * p} opacity={interpolate(f - at, [0, 2], [0, 1], clamp)} bob={Math.sin((f + i * 9) / 8) * H * 0.004} />
                ) : null;
              })}
            </AbsoluteFill>
          );
        })()}
        {MESS.map((c, i) => <Sfx key={c.kind} src={urls[i % 2 ? SFX.ping : SFX.pop]} at={6 + i * 11} volume={0.14} />)}
        <Sfx src={urls[SFX.riser]} at={wf(hook, "צריך") - 4} volume={0.12} />
        {voice(hook)}
      </SceneFrame>

      {/* ---------- 2. One place: everything is pulled into one screen ---------- */}
      <SceneFrame from={one.startFrame} durationInFrames={one.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - one.startFrame;
          const pullAt = on(one, "הכול", { }) - 8;
          const pull = interpolate(f, [pullAt, pullAt + 14], [0, 1], { ...clamp, easing: easeOut });
          const panel = spring({ frame: f - (pullAt + 6), fps, config: smooth });
          const cx = 0.5, cy = 0.5;
          const tiles = [
            { label: "לידים חדשים", kind: "bell" },
            { label: "פגישות היום", kind: "calendar" },
            { label: "משימות", kind: "check" },
          ];
          return (
            <AbsoluteFill>
              <div style={{ position: "absolute", top: H * 0.07, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.008 }}>
                <div style={shown(f, on(one, "הגיע"), fps, H, 1.12)}><Line size={W * 0.075} color={palette.ink}>הגיע הזמן לנהל</Line></div>
                <div style={shown(f, on(one, "הכול"), fps, H, 1.12)}><Line size={W * 0.095}>הכול <span style={{ color: palette.accent }}>במקום אחד</span></Line></div>
              </div>
              {f < pullAt + 16 ? (
                <div style={{ position: "absolute", left: W * 0.5 - W * 0.17, top: H * 0.5, opacity: 1 - pull }}>
                  <Broker size={W * 0.34} frame={f} />
                </div>
              ) : null}
              {MESS.map((c) => (
                <MessCard key={c.kind} c={c} W={W} H={H} scale={1 - 0.75 * pull} opacity={1 - pull} dx={(cx - c.x) * W * pull} dy={(cy - c.y) * H * pull} showBadge={pull < 0.5} />
              ))}
              {/* the one screen */}
              {f >= pullAt + 6 ? (
                <div style={{ position: "absolute", left: W * 0.08, right: W * 0.08, top: H * 0.3, height: H * 0.42, borderRadius: W * 0.05, background: "#ffffff", boxShadow: "0 30px 70px rgba(13,27,61,0.22)", border: `${W * 0.004}px solid ${palette.line}`, overflow: "hidden", opacity: interpolate(f - pullAt - 6, [0, 3], [0, 1], clamp), transform: `scale(${0.85 + 0.15 * panel})` }}>
                  <div style={{ height: H * 0.07, background: palette.hero, display: "flex", alignItems: "center", justifyContent: "space-between", padding: `0 ${W * 0.04}px`, direction: "rtl" }}>
                    <Line size={W * 0.04} color="#ffffff" weight={800}>שוק נדל״ן</Line>
                    <div style={{ display: "flex", gap: W * 0.012 }}>
                      {[0, 1, 2].map((d) => <div key={d} style={{ width: W * 0.018, height: W * 0.018, borderRadius: "50%", background: palette.accent, opacity: 0.4 + d * 0.3 }} />)}
                    </div>
                  </div>
                  <div style={{ padding: W * 0.04, display: "flex", flexDirection: "column", gap: H * 0.014 }}>
                    {tiles.map((t, i) => {
                      const at = pullAt + 14 + i * 6;
                      return (
                        <div key={t.label} style={{ display: "flex", alignItems: "center", gap: W * 0.035, height: H * 0.072, background: palette.soft, borderRadius: W * 0.03, padding: `0 ${W * 0.035}px`, direction: "rtl", ...shown(f, at, fps, H, 1.06) }}>
                          <Glyph kind={t.kind} size={W * 0.07} color={palette.hero} />
                          <Line size={W * 0.046} weight={700} color={palette.ink}>{t.label}</Line>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.whoosh]} at={on(one, "הכול") - 8} volume={0.22} />
        <Sfx src={urls[SFX.impact]} at={on(one, "הכול") + 8} volume={0.2} />
        <Sfx src={urls[SFX.tap]} at={on(one, "במקום") + 2} volume={0.16} />
        {voice(one)}
      </SceneFrame>

      {/* ---------- 3. The tools: six tiles, then the real mentor card ---------- */}
      <SceneFrame from={tools.startFrame} durationInFrames={tools.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - tools.startFrame;
          const mAt = on(tools, "שמתווך");
          const shrink = interpolate(f, [mAt - 6, mAt + 8], [0, 1], { ...clamp, easing: easeOut });
          const mP = spring({ frame: f - mAt, fps, config: smooth });
          const gridW = W * 0.9, tileH = H * 0.165, gap = W * 0.03;
          const tileW = (gridW - gap) / 2;
          const gridTop = H * 0.075;
          const gridScale = 1 - 0.34 * shrink;
          const mentorW = W * 0.88, mentorH = mentorW * (580 / 979);
          const mentorTop = gridTop + (tileH * 3 + gap * 2) * gridScale + H * 0.045;
          return (
            <AbsoluteFill>
              <div style={{ position: "absolute", left: (W - gridW) / 2, top: gridTop, width: gridW, transformOrigin: "50% 0", transform: `scale(${gridScale})`, display: "grid", gridTemplateColumns: `${tileW}px ${tileW}px`, gap, direction: "rtl" }}>
                {FEATURES.map((ft) => {
                  const at = on(tools, ft.word, { nth: ft.nth });
                  const p = spring({ frame: f - at, fps, config: snappy });
                  return (
                    <div key={ft.id} style={{ height: tileH, borderRadius: W * 0.04, background: "#ffffff", border: `${W * 0.004}px solid ${palette.line}`, boxShadow: "0 16px 40px rgba(13,27,61,0.14)", display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: H * 0.004, padding: `0 ${W * 0.035}px`, opacity: f >= at ? interpolate(f - at, [0, 2], [0, 1], clamp) : 0, transform: `scale(${0.8 + 0.2 * p})` }}>
                      <div style={{ width: W * 0.11, height: W * 0.11, borderRadius: W * 0.03, background: palette.hero, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: H * 0.004 }}>
                        {ft.kind === "wa" ? <Icon name="whatsapp" size={W * 0.075} color="#ffffff" /> : <Glyph kind={ft.kind} size={W * 0.07} color={ft.kind === "sparkle" ? palette.accent : "#ffffff"} />}
                      </div>
                      <Line size={W * 0.052} color={palette.hero}>{ft.title}</Line>
                      <Line size={W * 0.03} weight={600} color={palette.dim}>{ft.sub}</Line>
                    </div>
                  );
                })}
              </div>
              {f >= mAt ? (
                <div style={{ position: "absolute", left: (W - mentorW) / 2, top: mentorTop, width: mentorW, opacity: interpolate(f - mAt, [0, 3], [0, 1], clamp), transform: `translateY(${(1 - mP) * H * 0.05}px) scale(${0.9 + 0.1 * mP})` }}>
                  <div style={{ position: "relative", width: mentorW, height: mentorH, borderRadius: W * 0.04, overflow: "hidden", border: `${W * 0.006}px solid ${palette.accent}`, boxShadow: "0 28px 70px rgba(13,27,61,0.3)", background: palette.dark }}>
                    <Img src={urls[IMG.mentor]} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                  <div style={{ position: "absolute", top: -H * 0.022, right: W * 0.04, background: palette.accent, color: palette.ink, padding: `${H * 0.005}px ${W * 0.045}px`, borderRadius: W * 0.05, boxShadow: "0 10px 26px rgba(13,27,61,0.25)" }}>
                    <Line size={W * 0.04} color={palette.ink}>מנטור AI מלווה אותך להצלחה</Line>
                  </div>
                </div>
              ) : null}
            </AbsoluteFill>
          );
        })()}
        {FEATURES.map((ft, i) => <Sfx key={ft.id} src={urls[i % 3 === 0 ? SFX.pop : i % 3 === 1 ? SFX.tap : SFX.ping]} at={on(tools, ft.word, { nth: ft.nth }) + 1} volume={0.2} />)}
        <Sfx src={urls[SFX.sparkle]} at={wf(tools, "AI") + 2} volume={0.14} />
        <Sfx src={urls[SFX.whoosh]} at={on(tools, "שמתווך") - 2} volume={0.2} />
        <Sfx src={urls[SFX.impact]} at={on(tools, "שמתווך") + 4} volume={0.18} />
        {voice(tools)}
      </SceneFrame>

      {/* ---------- 4. The offer: two months of Elite, no charge ---------- */}
      <SceneFrame from={offer.startFrame} durationInFrames={offer.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - offer.startFrame;
          const bAt = on(offer, "חודשיים");
          const jAt = on(offer, "הצטרפו");
          const badge = spring({ frame: f - bAt, fps, config: { damping: 9, stiffness: 150 } });
          const dev = spring({ frame: f - 2, fps, config: smooth });
          const pill = spring({ frame: f - jAt, fps, config: snappy });
          const lapW = W * 0.78, lapH = lapW * 0.6;
          const miniTiles = (w: number, h: number, n: number) => (
            <div style={{ display: "flex", flexDirection: "column", gap: h * 0.04, padding: h * 0.07 }}>
              <div style={{ height: h * 0.1, width: "46%", borderRadius: h, background: "rgba(255,255,255,0.85)", alignSelf: "flex-end" }} />
              {Array.from({ length: n }).map((_, i) => <div key={i} style={{ height: h * 0.15, borderRadius: h * 0.04, background: i % 2 ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.24)" }} />)}
            </div>
          );
          return (
            <AbsoluteFill>
              <div style={{ position: "absolute", top: H * 0.07, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.008 }}>
                <div style={shown(f, on(offer, "מתחילים"), fps, H, 1.12)}><Line size={W * 0.075} color={palette.ink}>מתחילים עם חודשיים</Line></div>
                <div style={shown(f, on(offer, "Elite"), fps, H, 1.2)}><Line size={W * 0.105}><span style={{ color: palette.accent }}>Elite</span> ללא תשלום!</Line></div>
              </div>
              {/* laptop */}
              <div style={{ position: "absolute", left: W * 0.5 - lapW / 2, top: H * 0.31, opacity: interpolate(f, [0, 3], [0, 1], clamp), transform: `translateY(${(1 - dev) * H * 0.05}px)` }}>
                <div style={{ width: lapW, height: lapH, background: palette.ink, borderRadius: W * 0.03, padding: W * 0.018, boxShadow: "0 30px 70px rgba(13,27,61,0.3)" }}>
                  <div style={{ width: "100%", height: "100%", borderRadius: W * 0.015, background: palette.hero, overflow: "hidden" }}>{miniTiles(lapW, lapH, 5)}</div>
                </div>
                <div style={{ width: lapW * 1.1, height: W * 0.026, marginLeft: -lapW * 0.05, background: "#cfd6e6", borderRadius: `0 0 ${W * 0.03}px ${W * 0.03}px` }} />
              </div>
              {/* phone */}
              <div style={{ position: "absolute", left: W * 0.5 - W * 0.43, top: H * 0.42, width: W * 0.22, height: W * 0.22 * 2, background: palette.ink, borderRadius: W * 0.04, padding: W * 0.012, boxShadow: "0 26px 60px rgba(13,27,61,0.35)", opacity: interpolate(f, [4, 8], [0, 1], clamp), transform: `translateY(${(1 - dev) * H * 0.07}px)` }}>
                <div style={{ width: "100%", height: "100%", borderRadius: W * 0.03, background: palette.hero, overflow: "hidden" }}>{miniTiles(W * 0.22, W * 0.44, 4)}</div>
              </div>
              {/* the badge */}
              {f >= bAt ? (
                <div style={{ position: "absolute", right: W * 0.06, top: H * 0.285, width: W * 0.3, height: W * 0.3, borderRadius: "50%", background: `radial-gradient(circle at 35% 30%, #f2d77a, ${palette.accent})`, border: `${W * 0.008}px solid #ffffff`, boxShadow: "0 22px 50px rgba(201,162,39,0.55)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: interpolate(f - bAt, [0, 2], [0, 1], clamp), transform: `scale(${0.4 + 0.6 * badge}) rotate(${(1 - badge) * -25}deg)` }}>
                  <div style={{ fontFamily: heebo, fontWeight: 900, fontSize: W * 0.17, lineHeight: 0.95, color: palette.ink }}>2</div>
                  <Line size={W * 0.052} color={palette.ink}>חודשים</Line>
                </div>
              ) : null}
              {f >= jAt ? (
                <div style={{ position: "absolute", top: H * 0.7, width: "100%", display: "flex", justifyContent: "center", opacity: interpolate(f - jAt, [0, 2], [0, 1], clamp), transform: `scale(${0.85 + 0.15 * pill})` }}>
                  <div style={{ background: palette.hero, borderRadius: W * 0.08, padding: `${H * 0.012}px ${W * 0.07}px`, boxShadow: "0 18px 44px rgba(14,42,107,0.35)" }}>
                    <Line size={W * 0.055} color="#ffffff">הצטרפו עכשיו למסלול <span style={{ color: "#f5dfa0" }}>Elite</span></Line>
                  </div>
                </div>
              ) : null}
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.whoosh]} at={2} volume={0.16} />
        <Sfx src={urls[SFX.impact]} at={wf(offer, "חודשיים") + 1} volume={0.24} />
        <Sfx src={urls[SFX.sparkle]} at={wf(offer, "חודשיים") + 2} volume={0.2} />
        <Sfx src={urls[SFX.tap]} at={wf(offer, "הצטרפו") + 1} volume={0.22} />
        {voice(offer)}
      </SceneFrame>

      {/* ---------- 5. The close: the original logo, the line, the call to act ---------- */}
      <SceneFrame from={cta.startFrame} durationInFrames={cta.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - cta.startFrame;
          const logoP = spring({ frame: f - 2, fps, config: { damping: 12, stiffness: 120 } });
          const jAt = on(cta, "הצטרפו");
          const jP = spring({ frame: f - jAt, fps, config: { damping: 10, stiffness: 150 } });
          const logoSize = W * 0.64;
          return (
            <AbsoluteFill style={{ background: palette.bg }}>
              {/* the logo is untouched: the original file, on its own ground, only scaled and faded in */}
              <div style={{ position: "absolute", left: (W - logoSize) / 2, top: H * 0.045, width: logoSize, height: logoSize, opacity: interpolate(f, [0, 4], [0, 1], clamp), transform: `translateY(${(1 - logoP) * H * 0.02}px) scale(${1.12 - 0.12 * logoP})`, WebkitMaskImage: "radial-gradient(closest-side, #000 90%, transparent 100%)", maskImage: "radial-gradient(closest-side, #000 90%, transparent 100%)" }}>
                <Img src={urls[IMG.logo]} style={{ width: "100%", height: "100%" }} />
              </div>
              <div style={{ position: "absolute", top: H * 0.4, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.004 }}>
                <div style={shown(f, on(cta, "העסק"), fps, H, 1.1)}><Line size={W * 0.075}>העסק שלך ראוי</Line></div>
                <div style={shown(f, on(cta, "לעבוד"), fps, H, 1.1)}><Line size={W * 0.075}>לעבוד <span style={{ color: palette.accent }}>חכם יותר.</span></Line></div>
              </div>
              {f >= jAt ? (
                <div style={{ position: "absolute", top: H * 0.585, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.014, opacity: interpolate(f - jAt, [0, 2], [0, 1], clamp), transform: `scale(${0.8 + 0.2 * jP})` }}>
                  <div style={{ background: palette.accent, borderRadius: W * 0.08, padding: `${H * 0.012}px ${W * 0.09}px`, boxShadow: "0 18px 44px rgba(201,162,39,0.5)" }}>
                    <Line size={W * 0.09} color={palette.ink}>הצטרפו עכשיו!</Line>
                  </div>
                  <div style={{ ...shown(f, jAt + 8, fps, H, 1.05), fontFamily: heebo, fontWeight: 800, fontSize: W * 0.055, color: palette.hero, direction: "ltr", letterSpacing: 0.5 }}>shuknadlan.co.il</div>
                </div>
              ) : null}
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.sparkle]} at={2} volume={0.2} />
        <Sfx src={urls[SFX.riser]} at={Math.max(0, wf(cta, "הצטרפו") - 24)} volume={0.14} />
        <Sfx src={urls[SFX.impact]} at={wf(cta, "הצטרפו") + 2} volume={0.24} />
        <Sfx src={urls[SFX.chime]} at={wf(cta, "עכשיו") + 4} volume={0.16} />
        {voice(cta)}
      </SceneFrame>

      {manifest.music ? <Music src={urls[manifest.music.key]} duckTo={0.3} /> : null}
      <Grain blend="multiply" opacity={0.04} />
      <Vignette strength={0.1} />
    </AbsoluteFill>
  );
};
