"""Original illustrated project covers in the Sheriff of Byte Island case-file style.
Parchment, ink outlines, hard offset shadows, sheriff gold + rust. Output: 1600x1000 PNG."""
import cairosvg, random, math
from PIL import Image, ImageFilter, ImageChops
W, H = 1600, 1000
INK, PARCH, POSTER, RUST, GOLD, GOLD2, FOREST, CREAM, SKY = "#231C15", "#E9DCC0", "#F3E9D2", "#7E2F1A", "#D9A441", "#B8862A", "#2F5D46", "#FBF5E6", "#9DB8C4"
SW = 9
def sh(svg, dx=14, dy=14):   # hard offset shadow: ink copy of a group behind it
    return f'<g transform="translate({dx},{dy})" fill="{INK}" stroke="{INK}">{svg}</g>{svg}'
def frame(body, accent):
    rays = "".join(f'<path d="M800,560 L{800+1400*math.cos(a):.0f},{560+1400*math.sin(a):.0f} L{800+1400*math.cos(a+0.12):.0f},{560+1400*math.sin(a+0.12):.0f}Z" fill="{accent}" opacity="0.10"/>' for a in [i*0.26 for i in range(25)])
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<rect width="{W}" height="{H}" fill="{PARCH}"/>{rays}
<circle cx="800" cy="560" r="330" fill="{POSTER}" opacity="0.7"/>
<g stroke="{INK}" stroke-width="{SW}" stroke-linejoin="round" stroke-linecap="round">{body}</g>
<rect x="26" y="26" width="{W-52}" height="{H-52}" fill="none" stroke="{INK}" stroke-width="10"/>
<rect x="48" y="48" width="{W-96}" height="{H-96}" fill="none" stroke="{INK}" stroke-width="3" stroke-dasharray="18 12" opacity="0.55"/>
{"".join(f'<circle cx="{x}" cy="{y}" r="9" fill="{RUST}" stroke="{INK}" stroke-width="3"/>' for x,y in ((70,70),(W-70,70),(70,H-70),(W-70,H-70)))}
</svg>'''
def eyes(cx, cy, gap, r=34):
    s = ""
    for dx in (-gap, gap):
        s += f'<circle cx="{cx+dx}" cy="{cy}" r="{r}" fill="{INK}"/>'
        s += f'<circle cx="{cx+dx+r*0.32}" cy="{cy-r*0.35}" r="{r*0.32}" fill="{CREAM}" stroke="none"/>'
        s += f'<circle cx="{cx+dx-r*0.3}" cy="{cy+r*0.35}" r="{r*0.13}" fill="{CREAM}" stroke="none"/>'
    return s
def cheeks(cx, cy, gap):
    return "".join(f'<ellipse cx="{cx+dx}" cy="{cy}" rx="30" ry="18" fill="#E58E73" stroke="none" opacity="0.85"/>' for dx in (-gap, gap))
def smile(cx, cy, w=60):
    return f'<path d="M{cx-w},{cy} Q{cx},{cy+w*0.9} {cx+w},{cy}" fill="none"/>'
def sparkle(x, y, s=26, c=GOLD):
    return f'<path d="M{x},{y-s} Q{x+s*0.18},{y-s*0.18} {x+s},{y} Q{x+s*0.18},{y+s*0.18} {x},{y+s} Q{x-s*0.18},{y+s*0.18} {x-s},{y} Q{x-s*0.18},{y-s*0.18} {x},{y-s}Z" fill="{c}" stroke-width="5"/>'
def doc(x, y, w, h, rot=0, lines=4, fill=CREAM):
    l = "".join(f'<line x1="{x+30}" y1="{y+50+i*36}" x2="{x+w-30-(40 if i==lines-1 else 0)}" y2="{y+50+i*36}" stroke-width="7" opacity="0.8"/>' for i in range(lines))
    return f'<g transform="rotate({rot} {x+w/2} {y+h/2})"><path d="M{x},{y} h{w-50} l50,50 v{h-50} h-{w} z" fill="{fill}"/><path d="M{x+w-50},{y} v50 h50" fill="none"/>{l}</g>'
def bubble(x, y, w, h, tail="left", fill=CREAM):
    tx = x + 70 if tail == "left" else x + w - 70          # tail base centre
    tip = (tx - 30, y + h + 60) if tail == "left" else (tx + 30, y + h + 60)
    body = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="30" fill="{fill}"/>'
    cover = f'<path d="M{tx-28},{y+h-6} L{tip[0]},{tip[1]} L{tx+28},{y+h-6}z" fill="{fill}" stroke="none"/>'
    sides = f'<path d="M{tx-28},{y+h} L{tip[0]},{tip[1]} L{tx+28},{y+h}" fill="none"/>'
    return body + cover + sides

# ---------------------------------------------------------------- 1 KnoDesk RAG: robot librarian
def knodesk_rag():
    b = ""
    b += sh(doc(980, 330, 280, 360, 8) + doc(1030, 300, 280, 360, -4))                      # document stack
    b += sh(f'<rect x="560" y="300" width="380" height="330" rx="90" fill="{SKY}"/>')            # head
    b += f'<line x1="750" y1="300" x2="750" y2="220"/>' + sh(f'<circle cx="750" cy="205" r="30" fill="{GOLD}"/>', 8, 8)
    b += f'<rect x="610" y="370" width="280" height="190" rx="60" fill="{CREAM}"/>'
    b += eyes(750, 445, 70) + cheeks(750, 505, 110) + smile(750, 505, 42)
    b += sh(f'<rect x="600" y="640" width="300" height="200" rx="60" fill="{SKY}"/><circle cx="750" cy="730" r="34" fill="{GOLD}"/>')   # body
    b += sh(f'<circle cx="1110" cy="560" r="85" fill="{CREAM}" opacity="1"/><line x1="1050" y1="620" x2="960" y2="720" stroke-width="22"/>', 10, 10)  # magnifier
    b += f'<path d="M900,700 Q950,690 975,712" fill="none" stroke-width="20"/>'
    b += sh(bubble(170, 240, 360, 230, "right"))
    b += "".join(f'<line x1="220" y1="{300+i*44}" x2="{480 - (90 if i==2 else 0)}" y2="{300+i*44}" stroke-width="8"/>' for i in range(3))
    for i, (cx, c) in enumerate(((240, RUST), (300, FOREST))):
        b += f'<circle cx="{cx}" cy="430" r="22" fill="{c}" stroke-width="5"/><text x="{cx}" y="439" font-family="DejaVu Sans" font-weight="bold" font-size="26" text-anchor="middle" fill="{CREAM}" stroke="none">{i+1}</text>'
    b += sparkle(1330, 260) + sparkle(470, 760, 20) + sparkle(1280, 790, 18, RUST)
    return frame(b, GOLD)

# ---------------------------------------------------------------- 2 Voice agent: headset bot + sound waves
def voice_agent():
    b = ""
    for i, hgt in enumerate((90, 170, 250, 170, 110, 60)):
        x = 1080 + i * 58
        b += sh(f'<rect x="{x}" y="{560-hgt/2}" width="34" height="{hgt}" rx="17" fill="{GOLD}"/>', 8, 8)
    for i, hgt in enumerate((60, 140, 220, 140, 80)):
        x = 260 + i * 58
        b += sh(f'<rect x="{x}" y="{560-hgt/2}" width="34" height="{hgt}" rx="17" fill="{GOLD}"/>', 8, 8)
    b += sh(f'<circle cx="800" cy="520" r="230" fill="{FOREST}"/>')
    b += f'<circle cx="800" cy="520" r="170" fill="{CREAM}"/>'
    b += eyes(800, 490, 66, 32) + cheeks(800, 560, 105) + f'<ellipse cx="800" cy="585" rx="38" ry="30" fill="{RUST}"/>'   # talking mouth
    b += f'<path d="M560,470 Q560,240 800,240 Q1040,240 1040,470" fill="none" stroke-width="26"/>'                         # headband
    b += sh(f'<rect x="520" y="430" width="80" height="150" rx="34" fill="{RUST}"/><rect x="1000" y="430" width="80" height="150" rx="34" fill="{RUST}"/>', 8, 8)
    b += f'<path d="M1040,560 Q1050,690 920,700" fill="none" stroke-width="14"/>' + sh(f'<circle cx="900" cy="700" r="26" fill="{INK}"/>', 6, 6)   # mic boom
    b += sh(f'<path d="M640,790 q0,-40 40,-40 h240 q40,0 40,40 v40 h-320z" fill="{FOREST}"/>')                             # little body
    b += sh(bubble(1130, 190, 300, 150, "left"))
    b += f'<path d="M1180,265 l30,-35 l30,60 l30,-70 l30,85 l30,-60 l30,40" fill="none" stroke="{RUST}" stroke-width="9"/>'
    b += sparkle(350, 260) + sparkle(1290, 800, 22, RUST) + sparkle(420, 820, 18)
    return frame(b, FOREST)

# ---------------------------------------------------------------- 3 Sales pipeline: smiling funnel + proof-linked leads
def sales_pipeline():
    b = ""
    for i, (x, y, r) in enumerate(((560, 150, -12), (760, 110, 6), (960, 160, 14))):        # lead cards
        b += sh(f'<g transform="rotate({r} {x+90} {y+60})"><rect x="{x}" y="{y}" width="180" height="120" rx="16" fill="{CREAM}"/><circle cx="{x+45}" cy="{y+60}" r="26" fill="{SKY}"/><line x1="{x+85}" y1="{y+45}" x2="{x+150}" y2="{y+45}" stroke-width="7"/><line x1="{x+85}" y1="{y+80}" x2="{x+130}" y2="{y+80}" stroke-width="7"/></g>', 8, 8)
    b += sh(f'<path d="M470,330 h660 l-230,300 v170 l-200,60 v-230 z" fill="{GOLD}"/>')       # funnel
    b += f'<ellipse cx="800" cy="330" rx="330" ry="40" fill="{GOLD2}"/>'
    b += eyes(800, 430, 60, 28) + cheeks(800, 480, 100) + smile(800, 478, 40)
    b += sh(f'<circle cx="800" cy="930" r="0"/>')
    for i, x in enumerate((690, 800, 910)):                                                      # stars out
        b += sparkle(x, 905 - (30 if i == 1 else 0), 30, GOLD)
    b += sh(f'<rect x="1190" y="560" width="60" height="200" fill="{FOREST}"/><rect x="1270" y="480" width="60" height="280" fill="{FOREST}"/><rect x="1350" y="380" width="60" height="380" fill="{RUST}"/>', 8, 8)
    b += f'<line x1="1170" y1="760" x2="1430" y2="760" stroke-width="10"/>'
    b += f'<path d="M1180,520 L1260,450 L1330,390 L1420,300" fill="none" stroke="{RUST}" stroke-width="10"/><path d="M1385,300 h35 v35" fill="none" stroke="{RUST}" stroke-width="10"/>'
    b += sh(f'<g transform="rotate(-30 300 560)"><rect x="200" y="520" width="120" height="70" rx="35" fill="none" stroke-width="18"/><rect x="290" y="520" width="120" height="70" rx="35" fill="none" stroke-width="18" stroke="{RUST}"/></g>', 8, 8)  # proof link
    b += f'<circle cx="300" cy="700" r="36" fill="{FOREST}"/><path d="M282,700 l14,14 l26,-28" fill="none" stroke="{CREAM}" stroke-width="9"/>'
    b += sparkle(1300, 220, 22) + sparkle(250, 280, 18, RUST)
    return frame(b, RUST)

# ---------------------------------------------------------------- 4 Face recognition: friendly face in scan brackets + landmarks
def face_recognition():
    b = ""
    b += sh(f'<circle cx="800" cy="540" r="230" fill="#F2C9A5"/>')
    b += f'<path d="M580,470 Q600,290 800,290 Q1000,290 1020,470 Q960,380 800,390 Q660,380 580,470z" fill="{INK}"/>'   # hair
    b += eyes(800, 530, 85, 30) + cheeks(800, 600, 130) + smile(800, 620, 55)
    pts = [(715, 530), (885, 530), (800, 600), (740, 650), (860, 650), (800, 700), (640, 560), (960, 560), (800, 450)]
    b += "".join(f'<line x1="{a[0]}" y1="{a[1]}" x2="{c[0]}" y2="{c[1]}" stroke="{GOLD2}" stroke-width="3" opacity="0.9"/>' for a, c in ((pts[0], pts[2]), (pts[1], pts[2]), (pts[2], pts[3]), (pts[2], pts[4]), (pts[3], pts[5]), (pts[4], pts[5]), (pts[6], pts[0]), (pts[7], pts[1]), (pts[8], pts[0]), (pts[8], pts[1])))
    b += "".join(f'<circle cx="{x}" cy="{y}" r="10" fill="{GOLD}" stroke-width="4"/>' for x, y in pts)
    L = 120
    for (x, y, dx, dy) in ((470, 210, 1, 1), (1130, 210, -1, 1), (470, 870, 1, -1), (1130, 870, -1, -1)):
        b += sh(f'<path d="M{x},{y+dy*L} V{y} H{x+dx*L}" fill="none" stroke="{RUST}" stroke-width="22"/>', 8, 8)
    b += f'<line x1="480" y1="760" x2="1120" y2="760" stroke="{FOREST}" stroke-width="10" opacity="0.8"/>'                  # scan line
    b += sh(f'<circle cx="1180" cy="760" r="70" fill="{FOREST}"/><path d="M1145,760 l25,25 l50,-55" fill="none" stroke="{CREAM}" stroke-width="16"/>', 8, 8)
    b += sh(f'<rect x="210" y="430" width="170" height="110" rx="20" fill="{CREAM}"/><text x="295" y="503" font-family="DejaVu Sans Mono" font-weight="bold" font-size="44" text-anchor="middle" fill="{INK}" stroke="none">0.8</text>', 8, 8)
    b += sparkle(360, 260, 22) + sparkle(1300, 300, 20, RUST)
    return frame(b, FOREST)

# ---------------------------------------------------------------- 5 NED regulations assistant: graduate owl with the rule book
def ned_owl():
    b = ""
    b += sh(f'<ellipse cx="800" cy="580" rx="230" ry="260" fill="#A07850"/>')                   # body
    b += f'<ellipse cx="800" cy="640" rx="150" ry="170" fill="{POSTER}"/>'
    b += "".join(f'<path d="M{740+i*40},{600+j*45} q20,18 40,0" fill="none" stroke-width="5" opacity="0.6"/>' for i in range(3) for j in range(4))
    for dx in (-90, 90):
        b += f'<circle cx="{800+dx}" cy="440" r="85" fill="{CREAM}"/>'
    b += eyes(800, 440, 90, 42)
    b += f'<path d="M780,500 l20,32 l20,-32z" fill="{GOLD}" stroke-width="6"/>'                  # beak
    b += f'<path d="M600,330 l-30,-90 l90,50z M1000,330 l30,-90 l-90,50z" fill="#A07850"/>'       # ear tufts
    b += sh(f'<path d="M580,260 L800,180 L1020,260 L800,340z" fill="{INK}"/><rect x="700" y="270" width="200" height="70" fill="{INK}"/>', 8, 8)  # cap
    b += f'<path d="M1020,260 v110" fill="none" stroke="{GOLD}" stroke-width="10"/><circle cx="1020" cy="385" r="18" fill="{GOLD}" stroke-width="5"/>'
    b += sh(f'<path d="M560,720 q120,-50 240,0 q120,-50 240,0 v150 q-120,-50 -240,0 q-120,-50 -240,0z" fill="{RUST}"/><path d="M800,720 v150" fill="none"/>')   # open book
    b += "".join(f'<line x1="{x}" y1="{760+i*30}" x2="{x+150}" y2="{760+i*30}" stroke="{CREAM}" stroke-width="6"/>' for x in (600, 830) for i in range(3))
    b += sh(bubble(1080, 230, 330, 200, "left"))
    b += f'<circle cx="1160" cy="320" r="40" fill="{FOREST}"/><path d="M1140,320 l15,15 l28,-30" fill="none" stroke="{CREAM}" stroke-width="9"/>'
    b += f'<text x="1305" y="345" font-family="DejaVu Sans Mono" font-weight="bold" font-size="46" text-anchor="middle" fill="{RUST}" stroke="none">1.0</text>'
    b += sparkle(330, 300, 24) + sparkle(1320, 780, 20, RUST) + sparkle(420, 800, 16)
    return frame(b, GOLD2)

def finish(svg, name):
    png = f"/home/claude/covers/{name}.png"
    cairosvg.svg2png(bytestring=svg.encode(), write_to=png, output_width=W, output_height=H)
    im = Image.open(png).convert("RGB")
    random.seed(len(name))
    noise = Image.effect_noise((W, H), 28).convert("L").filter(ImageFilter.GaussianBlur(0.6))
    fib = Image.merge("RGB", (noise, noise, noise))
    im = ImageChops.blend(im, ImageChops.multiply(im, ImageChops.add(fib, Image.new("RGB", (W, H), (150, 150, 150)), scale=1.0)), 0.18)
    im.save(png, optimize=True)
    return png

for fn, name in ((knodesk_rag, "knodesk-rag"), (voice_agent, "knodesk-voice-agent"), (sales_pipeline, "sales-pipeline"),
                 (face_recognition, "face-recognition-attendance"), (ned_owl, "ned-rag-assistant")):
    print(finish(fn(), name))
