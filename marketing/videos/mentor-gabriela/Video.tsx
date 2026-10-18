import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";
import { BgMesh, Captions, Grain, Icon, Music, SceneFrame, Sfx, Vignette, Voiceover, font, onWord, sceneById, wordFrame } from "reelkit/kit";
import type { VideoProps } from "reelkit/kit";
import { HebrewText as Line, enter, shown } from "./HebrewText";
import { Chip } from "./Chip";
import { CheckGlyph, CompassGlyph, HouseGlyph, ListGlyph, PenGlyph, SunGlyph } from "./Glyphs";
import { PhoneShot } from "./PhoneShot";
import { Tap } from "./Tap";

// Same series as "call-to-meeting" and "property-intake": sapphire + gold on a warm off-white ground.
const palette = {
  bg: "#F7F5F0",
  ink: "#0d1b3d",
  hero: "#0e2a6b",
  accent: "#c9a227",
  dim: "#6b7280",
  card: "#ffffff",
  line: "#e7e3da",
  soft: "#eef2fa",
  live: "#16a34a",
  urgent: "#e5484d",
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
  ring: "assets/lib/synths-of-the-past-phone-mobile-phone-ring/clip.mp3",
};
const IMG = {
  logo: "assets/user/a-3818936f-logo-shuknadlan.png",
  portrait: "assets/user/a-40190d35-gabriela-portrait.png",
  face: "assets/user/a-d5da37c7-gabriela-face.jpg",
  chat: "assets/user/a-8f045017-wa-client-a.jpg",
};
// The WhatsApp screenshot, in its own pixels: the voice note, the client card reply, the list of matches.
const SHOT = { w: 1080, h: 2340, voice: [47, 287, 918, 456], client: [164, 486, 1030, 1106], matches: [164, 1270, 1030, 2048] } as const;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const smooth = { damping: 18, stiffness: 120 };
const snappy = { damping: 13, stiffness: 170 };
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

const TASKS = ["לחזור ללקוח", "לעדכן נכס", "לשלוח הסכם", "לקבוע סיור", "לבדוק התאמות"];

