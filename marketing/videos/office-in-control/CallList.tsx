import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type CallRow = { who: string; with: string; time: string; length: string; summary: string };

export type CallListProps = {
  calls?: CallRow[];
  delay?: number;
  per?: number;
  playIndex?: number;
  playAt?: number;
  w?: number;
  hero?: string;
  accent?: string;
  ink?: string;
  dim?: string;
  line?: string;
  surface?: string;
  font?: string;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// A right-to-left list of recorded calls: who, with whom, when, how long and a one-line summary, each with a play
// button; at playAt one row's button turns on and a waveform runs under it. Use it for a call log or recordings.
export const CallList: React.FC<CallListProps> = ({ calls = [], delay = 0, per = 5, playIndex = 0, playAt = 9999, w = 0.6, hero = "#003DA5", accent = "#DC1C2E", ink = "#0B1B3F", dim = "#5B6475", line = "#E3E8F0", surface = "#FFFFFF", font }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const W = width * w;
  const fs = W * 0.026;
  return (
    <div style={{ width: W, direction: "rtl", fontFamily: font }}>
      {calls.map((c, i) => {
        const at = delay + i * per;
        const playing = i === playIndex && frame >= playAt;
        const bars = 36;
        return (
          <div key={i} style={{ background: playing ? "rgba(0,61,165,0.05)" : surface, borderBottom: `1px solid ${line}`, padding: `${height * 0.016}px ${W * 0.02}px`, opacity: interpolate(frame - at, [0, 3], [0, 1], clamp), transform: `translateY(${interpolate(frame - at, [0, 8], [fs, 0], clamp)}px)` }}>
            <div style={{ display: "flex", alignItems: "center", gap: W * 0.02 }}>
              <div style={{ width: fs * 2.2, height: fs * 2.2, borderRadius: "50%", background: playing ? accent : hero, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg viewBox="0 0 24 24" width={fs} height={fs} fill={surface}>{playing ? <path d="M7 5h3v14H7zM14 5h3v14h-3z" /> : <path d="M8 5l11 7-11 7z" />}</svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: fs, color: ink, whiteSpace: "nowrap" }}>{c.who} · {c.with}</div>
                <div style={{ fontWeight: 500, fontSize: fs * 0.85, color: dim, whiteSpace: "nowrap" }}>{c.summary}</div>
              </div>
              <div style={{ fontWeight: 600, fontSize: fs * 0.8, color: dim, whiteSpace: "nowrap", textAlign: "left" }}>{c.time} · {c.length}</div>
            </div>
            {playing ? (
              <div style={{ display: "flex", alignItems: "center", gap: 3, height: fs * 1.6, marginTop: fs * 0.4, marginRight: fs * 2.8, direction: "ltr" }}>
                {Array.from({ length: bars }).map((_, b) => {
                  const lit = (frame - playAt) / 3 > b;
                  const hgt = 0.3 + 0.7 * Math.abs(Math.sin(b * 1.7 + 0.6) * Math.cos(b * 0.45));
                  return <div key={b} style={{ width: W * 0.006, height: `${hgt * 100}%`, borderRadius: 2, background: lit ? accent : line }} />;
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
