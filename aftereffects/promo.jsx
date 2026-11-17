/*  promo.jsx: builds "The Case File of Umer" (Module 3 promo film) in Adobe After Effects 2022 (22.6).
    Run: File > Scripts > Run Script File... > aftereffects/promo.jsx
    (Edit > Preferences > Scripting & Expressions > "Allow Scripts to Write Files and Access Network" must be ON
     while it runs, so it can save the .aep; switch it OFF again afterwards.)
    Storyboard: docs/promo/STORYBOARD.md   Spec: 3840x2160, 24 fps, 45.0 s (1080 frames), 96 bpm (beat = 15 frames).
    Footage: aftereffects/footage/F1..F10/*.png (PNG sequences); missing shots become labelled placeholders.
    Audio:   aftereffects/audio/music.wav, sfx.wav, ambience.wav (optional; mix.wav is used by the final ffmpeg mux).
    Output:  aftereffects/promo.aep + a Render Queue item writing a PNG sequence to aftereffects/render/.
    Everything here is built from scratch by this script: no presets, no third-party plug-ins, no stock media. */
(function () {
    // ------------------------------------------------------------------ config
    var LIVE_URL = "web3d-portfolio-three.vercel.app";      // production domain (Vercel)
    var EMAIL = "mumerfarooq.ned@gmail.com";
    var W = 3840, H = 2160, FPS = 24, DUR = 45, BEAT = 15;
    var C = {
        parch: hex("E9DCC0"), poster: hex("F3E9D2"), ink: hex("231C15"), rust: hex("7E2F1A"),
        gold: hex("D9A441"), brass: hex("B8862A"), forest: hex("2F5D46"), night: hex("14182E"),
        amber: hex("FFB45A"), cream: hex("F3E9D2"), black: [0, 0, 0]
    };
    var F = { head: "Rokkitt-Black", wanted: "Ultra-Regular", type: "CourierPrime-Bold", typeR: "CourierPrime-Regular", serif: "SourceSerif4-Regular" };
    var ROOT = new File($.fileName).parent;                    // .../aftereffects
    var REPO = ROOT.parent;
    var STAMPS = [];                                           // frames that get a camera shake (master time)

    function hex(h) { return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255]; }
    function t(f) { return f / FPS; }

    app.beginUndoGroup("Build promo");
    try { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (e) {}
    app.newProject();
    var proj = app.project;
    var BIN = proj.items.addFolder("PROMO (built by promo.jsx)");
    var BIN_SC = proj.items.addFolder("Scenes"); BIN_SC.parentFolder = BIN;
    var BIN_FT = proj.items.addFolder("Footage"); BIN_FT.parentFolder = BIN;
    var BIN_AU = proj.items.addFolder("Audio"); BIN_AU.parentFolder = BIN;

    // ------------------------------------------------------------------ helpers
    function comp(name, frames, parent) {
        var c = proj.items.addComp(name, W, H, 1, t(frames), FPS);
        c.parentFolder = parent || BIN_SC; c.bgColor = C.ink; c.motionBlur = true;
        c.shutterAngle = 180; return c;
    }
    function dims(p) {
        if (p.isSpatial) return 1;
        var v = p.value; return (v instanceof Array) ? v.length : 1;
    }
    function ease(p, inf, outf) {
        var d = dims(p), i, k, a = [], b = [];
        for (i = 0; i < d; i++) { a.push(new KeyframeEase(0, inf || 70)); b.push(new KeyframeEase(0, outf || 70)); }
        for (k = 1; k <= p.numKeys; k++) { try { p.setTemporalEaseAtKey(k, a, b); } catch (e) {} }
    }
    function keys(p, list, easeIt) {               // list: [[frame, value], ...] in the comp's local time
        for (var i = 0; i < list.length; i++) p.setValueAtTime(t(list[i][0]), list[i][1]);
        if (easeIt !== false) ease(p);
        return p;
    }
    function hold(p) { for (var k = 1; k <= p.numKeys; k++) p.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD); }
    function solid(c, name, col, w, h) { return c.layers.addSolid(col, name, w || W, h || H, 1, c.duration); }
    function span(l, f0, f1) { l.inPoint = t(f0); l.outPoint = t(f1); return l; }
    function pos(l, x, y) { l.property("ADBE Transform Group").property("ADBE Position").setValue([x, y]); return l; }
    function tr(l, name) { return l.property("ADBE Transform Group").property(name); }

    function text(c, str, font, size, col, opts) {
        opts = opts || {};
        var l = c.layers.addText(str);
        var sp = l.property("ADBE Text Properties").property("ADBE Text Document");
        var d = sp.value;
        d.resetCharStyle(); d.resetParagraphStyle();
        d.text = str; d.font = font; d.fontSize = size; d.applyFill = true; d.fillColor = col; d.applyStroke = false;
        d.tracking = opts.tracking || 0;
        try { d.autoLeading = false; d.leading = opts.leading || size * 1.1; } catch (e) {}
        d.justification = opts.left ? ParagraphJustification.LEFT_JUSTIFY : ParagraphJustification.CENTER_JUSTIFY;
        try { sp.setValue(d); } catch (e) { d.font = "Arial-BoldMT"; sp.setValue(d); }
        pos(l, opts.x !== undefined ? opts.x : W / 2, opts.y !== undefined ? opts.y : H / 2);
        if (opts.name) l.name = opts.name;
        return l;
    }
    function slam(l, f, big) {                     // type slam: 135% -> 97% -> 100%, opacity snaps on
        var s = big || 135;
        keys(tr(l, "ADBE Scale"), [[f, [s, s]], [f + 3, [97, 97]], [f + 6, [100, 100]]]);
        keys(tr(l, "ADBE Opacity"), [[f - 1, 0], [f, 100]], false); hold(tr(l, "ADBE Opacity"));
        return l;
    }
    function typewriter(l, f0, f1) {               // characters appear left to right
        var an = l.property("ADBE Text Properties").property("ADBE Text Animators").addProperty("ADBE Text Animator");
        an.property("ADBE Text Animator Properties").addProperty("ADBE Text Opacity").setValue(0);
        var sel = an.property("ADBE Text Selectors").addProperty("ADBE Text Selector");
        keys(sel.property("ADBE Text Percent Start"), [[f0, 0], [f1, 100]], false);
        return l;
    }
    function stamp(c, str, f, x, y, size, col, masterOffset) {    // rubber stamp: Ultra, boxed, -4 deg, thud
        var l = text(c, str, F.wanted, size, col, { x: x, y: y, tracking: 40 });
        try { var g = l.property("ADBE Effect Parade").addProperty("ADBE Turbulent Displace");
              sv(g.property(2), 18); sv(g.property(3), 40); } catch (e) {}            // amount, size: inky edges
        keys(tr(l, "ADBE Scale"), [[f, [190, 190]], [f + 3, [94, 94]], [f + 6, [100, 100]]]);
        tr(l, "ADBE Rotate Z").setValue(-4);
        keys(tr(l, "ADBE Opacity"), [[f - 1, 0], [f, 92]], false); hold(tr(l, "ADBE Opacity"));
        box(c, l, f, col);
        if (masterOffset !== undefined) STAMPS.push(masterOffset + f);
        return l;
    }
    function box(c, txt, f, col) {                 // stroked frame around a stamp, parented to it
        var r = txt.sourceRectAtTime(t(f + 8), false);
        var s = c.layers.addShape(); s.name = txt.name + " frame";
        var g = s.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        var v = g.property("ADBE Vectors Group");
        v.addProperty("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue([r.width + 120, r.height + 90]);
        var st = v.addProperty("ADBE Vector Graphic - Stroke");
        st.property("ADBE Vector Stroke Color").setValue(col); st.property("ADBE Vector Stroke Width").setValue(18);
        tr(s, "ADBE Position").setValue([0, 0]);
        s.parent = txt;
        tr(s, "ADBE Position").setValue([r.left + r.width / 2, r.top + r.height / 2]);
        keys(tr(s, "ADBE Opacity"), [[f - 1, 0], [f, 100]], false); hold(tr(s, "ADBE Opacity"));
        s.moveAfter(txt);
        return s;
    }
    function rect(c, name, w, h, col, x, y, strokeCol, strokeW) {
        var s = c.layers.addShape(); s.name = name;
        var g = s.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        var v = g.property("ADBE Vectors Group");
        v.addProperty("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue([w, h]);
        if (col) v.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(col);
        if (strokeCol) {
            var st = v.addProperty("ADBE Vector Graphic - Stroke");
            st.property("ADBE Vector Stroke Color").setValue(strokeCol); st.property("ADBE Vector Stroke Width").setValue(strokeW || 8);
        }
        pos(s, x, y); return s;
    }
    function sv(p, v) { try { p.setValue(v); } catch (e) {} }
    function shadowCast(l, dist) {                 // hard offset shadow (case-file look)
        try {
            var d = l.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
            sv(d.property("ADBE Drop Shadow-0001"), C.ink); sv(d.property("ADBE Drop Shadow-0002"), 229);
            sv(d.property("ADBE Drop Shadow-0003"), 135); sv(d.property("ADBE Drop Shadow-0004"), dist || 26);
            sv(d.property("ADBE Drop Shadow-0005"), 0);
        } catch (e) {}
        return l;
    }
    function paper(c) {                            // parchment background + paper-fibre noise (overlay) + vignette
        var bg = solid(c, "Parchment", C.parch);
        try {
            var nzl = solid(c, "Paper fibres", [0.5, 0.5, 0.5]);
            var fn = nzl.property("ADBE Effect Parade").addProperty("ADBE Fractal Noise");
            try { fn.property("Contrast").setValue(180); } catch (e) {}
            try { fn.property("Transform").property("Scale").setValue(260); } catch (e) {}
            try { fn.property("Evolution").expression = "time*40"; } catch (e) {}
            nzl.blendingMode = BlendingMode.OVERLAY; tr(nzl, "ADBE Opacity").setValue(22);
            bg.__fibres = nzl;
        } catch (e) {}
        vignette(c, 45);
        return bg;
    }
    function vignette(c, opacity) {
        var v = solid(c, "Vignette", C.black);
        var m = v.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
        var s = new Shape(), rx = W * 0.62, ry = H * 0.66, k = 0.5523;
        s.vertices = [[W / 2, H / 2 - ry], [W / 2 + rx, H / 2], [W / 2, H / 2 + ry], [W / 2 - rx, H / 2]];
        s.inTangents = [[-rx * k, 0], [0, -ry * k], [rx * k, 0], [0, ry * k]];
        s.outTangents = [[rx * k, 0], [0, ry * k], [-rx * k, 0], [0, -ry * k]];
        s.closed = true;
        m.property("ADBE Mask Shape").setValue(s); m.inverted = true;
        m.property("ADBE Mask Feather").setValue([900, 900]);
        tr(v, "ADBE Opacity").setValue(opacity);
        return v;
    }
    function letterbox(c) {
        var bar = Math.round((H - W / 2.39) / 2);
        var a = rect(c, "Letterbox top", W, bar, C.black, W / 2, bar / 2);
        var b = rect(c, "Letterbox bottom", W, bar, C.black, W / 2, H - bar / 2);
        return [a, b];
    }
    function grade(l, warm) {                      // per-shot look: glow on lights (+ slight warmth by day)
        try {
            var fx = l.property("ADBE Effect Parade");
            var g = fx.addProperty("ADBE Glo2");
            sv(g.property("ADBE Glo2-0002"), 68); sv(g.property("ADBE Glo2-0003"), 60); sv(g.property("ADBE Glo2-0004"), 0.6);
            if (warm) { var tn = fx.addProperty("ADBE Tint"); sv(tn.property("ADBE Tint-0002"), C.gold); sv(tn.property("ADBE Tint-0003"), 8); }
        } catch (e) {}
        return l;
    }

    // ------------------------------------------------------------------ footage
    function footage(id, label) {
        var dir = new Folder(ROOT.fsName + "/footage/" + id);
        if (dir.exists) {
            var files = dir.getFiles("*.png");
            if (files.length) {
                files.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
                var io = new ImportOptions(files[0]);
                if (io.canImportAs(ImportAsType.FOOTAGE)) {
                    io.sequence = true; io.forceAlphabetical = true;
                    var it = proj.importFile(io); it.parentFolder = BIN_FT; it.name = id;
                    it.mainSource.conformFrameRate = FPS;
                    return it;
                }
            }
        }
        var ph = comp("PLACEHOLDER " + id, 240, BIN_FT); ph.bgColor = C.night;
        solid(ph, "bg", C.night);
        text(ph, id + " - " + label, F.type, 110, C.amber, { y: H / 2 - 60 });
        text(ph, "capture pending (P9.3): footage/" + id + "/", F.typeR, 64, C.cream, { y: H / 2 + 80 });
        return ph;
    }
    function shot(c, item, f0, f1, srcStart, warm) {
        var l = c.layers.add(item); l.startTime = t(f0 - (srcStart || 0)); span(l, f0, f1);
        var sx = 100 * W / item.width; tr(l, "ADBE Scale").setValue([sx, sx]);
        grade(l, warm);
        return l;
    }
    var FT = {
        F1: footage("F1", "night sea, lighthouse, boat rowing in"), F2: footage("F2", "rowboat close: oars and splash"),
        F3: footage("F3", "blacksmith street dolly, golden hour"), F4: footage("F4", "push-in on the bounty board"),
        F5: footage("F5", "Classic projects gallery capture"), F6: footage("F6", "train arriving at the station"),
        F7: footage("F7", "horse gallop down the main street"), F8: footage("F8", "stars to the counter, fireworks"),
        F9: footage("F9", "Classic hero + WANTED poster scroll"), F10: footage("F10", "aerial pull-back, night island")
    };
    var HEADSHOT = null;
    try { var hf = new File(REPO.fsName + "/public/images/profile/umer-headshot.jpg"); if (hf.exists) { HEADSHOT = proj.importFile(new ImportOptions(hf)); HEADSHOT.parentFolder = BIN_FT; } } catch (e) {}

    // ------------------------------------------------------------------ S1 cold open (0-120)
    var S1 = comp("S1 Cold open", 128);
    shot(S1, FT.F1, 0, 78, 0, false);
    shot(S1, FT.F2, 78, 128, 0, false);
    letterbox(S1);
    var flick = solid(S1, "Projector flicker", C.black);                       // black -> flicker -> picture
    flick.property("ADBE Transform Group").property("ADBE Opacity").expression =
        "f=timeToFrames(time); f<6?100:(f<18?(seedRandom(f,true), random(0,60)):0)";
    var bi = stamp(S1, "BYTE ISLAND", 60, W / 2, H / 2 - 40, 330, C.cream, 0);
    shadowCast(bi, 18);
    typewriter(text(S1, "A NEW SHERIFF ARRIVES IN TOWN", F.type, 92, C.amber, { y: H / 2 + 260, tracking: 160 }), 74, 108);

    // ------------------------------------------------------------------ S2 WANTED (120-240)
    var S2 = comp("S2 Office - WANTED", 128); var o2 = 120;
    paper(S2);
    var cam2 = S2.layers.addCamera("Cam", [W / 2, H / 2]);
    var co = cam2.property("ADBE Camera Options Group");
    sv(co.property("ADBE Camera Depth of Field"), 1); sv(co.property("ADBE Camera Aperture"), 120); sv(co.property("ADBE Camera Blur Level"), 80);
    var ZOOM = W * 50 / 36;                                                 // 50 mm-equivalent: distance ZOOM = 100% scale
    sv(co.property("ADBE Camera Zoom"), ZOOM);
    keys(tr(cam2, "ADBE Position"), [[0, [W / 2, H / 2, -ZOOM * 1.18]], [120, [W / 2, H / 2 - 20, -ZOOM * 1.03]]]);
    co.property("ADBE Camera Focus Distance").expression = "length(position, [thisComp.width/2, thisComp.height/2, 0])";
    var posterL = rect(S2, "Poster", 1600, 1980, C.poster, W / 2, H / 2 + 20, C.ink, 10); posterL.threeDLayer = true; shadowCast(posterL, 40);
    keys(tr(posterL, "ADBE Position"), [[0, [W / 2, -1400, 0]], [8, [W / 2, H / 2 + 30, 0]], [11, [W / 2, H / 2 + 20, 0]]]);
    keys(tr(posterL, "ADBE Rotate Z"), [[0, -9], [8, 1.5], [12, -1.2]]);
    S2.time = t(14);                                                        // parent while the poster is at rest
    function onPoster(l, f, z) { l.threeDLayer = true; l.parent = posterL; return l; }
    var wanted = text(S2, "WANTED", F.wanted, 280, C.ink, { y: H / 2 - 700, tracking: 60 }); onPoster(wanted); slam(wanted, 14, 150);
    if (HEADSHOT) {
        var hs = S2.layers.add(HEADSHOT); hs.threeDLayer = true;
        var sc = 100 * 720 / HEADSHOT.width; tr(hs, "ADBE Scale").setValue([sc, sc, 100]);
        pos(hs, W / 2, H / 2 - 150); hs.parent = posterL;
        var hfr = rect(S2, "Photo frame", 760, HEADSHOT.height * sc / 100 + 40, null, W / 2, H / 2 - 150, C.ink, 10); hfr.threeDLayer = true; hfr.parent = posterL;
        keys(tr(hfr, "ADBE Opacity"), [[22, 0], [30, 100]]);
        keys(tr(hs, "ADBE Opacity"), [[22, 0], [30, 100]]);
        try { var ht = hs.property("ADBE Effect Parade").addProperty("ADBE Tint"); sv(ht.property("ADBE Tint-0002"), C.parch); sv(ht.property("ADBE Tint-0003"), 25); } catch (e) {}
    }
    var nm = text(S2, "MUHAMMAD UMER FAROOQ", F.head, 150, C.ink, { y: H / 2 + 470, tracking: 30 }); onPoster(nm); slam(nm, 36);
    var ti = text(S2, "ASSOCIATE AI ENGINEER · KARACHI", F.type, 70, C.rust, { y: H / 2 + 590, tracking: 120 }); onPoster(ti); typewriter(ti, 44, 66);
    var hl = text(S2, "I build AI that people actually use,\rand make it feel alive in 3D.", F.serif, 64, C.ink, { y: H / 2 + 720 }); onPoster(hl); typewriter(hl, 60, 92);
    var cf = stamp(S2, "CASE FILE No. 021", 90, W / 2 + 560, H / 2 - 420, 120, C.rust, o2); cf.threeDLayer = true; cf.parent = posterL;

    // ------------------------------------------------------------------ S3 Workshop - skills (240-420)
    var S3 = comp("S3 Workshop - skills", 188); var o3 = 240;
    var f3 = shot(S3, FT.F3, 0, 188, 0, true);
    var p3 = paper(S3);
    var toggle = "b=Math.floor(timeToFrames(time)/" + BEAT + "); (b<1)?100:((b%2==0)?100:0)";   // parchment on even beats, footage on odd beats
    tr(p3, "ADBE Opacity").expression = toggle;
    if (p3.__fibres) tr(p3.__fibres, "ADBE Opacity").expression = "b=Math.floor(timeToFrames(time)/" + BEAT + "); (b<1)?22:((b%2==0)?22:0)";
    var hdr3 = text(S3, "TOOLS OF THE TRADE", F.type, 96, C.rust, { y: 360, tracking: 220 }); typewriter(hdr3, 0, 14);
    var SK = ["LLMs & RAG", "COMPUTER VISION", "PYTHON · FASTAPI", "THREE.JS", "BLENDER", "AFTER EFFECTS", "REACT · NEXT.JS", "DOCKER · VERCEL"];
    for (var i = 0; i < SK.length; i++) {
        var onFootage = ((i + 1) % 2 === 1);                                   // beat index b = i+1; odd beats show footage
        var f = BEAT * (i + 1), w = text(S3, SK[i], F.head, 360, onFootage ? C.cream : C.ink, { y: H / 2 + 40, tracking: 10 });
        slam(w, f); span(w, f, (i === SK.length - 1) ? 188 : f + BEAT);
        if (onFootage) shadowCast(w, 22);
        STAMPS.push(o3 + f);
    }
    var all = text(S3, "LLMs · RAG · CV · PYTHON · THREE.JS · BLENDER · AE · REACT · DOCKER", F.type, 64, C.ink, { y: H - 300, tracking: 80 });
    span(all, 135, 188); typewriter(all, 135, 170);

    // ------------------------------------------------------------------ S4 Bounty board - projects (420-660)
    var S4 = comp("S4 Bounties - projects", 248); var o4 = 420;
    paper(S4);
    var hdr4 = text(S4, "CASES I'VE CLOSED", F.head, 300, C.ink, { y: H / 2 }); slam(hdr4, 2); span(hdr4, 0, 24);
    shot(S4, FT.F4, 24, 84, 0, false); 
    var CASES = [["TALEEM360", "REWARD: 1ST OF 70+ TEAMS"], ["KNODESK RAG", "REWARD: 10+ BUSINESSES"],
                 ["SALES PIPELINE", "REWARD: 25+ DAILY USERS"], ["NED REGULATIONS AI", "RECALL@5 = 1.000"]];
    var px = [W * 0.2, W * 0.4, W * 0.6, W * 0.8];
    for (i = 0; i < CASES.length; i++) {
        var fi = 84 + 30 * i;
        var pst = rect(S4, "Bounty " + CASES[i][0], 700, 980, C.poster, px[i], H / 2, C.ink, 8); shadowCast(pst, 26);
        keys(tr(pst, "ADBE Position"), [[fi, [px[i], -900]], [fi + 5, [px[i], H / 2 + 20]], [fi + 8, [px[i], H / 2]]]);
        tr(pst, "ADBE Rotate Z").setValue([-3, 2, -2, 3][i]);
        span(pst, fi, 210);
        var b1 = text(S4, "BOUNTY", F.wanted, 96, C.ink, { x: 0, y: 0 }); b1.parent = pst; pos(b1, 0, -360); span(b1, fi, 210);
        var b2 = text(S4, CASES[i][0], F.head, 92, C.ink, {}); b2.parent = pst; pos(b2, 0, -40); span(b2, fi, 210);
        var b3 = text(S4, CASES[i][1], F.type, 44, C.rust, { tracking: 40 }); b3.parent = pst; pos(b3, 0, 120); span(b3, fi + 4, 210); typewriter(b3, fi + 4, fi + 16);
        var st4 = stamp(S4, "CASE CLOSED", fi + 18, px[i], H / 2 + 300, 64, C.rust, o4); span(st4, fi + 18, 210);
        STAMPS.push(o4 + fi + 5);
    }
    shot(S4, FT.F5, 204, 248, 0, true);
    letterbox(S4);

    // ------------------------------------------------------------------ S5 Railway - journey (660-840)
    var S5 = comp("S5 Railway - journey", 188); var o5 = 660;
    paper(S5);
    text(S5, "STATIONS SO FAR", F.type, 96, C.rust, { y: 330, tracking: 220 });
    var rail = S5.layers.addShape(); rail.name = "RAIL BIG";
    var rg = rail.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group"); rg.name = "Rail";
    var rv = rg.property("ADBE Vectors Group");
    var rp = rv.addProperty("ADBE Vector Shape - Group"); rp.name = "Line";
    var sh = new Shape(); sh.vertices = [[-1550, 180], [-500, 180], [-120, -40], [520, -40], [900, -260], [1550, -260]]; sh.closed = false;
    rp.property("ADBE Vector Shape").setValue(sh);
    var rs = rv.addProperty("ADBE Vector Graphic - Stroke"); rs.property("ADBE Vector Stroke Color").setValue(C.brass); rs.property("ADBE Vector Stroke Width").setValue(22);
    var trim = rv.addProperty("ADBE Vector Filter - Trim");
    keys(trim.property("ADBE Vector Trim End"), [[10, 0], [120, 100]], false);
    pos(rail, W / 2, H / 2 + 140);
    var lan = rect(S5, "Lantern", 70, 70, C.amber, 0, 0); lan.name = "Lantern";
    tr(lan, "ADBE Position").expression =
        "var L=thisComp.layer('RAIL BIG'); var p=L.content('Rail').content('Line').path; var e=L.content('Rail').content('Trim Paths 1').end/100; L.toComp(p.pointOnPath(Math.max(0.0001,e)));";
    try { var gl = lan.property("ADBE Effect Parade").addProperty("ADBE Glo2"); sv(gl.property("ADBE Glo2-0003"), 180); sv(gl.property("ADBE Glo2-0004"), 2.5); } catch (e) {}
    var ST = [["AUG 2023", "NED UNIVERSITY · BS CS & IT", 0.04, 25], ["2ND YEAR", "2ND IN CLASS · GPA 3.83", 0.33, 55],
              ["AUG 2026", "AXISERO · ASSOCIATE AI ENGINEER", 0.62, 85], ["OCT 2026", "BEST FYDP · 1ST OF 70+", 0.96, 115]];
    var SP = [[-1500, 180], [-380, 120], [460, -40], [1500, -260]];
    for (i = 0; i < ST.length; i++) {
        var sf = ST[i][3], sx2 = W / 2 + SP[i][0], sy2 = H / 2 + 140 + SP[i][1];
        var dot = rect(S5, "Station " + ST[i][0], 56, 56, C.ink, sx2, sy2); slam(dot, sf, 220);
        var yr = text(S5, ST[i][0], F.head, 150, (i === 3) ? C.rust : C.ink, { x: sx2, y: sy2 - 160 }); slam(yr, sf);
        var lb = text(S5, ST[i][1], F.type, 50, C.ink, { x: sx2, y: sy2 + 130, tracking: 40 }); typewriter(lb, sf + 2, sf + 14);
        STAMPS.push(o5 + sf);
    }
    var trainShot = shot(S5, FT.F6, 128, 188, 0, false); letterbox(S5);
    var cnt = text(S5, "3 YEARS, 1 BEST-FYDP AWARD", F.type, 64, C.rust, { y: H - 260, tracking: 120 }); span(cnt, 116, 128); typewriter(cnt, 116, 126);

    // ------------------------------------------------------------------ S6 The town - two ways in (840-960)
    var S6 = comp("S6 Town - two ways in", 128); var o6 = 840;
    var left = shot(S6, FT.F9, 0, 64, 0, true), right = shot(S6, FT.F7, 0, 64, 0, true);
    function halfMask(l, leftSide) {
        var m = l.property("ADBE Mask Parade").addProperty("ADBE Mask Atom"); var s = new Shape();
        var x0 = leftSide ? 0 : W / 2 + 12, x1 = leftSide ? W / 2 - 12 : W;
        s.vertices = [[x0, 0], [x1, 0], [x1, H], [x0, H]]; s.closed = true; m.property("ADBE Mask Shape").setValue(s);
    }
    halfMask(left, true); halfMask(right, false);
    var sep = rect(S6, "Split", 24, H, C.gold, W / 2, H / 2); span(sep, 0, 64);
    keys(tr(sep, "ADBE Scale"), [[0, [100, 0]], [6, [100, 100]]]);
    var two = text(S6, "TWO WAYS IN", F.head, 220, C.cream, { y: 300 }); slam(two, 4); span(two, 0, 64); shadowCast(two, 20);
    var lt = text(S6, "CLASSIC · THE CASE FILE", F.type, 72, C.cream, { x: W * 0.25, y: H - 260, tracking: 100 }); span(lt, 0, 64); typewriter(lt, 10, 26); shadowCast(lt, 10);
    var rt = text(S6, "EXPLORE · BYTE ISLAND", F.type, 72, C.cream, { x: W * 0.75, y: H - 260, tracking: 100 }); span(rt, 0, 64); typewriter(rt, 18, 34); shadowCast(rt, 10);
    shot(S6, FT.F8, 64, 128, 0, false);
    var stars = text(S6, "8/8 STARS", F.head, 200, C.gold, { y: 380 }); slam(stars, 70); span(stars, 64, 128); shadowCast(stars, 20);
    var cc = stamp(S6, "CASE CLOSED", 92, W / 2, H / 2 + 80, 420, C.rust, o6); shadowCast(cc, 24);
    letterbox(S6);

    // ------------------------------------------------------------------ S7 End card (960-1080)
    var S7 = comp("S7 End card", 120); var o7 = 960;
    var f10 = shot(S7, FT.F10, 0, 120, 0, false);
    var dim = solid(S7, "Ink veil", C.ink); keys(tr(dim, "ADBE Opacity"), [[0, 0], [14, 62]]);
    var um = text(S7, "UMER", F.head, 760, C.cream, { y: H / 2 - 160, tracking: 40 }); slam(um, 4, 150); shadowCast(um, 34); STAMPS.push(o7 + 4);
    typewriter(text(S7, "MUHAMMAD UMER FAROOQ · AI ENGINEER", F.type, 92, C.gold, { y: H / 2 + 330, tracking: 160 }), 16, 40);
    typewriter(text(S7, LIVE_URL, F.type, 80, C.cream, { y: H / 2 + 480, tracking: 60 }), 40, 60);
    typewriter(text(S7, EMAIL, F.typeR, 70, C.cream, { y: H / 2 + 590, tracking: 40 }), 56, 74);
    var ride = text(S7, "RIDE TO THE ISLAND →", F.head, 120, C.rust, { y: H - 220 });
    var rbg = rect(S7, "Ride button", 1500, 210, C.cream, W / 2, H - 230, C.ink, 10); rbg.moveAfter(ride); shadowCast(rbg, 20);
    slam(ride, 74); keys(tr(rbg, "ADBE Opacity"), [[73, 0], [74, 100]], false); hold(tr(rbg, "ADBE Opacity"));
    letterbox(S7);

    // ------------------------------------------------------------------ MASTER
    var M = comp("PROMO_MASTER (render this)", 1080, BIN); M.bgColor = C.black;
    var SC = [[S1, 0], [S2, 120], [S3, 240], [S4, 420], [S5, 660], [S6, 840], [S7, 960]];
    for (i = 0; i < SC.length; i++) {
        var sl = M.layers.add(SC[i][0]); sl.startTime = t(SC[i][1]); sl.collapseTransformation = false;
        span(sl, Math.max(0, SC[i][1] - (i ? 0 : 0)), Math.min(1080, SC[i][1] + SC[i][0].duration * FPS));
        if (i > 0) {                                                            // ink wipe in over the previous scene
            var lw = sl.property("ADBE Effect Parade").addProperty("ADBE Linear Wipe");
            lw.property("ADBE Linear Wipe-0002").setValue(i % 2 ? 270 : 90); lw.property("ADBE Linear Wipe-0003").setValue(260);
            keys(lw.property("ADBE Linear Wipe-0001"), [[SC[i][1], 100], [SC[i][1] + 8, 0]]);
            try { var td = sl.property("ADBE Effect Parade").addProperty("ADBE Turbulent Displace");
                  sv(td.property(3), 120); keys(td.property(2), [[SC[i][1], 160], [SC[i][1] + 9, 0]]); } catch (e) {}
            sl.moveToBeginning();
        }
    }
    // persistent railroad progress line + chapter counter + timecode overlay
    var prog = M.layers.addShape(); prog.name = "RAIL";
    var pg = prog.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group"); pg.name = "Rail";
    var pv = pg.property("ADBE Vectors Group"); var pp = pv.addProperty("ADBE Vector Shape - Group"); pp.name = "Line";
    var ps = new Shape(); ps.vertices = [[160, H - 120], [W - 160, H - 120]]; ps.closed = false; pp.property("ADBE Vector Shape").setValue(ps);
    var pst2 = pv.addProperty("ADBE Vector Graphic - Stroke"); pst2.property("ADBE Vector Stroke Color").setValue(C.gold); pst2.property("ADBE Vector Stroke Width").setValue(6);
    var ptr = pv.addProperty("ADBE Vector Filter - Trim"); keys(ptr.property("ADBE Vector Trim End"), [[120, 0], [1060, 100]], false);
    tr(prog, "ADBE Position").setValue([0, 0]); tr(prog, "ADBE Anchor Point").setValue([0, 0]);
    span(prog, 120, 1060); tr(prog, "ADBE Opacity").setValue(80);
    var head = rect(M, "Rail lantern", 26, 26, C.amber, 0, 0);
    tr(head, "ADBE Position").expression = "var L=thisComp.layer('RAIL'); var e=L.content('Rail').content('Trim Paths 1').end/100; L.toComp(L.content('Rail').content('Line').path.pointOnPath(Math.max(0.0001,e)));";
    try { sv(head.property("ADBE Effect Parade").addProperty("ADBE Glo2").property("ADBE Glo2-0003"), 90); } catch (e) {}
    span(head, 120, 1060);
    var chapters = ["", "CH 01/05  ·  THE OFFICE", "CH 02/05  ·  THE WORKSHOP", "CH 03/05  ·  THE BOUNTY BOARD", "CH 04/05  ·  THE RAILWAY", "CH 05/05  ·  THE TOWN", ""];
    var chap = text(M, "CH", F.type, 40, C.gold, { x: 170, y: 140, left: true, tracking: 120 }); chap.name = "Chapter";
    chap.property("ADBE Text Properties").property("ADBE Text Document").expression =
        "var c=" + toSrc(chapters) + "; var s=[0,120,240,420,660,840,960]; var f=timeToFrames(time); var k=0; for(var i=0;i<s.length;i++){ if(f>=s[i]) k=i; } c[k];";
    var tc = text(M, "00:00", F.typeR, 40, C.gold, { x: W - 170, y: 140, tracking: 80 }); tc.name = "Timecode";
    tc.property("ADBE Text Properties").property("ADBE Text Document").expression = "timeToTimecode(time, 24, false)";
    var corners = M.layers.addShape(); corners.name = "Corner brackets";
    var cg = corners.property("ADBE Root Vectors Group");
    var CN = [[[90, 220], [90, 90], [220, 90]], [[W - 220, 90], [W - 90, 90], [W - 90, 220]], [[90, H - 220], [90, H - 90], [220, H - 90]], [[W - 220, H - 90], [W - 90, H - 90], [W - 90, H - 220]]];
    for (i = 0; i < 4; i++) {
        var g4 = cg.addProperty("ADBE Vector Group"); var v4 = g4.property("ADBE Vectors Group");
        var s4 = new Shape(); s4.vertices = CN[i]; s4.closed = false; v4.addProperty("ADBE Vector Shape - Group").property("ADBE Vector Shape").setValue(s4);
        var k4 = v4.addProperty("ADBE Vector Graphic - Stroke"); k4.property("ADBE Vector Stroke Color").setValue(C.gold); k4.property("ADBE Vector Stroke Width").setValue(5);
    }
    tr(corners, "ADBE Opacity").setValue(70);
    // stamp shake + cut flashes on an adjustment layer above the scenes
    var adj = solid(M, "FX: shake, flash, grain", [1, 1, 1]); adj.adjustmentLayer = true;
    var tf = adj.property("ADBE Effect Parade").addProperty("ADBE Geometry2");
    tf.property("ADBE Geometry2-0002").expression =
        "var s=" + toSrc(STAMPS) + "; var f=timeToFrames(time); var a=0; for(var i=0;i<s.length;i++){ var d=f-s[i]; if(d>=0&&d<5) a=Math.max(a,(5-d)*3.2); } seedRandom(f,true); value+[random(-a,a),random(-a,a)];";
    var ex = adj.property("ADBE Effect Parade").addProperty("ADBE Exposure2");
    try { ex.property("Exposure").expression = "var c=[120,240,420,660,840,960]; var f=timeToFrames(time); var e=0; for(var i=0;i<c.length;i++){ var d=f-c[i]; if(d>=0&&d<2) e=0.9-0.45*d; } e;"; } catch (e) {}
    try { var nz = adj.property("ADBE Effect Parade").addProperty("ADBE Noise"); sv(nz.property(1), 7); sv(nz.property(2), 0); } catch (e) {}   // monochrome film grain
    adj.moveToBeginning(); prog.moveToBeginning(); head.moveToBeginning(); chap.moveToBeginning(); tc.moveToBeginning(); corners.moveToBeginning();
    // final fade to black over the last 6 frames
    var outF = solid(M, "Fade out", C.black); keys(tr(outF, "ADBE Opacity"), [[1074, 0], [1080, 100]]); outF.moveToBeginning();

    // audio stems
    var AU = ["music", "sfx", "ambience"];
    for (i = 0; i < AU.length; i++) {
        var af = new File(ROOT.fsName + "/audio/" + AU[i] + ".wav");
        if (af.exists) { var ai = proj.importFile(new ImportOptions(af)); ai.parentFolder = BIN_AU; var al = M.layers.add(ai); al.startTime = 0; al.moveToEnd(); }
    }
    // beat markers (every bar) + scene markers
    var names = ["Cold open", "01 Office", "02 Workshop", "03 Bounties", "04 Railway", "05 Town", "End card"];
    for (i = 0; i < SC.length; i++) M.markerProperty.setValueAtTime(t(SC[i][1]), new MarkerValue(names[i]));

    // ------------------------------------------------------------------ render queue + save
    var rqi = proj.renderQueue.items.add(M);
    var om = rqi.outputModule(1);
    var tpl = ["PNG Sequence", "TIFF Sequence with Alpha", "Lossless"], applied = "";
    for (i = 0; i < tpl.length && !applied; i++) { try { om.applyTemplate(tpl[i]); applied = tpl[i]; } catch (e) {} }
    var rdir = new Folder(ROOT.fsName + "/render"); if (!rdir.exists) rdir.create();
    om.file = new File(rdir.fsName + "/promo_[#####].png");
    try { rqi.applyTemplate("Best Settings"); } catch (e) {}

    app.endUndoGroup();
    var out = new File(ROOT.fsName + "/promo.aep");
    try { proj.save(out); } catch (e) { alert("Built the promo, but could not save promo.aep.\nTurn on Preferences > Scripting & Expressions > Allow Scripts to Write Files, then File > Save As.\n" + e); return; }
    M.openInViewer();
    alert("Promo built.\nSaved: " + out.fsName + "\nOutput module: " + applied + "\nPlaceholders are used for any footage not captured yet.");

    function toSrc(a) { var s = "["; for (var i = 0; i < a.length; i++) { s += (i ? "," : "") + (typeof a[i] === "string" ? "'" + a[i].replace(/'/g, "\\'") + "'" : a[i]); } return s + "]"; }
})();