export const Video: React.FC<VideoProps> = ({ manifest, urls }) => {
  const frame = useCurrentFrame();
  const real = useVideoConfig();
  const fps = real.fps;
  // Laid out on a 9:16 stage. In a square frame (feed posts) the stage is scaled down to the band that holds every
  // scene's content; the captions sit on the square frame itself.
  const square = real.height / real.width < 1.2;
  const W = real.width;
  const H = square ? Math.round((real.width * 16) / 9) : real.height;
  const STAGE = square ? 0.64 : 1;
  const WIN_TOP = square ? 100 : 0;

  const hook = sceneById(manifest, "hook");
  const mentor = sceneById(manifest, "mentor");
  const gab = sceneById(manifest, "gabriela");
  const more = sceneById(manifest, "more");
  const payoff = sceneById(manifest, "payoff");
  const cta = sceneById(manifest, "cta");

  const voice = (s: typeof hook) => (
    <>
      {square ? null : <Captions words={s.words} group={manifest.captions} rtl face={heebo} highlight={palette.accent} mode="highlight" />}
      {s.voiceoverKey ? <Voiceover src={urls[s.voiceoverKey]} /> : null}
    </>
  );

  // The two characters, drawn the same way wherever they appear.
  const mentorBadge = (d: number, turn = 0) => (
    <div style={{ width: d, height: d, borderRadius: "50%", background: palette.hero, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 12px 30px rgba(14,42,107,0.25)", flex: "none" }}>
      <CompassGlyph size={d * 0.66} color="#ffffff" turn={turn} />
    </div>
  );
  const gabBadge = (d: number) => (
    <div style={{ width: d, height: d, borderRadius: "50%", overflow: "hidden", border: `${d * 0.05}px solid #ffffff`, boxShadow: "0 12px 30px rgba(13,27,61,0.22)", flex: "none" }}>
      <Img src={urls[IMG.face]} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
  );

  const mentorTap = mentor.startFrame + onWord(mentor, "היום");

  return (
    <AbsoluteFill style={{ background: palette.bg }}>
      <style>{"*{box-sizing:border-box}"}</style>
      <BgMesh bg={palette.bg} hero={palette.hero} accent={palette.accent} />
      <div style={{ position: "absolute", left: (W - W * STAGE) / 2, top: -WIN_TOP * STAGE, width: W, height: H, transform: `scale(${STAGE})`, transformOrigin: "top left" }}>

      {/* Scene 1: tasks pile up and the phone rings; then the new team splits the screen */}
      <SceneFrame from={hook.startFrame} durationInFrames={hook.durationFrames} exit="cut">
        {(() => {
          const f = frame - hook.startFrame;
          const drown = onWord(hook, "לטבוע");
          const meet = onWord(hook, "הכירו");
          const team = onWord(hook, "הצוות");
          const out = interpolate(f, [meet, meet + 10], [0, 1], { ...clamp, easing: easeOut });
          const shake = f >= drown && f < meet ? Math.sin(f * 1.9) * W * 0.006 : 0;
          const ringOn = f >= drown - 4 && f < meet;
          const panelP = (i: number) => spring({ frame: f - team - i * 3, fps, config: smooth });
          const panel = (i: number): React.CSSProperties => ({
            position: "absolute", top: H * 0.27, height: H * 0.44, width: W * 0.42, borderRadius: W * 0.05, overflow: "hidden",
            opacity: interpolate(f - team - i * 3, [0, 3], [0, 1], clamp), transform: `translateY(${(1 - panelP(i)) * H * 0.04}px) scale(${1.06 - 0.06 * panelP(i)})`,
            boxShadow: "0 24px 60px rgba(13,27,61,0.18)",
          });
          return (
            <AbsoluteFill>
              <div style={{ position: "absolute", top: H * 0.12, width: "100%", display: "flex", justifyContent: "center", direction: "rtl", opacity: f < team ? 1 : 0, ...(f < team ? shown(f, onWord(hook, "בלי"), fps, H, 1.15) : {}) }}>
                <Line face={heebo} size={W * 0.08} weight={800} color={palette.hero}>בלי לטבוע <span style={{ color: palette.accent }}>במשימות?</span></Line>
              </div>
              <div style={{ position: "absolute", top: H * 0.12, width: "100%", display: "flex", justifyContent: "center", direction: "rtl", ...shown(f, team, fps, H, 1.15) }}>
                <Line face={heebo} size={W * 0.08} weight={800} color={palette.hero}>הצוות <span style={{ color: palette.accent }}>החדש</span> שלכם</Line>
              </div>

              {/* the pile of tasks */}
              {out < 1
                ? TASKS.map((t, i) => {
                    const at = 2 + i * 5;
                    const p = spring({ frame: f - at, fps, config: snappy });
                    const rot = [-4, 3, -2, 5, -3][i];
                    const y = H * (0.6 - i * 0.075);
                    const flyX = (i % 2 === 0 ? -1 : 1) * out * W * 1.1;
                    return f >= at ? (
                      <div key={t} style={{ position: "absolute", left: W * 0.14 + shake + flyX, top: y - (1 - p) * H * 0.25, width: W * 0.72, height: H * 0.07, borderRadius: W * 0.035, background: palette.card, boxShadow: "0 14px 32px rgba(13,27,61,0.16)", display: "flex", alignItems: "center", gap: W * 0.035, padding: `0 ${W * 0.045}px`, direction: "rtl", opacity: interpolate(f - at, [0, 2], [0, 1], clamp), transform: `rotate(${rot * p}deg)` }}>
                        <ListGlyph size={W * 0.06} color={palette.hero} />
                        <Line face={heebo} size={W * 0.045} weight={700}>{t}</Line>
                        <div style={{ flex: 1 }} />
                        <div style={{ width: W * 0.05, height: W * 0.05, borderRadius: W * 0.012, border: `${W * 0.005}px solid ${palette.line}` }} />
                      </div>
                    ) : null;
                  })
                : null}

              {/* the phone that keeps ringing */}
              {ringOn ? (
                <div style={{ position: "absolute", left: W * 0.1, top: H * 0.22, width: W * 0.16, height: W * 0.16, borderRadius: "50%", background: palette.urgent, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 14px 32px rgba(229,72,77,0.35)", ...enter(f, drown - 4, fps, H, 1.25), rotate: `${Math.sin(f * 2.2) * 14}deg` }}>
                  <Icon name="phone" size={W * 0.085} color="#ffffff" />
                </div>
              ) : null}

              {/* the team: the Mentor on the right, Gabriela on the left */}
              {f >= team ? (
                <>
                  <div style={{ ...panel(0), right: W * 0.06, background: palette.hero, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: H * 0.03, direction: "rtl" }}>
                    <CompassGlyph size={W * 0.26} color="#ffffff" turn={interpolate(f - team, [0, 24], [-60, 0], { ...clamp, easing: easeOut })} />
                    <Line face={heebo} size={W * 0.07} weight={800} color="#ffffff">המנטור</Line>
                  </div>
                  <div style={{ ...panel(1), left: W * 0.06, background: palette.soft }}>
                    <Img src={urls[IMG.portrait]} style={{ position: "absolute", left: "6%", bottom: H * 0.06, width: "130%" }} />
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: H * 0.085, background: palette.card, display: "flex", alignItems: "center", justifyContent: "center", direction: "rtl" }}>
                      <Line face={heebo} size={W * 0.07} weight={800} color={palette.hero}>גבריאלה</Line>
                    </div>
                  </div>
                </>
              ) : null}
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.pop]} at={2} volume={0.14} />
        <Sfx src={urls[SFX.pop]} at={12} volume={0.12} />
        <Sfx src={urls[SFX.pop]} at={22} volume={0.12} />
        <Sfx src={urls[SFX.ring]} at={wordFrame(hook, "לטבוע") - 4} volume={0.16} />
        <Sfx src={urls[SFX.whoosh]} at={wordFrame(hook, "הכירו")} volume={0.22} />
        <Sfx src={urls[SFX.impact]} at={wordFrame(hook, "הצוות")} volume={0.26} />
        {voice(hook)}
      </SceneFrame>

      {/* Scene 2: the Mentor's card in the dashboard: every morning, the numbers, and what to focus on today */}
      <SceneFrame from={mentor.startFrame} durationInFrames={mentor.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - mentor.startFrame;
          const p = spring({ frame: f, fps, config: smooth });
          const morning = onWord(mentor, "בוקר");
          const nums = onWord(mentor, "המספרים");
          const focus = onWord(mentor, "להתמקד");
          const tiles = [
            { l: "זמן תגובה", bars: [0.5, 0.7, 0.45, 0.85] },
            { l: "המרה", bars: [0.35, 0.55, 0.65, 0.8] },
            { l: "בלעדיות", bars: [0.6, 0.4, 0.7, 0.75] },
          ];
          return (
            <AbsoluteFill>
              <div style={{ position: "absolute", left: W * 0.06, top: H * 0.17, width: W * 0.88, height: H * 0.52, borderRadius: W * 0.05, background: palette.card, boxShadow: "0 24px 60px rgba(13,27,61,0.16)", padding: W * 0.055, display: "flex", flexDirection: "column", gap: H * 0.022, direction: "rtl", opacity: interpolate(f, [0, 3], [0, 1], clamp), transform: `translateY(${(1 - p) * H * 0.03}px)` }}>
                {/* header */}
                <div style={{ display: "flex", alignItems: "center", gap: W * 0.035 }}>
                  {mentorBadge(W * 0.15, interpolate(f, [0, 20], [-40, 0], { ...clamp, easing: easeOut }))}
                  <div style={{ display: "flex", flexDirection: "column", gap: H * 0.004 }}>
                    <Line face={heebo} size={W * 0.07} weight={800} color={palette.hero}>המנטור</Line>
                    <Line face={heebo} size={W * 0.036} weight={600} color={palette.dim}>בדאשבורד שלך ב-CRM</Line>
                  </div>
                </div>
                {/* every morning */}
                <div style={{ display: "flex", alignItems: "center", gap: W * 0.03, background: "#fbf6e6", borderRadius: W * 0.03, padding: `${H * 0.014}px ${W * 0.04}px`, ...shown(f, morning, fps, H, 1.06) }}>
                  <SunGlyph size={W * 0.075} color={palette.accent} rays={interpolate(f - morning, [0, 14], [0.2, 1], clamp)} />
                  <Line face={heebo} size={W * 0.046} weight={800}>סיכום מוכן כל בוקר</Line>
                </div>
                {/* the numbers */}
                <div style={{ display: "flex", gap: W * 0.03 }}>
                  {tiles.map((t, i) => {
                    const at = nums + i * 3;
                    return (
                      <div key={t.l} style={{ flex: 1, height: H * 0.13, borderRadius: W * 0.03, background: palette.soft, padding: W * 0.025, display: "flex", flexDirection: "column", justifyContent: "space-between", ...shown(f, at, fps, H, 1.08) }}>
                        <Line face={heebo} size={W * 0.036} weight={700} color={palette.ink}>{t.l}</Line>
                        <div style={{ display: "flex", alignItems: "flex-end", gap: W * 0.012, height: H * 0.06, direction: "ltr" }}>
                          {t.bars.map((b, j) => (
                            <div key={j} style={{ flex: 1, borderRadius: W * 0.008, background: j === t.bars.length - 1 ? palette.accent : palette.hero, opacity: j === t.bars.length - 1 ? 1 : 0.55, height: `${b * 100 * interpolate(f - at - j * 2, [0, 10], [0, 1], { ...clamp, easing: easeOut })}%` }} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* what to focus on today */}
                <div style={{ borderRadius: W * 0.035, border: `${W * 0.005}px solid ${palette.urgent}`, background: "#fff5f5", padding: `${H * 0.016}px ${W * 0.04}px`, display: "flex", flexDirection: "column", gap: H * 0.012, ...shown(f, focus, fps, H, 1.1) }}>
                  <div style={{ display: "flex", alignItems: "center", gap: W * 0.025 }}>
                    <div style={{ width: W * 0.03, height: W * 0.03, borderRadius: "50%", background: palette.urgent, boxShadow: `0 0 0 ${W * 0.008 * (1 + Math.sin(f * 0.5))}px rgba(229,72,77,0.25)` }} />
                    <Line face={heebo} size={W * 0.05} weight={800}>ליד מחכה 40 דק׳</Line>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: W * 0.03 }}>
                    <Line face={heebo} size={W * 0.038} weight={600} color={palette.dim}>כדאי לחזור אליו עכשיו</Line>
                    <div style={{ flex: 1 }} />
                    <div style={{ padding: `${H * 0.01}px ${W * 0.04}px`, borderRadius: W * 0.025, background: frame >= mentorTap ? palette.accent : palette.hero, color: frame >= mentorTap ? palette.ink : "#ffffff", fontFamily: heebo, fontWeight: 800, fontSize: W * 0.038, whiteSpace: "nowrap", direction: "rtl", transform: `scale(${1 - 0.06 * Math.sin(interpolate(frame, [mentorTap, mentorTap + 8], [0, Math.PI], clamp))})` }}>פתיחת הליד</div>
                  </div>
                </div>
              </div>
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.whoosh]} at={0} volume={0.18} />
        <Sfx src={urls[SFX.sparkle]} at={wordFrame(mentor, "בוקר")} volume={0.18} />
        <Sfx src={urls[SFX.pop]} at={wordFrame(mentor, "המספרים")} volume={0.16} />
        <Sfx src={urls[SFX.ping]} at={wordFrame(mentor, "להתמקד")} volume={0.24} />
        <Sfx src={urls[SFX.tap]} at={wordFrame(mentor, "היום")} volume={0.22} />
        {voice(mentor)}
      </SceneFrame>
      <Tap at={mentorTap} x={W * 0.27} y={H * 0.64} d={W * 0.09} />

      {/* Scene 3: Gabriela in WhatsApp: a voice note, a client card, and the matches (the user's real screenshot) */}
      <SceneFrame from={gab.startFrame} durationInFrames={gab.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - gab.startFrame;
          const wa = onWord(gab, "בוואטסאפ");
          const note = onWord(gab, "הודעה");
          const card = onWord(gab, "כרטיס");
          const match = onWord(gab, "התאמות");
          const phoneP = spring({ frame: f - wa, fps, config: smooth });
          const scroll = interpolate(f, [match - 10, match + 2], [0, 470], { ...clamp, easing: easeOut });
          const mark = (from: number, to?: number) => interpolate(f, [from, from + 4], [0, 1], clamp) * (to === undefined ? 1 : interpolate(f, [to - 2, to + 2], [1, 0], clamp));
          const screenW = W * 0.56;
          return (
            <AbsoluteFill>
              <div style={{ position: "absolute", top: H * 0.08, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: W * 0.035, direction: "rtl", ...shown(f, 0, fps, H, 1.1) }}>
                {gabBadge(W * 0.15)}
                <div style={{ display: "flex", flexDirection: "column", gap: H * 0.004 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: W * 0.02 }}>
                    <Line face={heebo} size={W * 0.07} weight={800} color={palette.hero}>גבריאלה</Line>
                    <div style={shown(f, wa, fps, H, 1.25)}><Icon name="whatsapp" size={W * 0.07} color="brand" /></div>
                  </div>
                  <div style={shown(f, onWord(gab, "העוזרת"), fps, H, 1.05)}>
                    <Line face={heebo} size={W * 0.042} weight={700} color={palette.dim}>העוזרת האישית שלכם</Line>
                  </div>
                </div>
              </div>
              {f >= wa ? (
                <div style={{ position: "absolute", top: H * 0.23, width: "100%", display: "flex", justifyContent: "center", direction: "rtl", opacity: interpolate(f - wa, [0, 3], [0, 1], clamp), transform: `translateY(${(1 - phoneP) * H * 0.06}px)` }}>
                  <PhoneShot src={urls[IMG.chat]} srcW={SHOT.w} srcH={SHOT.h} width={screenW} viewH={H * 0.47} scroll={scroll}
                    marks={[
                      { box: [...SHOT.voice], p: mark(note, card) },
                      { box: [...SHOT.client], p: mark(card, match - 8) },
                      { box: [...SHOT.matches], p: mark(match) },
                    ]} />
                </div>
              ) : null}
              <div style={{ position: "absolute", top: H * 0.69, width: "100%", display: "flex", justifyContent: "center" }}>
                {f >= card && f < match ? (
                  <div style={enter(f, card, fps, H, 1.2)}><Chip face={heebo} text="פותחת כרטיס לקוח" size={W * 0.048} icon={<Icon name="user" size={W * 0.05} color={palette.ink} />} /></div>
                ) : null}
                {f >= match ? (
                  <div style={enter(f, match, fps, H, 1.2)}><Chip face={heebo} text="מוצאת התאמות" size={W * 0.048} icon={<HouseGlyph size={W * 0.05} color={palette.ink} />} /></div>
                ) : null}
              </div>
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.whoosh]} at={wordFrame(gab, "בוואטסאפ")} volume={0.2} />
        <Sfx src={urls[SFX.send]} at={wordFrame(gab, "הודעה")} volume={0.2} />
        <Sfx src={urls[SFX.pop]} at={wordFrame(gab, "כרטיס")} volume={0.2} />
        <Sfx src={urls[SFX.chime]} at={wordFrame(gab, "התאמות")} volume={0.22} />
        {voice(gab)}
      </SceneFrame>

      {/* Scene 4: and more: listings, agreements to sign, meetings in the calendar */}
      <SceneFrame from={more.startFrame} durationInFrames={more.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - more.startFrame;
          const rows = [
            { w: "מעלה", t: "מעלה נכסים", icon: <HouseGlyph size={W * 0.075} color={palette.hero} /> },
            { w: "שולחת", t: "שולחת הסכמים לחתימה", icon: <PenGlyph size={W * 0.075} color={palette.hero} /> },
            { w: "וקובעת", t: "קובעת פגישות ביומן", icon: <Icon name="calendar" size={W * 0.075} color={palette.hero} /> },
          ];
          return (
            <AbsoluteFill>
              <div style={{ position: "absolute", top: H * 0.1, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.012, direction: "rtl", ...shown(f, 0, fps, H, 1.1) }}>
                {gabBadge(W * 0.2)}
                <Line face={heebo} size={W * 0.06} weight={800} color={palette.hero}>היא גם...</Line>
              </div>
              {rows.map((r, i) => {
                const at = onWord(more, r.w);
                const done = interpolate(f - at, [6, 10], [0, 1], clamp);
                return (
                  <div key={r.w} style={{ position: "absolute", left: W * 0.08, top: H * (0.35 + i * 0.12), width: W * 0.84, height: H * 0.095, borderRadius: W * 0.04, background: palette.card, boxShadow: "0 16px 40px rgba(13,27,61,0.14)", display: "flex", alignItems: "center", gap: W * 0.04, padding: `0 ${W * 0.05}px`, direction: "rtl", ...shown(f, at, fps, H, 1.08) }}>
                    {r.icon}
                    <Line face={heebo} size={W * 0.055} weight={800}>{r.t}</Line>
                    <div style={{ flex: 1 }} />
                    <div style={{ width: W * 0.085, height: W * 0.085, borderRadius: "50%", background: done > 0 ? palette.live : palette.soft, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${0.7 + 0.3 * done + 0.15 * Math.sin(done * Math.PI)})` }}>
                      {done > 0 ? <CheckGlyph size={W * 0.06} color="#ffffff" /> : null}
                    </div>
                  </div>
                );
              })}
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.whoosh]} at={0} volume={0.16} />
        <Sfx src={urls[SFX.chime]} at={wordFrame(more, "מעלה") + 6} volume={0.16} />
        <Sfx src={urls[SFX.chime]} at={wordFrame(more, "שולחת") + 6} volume={0.16} />
        <Sfx src={urls[SFX.chime]} at={wordFrame(more, "וקובעת") + 6} volume={0.18} />
        {voice(more)}
      </SceneFrame>

      {/* Scene 5: the Mentor advises, Gabriela does it; less grunt work, more deals */}
      <SceneFrame from={payoff.startFrame} durationInFrames={payoff.durationFrames} enter="cut" exit="cut">
        {(() => {
          const f = frame - payoff.startFrame;
          const m = onWord(payoff, "המנטור");
          const g = onWord(payoff, "גבריאלה");
          const row = (at: number, fromRight: boolean): React.CSSProperties => {
            const p = spring({ frame: f - at, fps, config: smooth });
            return { opacity: interpolate(f - at, [0, 3], [0, 1], clamp), transform: `translateX(${(1 - p) * W * 0.12 * (fromRight ? 1 : -1)}px)` };
          };
          return (
            <AbsoluteFill>
              <div style={{ position: "absolute", left: W * 0.07, top: H * 0.13, width: W * 0.86, height: H * 0.15, borderRadius: W * 0.05, background: palette.hero, display: "flex", alignItems: "center", gap: W * 0.05, padding: `0 ${W * 0.06}px`, direction: "rtl", boxShadow: "0 20px 50px rgba(14,42,107,0.22)", ...(f >= m ? row(m, true) : { opacity: 0 }) }}>
                <div style={{ width: W * 0.17, height: W * 0.17, borderRadius: "50%", background: "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <CompassGlyph size={W * 0.12} color="#ffffff" />
                </div>
                <Line face={heebo} size={W * 0.075} weight={800} color="#ffffff">המנטור מייעץ.</Line>
              </div>
              <div style={{ position: "absolute", left: W * 0.07, top: H * 0.31, width: W * 0.86, height: H * 0.15, borderRadius: W * 0.05, background: palette.card, display: "flex", alignItems: "center", gap: W * 0.05, padding: `0 ${W * 0.06}px`, direction: "rtl", boxShadow: "0 20px 50px rgba(13,27,61,0.14)", ...(f >= g ? row(g, false) : { opacity: 0 }) }}>
                {gabBadge(W * 0.17)}
                <Line face={heebo} size={W * 0.075} weight={800} color={palette.hero}>גבריאלה מבצעת.</Line>
              </div>
              <div style={{ position: "absolute", top: H * 0.53, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.01, direction: "rtl" }}>
                <div style={shown(f, onWord(payoff, "פחות"), fps, H, 1.1)}><Line face={heebo} size={W * 0.07} weight={800} color={palette.dim}>פחות עבודה שחורה</Line></div>
                <div style={shown(f, onWord(payoff, "יותר"), fps, H, 1.2)}><Line face={heebo} size={W * 0.085} weight={800} color={palette.hero}>יותר <span style={{ color: palette.accent }}>עסקאות</span></Line></div>
              </div>
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.whoosh]} at={wordFrame(payoff, "המנטור")} volume={0.2} />
        <Sfx src={urls[SFX.whoosh]} at={wordFrame(payoff, "גבריאלה")} volume={0.2} />
        <Sfx src={urls[SFX.pop]} at={wordFrame(payoff, "פחות")} volume={0.16} />
        <Sfx src={urls[SFX.impact]} at={wordFrame(payoff, "יותר")} volume={0.24} />
        {voice(payoff)}
      </SceneFrame>

      {/* Scene 6: both are already waiting for you, at Shuk Nadlan */}
      <SceneFrame from={cta.startFrame} durationInFrames={cta.durationFrames}>
        {(() => {
          const f = frame - cta.startFrame;
          const at = onWord(cta, "בשוק");
          const logoP = spring({ frame: f - at, fps, config: { damping: 12, stiffness: 140 } });
          return (
            <AbsoluteFill>
              <div style={{ position: "absolute", top: H * 0.13, width: "100%", display: "flex", justifyContent: "center", direction: "rtl", gap: W * 0.04, ...shown(f, 0, fps, H, 1.1) }}>
                {gabBadge(W * 0.16)}
                {mentorBadge(W * 0.16)}
              </div>
              <div style={{ position: "absolute", top: H * 0.25, width: "100%", display: "flex", justifyContent: "center", direction: "rtl", ...shown(f, onWord(cta, "שניהם"), fps, H, 1.12) }}>
                <Line face={heebo} size={W * 0.075} weight={800} color={palette.hero}>שניהם כבר מחכים לכם</Line>
              </div>
              {f >= at ? (
                <div style={{ position: "absolute", top: H * 0.37, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: H * 0.02 }}>
                  <Img src={urls[IMG.logo]} style={{ height: H * 0.13, opacity: interpolate(f - at, [0, 2], [0, 1], clamp), transform: `translateY(${(1 - logoP) * H * 0.02}px) scale(${1.15 - 0.15 * logoP})` }} />
                  <div style={enter(f, at + 3, fps, H, 1.08)}><Line face={heebo} size={W * 0.08} weight={800} color={palette.hero}>שוק נדל״ן</Line></div>
                  <div style={{ ...enter(f, at + 6, fps, H, 1.04), fontFamily: heebo, fontWeight: 700, fontSize: W * 0.05, color: palette.dim, direction: "ltr" }}>shuknadlan.co.il</div>
                </div>
              ) : null}
            </AbsoluteFill>
          );
        })()}
        <Sfx src={urls[SFX.riser]} at={0} volume={0.16} />
        <Sfx src={urls[SFX.impact]} at={wordFrame(cta, "בשוק")} volume={0.28} />
        {voice(cta)}
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
