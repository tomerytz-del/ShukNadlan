// Right-to-left text pieces: a single unbroken line, a rounded chip with an optional glyph, and the whole-word
// entrance (opacity full within 2 frames, short rise, small settle) that Hebrew needs instead of masked reveals.
import React from "react";
import { interpolate, spring } from "reelkit/frame";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const enter = (frame: number, at: number, fps: number, H: number, from = 1.08): React.CSSProperties => {
  const p = spring({ frame: frame - at, fps, config: { damping: 13, stiffness: 170 } });
  return {
    opacity: interpolate(frame - at, [0, 2], [0, 1], clamp),
    transform: `translateY(${(1 - p) * H * 0.015}px) scale(${from - (from - 1) * p})`,
  };
};
export const shown = (frame: number, at: number, fps: number, H: number, from = 1.08): React.CSSProperties =>
  frame >= at ? enter(frame, at, fps, H, from) : { opacity: 0 };

export const HebrewText: React.FC<{ size: number; face: string; weight?: number; color?: string; style?: React.CSSProperties; children: React.ReactNode }> = ({ size, face, weight = 700, color = "#0d1b3d", style, children }) => (
  <div style={{ fontFamily: face, fontSize: size, fontWeight: weight, color, direction: "rtl", whiteSpace: "nowrap", lineHeight: 1.15, ...style }}>{children}</div>
);
