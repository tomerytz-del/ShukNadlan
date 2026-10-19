import React from "react";
import { Img, interpolate, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type BeforeAfterProps = {
  before?: string;
  after?: string;
  x?: number;
  y?: number;
  w?: number;
  wipeAt?: number;
  frames?: number;
  delay?: number;
  handle?: string;
  label?: string;
  labelBg?: string;
  labelInk?: string;
  font?: string;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// A photo comparison: the after picture is uncovered over the before picture by a vertical handle that sweeps across.
// Use it for a renovation, a staging or any visual transformation of the same frame.
export const BeforeAfter: React.FC<BeforeAfterProps> = ({ before, after, x = 0.3, y = 0.5, w = 0.42, wipeAt = 10, frames = 24, delay = 0, handle = "#DC1C2E", label, labelBg = "#003DA5", labelInk = "#FFFFFF", font }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const W = width * w;
  const H = W * (440 / 630);
  const p = ease(interpolate(frame, [wipeAt, wipeAt + frames], [0, 1], clamp));
  const show = interpolate(frame - delay, [0, 4], [0, 1], clamp);
  const lift = interpolate(frame - delay, [0, 10], [height * 0.03, 0], { ...clamp, easing: (t: number) => 1 - Math.pow(1 - t, 3) });
  // the handle travels right to left, uncovering the after picture from the right
  const cut = W * (1 - p);
  return (
    <div style={{ position: "absolute", left: width * x - W / 2, top: height * y - H / 2 + lift, width: W, height: H, opacity: show, borderRadius: W * 0.03, overflow: "hidden", boxShadow: `0 ${H * 0.04}px ${H * 0.1}px rgba(11,27,63,0.25)` }}>
      {before ? <Img src={before} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} /> : null}
      <div style={{ position: "absolute", top: 0, bottom: 0, left: cut, right: 0, overflow: "hidden" }}>
        {after ? <Img src={after} style={{ position: "absolute", top: 0, left: -cut, width: W, height: H, objectFit: "cover" }} /> : null}
      </div>
      {p > 0 && p < 1 ? (
        <div style={{ position: "absolute", top: 0, bottom: 0, left: cut - W * 0.004, width: W * 0.008, background: handle }}>
          <div style={{ position: "absolute", top: "50%", left: "50%", width: W * 0.06, height: W * 0.06, marginLeft: -W * 0.03, marginTop: -W * 0.03, borderRadius: "50%", background: handle, border: `${W * 0.006}px solid #fff` }} />
        </div>
      ) : null}
      {label ? (
        <div style={{ position: "absolute", top: H * 0.05, right: W * 0.03, background: labelBg, color: labelInk, fontFamily: font, fontWeight: 700, fontSize: H * 0.06, padding: `${H * 0.012}px ${H * 0.035}px`, borderRadius: H * 0.05, direction: "rtl", whiteSpace: "nowrap", opacity: interpolate(frame, [wipeAt + frames - 4, wipeAt + frames + 2], [0, 1], clamp) }}>{label}</div>
      ) : null}
    </div>
  );
};
