// A finger tap on a screen: a soft press and a ring that expands and fades. Place it at the absolute frame of the
// tap; x and y are pixel positions.
import React from "react";
import { interpolate, useCurrentFrame } from "reelkit/frame";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const Tap: React.FC<{ at: number; x: number; y: number; d: number; color?: string }> = ({ at, x, y, d, color = "#c9a227" }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < -6 || t > 16) return null;
  return (
    <div style={{ position: "absolute", left: x - d / 2, top: y - d / 2, width: d, height: d }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(13,27,61,0.18)", opacity: interpolate(t, [-6, 0, 6, 12], [0, 1, 1, 0], clamp), transform: `scale(${interpolate(t, [-6, 0], [1.3, 1], clamp)})` }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `${d * 0.06}px solid ${color}`, opacity: interpolate(t, [0, 14], [1, 0], clamp), transform: `scale(${interpolate(t, [0, 14], [0.3, 1.6], clamp)})` }} />
    </div>
  );
};
