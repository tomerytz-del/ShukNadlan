import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type NodeTriadProps = {
  labels?: string[];
  at?: number[];
  focus?: number;
  focusAt?: number;
  ink?: string;
  hero?: string;
  accent?: string;
  surface?: string;
  font?: string;
  y?: number;
  size?: number;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// A row of round nodes joined by lines that draw from one to the next as each node lands, read right to left.
// Use it to show that a few separate parties become one connected system; focus lights one node in the accent.
export const NodeTriad: React.FC<NodeTriadProps> = ({
  labels = ["A", "B", "C"],
  at = [0, 15, 30],
  focus = -1,
  focusAt = 0,
  ink = "#0B1B3F",
  hero = "#003DA5",
  accent = "#DC1C2E",
  surface = "#FFFFFF",
  font,
  y = 0.6,
  size = 0.15,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const d = width * size;
  const n = labels.length;
  const span = width * 0.6;
  // first node on the right
  const xs = labels.map((_, i) => width / 2 + span / 2 - (span * i) / Math.max(1, n - 1));
  const cy = height * y;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {xs.slice(0, -1).map((x, i) => {
          const p = interpolate(frame, [at[i + 1] - 6, at[i + 1] + 4], [0, 1], clamp);
          if (p <= 0) return null;
          const x1 = x - d / 2;
          const x2 = x1 - (x1 - (xs[i + 1] + d / 2)) * p;
          return <line key={i} x1={x1} y1={cy} x2={x2} y2={cy} stroke={accent} strokeWidth={width * 0.004} strokeLinecap="round" strokeDasharray={`${width * 0.01} ${width * 0.008}`} />;
        })}
      </svg>
      {labels.map((label, i) => {
        const s = spring({ frame: frame - at[i], fps, config: { damping: 14, stiffness: 160 } });
        const lit = focus === i ? interpolate(frame, [focusAt, focusAt + 8], [0, 1], clamp) : 0;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: xs[i] - d / 2,
              top: cy - d / 2,
              width: d,
              height: d,
              borderRadius: "50%",
              background: lit > 0.5 ? hero : surface,
              border: `${width * 0.004}px solid ${hero}`,
              boxShadow: `0 ${width * 0.01}px ${width * 0.03}px rgba(11,27,63,0.16)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: interpolate(frame - at[i], [0, 2], [0, 1], clamp),
              transform: `scale(${0.6 + 0.4 * s})`,
            }}
          >
            <div style={{ fontFamily: font, fontWeight: 800, fontSize: d * 0.2, color: lit > 0.5 ? surface : ink, direction: "rtl", whiteSpace: "nowrap" }}>{label}</div>
          </div>
        );
      })}
    </div>
  );
};
