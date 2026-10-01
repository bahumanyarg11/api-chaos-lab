# Draws a dark "mock app" placeholder frame (1600x1000) with a label. Used only when a
# real screen recording is missing from public/rec/.
import sys
from PIL import Image, ImageDraw, ImageFont

out, idx, title, subtitle = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
W, H = 1600, 1000
img = Image.new("RGB", (W, H), (7, 7, 11))
d = ImageDraw.Draw(img)

def font(paths, size):
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()

SANS = ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
MONO = ["/System/Library/Fonts/Menlo.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]

# sidebar + top bar
d.rectangle([0, 0, 260, H], fill=(15, 15, 23))
d.line([260, 0, 260, H], fill=(37, 37, 58), width=2)
d.rectangle([260, 0, W, 72], fill=(12, 12, 19))
d.line([260, 72, W, 72], fill=(37, 37, 58), width=2)
d.rounded_rectangle([28, 24, 60, 56], radius=8, fill=(255, 61, 90))
d.text((74, 26), "ChaosLab", font=font(SANS, 24), fill=(244, 244, 248))
for i, label in enumerate(["Projects", "Chaos matrix", "Live traffic", "Playground", "Reports", "Integrate"]):
    y = 120 + i * 52
    d.rounded_rectangle([20, y - 10, 240, y + 30], radius=8, fill=(22, 22, 34) if i == 0 else None)
    d.text((40, y), label, font=font(SANS, 20), fill=(161, 161, 181))

# grid of mock cells
cols, rows = 8, 5
gx, gy, cw, ch = 340, 330, 140, 82
for r in range(rows):
    for c in range(cols):
        x0, y0 = gx + c * (cw + 14), gy + r * (ch + 14)
        hot = (r * 3 + c * 5) % 7 == 0
        d.rounded_rectangle([x0, y0, x0 + cw, y0 + ch], radius=10,
                            fill=(40, 18, 26) if hot else (22, 22, 34),
                            outline=(255, 61, 90) if hot else (37, 37, 58), width=2)

d.text((340, 120), f"{idx}  ·  {title}", font=font(SANS, 56), fill=(244, 244, 248))
d.text((340, 200), subtitle, font=font(MONO, 26), fill=(161, 161, 181))
d.text((340, 250), "PLACEHOLDER — drop the real recording at public/rec/" + out.split("/")[-1].replace(".png", ".mp4"),
       font=font(MONO, 20), fill=(255, 138, 0))
img.save(out)
