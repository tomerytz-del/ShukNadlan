import React from "react";
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type PhoneFrameProps = {
  src?: string;
  src2?: string;
  swapAt?: number;
  x?: number;
  y?: number;
  h?: number;
  aspect?: number;
  delay?: number;
  tilt?: number;
  bezel?: string;
  children?: React.ReactNode;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// A phone standing upright (aspect is its width over its height) with a dark bezel, showing a screenshot (or any children), that rises into place.
// src2 and swapAt cross-fade to a second screenshot, for one step of a flow on the same device.
export const PhoneFrame: React.FC<PhoneFrameProps> = ({ src, src2, swapAt = 9999, x = 0.7, y = 0.5, h = 0.78, aspect = 0.49, delay = 0, tilt = 0, bezel = "#0B1B3F", children }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const H = height * h;
  const W = H * aspect;
  const s = spring({ frame: frame - delay, fps, config: { damping: 16, stiffness: 140 } });
  const swap = interpolate(frame, [swapAt, swapAt + 8], [0, 1], clamp);
  const pad = W * 0.035;
  return (
    <div
      style={{
        position: "absolute",
        left: width * x - W / 2,
        top: height * y - H / 2,
        width: W,
        height: H,
        borderRadius: W * 0.13,
        background: bezel,
        padding: pad,
        boxSizing: "border-box",
        boxShadow: `0 ${H * 0.03}px ${H * 0.08}px rgba(11,27,63,0.28)`,
        opacity: interpolate(frame - delay, [0, 3], [0, 1], clamp),
        transform: `translateY(${(1 - s) * height * 0.06}px) rotate(${tilt}deg)`,
      }}
    >
      <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: W * 0.1, overflow: "hidden", background: "#ffffff" }}>
        {src ? <Img src={src} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} /> : null}
        {src2 ? <Img src={src2} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", opacity: swap }} /> : null}
        {children}
      </div>
    </div>
  );
};
