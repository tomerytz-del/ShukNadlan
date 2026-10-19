import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type MatchCardProps = {
  title?: string;
  sub?: string;
  badge?: string;
  tag?: string;
  delay?: number;
  w?: number;
  hero?: string;
  accent?: string;
  ink?: string;
  dim?: string;
  surface?: string;
  font?: string;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// A result card, right to left: a title, a grey line under it, an optional small tag and a round score badge in the
// accent colour that pops in after the card. Use it for a match, a found item or a scored result.
export const MatchCard: React.FC<MatchCardProps> = ({ title = "Title", sub = "", badge = "100%", tag, delay = 0, w = 0.3, hero = "#003DA5", accent = "#DC1C2E", ink = "#0B1B3F", dim = "#5B6475", surface = "#FFFFFF", font }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const W = width * w;
  const fs = W * 0.06;
  const s = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 170 } });
  const b = spring({ frame: frame - delay - 6, fps, config: { damping: 10, stiffness: 220 } });
  return (
    <div style={{ width: W, background: surface, borderRadius: W * 0.04, borderRight: `${W * 0.015}px solid ${hero}`, padding: `${W * 0.045}px ${W * 0.05}px`, boxSizing: "border-box", direction: "rtl", fontFamily: font, display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 12px 30px rgba(11,27,63,0.14)", opacity: interpolate(frame - delay, [0, 2], [0, 1], clamp), transform: `translateY(${(1 - s) * height * 0.03}px)` }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: fs, color: ink, whiteSpace: "nowrap" }}>{title}</div>
        <div style={{ fontWeight: 500, fontSize: fs * 0.72, color: dim, whiteSpace: "nowrap" }}>{sub}</div>
        {tag ? <div style={{ display: "inline-block", marginTop: fs * 0.3, fontWeight: 700, fontSize: fs * 0.6, color: hero, background: "rgba(0,61,165,0.08)", borderRadius: fs, padding: `${fs * 0.1}px ${fs * 0.5}px`, whiteSpace: "nowrap" }}>{tag}</div> : null}
      </div>
      <div style={{ width: fs * 2.6, height: fs * 2.6, borderRadius: "50%", background: accent, color: surface, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: fs * 0.8, transform: `scale(${frame >= delay + 6 ? 0.6 + 0.4 * b : 0})`, direction: "ltr" }}>{badge}</div>
    </div>
  );
};
