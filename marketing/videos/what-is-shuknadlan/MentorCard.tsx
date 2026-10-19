import React from "react";
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type MentorCardProps = {
  title?: string;
  sub?: string;
  summary?: string[];
  step?: string[];
  chip?: string;
  avatar?: string;
  delay?: number;
  stepAt?: number;
  w?: number;
  h?: number;
  panel?: string;
  surface?: string;
  ink?: string;
  accent?: string;
  gold?: string;
  font?: string;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// A dark advice card from an AI coach: avatar and title, a short summary, and one recommended step on a light
// card with a priority chip; the step gets an accent outline at stepAt. Use a row of them for several audiences.
export const MentorCard: React.FC<MentorCardProps> = ({
  title = "Coach",
  sub = "",
  summary = [],
  step = [],
  chip = "",
  avatar,
  delay = 0,
  stepAt = 9999,
  w = 0.28,
  h = 0.56,
  panel = "#0E2557",
  surface = "#FFFFFF",
  ink = "#0B1B3F",
  accent = "#DC1C2E",
  gold = "#E2B93B",
  font,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const W = width * w;
  const H = height * h;
  const s = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 150 } });
  const lit = interpolate(frame, [stepAt, stepAt + 6], [0, 1], clamp);
  const fs = W * 0.05;
  return (
    <div
      style={{
        width: W,
        height: H,
        background: panel,
        borderRadius: W * 0.06,
        padding: W * 0.06,
        boxSizing: "border-box",
        direction: "rtl",
        display: "flex",
        flexDirection: "column",
        gap: H * 0.035,
        boxShadow: `0 ${H * 0.03}px ${H * 0.08}px rgba(11,27,63,0.3)`,
        opacity: interpolate(frame - delay, [0, 3], [0, 1], clamp),
        transform: `translateY(${(1 - s) * height * 0.05}px) scale(${0.95 + 0.05 * s})`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: W * 0.04 }}>
        {avatar ? <Img src={avatar} style={{ width: W * 0.17, height: W * 0.17, borderRadius: "50%", border: `3px solid ${gold}`, objectFit: "cover" }} /> : null}
        <div>
          <div style={{ fontFamily: font, fontWeight: 800, fontSize: fs * 1.05, color: surface, whiteSpace: "nowrap" }}>{title}</div>
          <div style={{ fontFamily: font, fontWeight: 400, fontSize: fs * 0.72, color: "rgba(255,255,255,0.7)", whiteSpace: "nowrap" }}>{sub}</div>
        </div>
      </div>
      <div>
        {summary.map((l, i) => <div key={i} style={{ fontFamily: font, fontWeight: 700, fontSize: fs * 0.9, color: surface, whiteSpace: "nowrap", lineHeight: 1.35 }}>{l}</div>)}
      </div>
      <div style={{ background: surface, borderRadius: W * 0.04, padding: W * 0.05, boxShadow: lit > 0 ? `0 0 0 ${W * 0.012 * lit}px ${accent}` : undefined, transform: `scale(${1 + 0.03 * lit})` }}>
        {chip ? <div style={{ display: "inline-block", fontFamily: font, fontWeight: 700, fontSize: fs * 0.66, color: lit > 0.5 ? surface : ink, background: lit > 0.5 ? accent : "#F6E7B8", borderRadius: W, padding: `${W * 0.006}px ${W * 0.03}px`, marginBottom: H * 0.015, whiteSpace: "nowrap" }}>{chip}</div> : null}
        {step.map((l, i) => <div key={i} style={{ fontFamily: font, fontWeight: i === 0 ? 800 : 400, fontSize: i === 0 ? fs * 0.88 : fs * 0.72, color: ink, whiteSpace: "nowrap", lineHeight: 1.4 }}>{l}</div>)}
      </div>
    </div>
  );
};
