import React from "react";
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type MailAlertProps = {
  from?: string;
  subject?: string;
  time?: string;
  greeting?: string;
  photo?: string;
  price?: string;
  title?: string;
  place?: string;
  button?: string;
  bannerAt?: number;
  openAt?: number;
  phoneH?: number;
  hero?: string;
  ink?: string;
  dim?: string;
  surface?: string;
  ground?: string;
  font?: string;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// A phone screen that receives an email: a notification banner drops in at bannerAt, then the message opens at openAt
// with a greeting, a listing card and a button. Put it inside a PhoneFrame; everything is right to left.
export const MailAlert: React.FC<MailAlertProps> = ({
  from = "Sender",
  subject = "Subject",
  time = "now",
  greeting = "",
  photo,
  price = "",
  title = "",
  place = "",
  button = "Open",
  bannerAt = 4,
  openAt = 30,
  phoneH = 0.8,
  hero = "#003DA5",
  ink = "#0B1B3F",
  dim = "#5B6475",
  surface = "#FFFFFF",
  ground = "#EEF2F8",
  font,
}) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const H = height * phoneH;
  const fs = H * 0.03;
  const b = spring({ frame: frame - bannerAt, fps, config: { damping: 14, stiffness: 190 } });
  const open = interpolate(frame, [openAt, openAt + 8], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", inset: 0, background: ground, direction: "rtl", fontFamily: font, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, padding: H * 0.025, paddingTop: H * 0.06, opacity: open, transform: `translateY(${(1 - open) * H * 0.04}px)` }}>
        <div style={{ fontWeight: 800, fontSize: fs * 1.05, color: ink, whiteSpace: "nowrap" }}>{subject}</div>
        <div style={{ fontWeight: 400, fontSize: fs * 0.75, color: dim, whiteSpace: "nowrap", marginBottom: H * 0.02 }}>{from}</div>
        <div style={{ fontWeight: 500, fontSize: fs * 0.9, color: ink, whiteSpace: "nowrap", marginBottom: H * 0.015 }}>{greeting}</div>
        <div style={{ background: surface, borderRadius: H * 0.02, overflow: "hidden", boxShadow: "0 6px 16px rgba(11,27,63,0.1)" }}>
          {photo ? <Img src={photo} style={{ display: "block", width: "100%", height: H * 0.24, objectFit: "cover" }} /> : null}
          <div style={{ padding: H * 0.018 }}>
            <div style={{ fontWeight: 800, fontSize: fs * 1.15, color: ink, whiteSpace: "nowrap" }}>{price}</div>
            <div style={{ fontWeight: 700, fontSize: fs * 0.88, color: ink, whiteSpace: "nowrap" }}>{title}</div>
            <div style={{ fontWeight: 400, fontSize: fs * 0.78, color: dim, whiteSpace: "nowrap", marginBottom: H * 0.014 }}>{place}</div>
            <div style={{ textAlign: "center", padding: `${H * 0.014}px 0`, borderRadius: H * 0.016, background: hero, color: surface, fontWeight: 800, fontSize: fs * 0.9 }}>{button}</div>
          </div>
        </div>
      </div>
      {frame >= bannerAt ? (
        <div style={{ position: "absolute", left: H * 0.02, right: H * 0.02, top: H * 0.02, background: surface, borderRadius: H * 0.025, padding: H * 0.018, boxShadow: "0 10px 26px rgba(11,27,63,0.22)", opacity: interpolate(frame, [bannerAt, bannerAt + 2, openAt - 2, openAt + 4], [0, 1, 1, 0], clamp), transform: `translateY(${(1 - b) * -H * 0.08}px)` }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 700, fontSize: fs * 0.75, color: dim, whiteSpace: "nowrap" }}>{from}</div>
            <div style={{ fontWeight: 400, fontSize: fs * 0.7, color: dim, whiteSpace: "nowrap" }}>{time}</div>
          </div>
          <div style={{ fontWeight: 800, fontSize: fs * 0.9, color: ink, whiteSpace: "nowrap" }}>{subject}</div>
        </div>
      ) : null}
    </div>
  );
};
