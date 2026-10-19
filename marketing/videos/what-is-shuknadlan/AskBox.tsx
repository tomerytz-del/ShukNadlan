import React from "react";
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type AskBoxProps = {
  question?: string;
  answer?: string[];
  avatar?: string;
  label?: string;
  delay?: number;
  cps?: number;
  answerAt?: number;
  per?: number;
  w?: number;
  panel?: string;
  field?: string;
  surface?: string;
  ink?: string;
  gold?: string;
  font?: string;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// A right-to-left ask field: a question types itself in with a caret at its left end, then the answer lines rise in
// one by one on a light card below. Use it to show someone asking an assistant or coach a question.
export const AskBox: React.FC<AskBoxProps> = ({
  question = "Question?",
  answer = [],
  avatar,
  label = "",
  delay = 0,
  cps = 26,
  answerAt = 40,
  per = 8,
  w = 0.62,
  panel = "#0E2557",
  field = "#1B3A7A",
  surface = "#FFFFFF",
  ink = "#0B1B3F",
  gold = "#E2B93B",
  font,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const W = width * w;
  const fs = W * 0.03;
  const s = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 160 } });
  const chars = Math.floor(Math.max(0, frame - delay - 4) * (cps / fps));
  const typed = Array.from(question).slice(0, chars).join("");
  const caret = chars < question.length || frame < answerAt ? (Math.floor(frame / 8) % 2 === 0 ? 1 : 0) : 0;
  return (
    <div style={{ width: W, direction: "rtl", fontFamily: font, opacity: interpolate(frame - delay, [0, 3], [0, 1], clamp), transform: `translateY(${(1 - s) * height * 0.04}px)` }}>
      <div style={{ background: panel, borderRadius: W * 0.03, padding: W * 0.025, display: "flex", alignItems: "center", gap: W * 0.02 }}>
        {avatar ? <Img src={avatar} style={{ width: W * 0.08, height: W * 0.08, borderRadius: "50%", border: `3px solid ${gold}`, objectFit: "cover" }} /> : null}
        <div style={{ flex: 1, background: field, border: `2px solid ${gold}`, borderRadius: W * 0.02, padding: `${W * 0.018}px ${W * 0.025}px`, display: "flex", alignItems: "center", gap: W * 0.01, minHeight: fs * 1.6 }}>
          {label ? <span style={{ fontWeight: 400, fontSize: fs * 0.85, color: "rgba(255,255,255,0.65)", whiteSpace: "nowrap" }}>{label}</span> : null}
          <span style={{ fontWeight: 700, fontSize: fs, color: surface, whiteSpace: "nowrap" }}>{typed}</span>
          <span style={{ width: 3, height: fs * 1.1, background: gold, opacity: caret }} />
        </div>
        <div style={{ width: W * 0.075, height: W * 0.075, borderRadius: W * 0.02, background: gold, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg viewBox="0 0 24 24" width={W * 0.035} height={W * 0.035} fill="none" stroke={panel} strokeWidth={2.6} strokeLinecap="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
        </div>
      </div>
      {frame >= answerAt ? (
        <div style={{ marginTop: W * 0.02, background: surface, borderRadius: W * 0.03, padding: W * 0.03, boxShadow: "0 12px 30px rgba(11,27,63,0.18)" }}>
          {answer.map((l, i) => {
            const at = answerAt + i * per;
            return <div key={i} style={{ fontWeight: i === 0 ? 800 : 500, fontSize: fs * (i === 0 ? 1.0 : 0.9), color: ink, whiteSpace: "nowrap", lineHeight: 1.5, opacity: interpolate(frame - at, [0, 3], [0, 1], clamp), transform: `translateY(${interpolate(frame - at, [0, 6], [fs * 0.4, 0], clamp)}px)` }}>{l}</div>;
          })}
        </div>
      ) : null}
    </div>
  );
};
