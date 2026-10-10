import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";
import { BgMesh, Captions, Grain, Icon, Music, SceneFrame, Sfx, Vignette, Voiceover, font, onWord, sceneById, wordFrame } from "reelkit/kit";
import type { VideoProps } from "reelkit/kit";

// Same series as "call-to-meeting" and "property-intake": sapphire pin + gold shin, on a warm off-white ground.
// This one is for buyers and renters, and the screens are the real site (screenshots from a phone).
const palette = {
  bg: "#F7F5F0",
  ink: "#0d1b3d",
  hero: "#0e2a6b",
  accent: "#c9a227",
  dim: "#6b7280",
  line: "#e7e3da",
  soft: "#eef2fa",
  vizBg: "#0f1f4a",
  wa: "#25d366",
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
  logo: "assets/user/a-4857a6de-logo-shuknadlan.png",
  portrait: "assets/user/a-0f40a197-gabriela-portrait.jpg",
  home: "assets/user/a-1f61792f-home.jpg",
  mapIn: "assets/user/a-ca2a648b-map-zoom-in.jpg",
  mapOut: "assets/user/a-46a00522-map-zoom-out.jpg",
  houseBefore: "assets/user/a-664047c1-photo-before.jpg",
  houseAfter: "assets/user/a-763900c8-photo-after.jpg",
  houseLux: "assets/user/a-2e991bcc-photo-lux.jpg",
  shopBefore: "assets/user/a-7c219f6c-photo-shop-before.jpg",
  shopAfter: "assets/user/a-096793a5-photo-shop-after.jpg",
  petBefore: "assets/user/a-bae15092-photo-pet-before.jpg",
  petAfter: "assets/user/a-37a2eb3f-photo-pet-after.jpg",
  experts: "assets/user/a-4488f329-experts-card.jpg",
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const smooth = { damping: 18, stiffness: 120 };
const snappy = { damping: 13, stiffness: 170 };
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

// A whole Hebrew word or line entering: opacity is full within 2 frames, short rise, small settle.
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

const Chip: React.FC<{ text: string; bg?: string; color?: string; size: number; icon?: React.ReactNode; border?: string }> = ({ text, bg = palette.accent, color = palette.ink, size, icon, border }) => (
  <div style={{ display: "inline-flex", alignItems: "center", gap: size * 0.4, background: bg, color, padding: `${size * 0.35}px ${size * 0.8}px`, borderRadius: size * 2, fontFamily: heebo, fontWeight: 800, fontSize: size, direction: "rtl", whiteSpace: "nowrap", boxShadow: "0 10px 30px rgba(14,42,107,0.18)", border }}>
    {icon}
    <span>{text}</span>
  </div>
);

// A tap: a ring that expands and fades where a finger touches the screen.
const Tap: React.FC<{ at: number; x: number; y: number; d: number; color?: string }> = ({ at, x, y, d, color = palette.accent }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < -6 || t > 16) return null;
  return (
    <div style={{ position: "absolute", left: x - d / 2, top: y - d / 2, width: d, height: d }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(13,27,61,0.22)", opacity: interpolate(t, [-6, 0, 6, 12], [0, 1, 1, 0], clamp) }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `${d * 0.07}px solid ${color}`, opacity: interpolate(t, [0, 14], [1, 0], clamp), transform: `scale(${interpolate(t, [0, 14], [0.3, 1.7], clamp)})` }} />
    </div>
  );
};

const HeartGlyph: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 48 48">
    <path d="M24 41S6 30 6 17.5A9.5 9.5 0 0 1 24 13a9.5 9.5 0 0 1 18 4.5C42 30 24 41 24 41z" fill={color} />
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
  // scene's content, and the captions sit on the square frame itself.
  const square = real.height / real.width < 1.2;
  const W = real.width;
  const H = square ? Math.round((real.width * 16) / 9) : real.height;
  const STAGE = square ? 0.66 : 1;
  const WIN_TOP = square ? 130 : 0;

  const hook = sceneById(manifest, "hook");
  const all = sceneById(manifest, "all");
  const map = sceneById(manifest, "map");
  const ai = sceneById(manifest, "ai");
  const experts = sceneById(manifest, "experts");
  const payoff = sceneById(manifest, "payoff");
  type S = typeof hook;
  const on = (s: S, w: string, o?: { nth?: number }) => s.startFrame + onWord(s, w, o);

  const voice = (s: S) => (
    <>
      {square ? null : <Captions words={s.words} group={manifest.captions} rtl face={heebo} highlight={palette.accent} mode="highlight" />}
      {s.voiceoverKey ? <Voiceover src={urls[s.voiceoverKey]} /> : null}
    </>
  );

  // ---------- The phone: the real site, from scene 2 to the payoff ----------
  const SW = W * 0.54; // screen width; the screenshots are 1080 x 2109
  const SH = SW * (2109 / 1080);
  const PAD = SW * 0.035;
  const PW = SW + PAD * 2, PH = SH + PAD * 2;
  const phoneX = (W - PW) / 2, phoneY = H * 0.135;
  const scrX = phoneX + PAD, scrY = phoneY + PAD; // stage position of the screen's top-left corner
  const phoneIn = spring({ frame: frame - all.startFrame, fps, config: smooth });
  const phoneOutAt = payoff.startFrame + 2;
  const phoneOut = interpolate(frame, [phoneOutAt, phoneOutAt + 12], [0, 1], { ...clamp, easing: easeOut });
  const phoneOn = frame >= all.startFrame - 2 && frame < phoneOutAt + 14;

  // Scene 3: the map pulls out from the city centre to the whole city.
  const mapAt = on(map, "מפה");
  const pinch = interpolate(frame, [mapAt - 4, mapAt + 16], [0, 1], { ...clamp, easing: easeOut });
  const cardUp = spring({ frame: frame - on(map, "אינטראקטיבית") - 4, fps, config: snappy });

  // Scene 4: real visualizations from the site: the house, a new style, then two shops.
  // The line is fast, so after the first wipe the beats are evenly spaced to the end of the scene rather than on words.
  const v1 = on(ai, "הדמיות");
  const aiEnd = ai.startFrame + ai.durationFrames;
  const step = Math.max(12, Math.floor((aiEnd - (v1 + 18)) / 3));
  const v2 = v1 + 18, v3 = v2 + step, v4 = v3 + step;
  const shots = [
    { at: v1, before: IMG.houseBefore, after: IMG.houseAfter, label: "חזית הבית · מודרני נקי", style: 0 },
    { at: v2, before: IMG.houseAfter, after: IMG.houseLux, label: "חזית הבית · יוקרה מודרנית", style: 3 },
    { at: v3, before: IMG.shopBefore, after: IMG.shopAfter, label: "חלל העסק · פיצוציה", style: -1 },
    { at: v4, before: IMG.petBefore, after: IMG.petAfter, label: "חלל העסק · חנות חיות", style: -1 },
  ];
  const cur = frame >= v4 ? 3 : frame >= v3 ? 2 : frame >= v2 ? 1 : 0;
  const shot = shots[cur];
  const wipe = interpolate(frame, [shot.at, shot.at + (cur === 0 ? 16 : 9)], [0, 1], { ...clamp, easing: easeOut });

  // Scene 5: brokers, then the "talk to a real expert" card from the site.
  const brokersAt = on(experts, "מתווכים");
  const expertsAt = on(experts, "ומומחים");
  const findAt = on(experts, "מתחום");

  const screenOf = (): React.ReactNode => {
    const fill: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" };
    if (frame < map.startFrame) {
      // the home page, drifting slowly
      const s = interpolate(frame, [all.startFrame, map.startFrame], [1, 1.05], clamp);
      return <Img src={urls[IMG.home]} style={{ ...fill, transform: `scale(${s})`, transformOrigin: "50% 20%" }} />;
    }
    if (frame < ai.startFrame) {
      return (
        <>
          <Img src={urls[IMG.mapOut]} style={{ ...fill, opacity: pinch, transform: `scale(${1.6 - 0.6 * pinch})` }} />
          <Img src={urls[IMG.mapIn]} style={{ ...fill, opacity: 1 - pinch, transform: `scale(${1 - 0.38 * pinch})` }} />
          {/* the property card at the bottom of the real map rises on "interactive" */}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: SH * 0.2, background: "linear-gradient(transparent, rgba(13,27,61,0.18))", opacity: cardUp }} />
        </>
      );
    }
    if (frame < experts.startFrame) {
      const photoW = SW * 0.9, photoH = photoW * (535 / 790);
      const styles = ["מודרני נקי", "ים-תיכוני לבן", "סקנדינבי חמים", "יוקרה מודרנית"];
      return (
        <div style={{ position: "absolute", inset: 0, background: palette.vizBg, direction: "rtl" }}>
          <div style={{ position: "absolute", top: SH * 0.05, width: "100%", display: "flex", justifyContent: "center" }}>
            <Line size={SW * 0.058} color="#ffffff">בחרו את הסגנון המועדף עליכם!</Line>
          </div>
          {/* the four styles, as on the site */}
          <div style={{ position: "absolute", top: SH * 0.11, left: SW * 0.06, right: SW * 0.06, display: "grid", gridTemplateColumns: "1fr 1fr", gap: SW * 0.03, opacity: cur < 2 ? 1 : interpolate(frame, [v3 - 2, v3 + 4], [1, 0.25], clamp) }}>
            {styles.map((t, i) => {
              const active = i === shot.style;
              return (
                <div key={t} style={{ height: SH * 0.065, borderRadius: SW * 0.04, border: `${SW * 0.006}px solid ${active ? palette.accent : "rgba(255,255,255,0.25)"}`, background: active ? "#26314f" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: heebo, fontWeight: 700, fontSize: SW * 0.045, color: "#ffffff", whiteSpace: "nowrap", boxShadow: active ? `0 0 ${SW * 0.04}px rgba(201,162,39,0.45)` : "none" }}>{t}</div>
              );
            })}
          </div>
          {/* before / after, with the site's slider */}
          <div style={{ position: "absolute", top: SH * 0.3, left: (SW - photoW) / 2 - SW * 0.03, width: photoW + SW * 0.06, background: "#ffffff", borderRadius: SW * 0.05, padding: SW * 0.03, paddingBottom: SW * 0.02 }}>
            <div style={{ position: "relative", width: photoW, height: photoH, borderRadius: SW * 0.03, overflow: "hidden" }}>
              <Img src={urls[shot.before]} style={fill} />
              <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${wipe * 100}% 0 0)` }} />
              <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)` }}>
                <Img src={urls[shot.after]} style={fill} />
              </div>
              {wipe > 0.01 && wipe < 0.99 ? (
                <>
                  <div style={{ position: "absolute", top: 0, bottom: 0, left: `${wipe * 100}%`, width: SW * 0.008, background: palette.accent }} />
                  <div style={{ position: "absolute", top: photoH / 2 - SW * 0.06, left: `calc(${wipe * 100}% - ${SW * 0.06}px)`, width: SW * 0.12, height: SW * 0.12, borderRadius: "50%", background: palette.accent, border: `${SW * 0.008}px solid #ffffff`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: heebo, fontWeight: 800, fontSize: SW * 0.05, color: palette.ink }}>↔</div>
                </>
              ) : null}
              <div style={{ position: "absolute", top: SW * 0.03, right: SW * 0.03, background: "#ffffff", borderRadius: SW * 0.03, padding: `${SW * 0.008}px ${SW * 0.03}px`, fontFamily: heebo, fontWeight: 800, fontSize: SW * 0.04, color: palette.ink }}>Before</div>
              <div style={{ position: "absolute", top: SW * 0.03, left: SW * 0.03, background: palette.vizBg, borderRadius: SW * 0.03, padding: `${SW * 0.008}px ${SW * 0.03}px`, fontFamily: heebo, fontWeight: 800, fontSize: SW * 0.04, color: "#f5dfa0", display: "flex", alignItems: "center", gap: SW * 0.015 }}>
                <Sparkle size={SW * 0.035} color={palette.accent} />After
              </div>
            </div>
            <Line size={SW * 0.045} color={palette.ink} weight={700} style={{ padding: `${SW * 0.02}px ${SW * 0.01}px 0` }}>{shot.label}</Line>
          </div>
        </div>
      );
    }
    // scene 5: brokers on the site, then the experts card
    const ex = spring({ frame: frame - expertsAt, fps, config: smooth });
    return (
      <div style={{ position: "absolute", inset: 0, background: "#eef2f8", direction: "rtl" }}>
        <div style={{ position: "absolute", top: SH * 0.05, left: SW * 0.06, right: SW * 0.06, display: "flex", flexDirection: "column", gap: SH * 0.02, opacity: 1 - ex }}>
          <div style={{ display: "flex", gap: SW * 0.03 }}>
            <div style={{ flex: 1, height: SH * 0.05, borderRadius: SW * 0.04, background: palette.hero, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: heebo, fontWeight: 800, fontSize: SW * 0.045 }}>משרדי תיווך (26)</div>
            <div style={{ flex: 1, height: SH * 0.05, borderRadius: SW * 0.04, background: "#fff", border: `${SW * 0.005}px solid ${palette.hero}`, color: palette.hero, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: heebo, fontWeight: 800, fontSize: SW * 0.045 }}>מתווכים (33)</div>
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ height: SH * 0.1, borderRadius: SW * 0.05, background: "#ffffff", display: "flex", alignItems: "center", gap: SW * 0.04, padding: `0 ${SW * 0.05}px`, boxShadow: "0 6px 16px rgba(13,27,61,0.08)", ...shown(frame, brokersAt + i * 3, fps, H, 1.05) }}>
              <div style={{ width: SH * 0.065, height: SH * 0.065, borderRadius: "50%", background: palette.pins[i], display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <Icon name="user" size={SH * 0.035} color="#ffffff" />
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: SH * 0.01 }}>
                <div style={{ width: "70%", height: SH * 0.013, borderRadius: SW, background: palette.ink, opacity: 0.75 }} />
                <div style={{ width: "45%", height: SH * 0.011, borderRadius: SW, background: palette.line }} />
              </div>
              <div style={{ width: SH * 0.055, height: SH * 0.055, borderRadius: SW * 0.03, background: "#e8f8ee", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <Icon name="whatsapp" size={SH * 0.032} color="brand" />
              </div>
            </div>
          ))}
        </div>
        {frame >= expertsAt - 2 ? (
          <Img src={urls[IMG.experts]} style={{ position: "absolute", left: SW * 0.03, top: SH * 0.1, width: SW * 0.94, opacity: ex, transform: `translateY(${(1 - ex) * SH * 0.05}px)`, borderRadius: SW * 0.06 }} />
        ) : null}
      </div>
    );
  };

  // ---------- Scene 1: a thousand places to look ----------
  const chaosEnd = hook.startFrame + hook.durationFrames;
  const suck = interpolate(frame, [chaosEnd - 10, chaosEnd + 2], [0, 1], { ...clamp, easing: (t) => t * t });
  const chaos: { x: number; y: number; r: number; kind: "tab" | "group" | "wa" | "search" | "board"; text: string }[] = [
    { x: 0.27, y: 0.27, r: -6, kind: "tab", text: "אתר נדל״ן ארצי" },
    { x: 0.72, y: 0.25, r: 5, kind: "group", text: "קבוצת דירות בעמק" },
    { x: 0.5, y: 0.33, r: -2, kind: "search", text: "דירה בעפולה" },
    { x: 0.2, y: 0.4, r: 4, kind: "wa", text: "142 הודעות חדשות" },
    { x: 0.78, y: 0.41, r: -5, kind: "tab", text: "עוד אתר מודעות" },
    { x: 0.42, y: 0.47, r: 3, kind: "board", text: "לוח מודעות" },
    { x: 0.7, y: 0.53, r: 6, kind: "group", text: "קבוצה של 14,000" },
    { x: 0.26, y: 0.56, r: -4, kind: "wa", text: "קבוצת שכנים" },
    { x: 0.55, y: 0.61, r: -3, kind: "tab", text: "דירות להשכרה" },
    { x: 0.8, y: 0.31, r: 8, kind: "wa", text: "+99" },
    { x: 0.16, y: 0.31, r: -9, kind: "board", text: "מודעה בסופר" },
    { x: 0.36, y: 0.38, r: 7, kind: "tab", text: "מחירון דירות" },
  ];
  const stopAt = on(hook, "תפסיקו");
  const thousandAt = on(hook, "באלף");
  const count = Math.round(interpolate(frame, [hook.startFrame + 8, thousandAt], [0, 1000], { ...clamp, easing: (t) => t * t }));

  const chaosItem = (c: (typeof chaos)[number], i: number) => {
    const at = hook.startFrame + 4 + i * 3;
    if (frame < at) return null;
    const p = spring({ frame: frame - at, fps, config: snappy });
    const jitter = frame >= stopAt ? Math.sin((frame + i * 7) * 1.3) * 3 : 0;
    const x = (c.x + (0.5 - c.x) * suck) * W, y = (c.y + (0.46 - c.y) * suck) * H;
    const s = W * 0.036;
    const look: Record<string, { bg: string; color: string; icon: React.ReactNode }> = {
      tab: { bg: "#ffffff", color: palette.ink, icon: <div style={{ width: s * 0.7, height: s * 0.7, borderRadius: s * 0.2, background: palette.line }} /> },
      group: { bg: "#e7efff", color: "#1d3f8f", icon: <Icon name="user" size={s} color="#1d3f8f" /> },
      wa: { bg: "#dcf8c6", color: "#14532d", icon: <Icon name="message" size={s} color="#16a34a" /> },
      search: { bg: "#ffffff", color: palette.dim, icon: <svg width={s} height={s} viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke={palette.dim} strokeWidth="2.6" /><path d="M15.5 15.5L21 21" stroke={palette.dim} strokeWidth="2.6" strokeLinecap="round" /></svg> },
      board: { bg: "#fff6d8", color: "#7a5b00", icon: <Icon name="bell" size={s} color="#b8860b" /> },
    };
    const l = look[c.kind];
    return (
      <div key={i} style={{ position: "absolute", left: x, top: y, transform: `translate(-50%, -50%) rotate(${c.r + jitter}deg) scale(${(0.6 + 0.4 * p) * (1 - suck * 0.9)})`, opacity: interpolate(frame - at, [0, 2], [0, 1], clamp) * (1 - suck), display: "flex", alignItems: "center", gap: s * 0.45, background: l.bg, color: l.color, padding: `${s * 0.45}px ${s * 0.8}px`, borderRadius: s * 0.6, fontFamily: heebo, fontWeight: 800, fontSize: s, whiteSpace: "nowrap", direction: "rtl", boxShadow: "0 10px 28px rgba(13,27,61,0.16)", border: `${W * 0.002}px solid rgba(13,27,61,0.08)` }}>
        {l.icon}
        <span>{c.text}</span>
      </div>
    );
  };

  // ---------- Scene 6 ----------
  const enterAt = on(payoff, "היכנסו");
  const chooseAt = on(payoff, "ותתחילו");
  const askAt = on(payoff, "הנכס");

  return (
    <AbsoluteFill style={{ background: palette.bg }}>
      <style>{"*{box-sizing:border-box}"}</style>
      <BgMesh bg={palette.bg} hero={palette.hero} accent={palette.accent} />
      <div style={{ position: "absolute", left: (W - W * STAGE) / 2, top: -WIN_TOP * STAGE, width: W, height: H, transform: `scale(${STAGE})`, transformOrigin: "top left" }}>

      {/* Scene 1 */}
      <SceneFrame from={hook.startFrame} durationInFrames={hook.durationFrames} exit="cut">
        <AbsoluteFill>
          <div style={{ position: "absolute", top: H * 0.09, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.004, opacity: 1 - suck }}>
            <div style={shown(frame, hook.startFrame, fps, H, 1.15)}><Line size={W * 0.085}>מחפשים דירה</Line></div>
            <div style={shown(frame, on(hook, "בעפולה"), fps, H, 1.15)}><Line size={W * 0.085}>בעפולה <span style={{ color: palette.accent }}>והסביבה?</span></Line></div>
          </div>
          {chaos.map(chaosItem)}
          <div style={{ position: "absolute", top: H * 0.655, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", ...shown(frame, stopAt, fps, H, 1.2), opacity: frame >= stopAt ? 1 - suck : 0 }}>
            <Line size={W * 0.075} color={palette.ink}>תפסיקו לחפש</Line>
            <Line size={W * 0.075} color={palette.ink}>
              ב-<span style={{ color: "#c2410c", fontVariantNumeric: "tabular-nums", display: "inline-block", minWidth: W * 0.2, textAlign: "center", direction: "ltr" }}>{count}</span> מקומות
            </Line>
          </div>
        </AbsoluteFill>
        <Sfx src={urls[SFX.ping]} at={10} volume={0.12} />
        <Sfx src={urls[SFX.pop]} at={20} volume={0.12} />
        <Sfx src={urls[SFX.ping]} at={30} volume={0.12} />
        <Sfx src={urls[SFX.impact]} at={wordFrame(hook, "תפסיקו")} volume={0.24} />
        <Sfx src={urls[SFX.whoosh]} at={hook.durationFrames - 10} volume={0.24} />
        {voice(hook)}
      </SceneFrame>

      {/* Scene 2: every listing, every broker in the area */}
      <SceneFrame from={all.startFrame} durationInFrames={all.durationFrames} enter="cut" exit="cut">
        <AbsoluteFill>
          <div style={{ position: "absolute", top: H * 0.085, width: "100%", display: "flex", justifyContent: "center", ...shown(frame, all.startFrame + 2, fps, H, 1.12) }}>
            <Line size={W * 0.07}>כל הנכסים <span style={{ color: palette.accent }}>במקום אחד</span></Line>
          </div>
        </AbsoluteFill>
        <Sfx src={urls[SFX.whoosh]} at={0} volume={0.2} />
        <Sfx src={urls[SFX.pop]} at={wordFrame(all, "המתווכים")} volume={0.22} />
        <Sfx src={urls[SFX.pop]} at={wordFrame(all, "המתווכים") + 4} volume={0.18} />
        <Sfx src={urls[SFX.chime]} at={wordFrame(all, "בשוק")} volume={0.18} />
        {voice(all)}
      </SceneFrame>

      {/* Scene 3: an interactive map */}
      <SceneFrame from={map.startFrame} durationInFrames={map.durationFrames} enter="cut" exit="cut">
        <AbsoluteFill>
          <div style={{ position: "absolute", top: H * 0.085, width: "100%", display: "flex", justifyContent: "center", ...shown(frame, on(map, "מפה"), fps, H, 1.12) }}>
            <Line size={W * 0.07}>מפה <span style={{ color: palette.accent }}>אינטראקטיבית</span></Line>
          </div>
        </AbsoluteFill>
        <Sfx src={urls[SFX.whoosh]} at={wordFrame(map, "מפה") - 4} volume={0.22} />
        <Sfx src={urls[SFX.tap]} at={wordFrame(map, "אינטראקטיבית") + 4} volume={0.2} />
        {voice(map)}
      </SceneFrame>

      {/* Scene 4: AI visualizations on real listings */}
      <SceneFrame from={ai.startFrame} durationInFrames={ai.durationFrames} enter="cut" exit="cut">
        <AbsoluteFill>
          <div style={{ position: "absolute", top: H * 0.085, width: "100%", display: "flex", justifyContent: "center" }}>
            {frame < v3 ? (
              <div style={shown(frame, on(ai, "הדמיות"), fps, H, 1.12)}><Line size={W * 0.07}>הדמיות <span style={{ color: palette.accent }}>AI</span></Line></div>
            ) : (
              <div style={enter(frame, v3, fps, H, 1.12)}><Line size={W * 0.07}>גם <span style={{ color: palette.accent }}>לעסק שלכם</span></Line></div>
            )}
          </div>
        </AbsoluteFill>
        <Sfx src={urls[SFX.sparkle]} at={wordFrame(ai, "הדמיות")} volume={0.22} />
        <Sfx src={urls[SFX.tap]} at={wordFrame(ai, "AI") + 2} volume={0.2} />
        <Sfx src={urls[SFX.whoosh]} at={wordFrame(ai, "נכסים") - 2} volume={0.18} />
        <Sfx src={urls[SFX.whoosh]} at={wordFrame(ai, "שאהבתם") - 2} volume={0.16} />
        {voice(ai)}
      </SceneFrame>

      {/* Scene 5: brokers and experts */}
      <SceneFrame from={experts.startFrame} durationInFrames={experts.durationFrames} enter="cut" exit="cut">
        <AbsoluteFill>
          <div style={{ position: "absolute", top: H * 0.085, width: "100%", display: "flex", justifyContent: "center" }}>
            {frame < expertsAt ? (
              <div style={shown(frame, brokersAt, fps, H, 1.12)}><Line size={W * 0.07}>מתווכים</Line></div>
            ) : (
              <div style={enter(frame, expertsAt, fps, H, 1.12)}><Line size={W * 0.062}>עורכי דין · <span style={{ color: palette.accent }}>אדריכלים</span></Line></div>
            )}
          </div>
        </AbsoluteFill>
        <Sfx src={urls[SFX.pop]} at={wordFrame(experts, "מתווכים")} volume={0.2} />
        <Sfx src={urls[SFX.whoosh]} at={wordFrame(experts, "ומומחים") - 2} volume={0.2} />
        <Sfx src={urls[SFX.tap]} at={wordFrame(experts, "מתחום") + 2} volume={0.24} />
        {voice(experts)}
      </SceneFrame>

      {/* The phone, carried from scene 2 to the payoff */}
      {phoneOn ? (
        <div style={{ position: "absolute", left: phoneX, top: phoneY, width: PW, height: PH, borderRadius: PW * 0.12, background: palette.ink, padding: PAD, boxShadow: "0 34px 80px rgba(13,27,61,0.32)", opacity: interpolate(frame - all.startFrame, [-2, 2], [0, 1], clamp) * (1 - phoneOut), transform: `translateY(${(1 - phoneIn) * H * 0.04 + phoneOut * H * 0.08}px) scale(${(0.35 + 0.65 * phoneIn) * (1 - 0.15 * phoneOut)})` }}>
          <div style={{ position: "relative", width: SW, height: SH, borderRadius: PW * 0.095, overflow: "hidden", background: "#ffffff" }}>{screenOf()}</div>
        </div>
      ) : null}
      {frame >= all.startFrame && frame < all.startFrame + all.durationFrames ? (
        <>
          {/* the real counts from the site's directory, on "brokers" */}
          {(() => {
            const at = on(all, "המתווכים");
            const n = (to: number) => Math.round(interpolate(frame, [at, at + 18], [0, to], { ...clamp, easing: easeOut }));
            const badge = (label: string, value: number, x: number, y: number, dark: boolean, d: number) => (
              <div style={{ position: "absolute", left: x * W, top: y * H, transform: "translate(-50%, -50%)", ...shown(frame, at + d, fps, H, 1.2) }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", background: dark ? palette.hero : "#ffffff", color: dark ? "#ffffff" : palette.hero, borderRadius: W * 0.04, padding: `${H * 0.012}px ${W * 0.04}px`, boxShadow: "0 16px 40px rgba(13,27,61,0.22)", border: dark ? "none" : `${W * 0.005}px solid ${palette.hero}` }}>
                  <div style={{ fontFamily: heebo, fontWeight: 900, fontSize: W * 0.09, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{n(value)}</div>
                  <Line size={W * 0.036} weight={700} color={dark ? "#dbe3f5" : palette.hero}>{label}</Line>
                </div>
              </div>
            );
            return (
              <>
                {badge("משרדי תיווך", 26, 0.33, 0.64, true, 0)}
                {badge("מתווכים", 33, 0.69, 0.64, false, 4)}
              </>
            );
          })()}
        </>
      ) : null}
      {/* fingers on the phone */}
      {frame >= map.startFrame && frame < ai.startFrame ? (
        [-1, 1].map((d) => {
          const t = interpolate(frame, [mapAt - 6, mapAt + 16], [0, 1], { ...clamp, easing: easeOut });
          const o = interpolate(frame, [mapAt - 10, mapAt - 4, mapAt + 14, mapAt + 20], [0, 1, 1, 0], clamp);
          const cx = scrX + SW / 2 + d * SW * (0.3 - 0.22 * t), cy = scrY + SH * 0.45 + d * SH * (0.12 - 0.09 * t);
          const r = W * 0.045;
          return <div key={d} style={{ position: "absolute", left: cx - r, top: cy - r, width: r * 2, height: r * 2, borderRadius: "50%", background: "rgba(13,27,61,0.25)", border: `${W * 0.004}px solid rgba(255,255,255,0.9)`, opacity: o }} />;
        })
      ) : null}
      {frame >= ai.startFrame && frame < experts.startFrame ? (
        // the finger dragging the slider, and the taps on a style and on the heart
        (() => {
          const photoTop = scrY + SH * 0.3 + SW * 0.03;
          const photoH = SW * 0.9 * (535 / 790);
          const x0 = (W - SW * 0.9) / 2;
          const t = interpolate(frame, [v1, v1 + 16], [0, 1], { ...clamp, easing: easeOut });
          const o = interpolate(frame, [v1 - 6, v1, v1 + 16, v1 + 22], [0, 1, 1, 0], clamp);
          const r = W * 0.045;
          return (
            <>
              <div style={{ position: "absolute", left: x0 + SW * 0.9 * t - r, top: photoTop + photoH / 2 - r + W * 0.08, width: r * 2, height: r * 2, borderRadius: "50%", background: "rgba(13,27,61,0.25)", border: `${W * 0.004}px solid rgba(255,255,255,0.9)`, opacity: o }} />
              <Tap at={v2 - 2} x={scrX + SW * 0.06 + (SW * 0.88) * 0.25} y={scrY + SH * 0.11 + SH * 0.065 * 1.5 + SW * 0.03} d={W * 0.09} />
              {frame >= v4 ? (
                <div style={{ position: "absolute", left: scrX + SW * 0.12, top: photoTop + SW * 0.12, ...enter(frame, v4 + 2, fps, H, 1.6) }}>
                  <HeartGlyph size={W * 0.09} color="#e5484d" />
                </div>
              ) : null}
            </>
          );
        })()
      ) : null}
      <Tap at={findAt} x={scrX + SW * 0.5} y={scrY + SH * 0.1 + SW * 0.94 * (1250 / 980) * 0.86} d={W * 0.09} />

      {/* Scene 6: start choosing, or just ask Gabriela */}
      <SceneFrame from={payoff.startFrame} durationInFrames={payoff.durationFrames}>
        {(() => {
          const logoP = spring({ frame: frame - enterAt - 4, fps, config: { damping: 12, stiffness: 140 } });
          const gab = spring({ frame: frame - askAt, fps, config: smooth });
          return (
            <AbsoluteFill>
              {frame >= enterAt + 4 ? (
                <div style={{ position: "absolute", top: H * 0.1, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.012 }}>
                  <Img src={urls[IMG.logo]} style={{ height: H * 0.11, opacity: interpolate(frame - enterAt - 4, [0, 2], [0, 1], clamp), transform: `translateY(${(1 - logoP) * H * 0.02}px) scale(${1.15 - 0.15 * logoP})` }} />
                  <div style={{ ...enter(frame, enterAt + 8, fps, H, 1.04), fontFamily: heebo, fontWeight: 800, fontSize: W * 0.05, color: palette.hero, direction: "ltr" }}>shuknadlan.co.il</div>
                </div>
              ) : null}
              <div style={{ position: "absolute", top: H * 0.33, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.006 }}>
                <div style={shown(frame, chooseAt, fps, H, 1.12)}><Line size={W * 0.075}>התחילו לבחור</Line></div>
                <div style={shown(frame, chooseAt + 6, fps, H, 1.12)}><Line size={W * 0.075}>את <span style={{ color: palette.accent }}>הנכס הבא שלכם</span></Line></div>
              </div>
              {frame >= askAt ? (
                <div style={{ position: "absolute", left: W * 0.08, right: W * 0.08, top: H * 0.5, height: H * 0.2, borderRadius: W * 0.06, background: "#ffffff", boxShadow: "0 24px 60px rgba(13,27,61,0.16)", border: `${W * 0.005}px solid ${palette.accent}`, display: "flex", alignItems: "center", gap: W * 0.04, padding: `0 ${W * 0.05}px`, direction: "rtl", opacity: interpolate(frame - askAt, [0, 3], [0, 1], clamp), transform: `translateY(${(1 - gab) * H * 0.03}px)` }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: H * 0.008, flex: 1 }}>
                    <Line size={W * 0.04} weight={700} color={palette.dim}>או פשוט שאלו את</Line>
                    <Line size={W * 0.085}>גבריאלה</Line>
                    <div style={{ display: "flex", alignItems: "center", gap: W * 0.02 }}>
                      <Icon name="whatsapp" size={W * 0.05} color="brand" />
                      <Line size={W * 0.036} weight={700} color={palette.ink}>הסוכנת החכמה, בוואטסאפ</Line>
                    </div>
                  </div>
                  <div style={{ width: H * 0.16, height: H * 0.16, borderRadius: "50%", overflow: "hidden", border: `${W * 0.008}px solid ${palette.accent}`, flex: "none" }}>
                    <Img src={urls[IMG.portrait]} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 18%" }} />
                  </div>
                </div>
              ) : null}
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.riser]} at={Math.max(0, wordFrame(payoff, "היכנסו") - 30)} volume={0.16} />
        <Sfx src={urls[SFX.impact]} at={wordFrame(payoff, "היכנסו") + 4} volume={0.26} />
        <Sfx src={urls[SFX.ping]} at={wordFrame(payoff, "הנכס")} volume={0.2} />
        {voice(payoff)}
      </SceneFrame>

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
