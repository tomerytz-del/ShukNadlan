import React from "react";
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type ChatMessage = { from: "me" | "them"; lines: string[]; at: number; bold?: number[] };

export type ChatThreadProps = {
  name?: string;
  avatar?: string;
  messages?: ChatMessage[];
  phoneH?: number;
  text?: number;
  header?: string;
  wall?: string;
  mine?: string;
  theirs?: string;
  ink?: string;
  font?: string;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// A messaging-app screen, right to left: a header with avatar and name, then bubbles that pop in at their frames.
// Put it inside a PhoneFrame to show a conversation with an assistant or a person; each line is set on its own.
export const ChatThread: React.FC<ChatThreadProps> = ({
  name = "Name",
  avatar,
  messages = [],
  phoneH = 0.8,
  text = 0.028,
  header = "#F7F8FA",
  wall = "#EFEAE2",
  mine = "#D9FDD3",
  theirs = "#FFFFFF",
  ink = "#111B21",
  font,
}) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const H = height * phoneH;
  const fs = H * text;
  return (
    <div style={{ position: "absolute", inset: 0, background: wall, direction: "rtl", display: "flex", flexDirection: "column" }}>
      <div style={{ height: H * 0.09, background: header, display: "flex", alignItems: "center", gap: H * 0.015, padding: `0 ${H * 0.02}px`, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        {avatar ? <Img src={avatar} style={{ width: H * 0.055, height: H * 0.055, borderRadius: "50%", objectFit: "cover" }} /> : null}
        <div style={{ fontFamily: font, fontWeight: 700, fontSize: fs * 1.05, color: ink, whiteSpace: "nowrap" }}>{name}</div>
      </div>
      <div style={{ flex: 1, padding: H * 0.018, display: "flex", flexDirection: "column", gap: H * 0.014 }}>
        {messages.map((m, i) => {
          if (frame < m.at) return null;
          const s = spring({ frame: frame - m.at, fps, config: { damping: 14, stiffness: 190 } });
          return (
            <div
              key={i}
              style={{
                alignSelf: m.from === "me" ? "flex-end" : "flex-start",
                maxWidth: "94%",
                background: m.from === "me" ? mine : theirs,
                borderRadius: H * 0.016,
                padding: `${H * 0.011}px ${H * 0.016}px`,
                boxShadow: "0 1px 1px rgba(0,0,0,0.08)",
                opacity: interpolate(frame - m.at, [0, 2], [0, 1], clamp),
                transform: `translateY(${(1 - s) * H * 0.02}px) scale(${0.94 + 0.06 * s})`,
              }}
            >
              {m.lines.map((l, j) => (
                <div key={j} style={{ fontFamily: font, fontWeight: (m.bold ?? []).includes(j) ? 700 : 400, fontSize: fs, lineHeight: 1.35, color: ink, whiteSpace: "nowrap" }}>{l}</div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};
