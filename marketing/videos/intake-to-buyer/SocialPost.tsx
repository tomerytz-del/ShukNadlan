import React from "react";
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";
import { Icon } from "reelkit/kit";

export type SocialPostProps = {
  platform?: "facebook" | "instagram";
  page?: string;
  avatar?: string;
  meta?: string;
  lines?: string[];
  details?: string[];
  image?: string;
  imageH?: number;
  delay?: number;
  w?: number;
  ink?: string;
  dim?: string;
  link?: string;
  surface?: string;
  font?: string;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// A social media post card, right to left: the platform's mark, page name and avatar, a few lines of copy, detail lines
// and a photo, rising into place. Use it to show a listing or announcement published to a page.
export const SocialPost: React.FC<SocialPostProps> = ({
  platform = "facebook",
  page = "Page",
  avatar,
  meta = "",
  lines = [],
  details = [],
  image,
  imageH = 0.24,
  delay = 0,
  w = 0.3,
  ink = "#1C1E21",
  dim = "#65676B",
  link = "#1B5FD6",
  surface = "#FFFFFF",
  font,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const W = width * w;
  const fs = W * 0.045;
  const s = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 160 } });
  return (
    <div style={{ width: W, background: surface, borderRadius: W * 0.04, overflow: "hidden", direction: "rtl", fontFamily: font, boxShadow: "0 18px 44px rgba(11,27,63,0.2)", opacity: interpolate(frame - delay, [0, 3], [0, 1], clamp), transform: `translateY(${(1 - s) * height * 0.05}px)` }}>
      <div style={{ display: "flex", alignItems: "center", gap: W * 0.03, padding: W * 0.04 }}>
        {avatar ? <Img src={avatar} style={{ width: W * 0.12, height: W * 0.12, borderRadius: "50%", objectFit: "cover" }} /> : null}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: fs, color: ink, whiteSpace: "nowrap" }}>{page}</div>
          <div style={{ fontWeight: 400, fontSize: fs * 0.75, color: dim, whiteSpace: "nowrap" }}>{meta}</div>
        </div>
        <Icon name={platform} size={W * 0.09} color="brand" />
      </div>
      <div style={{ padding: `0 ${W * 0.04}px ${W * 0.03}px` }}>
        {lines.map((l, i) => <div key={i} style={{ fontWeight: 500, fontSize: fs * 0.88, color: ink, whiteSpace: "nowrap", lineHeight: 1.45 }}>{l}</div>)}
        {details.map((l, i) => <div key={i} style={{ fontWeight: 600, fontSize: fs * 0.82, color: i === details.length - 1 ? link : ink, whiteSpace: "nowrap", lineHeight: 1.45, marginTop: i === 0 ? fs * 0.4 : 0 }}>{l}</div>)}
      </div>
      {image ? <Img src={image} style={{ display: "block", width: "100%", height: height * imageH, objectFit: "cover" }} /> : null}
    </div>
  );
};
