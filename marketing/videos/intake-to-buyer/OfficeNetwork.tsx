import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type NetNode = { x: number; y: number; label: string; at: number; main?: boolean };

export type OfficeNetworkProps = {
  nodes?: NetNode[];
  linkAt?: number;
  from?: number;
  to?: number;
  travelAt?: number;
  travelFrames?: number;
  cardLabel?: string;
  clientLabel?: string;
  clientAt?: number;
  matchLabel?: string;
  matchAt?: number;
  ink?: string;
  hero?: string;
  accent?: string;
  surface?: string;
  line?: string;
  font?: string;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// A small network of partner nodes: they pop in, links draw from the main node to every other, a card travels
// along one link, a second chip appears at its end and a match badge seals it. Use it for sharing or matching between parties.
export const OfficeNetwork: React.FC<OfficeNetworkProps> = ({
  nodes = [],
  linkAt = 0,
  from = 0,
  to = 1,
  travelAt = 30,
  travelFrames = 22,
  cardLabel = "Item",
  clientLabel = "Client",
  clientAt = 50,
  matchLabel = "Match",
  matchAt = 60,
  ink = "#0B1B3F",
  hero = "#003DA5",
  accent = "#DC1C2E",
  surface = "#FFFFFF",
  line = "#C9D3E3",
  font,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const r = width * 0.045;
  const P = (n: NetNode) => ({ x: n.x * width, y: n.y * height });
  const main = nodes.findIndex((n) => n.main);
  const m = main >= 0 ? P(nodes[main]) : { x: 0, y: 0 };
  const a = nodes[from] ? P(nodes[from]) : m;
  const b = nodes[to] ? P(nodes[to]) : m;
  const t = ease(interpolate(frame, [travelAt, travelAt + travelFrames], [0, 1], clamp));
  const cx = a.x + (b.x - a.x) * t;
  const cy = a.y + (b.y - a.y) * t - Math.sin(Math.PI * t) * height * 0.08;
  const match = spring({ frame: frame - matchAt, fps, config: { damping: 12, stiffness: 200 } });
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {nodes.map((n, i) => {
          if (i === main) return null;
          const q = P(n);
          const p = interpolate(frame, [linkAt + i * 3, linkAt + i * 3 + 12], [0, 1], clamp);
          const hot = i === to && frame >= matchAt;
          return <line key={i} x1={m.x} y1={m.y} x2={m.x + (q.x - m.x) * p} y2={m.y + (q.y - m.y) * p} stroke={hot ? accent : line} strokeWidth={hot ? width * 0.004 : width * 0.0025} strokeDasharray={hot ? undefined : `${width * 0.008} ${width * 0.006}`} />;
        })}
      </svg>
      {nodes.map((n, i) => {
        const q = P(n);
        const s = spring({ frame: frame - n.at, fps, config: { damping: 14, stiffness: 170 } });
        return (
          <div key={i} style={{ position: "absolute", left: q.x - r, top: q.y - r, width: r * 2, height: r * 2, borderRadius: "50%", background: n.main ? hero : surface, border: `3px solid ${hero}`, display: "flex", alignItems: "center", justifyContent: "center", opacity: interpolate(frame - n.at, [0, 2], [0, 1], clamp), transform: `scale(${0.6 + 0.4 * s})`, boxShadow: "0 8px 24px rgba(11,27,63,0.15)" }}>
            <svg viewBox="0 0 24 24" width={r * 0.8} height={r * 0.8} fill="none" stroke={n.main ? surface : hero} strokeWidth={1.8} strokeLinejoin="round"><path d="M4 20V9l8-5 8 5v11z" /><path d="M10 20v-6h4v6" /></svg>
            <div style={{ position: "absolute", top: r * 2.15, fontFamily: font, fontWeight: 700, fontSize: r * 0.42, color: ink, whiteSpace: "nowrap", direction: "rtl" }}>{n.label}</div>
          </div>
        );
      })}
      {frame >= travelAt - 2 ? (
        <div style={{ position: "absolute", left: cx - width * 0.06, top: cy - height * 0.12, width: width * 0.12, padding: `${height * 0.012}px ${width * 0.01}px`, background: surface, borderRadius: width * 0.008, border: `2px solid ${hero}`, boxShadow: "0 10px 26px rgba(11,27,63,0.2)", direction: "rtl", textAlign: "center", fontFamily: font, fontWeight: 700, fontSize: width * 0.0125, color: ink, whiteSpace: "nowrap", opacity: interpolate(frame, [travelAt - 2, travelAt + 2], [0, 1], clamp) }}>{cardLabel}</div>
      ) : null}
      {frame >= clientAt ? (
        <div style={{ position: "absolute", left: b.x - width * 0.055, top: b.y + r * 2.9, width: width * 0.11, padding: `${height * 0.01}px 0`, background: surface, borderRadius: width * 0.02, border: `2px solid ${ink}`, textAlign: "center", direction: "rtl", fontFamily: font, fontWeight: 700, fontSize: width * 0.012, color: ink, whiteSpace: "nowrap", opacity: interpolate(frame - clientAt, [0, 2], [0, 1], clamp) }}>{clientLabel}</div>
      ) : null}
      {frame >= matchAt ? (
        <div style={{ position: "absolute", left: b.x - width * 0.07, top: b.y - r * 2.3 - height * 0.07, width: width * 0.14, padding: `${height * 0.012}px 0`, background: accent, borderRadius: width * 0.03, textAlign: "center", direction: "rtl", fontFamily: font, fontWeight: 800, fontSize: width * 0.016, color: surface, whiteSpace: "nowrap", transform: `scale(${0.7 + 0.3 * match})`, opacity: interpolate(frame - matchAt, [0, 2], [0, 1], clamp) }}>{matchLabel}</div>
      ) : null}
    </div>
  );
};
