import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type SceneTitleProps = {
  kicker?: string;
  title?: string;
  kickerAt?: number;
  titleAt?: number;
  align?: "right" | "center";
  y?: number;
  size?: number;
  ink?: string;
  accent?: string;
  font?: string;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// A right-to-left section heading: a small accent kicker with a short rule, then a heavy title that rises in whole.
// Use it at the top of each chapter of an explainer so the viewer always knows which part they are in.
export const SceneTitle: React.FC<SceneTitleProps> = ({ kicker = "", title = "Title", kickerAt = 0, titleAt = 6, align = "right", y = 0.07, size = 0.042, ink = "#003DA5", accent = "#DC1C2E", font }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const fs = width * size;
  const ts = spring({ frame: frame - titleAt, fps, config: { damping: 14, stiffness: 170 } });
  const ks = interpolate(frame - kickerAt, [0, 2], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", top: height * y, left: width * 0.05, right: width * 0.05, direction: "rtl", textAlign: align, display: "flex", flexDirection: "column", alignItems: align === "center" ? "center" : "flex-start", gap: fs * 0.15 }}>
      {kicker ? (
        <div style={{ display: "flex", alignItems: "center", gap: fs * 0.25, opacity: ks, transform: `translateY(${(1 - ks) * fs * 0.2}px)` }}>
          <div style={{ width: fs * 0.7 * ks, height: fs * 0.08, background: accent, borderRadius: fs }} />
          <div style={{ fontFamily: font, fontWeight: 700, fontSize: fs * 0.45, color: accent, whiteSpace: "nowrap" }}>{kicker}</div>
        </div>
      ) : null}
      <div style={{ fontFamily: font, fontWeight: 900, fontSize: fs, color: ink, whiteSpace: "nowrap", lineHeight: 1.1, opacity: interpolate(frame - titleAt, [0, 2], [0, 1], clamp), transform: `translateY(${(1 - ts) * height * 0.015}px) scale(${1.06 - 0.06 * ts})`, transformOrigin: align === "center" ? "center" : "right center" }}>{title}</div>
    </div>
  );
};
