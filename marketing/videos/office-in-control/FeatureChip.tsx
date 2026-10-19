import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type GlyphName = "chat" | "pin" | "spark" | "calc" | "lead" | "check";

export type FeatureChipProps = {
  label?: string;
  glyph?: GlyphName;
  delay?: number;
  size?: number;
  active?: boolean;
  ink?: string;
  hero?: string;
  surface?: string;
  font?: string;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const PATHS: Record<GlyphName, string[]> = {
  chat: ["M4 5h16v11H9l-5 4z"],
  pin: ["M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z", "M12 12.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z"],
  spark: ["M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"],
  calc: ["M6 3h12v18H6z", "M9 7h6", "M9 12h1M14 12h1M9 16h1M14 16h1"],
  lead: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"],
  check: ["M5 12.5l4.5 4.5L19 7"],
};

// A pill with a simple line glyph and a right-to-left label that pops in; active fills it with the hero colour.
// Use a column of them to tick off product features as the narrator names each one.
export const FeatureChip: React.FC<FeatureChipProps> = ({ label = "Feature", glyph = "check", delay = 0, size = 0.05, active = false, ink = "#0B1B3F", hero = "#003DA5", surface = "#FFFFFF", font }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const H = width * size;
  const s = spring({ frame: frame - delay, fps, config: { damping: 13, stiffness: 180 } });
  const fg = active ? surface : ink;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: H * 0.28,
        height: H,
        padding: `0 ${H * 0.45}px 0 ${H * 0.55}px`,
        borderRadius: H,
        background: active ? hero : surface,
        border: `2px solid ${hero}`,
        boxShadow: `0 ${H * 0.08}px ${H * 0.25}px rgba(11,27,63,0.12)`,
        direction: "rtl",
        opacity: interpolate(frame - delay, [0, 2], [0, 1], clamp),
        transform: `scale(${0.85 + 0.15 * s})`,
        transformOrigin: "right center",
      }}
    >
      <svg viewBox="0 0 24 24" width={H * 0.5} height={H * 0.5} fill="none" stroke={active ? surface : hero} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {PATHS[glyph].map((d, i) => <path key={i} d={d} />)}
      </svg>
      <div style={{ fontFamily: font, fontWeight: 700, fontSize: H * 0.4, color: fg, whiteSpace: "nowrap" }}>{label}</div>
    </div>
  );
};
