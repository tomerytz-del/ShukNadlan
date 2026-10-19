import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type TypeCardProps = {
  label?: string;
  lines?: string[];
  delay?: number;
  typeAt?: number;
  cps?: number;
  w?: number;
  hero?: string;
  ink?: string;
  dim?: string;
  surface?: string;
  font?: string;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// A card whose text writes itself, right to left: a small label with a spark, then lines typed in at cps characters a
// second with a caret at the left end of the line being written. Use it for generated copy or an AI-written description.
export const TypeCard: React.FC<TypeCardProps> = ({ label = "", lines = [], delay = 0, typeAt = 6, cps = 40, w = 0.34, hero = "#003DA5", ink = "#0B1B3F", dim = "#5B6475", surface = "#FFFFFF", font }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const W = width * w;
  const fs = W * 0.045;
  const s = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 160 } });
  let budget = Math.floor(Math.max(0, frame - typeAt) * (cps / fps));
  const total = lines.reduce((n, l) => n + Array.from(l).length, 0);
  const caretOn = Math.floor(frame / 8) % 2 === 0 && budget < total;
  return (
    <div style={{ width: W, background: surface, borderRadius: W * 0.035, padding: W * 0.05, boxSizing: "border-box", direction: "rtl", fontFamily: font, boxShadow: "0 16px 40px rgba(11,27,63,0.16)", borderRight: `${W * 0.012}px solid ${hero}`, opacity: interpolate(frame - delay, [0, 3], [0, 1], clamp), transform: `translateY(${(1 - s) * height * 0.03}px)` }}>
      {label ? (
        <div style={{ display: "flex", alignItems: "center", gap: fs * 0.3, fontWeight: 700, fontSize: fs * 0.8, color: hero, marginBottom: fs * 0.4, whiteSpace: "nowrap" }}>
          <svg viewBox="0 0 24 24" width={fs} height={fs} fill={hero}><path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" /></svg>
          {label}
        </div>
      ) : null}
      {lines.map((l, i) => {
        const chars = Array.from(l);
        const n = Math.max(0, Math.min(chars.length, budget));
        const writing = budget > 0 && budget < chars.length;
        budget -= chars.length;
        return (
          <div key={i} style={{ fontWeight: 500, fontSize: fs, color: ink, whiteSpace: "nowrap", lineHeight: 1.5, minHeight: fs * 1.5, display: "flex", alignItems: "center" }}>
            <span>{chars.slice(0, n).join("")}</span>
            {writing && caretOn ? <span style={{ width: 2, height: fs * 1.1, background: dim, marginRight: 2 }} /> : null}
          </div>
        );
      })}
    </div>
  );
};
