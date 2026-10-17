#!/usr/bin/env bash
# deliver.sh <reel> <NN-slug>: final master -> docs/marketing/videos/drafts/<NN-slug>/ (master, -small, cover)
W="$USERPROFILE/Desktop/RushPoint-reels-work"; R="$1"; S="$2"
D="C:/Users/savir/Projects/Rushpoint/docs/marketing/videos/drafts/$S"
SRC="$W/$R/build/${R}_A.mp4"
cp "$SRC" "$D/$S-v1.mp4"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SRC")
VB=$(python -c "print(min(2600, int(14*8192/float('$DUR') - 170)))")   # under 15 MB whatever the length
ffmpeg -v error -y -i "$SRC" -c:v libx264 -preset slow -b:v ${VB}k -maxrate $((VB*12/10))k -bufsize $((VB*2))k -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart "$D/$S-v1-small.mp4" < /dev/null
[ -f "$W/$R/build/${R}_A_cover.png" ] && cp "$W/$R/build/${R}_A_cover.png" "$D/$S-v1-cover.png"
echo "DELIVERED $S $(du -m "$D/$S-v1-small.mp4" | cut -f1)MB small"
