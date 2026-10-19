import React from "react";
import { Img, interpolate, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type AgentRow = { name: string; photo?: string; pct: number; deals: string; leads: string; reply: string; flag?: string; flagAt?: number; tone?: "good" | "bad" };

export type AgentTableProps = {
  rows?: AgentRow[];
  head?: string[];
  delay?: number;
  per?: number;
  w?: number;
  ink?: string;
  dim?: string;
  hero?: string;
  good?: string;
  bad?: string;
  surface?: string;
  line?: string;
  font?: string;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// A right-to-left performance table: one row per person with an avatar, a progress bar toward a target and a few
// figures; a row can light up with a coloured flag at its own frame. Use it on a rebuilt team dashboard.
export const AgentTable: React.FC<AgentTableProps> = ({
  rows = [],
  head = ["Name", "Target", "Deals", "Leads", "Reply"],
  delay = 0,
  per = 4,
  w = 0.6,
  ink = "#0B1B3F",
  dim = "#5B6475",
  hero = "#003DA5",
  good = "#1F8A4C",
  bad = "#DC1C2E",
  surface = "#FFFFFF",
  line = "#E3E8F0",
  font,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const W = width * w;
  const rh = height * 0.072;
  const fs = rh * 0.3;
  const cols = [0.3, 0.26, 0.13, 0.13, 0.18];
  const cell = (c: number, child: React.ReactNode, key: string | number) => (
    <div key={key} style={{ width: W * cols[c], display: "flex", alignItems: "center", gap: W * 0.01 }}>{child}</div>
  );
  return (
    <div style={{ width: W, direction: "rtl", fontFamily: font }}>
      <div style={{ display: "flex", height: rh * 0.7, borderBottom: `2px solid ${line}`, opacity: interpolate(frame - delay, [0, 4], [0, 1], clamp) }}>
        {head.map((h, i) => cell(i, <div style={{ fontWeight: 700, fontSize: fs * 0.85, color: dim, whiteSpace: "nowrap" }}>{h}</div>, i))}
      </div>
      {rows.map((r, i) => {
        const at = delay + 4 + i * per;
        const lit = r.flagAt !== undefined ? interpolate(frame, [r.flagAt, r.flagAt + 6], [0, 1], clamp) : 0;
        const tone = r.tone === "bad" ? bad : good;
        const bar = interpolate(frame, [at, at + 18], [0, Math.min(1, r.pct / 120)], { ...clamp, easing: (t: number) => 1 - Math.pow(1 - t, 3) });
        return (
          <div key={i} style={{ display: "flex", height: rh, borderBottom: `1px solid ${line}`, background: lit > 0 ? `rgba(${r.tone === "bad" ? "220,28,46" : "31,138,76"},${0.08 * lit})` : surface, boxShadow: lit > 0 ? `inset -${W * 0.006 * lit}px 0 0 ${tone}` : undefined, opacity: interpolate(frame - at, [0, 3], [0, 1], clamp), transform: `translateY(${interpolate(frame - at, [0, 8], [rh * 0.3, 0], clamp)}px)` }}>
            {cell(0, <>
              <div style={{ width: rh * 0.62, height: rh * 0.62, borderRadius: "50%", background: hero, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", color: surface, fontWeight: 700, fontSize: fs, marginRight: W * 0.008 }}>
                {r.photo ? <Img src={r.photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : r.name.slice(0, 1)}
              </div>
              <div style={{ fontWeight: 700, fontSize: fs, color: ink, whiteSpace: "nowrap" }}>{r.name}</div>
            </>, "n")}
            {cell(1, <>
              <div style={{ width: W * 0.15, height: rh * 0.14, borderRadius: rh, background: line, overflow: "hidden", display: "flex", justifyContent: "flex-start", direction: "ltr" }}>
                <div style={{ width: `${bar * 100}%`, height: "100%", background: r.pct >= 100 ? good : r.pct < 75 ? bad : hero, borderRadius: rh }} />
              </div>
              <div style={{ fontWeight: 800, fontSize: fs, color: ink, direction: "ltr", unicodeBidi: "isolate" }}>{r.pct}%</div>
            </>, "p")}
            {cell(2, <div style={{ fontWeight: 700, fontSize: fs, color: ink }}>{r.deals}</div>, "d")}
            {cell(3, <div style={{ fontWeight: 700, fontSize: fs, color: ink }}>{r.leads}</div>, "l")}
            {cell(4, r.flag && lit > 0 ? (
              <div style={{ fontWeight: 700, fontSize: fs * 0.85, color: surface, background: tone, borderRadius: rh, padding: `${rh * 0.06}px ${rh * 0.22}px`, whiteSpace: "nowrap", opacity: lit, transform: `scale(${0.8 + 0.2 * lit})` }}>{r.flag}</div>
            ) : (
              <div style={{ fontWeight: 600, fontSize: fs, color: dim, whiteSpace: "nowrap" }}>{r.reply}</div>
            ), "r")}
          </div>
        );
      })}
    </div>
  );
};
