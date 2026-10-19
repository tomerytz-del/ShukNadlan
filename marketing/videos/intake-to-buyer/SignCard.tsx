import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type SignCardProps = {
  title?: string;
  lines?: string[];
  signLabel?: string;
  signAt?: number;
  stamp?: string;
  stampAt?: number;
  delay?: number;
  w?: number;
  hero?: string;
  accent?: string;
  ink?: string;
  dim?: string;
  line?: string;
  surface?: string;
  font?: string;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// A document being signed, right to left: a title, a few term lines, a signature box where a pen stroke draws itself
// at signAt, and a stamp that lands at stampAt. Use it for any digital signature or approval.
export const SignCard: React.FC<SignCardProps> = ({
  title = "Agreement",
  lines = [],
  signLabel = "Signature",
  signAt = 20,
  stamp = "Signed",
  stampAt = 40,
  delay = 0,
  w = 0.3,
  hero = "#003DA5",
  accent = "#DC1C2E",
  ink = "#0B1B3F",
  dim = "#5B6475",
  line = "#E3E8F0",
  surface = "#FFFFFF",
  font,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const W = width * w;
  const fs = W * 0.048;
  const s = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 160 } });
  const pen = interpolate(frame, [signAt, signAt + 18], [0, 1], clamp);
  const st = spring({ frame: frame - stampAt, fps, config: { damping: 9, stiffness: 220 } });
  const path = "M8 40 C 20 10, 30 10, 34 34 S 50 52, 58 24 S 76 6, 82 30 S 104 44, 120 18 L 150 22";
  return (
    <div style={{ position: "relative", width: W, background: surface, borderRadius: W * 0.04, padding: W * 0.06, boxSizing: "border-box", direction: "rtl", fontFamily: font, boxShadow: "0 18px 44px rgba(11,27,63,0.18)", opacity: interpolate(frame - delay, [0, 3], [0, 1], clamp), transform: `translateY(${(1 - s) * height * 0.04}px)` }}>
      <div style={{ fontWeight: 800, fontSize: fs * 1.15, color: ink, whiteSpace: "nowrap", marginBottom: fs * 0.6 }}>{title}</div>
      {lines.map((l, i) => (
        <div key={i} style={{ fontWeight: 500, fontSize: fs * 0.82, color: dim, whiteSpace: "nowrap", lineHeight: 1.6, borderBottom: `1px solid ${line}` }}>{l}</div>
      ))}
      <div style={{ marginTop: fs * 0.9, fontWeight: 700, fontSize: fs * 0.8, color: ink }}>{signLabel}</div>
      <div style={{ marginTop: fs * 0.3, height: W * 0.24, border: `2px dashed ${line}`, borderRadius: W * 0.03, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg viewBox="0 0 160 60" width={W * 0.6} height={W * 0.22}>
          <path d={path} fill="none" stroke={hero} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - pen} />
        </svg>
      </div>
      {frame >= stampAt ? (
        <div style={{ position: "absolute", left: W * 0.08, bottom: W * 0.08, border: `4px solid ${accent}`, color: accent, borderRadius: W * 0.03, padding: `${fs * 0.2}px ${fs * 0.7}px`, fontWeight: 900, fontSize: fs * 1.05, whiteSpace: "nowrap", transform: `rotate(-10deg) scale(${1.6 - 0.6 * st})`, opacity: interpolate(frame - stampAt, [0, 3], [0, 1], clamp) }}>{stamp}</div>
      ) : null}
    </div>
  );
};
