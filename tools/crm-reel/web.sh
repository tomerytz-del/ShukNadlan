#!/bin/sh
# Web version from the 1440 master, written straight to the files pricing.html
# loads: 720px, 30fps, MP4 + WebM, and a poster (frame 0 = the loop's first frame).
# FFMPEG must point at a full ffmpeg build (libx264 + libvpx-vp9). docs/crm-reel.md
set -e
cd "$(dirname "$0")"
FF="${FFMPEG:-ffmpeg}"
OUT=../../assets
VF="scale=720:720:flags=lanczos,fps=30"
"$FF" -y -loglevel error -i reel-1440.mp4 -vf "$VF" -c:v libx264 -preset veryslow -crf 26 -pix_fmt yuv420p -movflags +faststart -an $OUT/crm-reel.mp4
"$FF" -y -loglevel error -i reel-1440.mp4 -vf "$VF" -c:v libvpx-vp9 -crf 38 -b:v 0 -row-mt 1 -deadline good -cpu-used 1 -pix_fmt yuv420p -an $OUT/crm-reel.webm
"$FF" -y -loglevel error -i reel-1440.mp4 -vf "scale=720:720:flags=lanczos" -frames:v 1 -q:v 3 $OUT/crm-reel-poster.jpg
ls -la reel-1440.mp4 $OUT/crm-reel.mp4 $OUT/crm-reel.webm $OUT/crm-reel-poster.jpg
