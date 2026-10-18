// Small flat glyphs drawn as SVG for interface cards: a compass (advice / direction), a sun (morning), a check,
// a house, a pen signing, a calendar and a to-do list. Each takes a pixel size and a colour.
import React from "react";

type G = { size: number; color: string };

export const CompassGlyph: React.FC<G & { needle?: string; turn?: number }> = ({ size, color, needle = "#c9a227", turn = 0 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48">
    <circle cx="24" cy="24" r="19" fill="none" stroke={color} strokeWidth="3.6" />
    <g transform={`rotate(${turn} 24 24)`}>
      <path d="M24 9l5 15h-10z" fill={needle} />
      <path d="M24 39l-5-15h10z" fill={color} opacity="0.55" />
    </g>
    <circle cx="24" cy="24" r="2.6" fill={color} />
  </svg>
);

export const SunGlyph: React.FC<G & { rays?: number }> = ({ size, color, rays = 1 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48">
    <circle cx="24" cy="24" r="9" fill={color} />
    {Array.from({ length: 8 }).map((_, i) => {
      const a = (i * Math.PI) / 4;
      const r1 = 14, r2 = 14 + 6 * rays;
      return <line key={i} x1={24 + r1 * Math.cos(a)} y1={24 + r1 * Math.sin(a)} x2={24 + r2 * Math.cos(a)} y2={24 + r2 * Math.sin(a)} stroke={color} strokeWidth="3.4" strokeLinecap="round" />;
    })}
  </svg>
);

export const CheckGlyph: React.FC<G> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke={color} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const HouseGlyph: React.FC<G> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 48 48">
    <path d="M7 22L24 8l17 14v18a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3z" fill={color} />
    <rect x="19" y="29" width="10" height="14" rx="2" fill="#fff" opacity="0.85" />
  </svg>
);

export const PenGlyph: React.FC<G> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 48 48">
    <path d="M30 8l10 10-20 20H10V28z" fill={color} />
    <path d="M8 44c6-4 10 2 16-2s10 0 16-2" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export const ListGlyph: React.FC<G> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 48 48">
    <rect x="8" y="6" width="32" height="36" rx="5" fill="none" stroke={color} strokeWidth="3.4" />
    {[16, 24, 32].map((y) => <line key={y} x1="15" y1={y} x2="33" y2={y} stroke={color} strokeWidth="3.4" strokeLinecap="round" />)}
  </svg>
);

export const Glyphs = { CompassGlyph, SunGlyph, CheckGlyph, HouseGlyph, PenGlyph, ListGlyph };
