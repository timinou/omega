#!/usr/bin/env bash
# Phone-friendly copies; preserve the full-quality proof masters.
set -euo pipefail
cd "$(dirname "$0")/.."
proof=${1:-proof/club}
mkdir -p "$proof/mobile"
ffmpeg -hide_banner -loglevel error -y -i "$proof"/pelagic.mp4 \
  -map 0:v:0 -map 0:a:0 -vf scale=640:360 \
  -c:v libx264 -preset medium -crf 28 -maxrate 420k -bufsize 840k \
  -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart \
  "$proof"/mobile/pelagic-mobile.mp4
ffmpeg -hide_banner -loglevel error -y -i "$proof"/pelagic.wav \
  -c:a libmp3lame -b:a 128k -id3v2_version 3 \
  -metadata title='PELAGIC — a live audiovisual descent' \
  -metadata artist='Omega / Beam Lisp' "$proof"/mobile/pelagic.mp3
ffmpeg -hide_banner -loglevel error -y -i "$proof"/02-playing.png \
  -vf scale=1080:-1 -q:v 3 -frames:v 1 "$proof"/mobile/studio.jpg
ffmpeg -hide_banner -loglevel error -y -i "$proof"/03-live-controls.png \
  -vf scale=1080:-1 -q:v 3 -frames:v 1 "$proof"/mobile/studio-controls.jpg
for media in "$proof"/mobile/pelagic-mobile.mp4 "$proof"/mobile/pelagic.mp3; do
  ffmpeg -hide_banner -v error -xerror -i "$media" -f null -
done
