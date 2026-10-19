import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type SlotPickerProps = {
  title?: string;
  days?: string[];
  pick?: number;
  pickAt?: number;
  times?: string[];
  timePick?: number;
  timeAt?: number;
  button?: string;
  buttonAt?: number;
  delay?: number;
  w?: number;
  hero?: string;
  ink?: string;
  line?: string;
  surface?: string;
  font?: string;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// A booking card, right to left: a grid of day chips and a row of time chips, each selected at its own frame, then a
// confirm button that fills in. Use it to show someone choosing an appointment.
export const SlotPicker: React.FC<SlotPickerProps> = ({
  title = "Pick a time",
  days = [],
  pick = 0,
  pickAt = 10,
  times = [],
  timePick = 0,
  timeAt = 20,
  button = "Send",
  buttonAt = 30,
  delay = 0,
  w = 0.3,
  hero = "#1E3A66",
  ink = "#0B1B3F",
  line = "#E3E8F0",
  surface = "#FFFFFF",
  font,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const W = width * w;
  const fs = W * 0.05;
  const s = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 160 } });
  const chip = (label: string, on: boolean, key: string | number) => (
    <div key={key} style={{ padding: `${fs * 0.45}px 0`, textAlign: "center", borderRadius: fs * 0.6, border: `2px solid ${on ? hero : line}`, background: on ? hero : surface, color: on ? surface : ink, fontWeight: 700, fontSize: fs * 0.8, whiteSpace: "nowrap" }}>{label}</div>
  );
  const fill = interpolate(frame, [buttonAt, buttonAt + 6], [0, 1], clamp);
  return (
    <div style={{ width: W, background: surface, borderRadius: W * 0.05, padding: W * 0.05, boxSizing: "border-box", direction: "rtl", fontFamily: font, boxShadow: "0 16px 40px rgba(11,27,63,0.18)", opacity: interpolate(frame - delay, [0, 3], [0, 1], clamp), transform: `translateY(${(1 - s) * height * 0.04}px)` }}>
      <div style={{ fontWeight: 800, fontSize: fs * 1.05, color: ink, marginBottom: fs * 0.7, whiteSpace: "nowrap" }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: fs * 0.45, marginBottom: fs * 0.8 }}>{days.map((d, i) => chip(d, i === pick && frame >= pickAt, i))}</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, times.length)}, 1fr)`, gap: fs * 0.45, marginBottom: fs * 0.9 }}>{times.map((t, i) => chip(t, i === timePick && frame >= timeAt, i))}</div>
      <div style={{ textAlign: "center", padding: `${fs * 0.6}px 0`, borderRadius: fs * 0.7, background: fill > 0 ? hero : line, color: fill > 0 ? surface : ink, fontWeight: 800, fontSize: fs * 0.9, whiteSpace: "nowrap", transform: `scale(${1 + 0.04 * Math.sin(Math.PI * fill)})` }}>{button}</div>
    </div>
  );
};
