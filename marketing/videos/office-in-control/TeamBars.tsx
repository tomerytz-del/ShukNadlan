import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type TeamBar = { label: string; pct: number; lead?: string };

export type TeamBarsProps = {
  title?: string;
  bars?: TeamBar[];
  targetLabel?: string;
  delay?: number;
  per?: number;
  w?: number;
  hero?: string;
  good?: string;
  bad?: string;
  ink?: string;
  dim?: string;
  line?: string;
  surface?: string;
  font?: string;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

// Horizontal progress bars toward a shared target, one per group, with a dashed 100% line; each bar grows in turn and
// takes a colour by whether it passed the target. Labels read right to left; the bars fill left to right like any meter.
export const TeamBars: React.FC<TeamBarsProps> = ({ title = "", bars = [], targetLabel = "Target", delay = 0, per = 8, w = 0.4, hero = "#003DA5", good = "#1F8A4C", bad = "#DC1C2E", ink = "#0B1B3F", dim = "#5B6475", line = "#E3E8F0", surface = "#FFFFFF", font }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const W = width * w;
  const fs = W * 0.042;
  const max = 130;
  const track = W * 0.62;
  return (
    <div style={{ width: W, background: surface, borderRadius: W * 0.03, padding: W * 0.05, boxSizing: "border-box", direction: "rtl", fontFamily: font, boxShadow: "0 16px 40px rgba(11,27,63,0.16)", opacity: interpolate(frame - delay, [0, 3], [0, 1], clamp) }}>
      {title ? <div style={{ fontWeight: 800, fontSize: fs * 1.1, color: ink, whiteSpace: "nowrap", marginBottom: fs * 0.8 }}>{title}</div> : null}
      {bars.map((b, i) => {
        const at = delay + 6 + i * per;
        const p = ease(interpolate(frame, [at, at + 18], [0, 1], clamp));
        const v = Math.round(b.pct * p);
        const col = b.pct >= 100 ? good : b.pct < 85 ? bad : hero;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: W * 0.03, marginBottom: fs * 0.9, opacity: interpolate(frame - at, [0, 3], [0, 1], clamp) }}>
            <div style={{ width: W * 0.22 }}>
              <div style={{ fontWeight: 700, fontSize: fs, color: ink, whiteSpace: "nowrap" }}>{b.label}</div>
              {b.lead ? <div style={{ fontWeight: 400, fontSize: fs * 0.75, color: dim, whiteSpace: "nowrap" }}>{b.lead}</div> : null}
            </div>
            <div style={{ position: "relative", width: track, height: fs * 0.8, borderRadius: fs, background: line, direction: "ltr" }}>
              <div style={{ width: `${(Math.min(b.pct, max) / max) * 100 * p}%`, height: "100%", borderRadius: fs, background: col }} />
              <div style={{ position: "absolute", top: -fs * 0.4, bottom: -fs * 0.4, left: `${(100 / max) * 100}%`, borderLeft: `2px dashed ${ink}` }} />
            </div>
            <div style={{ fontWeight: 800, fontSize: fs, color: ink, direction: "ltr", minWidth: fs * 3 }}>{v}%</div>
          </div>
        );
      })}
      <div style={{ fontWeight: 600, fontSize: fs * 0.8, color: dim, whiteSpace: "nowrap" }}>{targetLabel}</div>
    </div>
  );
};
