import React from "react";
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";

export type ShowcaseScreenProps = {
  brand?: string;
  agentName?: string;
  agentSub?: string;
  agentPhoto?: string;
  headline?: string;
  photo?: string;
  price?: string;
  title?: string;
  place?: string;
  likeLabel?: string;
  skipLabel?: string;
  likeAt?: number;
  toast?: string;
  phoneH?: number;
  hero?: string;
  accent?: string;
  ink?: string;
  dim?: string;
  surface?: string;
  ground?: string;
  font?: string;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// A personal property page for one client on a phone, right to left: a branded header, the agent's card, a property
// card with like and skip buttons; at likeAt the like button is pressed and a toast slides up. Put it in a PhoneFrame.
export const ShowcaseScreen: React.FC<ShowcaseScreenProps> = ({
  brand = "Brand",
  agentName = "Agent",
  agentSub = "",
  agentPhoto,
  headline = "",
  photo,
  price = "",
  title = "",
  place = "",
  likeLabel = "Like",
  skipLabel = "Skip",
  likeAt = 9999,
  toast = "",
  phoneH = 0.8,
  hero = "#1E3A66",
  accent = "#C2185B",
  ink = "#0B1B3F",
  dim = "#5B6475",
  surface = "#FFFFFF",
  ground = "#F1F4F9",
  font,
}) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const H = height * phoneH;
  const fs = H * 0.03;
  const press = spring({ frame: frame - likeAt, fps, config: { damping: 10, stiffness: 260 } });
  const pressed = frame >= likeAt;
  const t = interpolate(frame, [likeAt + 4, likeAt + 12], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", inset: 0, background: ground, direction: "rtl", fontFamily: font, padding: H * 0.02, display: "flex", flexDirection: "column", gap: H * 0.016 }}>
      <div style={{ background: hero, borderRadius: H * 0.02, padding: `${H * 0.02}px ${H * 0.025}px`, color: surface, fontWeight: 800, fontSize: fs * 1.05, whiteSpace: "nowrap" }}>{brand}</div>
      <div style={{ background: surface, borderRadius: H * 0.02, padding: H * 0.02, display: "flex", alignItems: "center", gap: H * 0.018 }}>
        {agentPhoto ? <Img src={agentPhoto} style={{ width: H * 0.085, height: H * 0.085, borderRadius: "50%", objectFit: "cover", border: `3px solid ${hero}` }} /> : null}
        <div>
          <div style={{ fontWeight: 800, fontSize: fs, color: ink, whiteSpace: "nowrap" }}>{agentName}</div>
          <div style={{ fontWeight: 400, fontSize: fs * 0.75, color: dim, whiteSpace: "nowrap" }}>{agentSub}</div>
        </div>
      </div>
      {headline ? <div style={{ fontWeight: 800, fontSize: fs * 1.05, color: ink, whiteSpace: "nowrap" }}>{headline}</div> : null}
      <div style={{ background: surface, borderRadius: H * 0.02, overflow: "hidden" }}>
        {photo ? <Img src={photo} style={{ display: "block", width: "100%", height: H * 0.24, objectFit: "cover" }} /> : null}
        <div style={{ padding: H * 0.018 }}>
          <div style={{ fontWeight: 800, fontSize: fs * 1.2, color: ink, whiteSpace: "nowrap", direction: "ltr", textAlign: "right" }}>{price}</div>
          <div style={{ fontWeight: 700, fontSize: fs * 0.9, color: ink, whiteSpace: "nowrap" }}>{title}</div>
          <div style={{ fontWeight: 400, fontSize: fs * 0.8, color: dim, whiteSpace: "nowrap", marginBottom: H * 0.014 }}>{place}</div>
          <div style={{ display: "flex", gap: H * 0.012 }}>
            <div style={{ flex: 1, textAlign: "center", padding: `${H * 0.014}px 0`, borderRadius: H * 0.016, background: accent, color: surface, fontWeight: 800, fontSize: fs * 0.95, transform: `scale(${pressed ? 1 - 0.08 * Math.sin(Math.PI * Math.min(1, press)) : 1})`, boxShadow: pressed ? `0 0 0 ${H * 0.006}px rgba(194,24,91,0.25)` : undefined }}>{likeLabel}</div>
            <div style={{ flex: 1, textAlign: "center", padding: `${H * 0.014}px 0`, borderRadius: H * 0.016, border: `2px solid ${ink}`, color: ink, fontWeight: 800, fontSize: fs * 0.95 }}>{skipLabel}</div>
          </div>
        </div>
      </div>
      {toast && t > 0 ? (
        <div style={{ position: "absolute", left: H * 0.03, right: H * 0.03, bottom: H * 0.03, background: ink, color: surface, borderRadius: H * 0.02, padding: `${H * 0.02}px ${H * 0.025}px`, fontWeight: 700, fontSize: fs, whiteSpace: "nowrap", opacity: t, transform: `translateY(${(1 - t) * H * 0.04}px)` }}>{toast}</div>
      ) : null}
    </div>
  );
};
