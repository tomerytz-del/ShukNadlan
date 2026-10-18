// A rounded right-to-left label with an optional glyph before the text, for tags and short callouts.
import React from "react";

export const Chip: React.FC<{ text: string; size: number; face: string; bg?: string; color?: string; icon?: React.ReactNode }> = ({ text, size, face, bg = "#c9a227", color = "#0d1b3d", icon }) => (
  <div style={{ display: "inline-flex", alignItems: "center", gap: size * 0.4, background: bg, color, padding: `${size * 0.35}px ${size * 0.8}px`, borderRadius: size * 2, fontFamily: face, fontWeight: 800, fontSize: size, direction: "rtl", whiteSpace: "nowrap", boxShadow: "0 10px 30px rgba(14,42,107,0.18)" }}>
    {icon}
    <span>{text}</span>
  </div>
);
