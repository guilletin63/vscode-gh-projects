"""Turns frames captured by scripts/record-demo.mjs into an optimised GIF.

Draws the mouse pointer, click ripples and the ghost of a dragged card onto each frame, then
encodes with ffmpeg (palettegen/paletteuse) at a fixed width and frame rate.

    python3 scripts/make-gif.py <frames-dir> <out.gif>
"""

import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

WIDTH = 960
FPS = 12
TAIL_MS = 600

ARROW = [(0, 0), (0, 17), (4, 13), (7, 20), (10, 19), (7, 12), (12, 12)]


def draw_pointer(img, x, y):
    d = ImageDraw.Draw(img)
    pts = [(x + px, y + py) for px, py in ARROW]
    d.polygon(pts, fill=(255, 255, 255), outline=(0, 0, 0))
    d.line(pts + [pts[0]], fill=(0, 0, 0), width=1)


def draw_ripple(img, x, y, age):
    if age < 0 or age > 450:
        return
    k = age / 450
    r = 8 + 18 * k
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    alpha = int(170 * (1 - k))
    d.ellipse([x - r, y - r, x + r, y + r], outline=(88, 166, 255, alpha), width=3)
    img.alpha_composite(overlay)


def main(frames_dir, out):
    meta = json.load(open(os.path.join(frames_dir, "meta.json")))
    frames = meta["frames"]
    events = meta["events"]
    if not frames:
        raise SystemExit("no frames captured")

    for ev in events:
        if ev["type"] == "ghost":
            # Crop the card from the last frame captured before the drag started.
            before = [i for i, f in enumerate(frames) if f["t"] <= ev["start"]] or [0]
            src = Image.open(os.path.join(frames_dir, f"{before[-1]:05d}.jpg")).convert("RGBA")
            r = ev["rect"]
            crop = src.crop((int(r["x"]), int(r["y"]), int(r["x"] + r["w"]), int(r["y"] + r["h"])))
            crop.putalpha(205)
            ev["_crop"] = crop

    work = tempfile.mkdtemp(prefix="ghp-gif-")
    concat = []
    for i, f in enumerate(frames):
        img = Image.open(os.path.join(frames_dir, f"{i:05d}.jpg")).convert("RGBA")
        t = f["t"]
        p = f["pointer"]
        for ev in events:
            if ev["type"] == "ghost" and ev["start"] <= t <= ev.get("end", t):
                g = ev["_crop"]
                img.alpha_composite(g, (int(p["x"] - ev["grab"]["x"]), int(p["y"] - ev["grab"]["y"])))
        for ev in events:
            if ev["type"] == "click":
                draw_ripple(img, ev["x"], ev["y"], t - ev["t"])
        if p["visible"]:
            draw_pointer(img, int(p["x"]), int(p["y"]))
        name = os.path.join(work, f"{i:05d}.png")
        img.convert("RGB").save(name)
        nxt = frames[i + 1]["t"] if i + 1 < len(frames) else t + TAIL_MS
        concat.append(f"file '{name}'\nduration {max(nxt - t, 1) / 1000:.3f}\n")
    concat.append(f"file '{os.path.join(work, f'{len(frames) - 1:05d}.png')}'\n")
    list_file = os.path.join(work, "frames.txt")
    open(list_file, "w").write("".join(concat))

    filters = f"fps={FPS},scale={WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle"
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list_file, "-filter_complex", filters, "-loop", "0", out],
        check=True,
    )
    print(f"{out}: {os.path.getsize(out) / 1024:.0f} KB, {len(frames)} frames")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
