"""Render the approved room-story VJ pack without paid generation.

Run from the repository: python scripts/render-wasurete-room.py
Originals live in research/wasurete-room; all timing is in real seconds at 24fps.
"""

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "research/wasurete-room"
DEST = ROOT / "docs/assets/library"
FFMPEG = ROOT / "node_modules/ffmpeg-static/ffmpeg.exe"
FPS = 24
PREFIX = "original-wasurete-"
STORY_TAG = "wasurete-room-story"
JOB = "3f2798b92bb34776acf5e4d87ff721d4"
VIDEO_SOURCE = (
    "https://resource2.heygen.ai/videos/4f11394dbb9e4330825165e58204ebcc/"
    "4f11394dbb9e4330825165e58204ebcc/01a18b1f-fdfc-746e-a9f0-6aca5fa0d495.mp4"
)
SHOTS = [
    {"key": "exterior", "name": "家の外観", "section": "main", "frames": 288,
     "source": "exterior-source.png", "in": None, "out": None},
    {"key": "lived-in-room", "name": "生活のある部屋", "section": "a", "frames": 96,
     "source": "trial-original.mp4", "in": 0, "out": 4},
    {"key": "emptying-room", "name": "物が消えていく部屋", "section": "b", "frames": 360,
     "source": "trial-original.mp4", "in": 0, "out": 15},
    {"key": "empty-room", "name": "何もなくなった部屋", "section": "c", "frames": 72,
     "source": "trial-original.mp4", "in": 12, "out": 15},
]


def run(*args):
    return subprocess.run(
        [str(FFMPEG), "-nostdin", "-hide_banner", *map(str, args)],
        check=True, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    catalog_path = ROOT / "docs/assets/catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    entries, rendered = [], []
    for shot in SHOTS:
        asset_id = PREFIX + shot["key"]
        output = DEST / (asset_id + ".mp4")
        thumb = DEST / (asset_id + ".jpg")
        still = shot["in"] is None
        if not output.exists():
            if still:
                # The only motion is a gentle camera zoom. A full cosine cycle
                # returns to its starting crop without a hard reset on repeat.
                vf = (
                    "scale=2560:1440:force_original_aspect_ratio=increase,"
                    "crop=2560:1440,"
                    "zoompan=z='1.015+0.012*(1-cos(2*PI*on/288))':"
                    "x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':"
                    "d=288:s=1280x720:fps=24,setsar=1"
                )
            else:
                vf = (
                    f"setpts=PTS-STARTPTS,trim=start={shot['in']}:end={shot['out']},setpts=PTS-STARTPTS,"
                    "scale=1280:720:force_original_aspect_ratio=increase,"
                    "crop=1280:720,setsar=1,fps=24"
                )
            result = run(
                "-n", "-i", SOURCE / shot["source"], "-map", "0:v:0", "-an",
                "-vf", vf, "-frames:v", shot["frames"],
                "-c:v", "libx264", "-preset", "slow", "-crf", "18",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", output,
            )
            (SOURCE / (shot["key"] + "-encode.log")).write_text(result.stderr, encoding="utf-8")
        if not thumb.exists():
            preview_at = 8 if shot["key"] == "emptying-room" else 0
            run("-n", "-ss", preview_at, "-i", output, "-frames:v", 1, "-vf", "scale=480:270", "-q:v", 2, thumb)
        # Decode the complete delivery, count frames and inspect actual streams.
        checked = run(
            "-v", "info", "-i", output, "-map", "0:v:0", "-an",
            "-progress", "pipe:1", "-nostats", "-f", "null", "-",
        )
        frame_count = int(re.findall(r"^frame=(\d+)$", checked.stdout, re.M)[-1])
        if frame_count != shot["frames"] or "Audio:" in checked.stderr:
            raise RuntimeError(f"Unexpected streams/frame count: {asset_id}")
        if not re.search(r"Video: h264.*1280x720.*24 fps", checked.stderr):
            raise RuntimeError(f"Unexpected format: {asset_id}")
        duration = frame_count / FPS
        note = (
            "AI生成静止画を使用したカメラ移動。葉や建物そのものは動きません。"
            if still else
            f"HeyGen生成動画から実時間{shot['in']}–{shot['out']}秒を抽出。"
        )
        once = shot["key"] == "emptying-room"
        entry = {
            "id": asset_id, "name": f"忘れてください · 家と記憶 — {shot['name']}",
            "kind": "video", "url": f"./assets/library/{asset_id}.mp4",
            "thumbnail": f"./assets/library/{asset_id}.jpg",
            "tags": ["setlist-scene", "web-library", "original", "ai-generated",
                     "song:wasurete-kudasai", f"section:{shot['section']}", STORY_TAG,
                     "忘れてください", "家と記憶", "ミニチュア", "部屋", shot["name"]],
            "hue": 35, "energy": 0.12, "duration": duration,
            "license": "AI生成オリジナル · Lumina Liveで利用可",
            "source": "OpenAI ImageGen · exterior-source.png" if still else f"HeyGen Video 1 · {JOB} · {VIDEO_SOURCE}",
            "attribution": note + " オリジナルの模型風背景。1280×720・24fps・H.264・無音に書き出し。",
            "status": "720p H.264 · 24fps · 無音" + (" · 一度再生・最後で停止" if once else ""),
            "bytes": output.stat().st_size,
        }
        if once:
            entry["playback"] = "once"
        entries.append(entry)
        rendered.append({**shot, "id": asset_id, "duration": duration, "bytes": output.stat().st_size,
                         "review": "full decode passed; visual review recorded in research/wasurete-room-production.json"})
        print(f"{asset_id}: {duration:g}s, {frame_count} frames, {output.stat().st_size} bytes")
    ids = {e["id"] for e in entries}
    # Existing Canva IDs and their order stay untouched; this pack is additive.
    original_ids = [a["id"] for a in catalog if a["id"] not in ids]
    updated = [a for a in catalog if a["id"] not in ids] + entries
    assert [a["id"] for a in updated if a["id"] not in ids] == original_ids
    catalog_path.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    credits = ROOT / "docs/assets/credits.txt"
    marker = "\n\n=== 忘れてください · 家と記憶（AIオリジナル） ===\n"
    body = credits.read_text(encoding="utf-8").split(marker)[0]
    body += marker + "\n\n".join(
        f"{e['name']}\n{e['license']}\n{e['source']}\n{e['attribution']}" for e in entries
    ) + "\n"
    credits.write_text(body, encoding="utf-8")
    (SOURCE / "exports.json").write_text(json.dumps(rendered, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
