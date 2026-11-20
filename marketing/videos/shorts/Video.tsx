import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "reelkit/frame";
import { Captions, FootageLayer, font } from "reelkit/kit";
import type { VideoProps } from "reelkit/kit";
import { Hook as hook, Words as words } from "./Words";

// A short cut from a long recording. The clip is already 1080x1920 (face-tracked) and carries the speaker's
// own sound, so this composition adds only two things: the hook in the first seconds and the Hebrew captions.
// Same series look as the other marketing videos: sapphire #0e2a6b with the gold #c9a227 accent, heebo, RTL.
const heebo = font("heebo");
const HOOK_SECONDS = 3;

const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const out = HOOK_SECONDS * fps;
  if (frame > out + 6) return null;
  const lines = [hook.hook1, hook.hook2].filter(Boolean);
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: "13%", direction: "rtl" }}>
      {lines.map((t, i) => {
        // each line rises whole (no masked reveal: Hebrew reads as dashes while a mask uncovers it)
        const p = spring({ frame: frame - i * 5, fps, config: { damping: 18, stiffness: 140 } });
        const fade = interpolate(frame, [out - 6, out + 6], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <div key={i} style={{
            opacity: Math.min(1, p * 2) * fade, transform: `translateY(${(1 - p) * 24}px)`,
            marginBottom: 14, padding: "10px 28px", borderRadius: 18, whiteSpace: "nowrap", direction: "rtl",
            background: i === 0 ? "#0e2a6b" : "rgba(15,31,74,0.78)", color: i === 0 ? "#ffffff" : "#c9a227",
            fontFamily: heebo, fontWeight: i === 0 ? 900 : 700, fontSize: width * (i === 0 ? 0.075 : 0.058),
          }}>{t}</div>
        );
      })}
    </AbsoluteFill>
  );
};

export const Video: React.FC<VideoProps> = ({ manifest, urls }) => {
  return (
    <AbsoluteFill>
      {/* the clip, with its own sound (muted={false}); no generated voice or music is added */}
      {manifest.footageKey ? <FootageLayer src={urls[manifest.footageKey]} muted={false} /> : null}
      {/* drawn once on the clip's own clock; the plan's scenes are only slices of it */}
      <Hook />
      {/* words are the speaker's own, timed from the recording: not s.words, which is empty in footage mode */}
      <Captions words={words as any} group="phrase" mode="highlight" highlight="#c9a227" face={heebo} rtl bottom={0.2} />
    </AbsoluteFill>
  );
};
