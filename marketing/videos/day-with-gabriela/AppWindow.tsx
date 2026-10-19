import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type AppWindowProps = {
  title?: string;
  tag?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  delay?: number;
  ink?: string;
  hero?: string;
  surface?: string;
  line?: string;
  font?: string;
  children?: React.ReactNode;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// A desktop app window with a title bar (right-to-left title, optional small tag) that rises into place.
// Use it as the frame for a rebuilt product screen: dashboards, lists, forms.
export const AppWindow: React.FC<AppWindowProps> = ({
  title = "Window",
  tag,
  x = 0.1,
  y = 0.15,
  w = 0.8,
  h = 0.65,
  delay = 0,
  ink = "#0B1B3F",
  hero = "#003DA5",
  surface = "#FFFFFF",
  line = "#E3E8F0",
  font,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 16, stiffness: 140 } });
  const bar = height * 0.055;
  return (
    <div
      style={{
        position: "absolute",
        left: width * x,
        top: height * y,
        width: width * w,
        height: height * h,
        background: surface,
        borderRadius: width * 0.012,
        border: `1px solid ${line}`,
        boxShadow: `0 ${width * 0.012}px ${width * 0.04}px rgba(11,27,63,0.14)`,
        overflow: "hidden",
        opacity: interpolate(frame - delay, [0, 3], [0, 1], clamp),
        transform: `translateY(${(1 - s) * height * 0.04}px) scale(${0.97 + 0.03 * s})`,
      }}
    >
      <div style={{ height: bar, background: hero, display: "flex", alignItems: "center", justifyContent: "space-between", padding: `0 ${width * 0.012}px`, direction: "rtl" }}>
        <div style={{ display: "flex", alignItems: "center", gap: width * 0.008 }}>
          <div style={{ fontFamily: font, fontWeight: 700, fontSize: bar * 0.42, color: surface, whiteSpace: "nowrap" }}>{title}</div>
          {tag ? (
            <div style={{ fontFamily: font, fontWeight: 600, fontSize: bar * 0.3, color: hero, background: surface, borderRadius: bar, padding: `${bar * 0.06}px ${bar * 0.3}px`, whiteSpace: "nowrap" }}>{tag}</div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: bar * 0.18, direction: "ltr" }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: bar * 0.22, height: bar * 0.22, borderRadius: "50%", background: "rgba(255,255,255,0.55)" }} />
          ))}
        </div>
      </div>
      <div style={{ position: "absolute", top: bar, left: 0, right: 0, bottom: 0 }}>{children}</div>
    </div>
  );
};
