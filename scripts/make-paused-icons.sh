#!/bin/sh
# Builds icons/icon-paused-{16,32,48,128}.png from the red toolbar pig:
# remap red to warm grey (#9C9A96, white stays white), paint over the eye
# dots, draw closed-eye arcs. Needs ImageMagick (`magick`). Run from repo root.
set -e
T=$(mktemp -d)
GREY='#9C9A96'
magick icons/icon-128.png -filter Lanczos -resize 512x512 \
  -color-matrix '0 0.471 0 0 0 0.529
                 0 0.471 0 0 0 0.529
                 0 0.471 0 0 0 0.529
                 0 0     0 1 0 0
                 0 0     0 0 1 0
                 0 0     0 0 0 1' \
  -fill "$GREY" -stroke none -draw "circle 162,236 162,272" -draw "circle 340,236 340,272" \
  -fill none -stroke white -strokewidth 11 -draw "stroke-linecap round path 'M144,230 Q164,254 184,230'" \
  -draw "stroke-linecap round path 'M320,230 Q340,254 360,230'" \
  "$T/p512.png"
for n in 16 32 48 128; do
  magick "$T/p512.png" -filter Lanczos -resize ${n}x${n} icons/icon-paused-$n.png
done
rm -rf "$T"
