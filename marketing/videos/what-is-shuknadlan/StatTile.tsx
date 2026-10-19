import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type StatTileProps = {
  label?: string;
  value?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  delta?: string;
  delay?: number;
  count?: number;
  w?: number;
  h?: number;
  ink?: string;
  dim?: string;
  bar?: string;
  good?: string;
  surface?: string;
  line?: string;
  font?: string;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// A dashboard tile: a coloured top rule, a right-to-left label, a figure that counts up and a small change chip.
// Use it in a row of key numbers on a rebuilt dashboard.
export const StatTile: React.FC<StatTileProps> = ({
  label = "Label",
  value = 42,
  decimals = 0,
  prefix = "",
  suffix = "",
  delta,
  delay = 0,
  count = 18,
  w = 0.18,
  h = 0.17,
  ink = "#0B1B3F",
  dim = "#5B6475",
  bar = "#003DA5",
  good = "#1F8A4C",
  surface = "#FFFFFF",
  line = "#E3E8F0",
  font,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 160 } });
  const v = value * interpolate(frame, [delay, delay + count], [0, 1], { ...clamp, easing: (t: number) => 1 - Math.pow(1 - t, 3) });
  const shown = v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const W = width * w;
  const H = height * h;
  return (
    <div
      style={{
        width: W,
        height: H,
        background: surface,
        border: `1px solid ${line}`,
        borderTop: `${H * 0.04}px solid ${bar}`,
        borderRadius: width * 0.008,
        padding: `${H * 0.1}px ${W * 0.07}px`,
        boxSizing: "border-box",
        direction: "rtl",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        opacity: interpolate(frame - delay, [0, 2], [0, 1], clamp),
        transform: `translateY(${(1 - s) * H * 0.12}px)`,
      }}
    >
      <div style={{ fontFamily: font, fontWeight: 600, fontSize: H * 0.13, color: dim, whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ fontFamily: font, fontWeight: 800, fontSize: H * 0.3, color: ink, whiteSpace: "nowrap", display: "flex", gap: W * 0.02 }}>
        <span>{prefix}{shown}{suffix}</span>
      </div>
      {delta ? <div style={{ fontFamily: font, fontWeight: 700, fontSize: H * 0.12, color: good, whiteSpace: "nowrap" }}>{delta}</div> : <div />}
    </div>
  );
};
