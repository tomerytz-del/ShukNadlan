// A real phone screenshot inside a phone body, shown through a window that can scroll down the picture, with
// boxes that light up over regions of it (in the screenshot's own pixels) as the narration names them.
import React from "react";
import { Img } from "reelkit/frame";

export type ShotMark = { box: [number, number, number, number]; p: number };

export const PhoneShot: React.FC<{
  src: string;
  srcW: number;
  srcH: number;
  width: number; // on-screen width of the screen area, px
  viewH: number; // on-screen height of the screen area, px
  scroll: number; // how far down the screenshot the window has moved, in screenshot px
  marks?: ShotMark[];
  accent?: string;
}> = ({ src, srcW, srcH, width, viewH, scroll, marks = [], accent = "#c9a227" }) => {
  const k = width / srcW;
  const bezel = width * 0.035;
  return (
    <div style={{ width: width + bezel * 2, height: viewH + bezel * 2, padding: bezel, borderRadius: width * 0.11, background: "#10131a", boxShadow: "0 30px 70px rgba(13,27,61,0.28)" }}>
      <div style={{ position: "relative", width, height: viewH, borderRadius: width * 0.08, overflow: "hidden", background: "#efeae2" }}>
        <div style={{ position: "absolute", left: 0, top: -scroll * k, width, height: srcH * k }}>
          <Img src={src} style={{ width: "100%", height: "100%", display: "block" }} />
          {marks.map((m, i) => {
            if (m.p <= 0.001) return null;
            const [x1, y1, x2, y2] = m.box;
            return (
              <div key={i} style={{ position: "absolute", left: x1 * k, top: y1 * k, width: (x2 - x1) * k, height: (y2 - y1) * k, borderRadius: width * 0.04, border: `${width * 0.012}px solid ${accent}`, boxShadow: `0 0 ${width * 0.05}px rgba(201,162,39,0.55)`, opacity: m.p, transform: `scale(${1.04 - 0.04 * m.p})` }} />
            );
          })}
        </div>
      </div>
    </div>
  );
};
