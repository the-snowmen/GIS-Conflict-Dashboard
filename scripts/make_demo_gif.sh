#!/usr/bin/env bash
# Assemble a high-quality looping GIF from a directory of JPEG frames using ffmpeg's
# two-pass palette workflow (palettegen -> paletteuse). Pairs with record_demo.mjs.
#
#   FRAMES=/tmp/demo-frames FPS=10 WIDTH=1440 bash scripts/make_demo_gif.sh
#
# Env knobs:
#   FRAMES    frame directory (default /tmp/demo-frames)   OUT      output gif (default docs/demo.gif)
#   FPS       output frame rate (default 10)               WIDTH    scaled width in px (default 1440)
#   COLORS    palette size (default 128)                   DITHER   paletteuse dither (default none)
#   DURATION  target seconds; frames are resampled to fit (default: play every frame at FPS)
#
# Defaults match record_demo.mjs's fixed-interval capture (10 fps). "none" dithering keeps
# the flat AOI fill clean and the file small; raise COLORS / switch DITHER to bayer for
# high-motion source frames.
set -euo pipefail

FRAMES="${FRAMES:-/tmp/demo-frames}"
OUT="${OUT:-docs/demo.gif}"
FPS="${FPS:-10}"
WIDTH="${WIDTH:-1440}"
COLORS="${COLORS:-128}"
DITHER="${DITHER:-none}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

count=$(find "$FRAMES" -name 'frame-*.jpg' | wc -l | tr -d ' ')
[ "$count" -gt 0 ] || { echo "No frames in $FRAMES" >&2; exit 1; }

# Spread all captured frames across DURATION seconds, then resample to FPS so the gif
# is a fixed, snappy length regardless of how many frames were captured.
if [ -n "${DURATION:-}" ]; then
  IN_FPS=$(awk "BEGIN{printf \"%.4f\", $count/$DURATION}")
else
  IN_FPS="$FPS"
fi
echo "Frames: $count  ->  $OUT  (in=${IN_FPS}fps out=${FPS}fps width=$WIDTH dur=${DURATION:-native})"

FILT="fps=${FPS},scale=${WIDTH}:-1:flags=lanczos"

# Pass 1 — build an optimized palette from the whole clip.
ffmpeg -y -v error -framerate "$IN_FPS" -pattern_type glob -i "$FRAMES/frame-*.jpg" \
  -vf "${FILT},palettegen=max_colors=${COLORS}:stats_mode=diff" "$TMP/palette.png"

# Pass 2 — render frames against the palette (diff_mode keeps static regions cheap).
ffmpeg -y -v error -framerate "$IN_FPS" -pattern_type glob -i "$FRAMES/frame-*.jpg" -i "$TMP/palette.png" \
  -lavfi "${FILT}[x];[x][1:v]paletteuse=dither=${DITHER}:diff_mode=rectangle" \
  -loop 0 "$OUT"

size=$(ls -lh "$OUT" | awk '{print $5}')
frames=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$OUT")
echo "Wrote $OUT  ($size, $frames frames @ ${FPS}fps)"
