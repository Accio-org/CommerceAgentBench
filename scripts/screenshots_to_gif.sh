#!/usr/bin/env bash
# Convert sidecar-captured screenshots (runs/<id>/screenshots/) into per-target
# GIFs. Default skips an "all" GIF because mixing tabs blows up the palette and
# the file gets huge; pass ALL=1 to opt in.
#
# Usage: scripts/screenshots_to_gif.sh <run_dir|screenshots_dir>
# Env overrides: FPS=2 WIDTH=900 MAX_COLORS=128 ALL=0
set -euo pipefail

usage() {
  cat >&2 <<EOF
Usage: $0 <run_dir|screenshots_dir>
  Reads <dir>/screenshots/*.jpg (or <dir>/*.jpg if already inside screenshots/),
  emits one GIF per Chrome targetId: by-target_<targetId8>.gif

Env overrides:
  FPS=2           playback rate (frames/sec)
  WIDTH=900       output width in pixels; height keeps aspect
  MAX_COLORS=128  palette size (lower = smaller file, more banding)
  ALL=0           set to 1 to also emit all.gif (whole timeline interleaved)
EOF
  exit 1
}

[[ $# -ge 1 ]] || usage
input="$1"

if [[ -d "$input/screenshots" ]]; then
  shots="$input/screenshots"
elif [[ -d "$input" ]]; then
  shots="$input"
else
  echo "not a directory: $input" >&2
  exit 1
fi

command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg not found in PATH" >&2; exit 1; }

FPS="${FPS:-2}"
WIDTH="${WIDTH:-900}"
MAX_COLORS="${MAX_COLORS:-128}"
ALL="${ALL:-0}"

target_ids=$(find "$shots" -maxdepth 1 -type f -name '*.jpg' -print0 \
  | xargs -0 -n1 basename \
  | awk -F'_' 'NF >= 4 { print $3 }' \
  | sort -u)

if [[ -z "$target_ids" ]]; then
  echo "no .jpg screenshots found in $shots" >&2
  exit 1
fi

palette="scale=${WIDTH}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${MAX_COLORS}[p];[s1][p]paletteuse=dither=bayer"

build() {
  local pattern="$1" out="$2"
  ffmpeg -y -loglevel error -framerate "$FPS" -pattern_type glob \
    -i "$pattern" -vf "$palette" -loop 0 "$out"
  local size
  size=$(du -h "$out" | awk '{print $1}')
  echo "[gif] $out ($size)"
}

for tid in $target_ids; do
  build "$shots/*_${tid}_*.jpg" "$shots/by-target_${tid}.gif"
done

if [[ "$ALL" == "1" ]]; then
  build "$shots/[0-9]*.jpg" "$shots/all.gif"
fi

echo "done. outputs in $shots"
