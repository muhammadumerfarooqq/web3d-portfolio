"""Combine turnaround renders into one review sheet."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

d = Path(sys.argv[1])
names = [n for n in ("turn_front", "turn_34", "turn_side") if (d / f"{n}.png").exists()]
ims = [Image.open(d / f"{n}.png").convert("RGB") for n in names]
face = d / "face_34.png"
h = max(i.height for i in ims)
w = sum(i.width for i in ims)
if face.exists():
    f = Image.open(face).convert("RGB")
    f = f.resize((h * f.width // f.height, h))
    ims.append(f)
    w += f.width
sheet = Image.new("RGB", (w, h), (8, 6, 15))
x = 0
for im in ims:
    sheet.paste(im, (x, 0))
    x += im.width
sheet.save(d / sys.argv[2] if len(sys.argv) > 2 else d / "sheet.jpg", quality=90)
print("sheet", sheet.size)
