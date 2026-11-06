/*
 * Colour Check — colour science and scoring engine.
 * Plain JavaScript, no dependencies, no network. Everything runs in the browser.
 *
 * Standards used
 *  - sRGB (IEC 61966-2-1) transfer curve and D65 matrices
 *  - CIE 1976 L*a*b* / LCh(ab), D65 reference white
 *  - CIEDE2000 colour difference (Sharma, Wu & Dalal 2005 implementation notes)
 *  - Bradford chromatic adaptation for white-reference correction
 *  - Individual Typology Angle (ITA) for skin depth classification
 *
 * Scoring model (see README for the reasoning)
 *  Six factors, each 0–100, combined with a weighted power mean (p = -3) so one
 *  bad factor drags the total down instead of being averaged away. A reference
 *  palette (Deep Autumn + Deep Winter overlap, and an avoid list) is used as an
 *  independent cross-check: a small bonus near good swatches, a penalty and a
 *  hard cap near avoid swatches.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Small maths helpers                                                 */
  /* ------------------------------------------------------------------ */
  var DEG = Math.PI / 180;
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  function cosd(d) { return Math.cos(d * DEG); }
  function sind(d) { return Math.sin(d * DEG); }
  function wrap360(h) { h = h % 360; return h < 0 ? h + 360 : h; }
  function hueDiff(a, b) { var d = Math.abs(wrap360(a) - wrap360(b)); return d > 180 ? 360 - d : d; }

  // Linear interpolation through [x, y] points (x ascending)
  function piecewise(x, pts) {
    if (x <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        var p = pts[i - 1], q = pts[i];
        return p[1] + (q[1] - p[1]) * (x - p[0]) / (q[0] - p[0]);
      }
    }
    return pts[pts.length - 1][1];
  }

  // 1 inside [lo, hi], fading to 0 over `soft` units outside
  function band(x, lo, hi, soft) {
    if (x >= lo && x <= hi) return 1;
    var d = x < lo ? lo - x : x - hi;
    return clamp01(1 - d / soft);
  }

  function mat3mul(A, B) {
    var R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++)
      R[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    return R;
  }
  function mat3vec(A, v) {
    return [
      A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2],
      A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2],
      A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2]
    ];
  }
  function mat3inv(m) {
    var a = m[0][0], b = m[0][1], c = m[0][2], d = m[1][0], e = m[1][1], f = m[1][2], g = m[2][0], h = m[2][1], i = m[2][2];
    var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    var det = a * A + b * B + c * C;
    return [
      [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
      [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
      [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]
    ];
  }

  /* ------------------------------------------------------------------ */
  /* Colour conversions                                                  */
  /* ------------------------------------------------------------------ */
  var D65 = [0.95047, 1.0, 1.08883];
  var RGB2XYZ = [
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.0721750],
    [0.0193339, 0.1191920, 0.9503041]
  ];
  var XYZ2RGB = mat3inv(RGB2XYZ);
  var EPS = 216 / 24389, KAPPA = 24389 / 27;

  function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function linearToSrgb(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }

  var LIN8 = new Float64Array(256);
  for (var k = 0; k < 256; k++) LIN8[k] = srgbToLinear(k / 255);

  function hexToRgb8(hex) {
    var s = String(hex).replace('#', '').trim();
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgb8ToHex(rgb) {
    return '#' + rgb.map(function (v) {
      var s = clamp(Math.round(v), 0, 255).toString(16).toUpperCase();
      return s.length < 2 ? '0' + s : s;
    }).join('');
  }
  function rgb8ToLinear(rgb) { return [LIN8[rgb[0]], LIN8[rgb[1]], LIN8[rgb[2]]]; }
  function linearToRgb8(lin) {
    return lin.map(function (v) { return clamp(Math.round(linearToSrgb(clamp(v, 0, 1)) * 255), 0, 255); });
  }
  function linearToXyz(lin) { return mat3vec(RGB2XYZ, lin); }
  function xyzToLinear(xyz) { return mat3vec(XYZ2RGB, xyz); }

  function xyzToLab(xyz) {
    function f(t) { return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116; }
    var fx = f(xyz[0] / D65[0]), fy = f(xyz[1] / D65[1]), fz = f(xyz[2] / D65[2]);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function labToXyz(lab) {
    var fy = (lab[0] + 16) / 116, fx = fy + lab[1] / 500, fz = fy - lab[2] / 200;
    function finv(t) { var t3 = t * t * t; return t3 > EPS ? t3 : (116 * t - 16) / KAPPA; }
    var yr = lab[0] > KAPPA * EPS ? fy * fy * fy : lab[0] / KAPPA;
    return [D65[0] * finv(fx), D65[1] * yr, D65[2] * finv(fz)];
  }
  function labToLch(lab) {
    var C = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
    var h = C < 1e-9 ? 0 : wrap360(Math.atan2(lab[2], lab[1]) / DEG);
    return { L: lab[0], C: C, h: h };
  }
  function lchToLab(L, C, h) { return [L, C * cosd(h), C * sind(h)]; }

  function hexToLab(hex) { return xyzToLab(linearToXyz(rgb8ToLinear(hexToRgb8(hex)))); }
  function labToLinear(lab) { return xyzToLinear(labToXyz(lab)); }
  function labToRgb8(lab) { return linearToRgb8(labToLinear(lab)); }
  function labToHex(lab) { return rgb8ToHex(labToRgb8(lab)); }
  function labInGamut(lab, tol) {
    tol = tol === undefined ? 1e-4 : tol;
    var lin = labToLinear(lab);
    return lin[0] >= -tol && lin[0] <= 1 + tol && lin[1] >= -tol && lin[1] <= 1 + tol && lin[2] >= -tol && lin[2] <= 1 + tol;
  }

  /* CIEDE2000 — follows Sharma, Wu & Dalal (2005) exactly. */
  function deltaE00(lab1, lab2) {
    var L1 = lab1[0], a1 = lab1[1], b1 = lab1[2], L2 = lab2[0], a2 = lab2[1], b2 = lab2[2];
    var C1 = Math.sqrt(a1 * a1 + b1 * b1), C2 = Math.sqrt(a2 * a2 + b2 * b2);
    var Cb = (C1 + C2) / 2, Cb7 = Math.pow(Cb, 7);
    var G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + 6103515625)));
    var a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    var C1p = Math.sqrt(a1p * a1p + b1 * b1), C2p = Math.sqrt(a2p * a2p + b2 * b2);
    var h1p = (a1p === 0 && b1 === 0) ? 0 : wrap360(Math.atan2(b1, a1p) / DEG);
    var h2p = (a2p === 0 && b2 === 0) ? 0 : wrap360(Math.atan2(b2, a2p) / DEG);
    var dLp = L2 - L1, dCp = C2p - C1p, dhp;
    if (C1p * C2p === 0) dhp = 0;
    else { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
    var dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * DEG / 2);
    var Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2, hbp;
    if (C1p * C2p === 0) hbp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbp = (h1p + h2p + 360) / 2;
    else hbp = (h1p + h2p - 360) / 2;
    var T = 1 - 0.17 * cosd(hbp - 30) + 0.24 * cosd(2 * hbp) + 0.32 * cosd(3 * hbp + 6) - 0.20 * cosd(4 * hbp - 63);
    var dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
    var Cbp7 = Math.pow(Cbp, 7);
    var RC = 2 * Math.sqrt(Cbp7 / (Cbp7 + 6103515625));
    var Lm = (Lbp - 50) * (Lbp - 50);
    var SL = 1 + 0.015 * Lm / Math.sqrt(20 + Lm), SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
    var RT = -Math.sin(2 * dTheta * DEG) * RC;
    var tL = dLp / SL, tC = dCp / SC, tH = dHp / SH;
    return Math.sqrt(tL * tL + tC * tC + tH * tH + RT * tC * tH);
  }

  /* Individual Typology Angle (skin depth), degrees */
  function ita(lab) { return Math.atan2(lab[0] - 50, lab[2]) / DEG; }

  /* ------------------------------------------------------------------ */
  /* sRGB gamut: maximum chroma for a given lightness and hue            */
  /* ------------------------------------------------------------------ */
  var gamutCache = new Map();
  function maxChroma(L, h) {
    if (L <= 0.05 || L >= 99.95) return 0;
    var key = Math.round(L * 20) + '|' + Math.round(wrap360(h) * 10);
    var hit = gamutCache.get(key);
    if (hit !== undefined) return hit;
    var lo = 0, hi = 200;
    for (var i = 0; i < 26; i++) {
      var mid = (lo + hi) / 2;
      if (labInGamut(lchToLab(L, mid, h), 1e-6)) lo = mid; else hi = mid;
    }
    if (gamutCache.size > 200000) gamutCache.clear();
    gamutCache.set(key, lo);
    return lo;
  }

  /* ------------------------------------------------------------------ */
  /* Sampling a patch of pixels (eyedropper)                             */
  /* ------------------------------------------------------------------ */
  /*
   * data: RGBA Uint8ClampedArray, w/h: image size, (cx, cy): centre in pixels,
   * r: radius in pixels, kind: 'fabric' | 'white'.
   * Fabric: specular highlights are dropped, then the darkest 20% (weave
   * shadows) and brightest 20% are trimmed and the rest averaged in linear
   * light. White: clipped pixels are dropped when possible and the brighter
   * body of the reference is averaged.
   */
  function samplePatch(data, w, h, cx, cy, r, kind) {
    r = Math.max(1.5, r);
    var x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
    var y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
    var r2 = r * r, px = [];
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r2) continue;
        var i = (y * w + x) * 4;
        var R = data[i], G = data[i + 1], B = data[i + 2];
        var lr = LIN8[R], lg = LIN8[G], lb = LIN8[B];
        px.push({ r: lr, g: lg, b: lb, Y: 0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb, max: Math.max(R, G, B) });
      }
    }
    var n = px.length;
    if (!n) return null;
    var clipLimit = kind === 'white' ? 252 : 250;
    var unclipped = px.filter(function (p) { return p.max < clipLimit; });
    var clippedFrac = 1 - unclipped.length / n;
    var pool = unclipped.length >= Math.max(4, n * (kind === 'white' ? 0.3 : 0.25)) ? unclipped : px;
    pool.sort(function (a, b) { return a.Y - b.Y; });
    var loQ = kind === 'white' ? 0.4 : 0.2, hiQ = kind === 'white' ? 0.97 : 0.8;
    var s = Math.floor(pool.length * loQ), e = Math.max(s + 1, Math.ceil(pool.length * hiQ));
    var kept = pool.slice(s, e);
    var sr = 0, sg = 0, sb = 0;
    kept.forEach(function (p) { sr += p.r; sg += p.g; sb += p.b; });
    var lin = [sr / kept.length, sg / kept.length, sb / kept.length];

    // Uniformity: is this one colour or a print / mix of colours?
    var meanLab = xyzToLab(linearToXyz(lin));
    var abD = [], Ls = [];
    kept.forEach(function (p) {
      var lab = xyzToLab(linearToXyz([p.r, p.g, p.b]));
      abD.push(Math.hypot(lab[1] - meanLab[1], lab[2] - meanLab[2]));
      Ls.push(lab[0]);
    });
    abD.sort(function (a, b) { return a - b; });
    Ls.sort(function (a, b) { return a - b; });
    var q = function (arr, t) { return arr[Math.min(arr.length - 1, Math.floor(arr.length * t))]; };
    var abSpread = q(abD, 0.8);
    var lSpread = q(Ls, 0.9) - q(Ls, 0.1);
    var mixed = kind === 'fabric' && (abSpread > Math.max(9, 0.35 * Math.hypot(meanLab[1], meanLab[2])) || lSpread > 26);

    return {
      lin: lin, n: n, kept: kept.length, clippedFrac: clippedFrac,
      abSpread: abSpread, lSpread: lSpread, mixed: mixed,
      rawLab: meanLab, rawHex: rgb8ToHex(linearToRgb8(lin))
    };
  }

  /* ------------------------------------------------------------------ */
  /* White-reference calibration                                         */
  /* ------------------------------------------------------------------ */
  var BRADFORD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
  var BRADFORD_INV = mat3inv(BRADFORD);
  var REF_Y = { white: 0.86, grey: 0.18 }; // white paper ≈ L* 94, 18 % grey card ≈ L* 50

  function adaptationMatrix(srcXYZ, dstXYZ) {
    var s = mat3vec(BRADFORD, srcXYZ), d = mat3vec(BRADFORD, dstXYZ);
    var D = [[d[0] / s[0], 0, 0], [0, d[1] / s[1], 0], [0, 0, d[2] / s[2]]];
    return mat3mul(BRADFORD_INV, mat3mul(D, BRADFORD));
  }

  function describeCast(lab) {
    var C = Math.hypot(lab[1], lab[2]);
    if (C < 3) return { label: 'Neutral light', tone: 'neutral', strength: 'none', C: C };
    var h = wrap360(Math.atan2(lab[2], lab[1]) / DEG);
    var tone = (h >= 40 && h < 125) ? 'warm' : (h >= 125 && h < 200) ? 'green' : (h >= 200 && h < 300) ? 'cool' : 'pink';
    var strength = C < 7 ? 'slight' : C < 15 ? 'clear' : 'strong';
    var name = { warm: 'Warm light', cool: 'Cool light', green: 'Greenish light', pink: 'Pinkish light' }[tone];
    var prefix = strength === 'slight' ? 'Slightly ' + name.toLowerCase() : strength === 'strong' ? 'Strong ' + name.toLowerCase() : name;
    return { label: prefix + ' detected', tone: tone, strength: strength, C: C, h: h };
  }

  /* Brightness of the brightest areas in the photo (99th percentile of luminance) */
  function brightReference(data, w, h) {
    var step = Math.max(1, Math.floor(Math.sqrt(w * h / 60000))), Ys = [];
    for (var y = 0; y < h; y += step) for (var x = 0; x < w; x += step) {
      var i = (y * w + x) * 4;
      if (Math.max(data[i], data[i + 1], data[i + 2]) >= 250) continue; // ignore blown highlights and lamps
      Ys.push(0.2126729 * LIN8[data[i]] + 0.7151522 * LIN8[data[i + 1]] + 0.0721750 * LIN8[data[i + 2]]);
    }
    Ys.sort(function (a, b) { return a - b; });
    return Ys[Math.min(Ys.length - 1, Math.floor(Ys.length * 0.99))] || 1;
  }

  function analyseWhite(sample, refType, brightY) {
    refType = refType === 'grey' ? 'grey' : 'white';
    var xyz = linearToXyz(sample.lin), lab = xyzToLab(xyz);
    var C = Math.hypot(lab[1], lab[2]);
    var res = { ok: true, level: 'good', refType: refType, xyz: xyz, lab: lab, hex: sample.rawHex, clippedFrac: sample.clippedFrac, message: '' };
    if (refType === 'white' && lab[0] < 35) {
      res.ok = false; res.level = 'error';
      res.message = 'Too dark to be a white reference. Tap a brighter white area.';
    } else if (refType === 'grey' && (lab[0] < 15 || lab[0] > 85)) {
      res.ok = false; res.level = 'error';
      res.message = lab[0] > 85 ? 'This looks white, not grey. Switch to White, or tap the grey card.' : 'Too dark for a grey card. Tap the card itself.';
    } else if (C > 32) {
      res.ok = false; res.level = 'error';
      res.message = "This doesn't look white or grey. Tap a plain white area.";
    } else if (refType === 'white' && brightY && xyz[1] < 0.8 * brightY && C > 14) {
      res.ok = false; res.level = 'error';
      res.message = 'This looks coloured, and the photo has brighter, whiter areas. Tap the white tag itself.';
    } else if (refType === 'white' && brightY && xyz[1] < 0.45 * brightY) {
      res.level = 'warn';
      res.message = 'Is this really white? Parts of the photo are much brighter.';
    } else if (sample.clippedFrac > 0.6) {
      res.level = 'warn';
      res.message = 'This white is overexposed, so the correction is only partial.';
    } else if (C > 20) {
      res.level = 'warn';
      res.message = 'Very strong colour cast. Make sure this really is white.';
    }
    res.cast = describeCast(lab);
    return res;
  }

  function makeCalibration(white) {
    var y = REF_Y[white.refType] || REF_Y.white;
    var dst = [D65[0] * y, D65[1] * y, D65[2] * y];
    return {
      matrix: adaptationMatrix(white.xyz, dst),
      refType: white.refType,
      level: white.level,
      cast: white.cast,
      refHex: white.hex,
      quality: white.level === 'good' ? 1 : 0.6
    };
  }

  /* Raw sample (linear sRGB) → corrected CIELAB */
  function correctSample(lin, calib) {
    var xyz = linearToXyz(lin);
    if (calib) xyz = mat3vec(calib.matrix, xyz);
    xyz = [Math.max(0, xyz[0]), Math.max(0, xyz[1]), Math.max(0, xyz[2])];
    return xyzToLab(xyz);
  }

  /* ------------------------------------------------------------------ */
  /* The person model                                                    */
  /* ------------------------------------------------------------------ */
  function buildPerson(p) {
    var skin = hexToLab(p.skin), hair = hexToLab(p.hair), eyes = hexToLab(p.eyes);
    var skinL = labToLch(skin), eyesL = labToLch(eyes);
    var natural = skin[0] - Math.min(hair[0], eyes[0]);
    var level = natural >= 35 ? 'high' : natural >= 20 ? 'medium' : 'low';
    var depth = p.depth === undefined ? 0.8 : p.depth;
    var shift = (0.8 - depth) * 25; // lighter seasons move the ideal band up
    var depthCurve = [[0, 62], [8, 68], [14, 88], [18, 100], [46, 100], [56, 84], [64, 66], [72, 48], [80, 36], [88, 30], [100, 26]]
      .map(function (pt, i, arr) { return [i === 0 || i === arr.length - 1 ? pt[0] : clamp(pt[0] + shift, 1, 99), pt[1]]; });
    var chroma = p.chroma === undefined ? 0.2 : p.chroma;
    return {
      skin: skin, hair: hair, eyes: eyes,
      skinHex: p.skin, hairHex: p.hair, eyesHex: p.eyes,
      skinLch: skinL, eyesLch: eyesL,
      ita: ita(skin),
      naturalContrast: natural, contrastLevel: level,
      contrastTarget: clamp(natural * 0.6, 12, 30),
      undertone: p.undertone === undefined ? 0.3 : p.undertone,
      olive: p.olive || 0,
      depth: depth, depthCurve: depthCurve,
      chromaLo: 0.34 + 0.2 * chroma, chromaHi: 0.74 + 0.2 * chroma,
      secondaryWeight: p.secondaryWeight === undefined ? 0.5 : p.secondaryWeight,
      palette: (p.palette || []).map(function (s) { return { name: s.name, hex: s.hex, weight: s.weight, lab: hexToLab(s.hex) }; }),
      avoid: (p.avoid || []).map(function (s) { return { name: s.name, hex: s.hex, lab: hexToLab(s.hex) }; }),
      label: p.label || ''
    };
  }

  /* ------------------------------------------------------------------ */
  /* Factors                                                             */
  /* ------------------------------------------------------------------ */
  /*
   * Colour temperature of a hue, -1 (cool, blue-based) … +1 (warm, yellow-
   * based), following colour-analysis convention: golden/orange is the warm
   * pole, blue the cool pole, true red and teal sit near neutral, and within
   * each family the yellow-leaning version is warmer than the blue-leaning one.
   */
  var WARMTH = [[0, -0.45], [15, -0.2], [25, 0.0], [40, 0.35], [55, 0.85], [75, 1.0], [95, 0.95], [110, 0.8], [140, 0.4],
    [170, 0.1], [195, -0.15], [215, -0.45], [250, -0.8], [285, -1.0], [300, -0.95], [330, -0.7], [345, -0.62], [360, -0.45]];
  function warmthIndex(h) { return piecewise(wrap360(h), WARMTH); }

  var WEIGHTS = { depth: 0.30, undertone: 0.22, chroma: 0.13, separation: 0.14, contrast: 0.12, harmony: 0.09 };
  var POWER = -3; // weighted power mean: low factors pull the total down hard

  // How much a colour reads as a light neutral (white, ivory, cream) rather than a pastel, 0…1.
  // Warm off-whites (cream, ivory) are allowed more chroma than cool or pink tints.
  function lightNeutrality(lch) {
    var warmish = band(lch.h, 55, 105, 45);
    var n = clamp01((14 - lch.C) / 12) * (1 - warmish) + clamp01((34 - lch.C) / 16) * warmish;
    return n * band(lch.L, 87, 100, 11);
  }

  function factorDepth(lch, person) {
    var curve = piecewise(lch.L, person.depthCurve);
    // Light neutrals (ivory, cream, white) are the season's highlight colours, not pastels
    var floor = 58 * lightNeutrality(lch);
    return { score: Math.max(curve, floor), lightNeutral: floor > curve };
  }

  function factorUndertone(lch, person) {
    var W = warmthIndex(lch.h), s = lch.C / (lch.C + 18), E = W * s;
    var dev = E - person.undertone, adev = Math.abs(dev);
    var m = 0.45 + 0.55 * clamp01((lch.L - 15) / 45); // temperature reads less in very dark colours
    var T;
    if (adev <= 0.25) T = 100;
    else if (adev <= 0.45) T = 100 - 50 * (adev - 0.25);
    else T = 90 - 130 * (adev - 0.45) * m;
    // Olive skin: yellow-greens at skin-level lightness bring out sallowness
    var olive = person.olive * band(lch.h, 95, 135, 15) * band(lch.L, 48, 80, 8) * clamp01((lch.C - 10) / 15);
    T -= 22 * olive;
    return { score: clamp(T, 15, 100), W: W, E: E, dev: dev, olive: olive };
  }

  var cuspCache = new Map();
  function cuspChroma(h) {
    h = wrap360(h);
    var h0 = Math.floor(h), t = h - h0;
    return cuspAt(h0) * (1 - t) + cuspAt((h0 + 1) % 360) * t;
  }
  function cuspAt(hInt) {
    var key = hInt;
    var hit = cuspCache.get(key);
    if (hit !== undefined) return hit;
    var best = 0, bestL = 50, L;
    for (L = 2; L <= 98; L += 2) { var c = maxChroma(L, key); if (c > best) { best = c; bestL = L; } }
    for (L = bestL - 2; L <= bestL + 2; L += 0.5) { var c2 = maxChroma(L, key); if (c2 > best) best = c2; }
    cuspCache.set(key, best);
    return best;
  }

  function smoothMaxChroma(L, h) {
    return (2 * maxChroma(L, h) + maxChroma(Math.max(0.1, L - 1.5), h) + maxChroma(Math.min(99.9, L + 1.5), h) +
      maxChroma(L, h - 3) + maxChroma(L, h + 3)) / 6;
  }

  function factorChroma(lch, person) {
    var Cmax = smoothMaxChroma(lch.L, lch.h);
    var relL = Cmax > 0.5 ? clamp(lch.C / Cmax, 0, 1.2) : 0;
    var relCusp = lch.C / Math.max(1, cuspChroma(lch.h));
    // Near-white yellows sit on a sharp corner of the sRGB gamut, so lean on the
    // hue's overall maximum there to keep the score smooth.
    var wL = 0.5 * (1 - 0.8 * clamp01((lch.L - 80) / 12));
    var rel = wL * relL + (1 - wL) * clamp(relCusp, 0, 1.2);
    var lo = person.chromaLo, hi = person.chromaHi, chromatic, kind = 'rich';
    if (rel < lo) {
      var under = (lo - rel) / lo, lf = clamp01((lch.L - 28) / 40);
      chromatic = 100 - 100 * under * (0.2 + 0.8 * lf);
      kind = lch.L < 35 ? 'deep-neutral' : 'muted';
    } else if (rel > hi) {
      var over = clamp01((rel - hi) / (1 - hi)), bf = clamp01((lch.L - 35) / 30);
      chromatic = 100 - 80 * over * (0.3 + 0.7 * bf);
      kind = 'vivid';
    } else chromatic = 100;
    var neon = clamp01((lch.C - 70) / 16) * clamp01((lch.L - 50) / 10) * clamp01((relL - 0.8) / 0.1);
    if (neon > 0) { chromatic = chromatic * (1 - neon) + Math.min(chromatic, 35) * neon; if (neon > 0.5) kind = 'neon'; }
    // Near-neutrals are judged as neutrals, not as "muted colours"
    var neutral = piecewise(lch.L, [[0, 92], [30, 95], [40, 76], [48, 52], [72, 45], [86, 66], [100, 82]]);
    var t = clamp01((lch.C - 4) / 6); // 0 = neutral, 1 = chromatic
    t = Math.min(t, 1 - lightNeutrality(lch)); // cream and ivory are light neutrals even with some chroma
    if (t < 1 && kind !== 'neon' && kind !== 'vivid') kind = lch.L < 35 ? 'deep-neutral' : lch.L > 85 ? 'light-neutral' : 'mid-neutral';
    if (t > 0.5 && (kind === 'deep-neutral' || kind === 'light-neutral' || kind === 'mid-neutral')) kind = rel < lo ? (lch.L < 35 ? 'deep-neutral' : 'muted') : 'rich';
    return { score: clamp(neutral * (1 - t) + chromatic * t, 5, 100), rel: rel, kind: kind, Cmax: Cmax };
  }

  function factorSeparation(lab, person) {
    var d = deltaE00(lab, person.skin);
    // Lighter "nude" shades in the skin's own hue family wash out more than
    // slightly deeper ones (which read as tonal), so they count as closer.
    var lighter = clamp01((lab[0] - person.skin[0]) / 6);
    var nude = 1 - lighter * 0.15 * (1 - clamp01(hueDiff(labToLch(lab).h, person.skinLch.h) / 60));
    var dEff = d * nude;
    return { score: 15 + 85 * smooth((dEff - 6) / 20), dE: d };
  }

  function factorContrast(lch, person) {
    // Value contrast against the skin, plus colour contrast when the garment is
    // clearly more saturated than the skin (a rich mustard still lifts a face
    // of the same lightness; a beige of the same lightness does not).
    var dL = Math.abs(lch.L - person.skin[0]), t = person.contrastTarget;
    var dC = clamp(lch.C - person.skinLch.C, 0, 30);
    var eff = Math.sqrt(dL * dL + 0.25 * dC * dC);
    return { score: eff >= t ? 100 : 25 + 75 * Math.pow(eff / t, 1.3), dL: dL, eff: eff };
  }

  function factorHarmony(lab, lch, person) {
    var dEyes = deltaE00(lab, person.eyes), dHair = deltaE00(lab, person.hair);
    var dEcho = Math.min(dEyes, dHair);
    var echo = clamp01((24 - dEcho) / 16);
    var comp = wrap360(person.eyesLch.h + 180);
    var pop = 0.75 * Math.pow(Math.max(0, cosd(hueDiff(lch.h, comp))), 3) * clamp01(lch.C / 25) * clamp01((70 - lch.L) / 25);
    var analog = 0.85 * Math.pow(Math.max(0, cosd(hueDiff(lch.h, person.skinLch.h))), 4) *
      clamp01((person.skin[0] - lch.L - 10) / 20) * clamp01(lch.C / 20);
    var best = Math.max(echo, pop, analog);
    var kind = best < 0.15 ? 'neutral' : best === echo ? (dEyes <= dHair ? 'echo-eyes' : 'echo-hair') : best === pop ? 'pop' : 'analog';
    return { score: 60 + 40 * best, kind: kind, echo: echo, pop: pop, analog: analog };
  }

  function paletteCheck(lab, person) {
    var bonus = 0, near = null, nearD = Infinity, avoidSw = null, avoidD = Infinity;
    person.palette.forEach(function (sw) {
      var d = deltaE00(lab, sw.lab), b = sw.weight * 5 * clamp01((10 - d) / 7);
      if (b > bonus) bonus = b;
      if (d < nearD) { nearD = d; near = sw; }
    });
    person.avoid.forEach(function (sw) {
      var d = deltaE00(lab, sw.lab);
      if (d < avoidD) { avoidD = d; avoidSw = sw; }
    });
    return {
      bonus: bonus, near: near, nearD: nearD,
      avoid: avoidSw, avoidD: avoidD, avoidPenalty: 16 * clamp01((10 - avoidD) / 6)
    };
  }

  /* Core score of a colour, full detail */
  function scoreLab(lab, person) {
    var lch = labToLch(lab);
    var f = {
      depth: factorDepth(lch, person),
      undertone: factorUndertone(lch, person),
      chroma: factorChroma(lch, person),
      separation: factorSeparation(lab, person),
      contrast: factorContrast(lch, person),
      harmony: factorHarmony(lab, lch, person)
    };
    var acc = 0;
    Object.keys(WEIGHTS).forEach(function (key) {
      acc += WEIGHTS[key] * Math.pow(Math.max(5, f[key].score), POWER);
    });
    var model = Math.pow(acc, 1 / POWER);
    var pal = paletteCheck(lab, person);
    var total = model + pal.bonus - pal.avoidPenalty;
    // Safety caps (continuous, so a tiny change in the reading can't flip the verdict)
    var caps = [];
    var avoidCap = 62 + 40 * clamp01((pal.avoidD - 4) / 4);       // ΔE00 ≤ 4 from an avoid colour → at most 62
    var minCore = Math.min(f.depth.score, f.undertone.score, f.separation.score);
    var coreCap = 64 + 40 * clamp01((minCore - 35) / 10);          // a core factor below 35 → at most 64
    if (avoidCap < total) { total = avoidCap; caps.push('avoid'); }
    if (coreCap < total) { total = coreCap; caps.push('core'); }
    if (total > 88) total = 88 + (total - 88) * 0.6;
    return { lab: lab, lch: lch, factors: f, model: model, palette: pal, caps: caps, score: clamp(total, 0, 100) };
  }

  function quickScore(lab, person) { return scoreLab(lab, person).score; }

  /* Score range under measurement uncertainty */
  var UNCERTAINTY = {
    calibrated: { L: 2.5, a: 1.5, b: 2.5 },
    partial: { L: 5, a: 2.5, b: 4.5 },
    uncalibrated: { L: 8, a: 3, b: 7 }
  };
  function scoreRange(lab, person, level) {
    var u = UNCERTAINTY[level] || UNCERTAINTY.uncalibrated;
    var deltas = [[u.L, 0, 0], [-u.L, 0, 0], [0, u.a, 0], [0, -u.a, 0], [0, 0, u.b], [0, 0, -u.b],
      [u.L * 0.7, 0, u.b * 0.7], [-u.L * 0.7, 0, u.b * 0.7], [u.L * 0.7, 0, -u.b * 0.7], [-u.L * 0.7, 0, -u.b * 0.7]];
    var base = quickScore(lab, person), lo = base, hi = base;
    deltas.forEach(function (d) {
      var s = quickScore([clamp(lab[0] + d[0], 0, 100), lab[1] + d[1], lab[2] + d[2]], person);
      if (s < lo) lo = s; if (s > hi) hi = s;
    });
    return { lo: lo, hi: hi, base: base };
  }

  /* Closest colour in the same family that would suit you clearly better */
  function suggest(lab, person, baseScore) {
    if (baseScore >= 88) return null;
    var lch = labToLch(lab);
    var need = Math.max(baseScore + 6, 78);
    var hues = lch.C < 6 ? [30, 50, 70, 95, 200, 230] : [-24, -16, -8, 0, 8, 16, 24].map(function (d) { return wrap360(lch.h + d); });
    function search(Ls, Cstep, hueList, Cmin, Cmax) {
      var best = null;
      hueList.forEach(function (h) {
        Ls.forEach(function (L) {
          var top = Math.min(Cmax, maxChroma(L, h) * 0.98);
          for (var C = Cmin; C <= top + 1e-9; C += Cstep) {
            var cand = lchToLab(L, C, h);
            var s = quickScore(cand, person);
            if (s < need) continue;
            var obj = s - 0.55 * deltaE00(lab, cand);
            if (!best || obj > best.obj) best = { lab: cand, score: s, obj: obj, L: L, C: C, h: h };
          }
        });
      });
      return best;
    }
    var Ls = [];
    for (var L = Math.max(6, lch.L - 42); L <= Math.min(95, lch.L + 30); L += 3) Ls.push(L);
    var Cmax = lch.C < 6 ? 22 : 95;
    var Cmin = lch.C < 6 ? 0 : Math.max(8, 0.35 * lch.C);
    var best = search(Ls, 4, hues, Cmin, Cmax);
    if (!best) return null;
    // refine around the coarse winner
    var fineL = [], fineH = [];
    for (var dl = -3; dl <= 3; dl += 1) fineL.push(clamp(best.L + dl, 4, 96));
    for (var dh = -6; dh <= 6; dh += 3) fineH.push(wrap360(best.h + dh));
    var fine = search(fineL, 1.5, fineH, Math.max(Cmin, best.C - 8), best.C + 8) || best;
    var rgb = labToRgb8(fine.lab);
    var finalLab = hexToLab(rgb8ToHex(rgb)); // snap to a real displayable colour
    var finalScore = quickScore(finalLab, person);
    if (finalScore < need - 1) return null;
    return { lab: finalLab, hex: rgb8ToHex(rgb), rgb: rgb, score: finalScore };
  }

  /* ------------------------------------------------------------------ */
  /* Words                                                               */
  /* ------------------------------------------------------------------ */
  function colourName(lab) {
    var c = labToLch(lab), L = c.L, C = c.C, h = c.h;
    var rel = C / Math.max(1, maxChroma(L, h));
    var warm = warmthIndex(h) * (C / (C + 18));
    if (C < 5 || (C < 8 && L < 18)) {
      var tint = C >= 2.5 ? (warm > 0.05 ? 'warm' : warm < -0.05 ? 'cool' : '') : '';
      if (L < 12) return tint === 'warm' ? 'warm black' : 'black';
      if (L < 32) return (tint ? tint + ' ' : '') + 'charcoal';
      if (L < 62) return tint === 'warm' ? 'taupe grey' : tint === 'cool' ? 'cool grey' : 'grey';
      if (L < 85) return tint === 'warm' ? 'stone' : tint === 'cool' ? 'pale cool grey' : 'light grey';
      return tint === 'warm' ? 'ivory' : tint === 'cool' ? 'icy white' : 'white';
    }
    var neon = C > 80 && L > 50 && rel > 0.85;
    var pastel = L > 78 && C < 40;
    var dusty = rel < 0.33 && L >= 40;
    var name;
    // light warm neutrals
    if (L > 84 && C < 24 && h >= 55 && h < 115) return C < 10 ? 'ivory' : 'cream';
    // browns: dark, or low chroma, in the red-orange-yellow range
    if (h >= 20 && h < 85 && (h >= 42 || rel < 0.62) && ((L < 38 && C < 45) || (L < 52 && C < 26))) {
      if (L < 20) return 'espresso';
      if (L < 30) return 'chocolate brown';
      if (h >= 68) return L < 40 ? 'dark bronze' : 'bronze brown';
      return h < 45 ? 'chestnut brown' : 'brown';
    }
    if (h >= 45 && h < 90 && L >= 48 && L < 84 && C < 34) return L < 70 ? 'camel' : L < 78 ? 'tan' : 'beige';
    if (h < 15 || h >= 345) name = L > 75 ? 'pink' : L > 50 ? (C > 55 ? 'raspberry' : 'rose') : L > 30 ? 'cranberry' : 'wine';
    else if (h < 30) name = L > 75 ? 'pink' : L > 55 ? (C > 50 ? 'coral red' : 'dusty rose') : L > 38 ? 'red' : L > 25 ? 'burgundy' : 'oxblood';
    else if (h < 50) name = L > 75 ? 'peach' : L > 55 ? 'coral' : L > 40 ? (C > 55 ? 'tomato red' : h < 42 ? 'brick red' : 'terracotta') : 'brick';
    else if (h < 60) name = L > 75 ? 'peach' : L > 58 ? 'apricot' : L > 42 ? (C > 52 ? 'burnt orange' : 'terracotta') : 'rust';
    else if (h < 72) name = L > 76 ? 'apricot' : L > 60 ? 'orange' : L > 38 ? 'copper' : 'rust';
    else if (h < 78) name = L > 80 ? 'apricot' : L > 62 ? 'amber' : 'bronze';
    else if (h < 100) name = L > 85 ? 'butter yellow' : L > 70 ? (C > 60 ? 'yellow' : 'gold') : L > 50 ? 'mustard' : 'old gold';
    else if (h < 125) name = L > 82 ? 'pale lime' : L > 60 ? (C > 45 ? 'lime' : 'khaki') : L > 38 ? (C > 60 ? 'moss green' : 'olive') : 'dark olive';
    else if (h < 165) name = L > 80 ? 'mint' : L > 60 ? (C > 40 ? 'bright green' : 'sage') : L > 35 ? (C > 45 ? 'emerald' : 'green') : 'forest green';
    else if (h < 210) name = L > 80 ? 'aqua' : L > 60 ? 'turquoise' : L > 38 ? 'teal' : 'deep teal';
    else if (h < 255) name = L > 78 ? 'icy blue' : L > 60 ? 'sky blue' : L > 38 ? (C > 35 ? 'cerulean blue' : 'steel blue') : 'petrol blue';
    else if (h < 300) name = L > 78 ? 'baby blue' : L > 58 ? 'periwinkle' : L > 32 ? (C > 45 ? 'royal blue' : 'denim blue') : 'navy';
    else if (h < 325) name = L > 75 ? 'lavender' : L > 55 ? 'lilac' : L > 30 ? 'purple' : 'aubergine';
    else name = L > 75 ? 'orchid pink' : L > 50 ? (C > 55 ? 'fuchsia' : 'mauve') : L > 28 ? 'magenta' : 'plum';
    if (neon) return 'neon ' + name.replace(/^(bright |pale |dusty )/, '');
    if (pastel && !/pink|peach|mint|lavender|lilac|baby|icy|aqua|butter|pale|orchid|apricot/.test(name)) return 'pastel ' + name;
    if (dusty && !/dusty|sage|khaki|steel|denim|mauve|camel|beige|olive|rose|taupe/.test(name)) return 'muted ' + name;
    return name;
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function describeColour(lab, f) {
    var name = colourName(lab), L = lab[0];
    var parts = [];
    if (!/black|charcoal|navy|espresso|chocolate|oxblood|wine|aubergine|plum|forest|petrol|deep|dark/.test(name)) {
      if (L < 30) parts.push('deep');
      else if (L > 75 && !/pastel|pale|icy|baby|butter|ivory|cream|beige|tan|white|light|mint|lavender|pink|peach|apricot|aqua|lilac|orchid|stone/.test(name)) parts.push('light');
    }
    var E = f.undertone.E;
    if (labToLch(lab).C >= 8 && !/neon/.test(name)) {
      if (E > 0.38) parts.push('warm'); else if (E < -0.25) parts.push('cool');
    }
    return (parts.length ? parts.join(', ') + ' ' : '') + name;
  }

  function factorTexts(r, person) {
    var f = r.factors, lch = r.lch, out = {};
    var d = f.depth.score, L = lch.L;
    out.depth = f.depth.lightNeutral ? 'Light neutral' : d >= 92 ? 'Right depth' : L < 14 ? 'Very dark' : L < 50 ? 'Deep' : L < 62 ? 'Bit light' : L < 76 ? 'Too light' : 'Too pale';
    var u = f.undertone;
    if (u.olive > 0.35) out.undertone = 'Sallow risk';
    else if (u.score >= 85) out.undertone = u.E > 0.2 ? 'Warm on warm' : u.E < -0.12 ? 'Cool, but fine' : 'Neutral, safe';
    else if (u.score >= 60) out.undertone = u.dev > 0 ? 'Bit golden' : 'Leans cool';
    else out.undertone = u.dev > 0 ? 'Too golden' : 'Too cool';
    var c = f.chroma;
    out.chroma = c.kind === 'neon' ? 'Too neon'
      : c.kind === 'vivid' ? (c.score >= 75 ? 'Bit bright' : c.score >= 55 ? 'Bright' : 'Too bright')
      : c.kind === 'deep-neutral' ? 'Deep neutral'
      : c.kind === 'light-neutral' ? 'Light neutral'
      : c.kind === 'mid-neutral' ? (c.score >= 75 ? 'Soft neutral' : 'Flat grey')
      : c.kind === 'muted' ? (c.score >= 75 ? 'Bit muted' : c.score >= 55 ? 'Muted' : 'Too dusty')
      : lch.L > 75 ? 'Pastel' : 'Rich';
    var s = f.separation.score;
    out.separation = s >= 85 ? 'Clear of skin' : s >= 60 ? 'Fairly close' : 'Too close';
    var k = f.contrast.score;
    out.contrast = k >= 92 ? 'Strong' : k >= 70 ? 'Balanced' : 'Low';
    var hk = f.harmony.kind;
    out.harmony = hk === 'echo-eyes' ? 'Echoes eyes' : hk === 'echo-hair' ? 'Echoes hair' : hk === 'pop' ? 'Eyes pop' : hk === 'analog' ? 'Tonal match' : 'Neutral';
    return out;
  }

  var POSITIVE = {
    depth: function () { return 'its depth matches your deep colouring'; },
    undertone: function (r) {
      var E = r.factors.undertone.E;
      return E > 0.2 ? 'its warmth sits well with your neutral-warm undertone'
        : E < -0.12 ? 'it stays close enough to neutral for your undertone' : 'its balanced temperature suits your neutral-warm undertone';
    },
    chroma: function (r) { return /neutral/.test(r.factors.chroma.kind) ? 'it works as a clean neutral for you' : 'its richness matches your colouring'; },
    separation: function () { return "it stands apart from your skin, so you won't look washed out"; },
    contrast: function () { return 'it keeps your natural high contrast'; },
    harmony: function (r) {
      var k = r.factors.harmony.kind;
      return k === 'pop' ? 'it makes your brown eyes stand out' : k === 'analog' ? "it tones with your skin's warmth" : k === 'echo-hair' ? 'it echoes your dark hair' : 'it echoes your dark eyes and hair';
    }
  };
  var SHORT_POS = {
    depth: 'suits your depth', undertone: 'matches your undertone', chroma: 'has the right richness',
    separation: 'stands clear of your skin', contrast: 'keeps your contrast',
    harmony: function (r) { var k = r.factors.harmony.kind; return k === 'pop' ? 'makes your eyes pop' : k === 'analog' ? 'tones with your skin' : 'echoes your eyes and hair'; }
  };
  var NEGATIVE = {
    depth: function (r) {
      if (r.factors.depth.lightNeutral) return "As a light neutral it works best as a contrast piece, with something deep near your face";
      return r.lch.L < 14 ? 'Jet black can look a little harsh on you; espresso or charcoal is softer'
        : r.lch.L < 70 ? "It's a bit lighter than your best shades" : "It's much lighter than your best shades, so it can wash out your deep colouring";
    },
    undertone: function (r) {
      var u = r.factors.undertone;
      var mild = u.score >= 65;
      return u.olive > 0.35 ? 'Yellow-greens at this lightness can bring out sallowness in olive-leaning skin'
        : u.dev > 0 ? (mild ? "It's a little more golden than your undertone needs" : "It's more golden than your neutral-warm undertone needs")
        : (mild ? 'It leans slightly cool for your neutral-warm undertone' : 'It leans too cool for your neutral-warm undertone');
    },
    chroma: function (r) {
      var k = r.factors.chroma.kind;
      return k === 'neon' || k === 'vivid' ? "It's brighter than your natural colouring, so it can overpower you"
        : k === 'mid-neutral' ? 'Mid greys tend to look flat against your colouring'
        : 'It looks greyed and dusty next to your clear, deep colouring';
    },
    separation: function (r) { return r.factors.separation.score >= 55 ? "It's fairly close to your skin tone, so keep some contrast nearby" : "It's close to your skin tone, so it can wash you out"; },
    contrast: function (r) { return r.factors.contrast.score >= 55 ? "It's close to your skin's lightness, so pair it with something deeper" : 'It sits at the same lightness as your skin, which flattens your natural contrast'; },
    harmony: function () { return ''; }
  };
  var SHORT_NEG = {
    depth: function (r) { return r.lch.L < 14 ? 'is a touch harsh' : 'is too light for you'; },
    undertone: function (r) { var u = r.factors.undertone; return u.olive > 0.35 ? 'can look sallow' : u.dev > 0 ? 'is too golden' : u.score >= 65 ? 'leans a little cool' : 'leans too cool'; },
    chroma: function (r) { var k = r.factors.chroma.kind; return k === 'neon' || k === 'vivid' ? 'is too loud for you' : 'is too dusty for you'; },
    separation: 'is too close to your skin', contrast: 'flattens your contrast', harmony: 'is neutral'
  };
  function call(v, r) { return typeof v === 'function' ? v(r) : v; }

  function verdictFor(score) {
    if (score >= 85) return { band: 'excellent', title: 'Excellent match', chip: 'Wear it', tone: 'good' };
    if (score >= 75) return { band: 'very-good', title: 'Very good match', chip: 'Wear it', tone: 'good' };
    if (score >= 65) return { band: 'good', title: 'Good match', chip: 'Works', tone: 'good' };
    if (score >= 55) return { band: 'okay', title: 'Okay match', chip: 'Use with care', tone: 'warn' };
    if (score >= 45) return { band: 'weak', title: 'Weak match', chip: 'Not your best', tone: 'warn' };
    return { band: 'poor', title: 'Poor match', chip: 'Avoid near face', tone: 'bad' };
  }

  function joinWords(w) { return w.length < 2 ? w[0] : w.slice(0, -1).join(', ') + ' and ' + w[w.length - 1]; }

  function suggestionWords(from, to) {
    var a = labToLch(from), b = labToLch(to), w = [];
    if (b.L < a.L - 5) w.push('deeper'); else if (b.L > a.L + 5) w.push('lighter');
    var ra = a.C / Math.max(1, maxChroma(a.L, a.h)), rb = b.C / Math.max(1, maxChroma(b.L, b.h));
    if (rb > ra + 0.08 && b.C > a.C + 4) w.push('richer'); else if (rb < ra - 0.08 && b.C < a.C - 4) w.push('softer');
    var ea = warmthIndex(a.h) * a.C / (a.C + 18), eb = warmthIndex(b.h) * b.C / (b.C + 18);
    if (eb > ea + 0.18) w.push('warmer'); else if (eb < ea - 0.18) w.push('cooler');
    return w;
  }

  /*
   * Full evaluation for the UI.
   * opts.level: 'calibrated' | 'partial' | 'uncalibrated'; opts.mixed: boolean
   */
  function evaluate(lab, person, opts) {
    opts = opts || {};
    var level = opts.level || 'calibrated';
    var r = scoreLab(lab, person);
    var score = Math.round(r.score);
    var range = scoreRange(lab, person, level);
    var half = Math.max(1, Math.round((range.hi - range.lo) / 2));
    var texts = factorTexts(r, person);
    var verdict = verdictFor(score);

    // Rank factors for the explanation
    var keys = Object.keys(WEIGHTS);
    var POS_MIN = { depth: 94, undertone: 88, chroma: 88, separation: 88, contrast: 88, harmony: 80 };
    var pos = keys.slice().sort(function (a, b) { return r.factors[b].score * WEIGHTS[b] - r.factors[a].score * WEIGHTS[a]; })
      .filter(function (k) { return r.factors[k].score >= POS_MIN[k] && !(k === 'harmony' && r.factors.harmony.kind === 'neutral'); });
    var deficits = keys.filter(function (k) { return k !== 'harmony'; })
      .map(function (k) { return { k: k, d: (100 - r.factors[k].score) * WEIGHTS[k] }; })
      .sort(function (a, b) { return b.d - a.d; });
    var negs = deficits.filter(function (x) {
      if (x.k === 'chroma' && /deep-neutral|light-neutral/.test(r.factors.chroma.kind)) return false;
      return r.factors[x.k].score < 78 && x.d >= 2.4;
    }).slice(0, 2).map(function (x) { return x.k; });
    var neg = negs[0] || null;

    var desc = describeColour(lab, r.factors);
    var sentences = [cap(desc) + '.'];
    var nPos = score >= 75 ? 2 : score >= 60 ? 1 : 0;
    if (nPos && pos.length) {
      var p1 = call(POSITIVE[pos[0]], r), p2 = nPos > 1 && pos[1] ? call(POSITIVE[pos[1]], r) : '';
      sentences.push(cap(p1) + (p2 ? ', and ' + p2 : '') + '.');
    }
    negs.slice(0, score >= 75 ? 1 : 2).forEach(function (k) { sentences.push(call(NEGATIVE[k], r) + '.'); });
    if (r.palette.avoidD <= 6) sentences.push('It sits close to ' + r.palette.avoid.name.toLowerCase() + ', a classic colour to avoid for your season.');
    if (opts.mixed) sentences.push('This spot mixes several colours, so the reading is an average.');

    var summary = cap(desc) + (neg && score < 65
      ? ' that ' + call(SHORT_NEG[neg], r) + (negs[1] && score < 55 ? ' and ' + call(SHORT_NEG[negs[1]], r) : '') + '.'
      : pos.length ? ' that ' + call(SHORT_POS[pos[0]], r) + (pos[1] && score >= 75 ? ' and ' + call(SHORT_POS[pos[1]], r) : '') + '.'
      : '.');

    var isBlack = r.lch.L < 14 && r.lch.C < 8;
    var isLightNeutral = r.factors.depth.lightNeutral;
    var sugg = level === 'uncalibrated' || isBlack || isLightNeutral || score >= 88 ? null : suggest(lab, person, r.score);
    var tip;
    if (score >= 88) tip = 'This is one of your best shades.';
    else if (isBlack) tip = 'Espresso brown or charcoal near your face would be softer still.';
    else if (isLightNeutral) tip = r.factors.undertone.E > 0.08
      ? 'A good light neutral for you. Wear it with something deep for the contrast you suit.'
      : 'Warm ivory or cream is a kinder light neutral for you than stark or cool white.';
    else if (sugg) {
      var w = suggestionWords(lab, sugg.lab);
      tip = w.length ? 'A ' + joinWords(w) + ' version would suit you even more.' : 'A slightly adjusted version would suit you even more.';
    } else if (score < 55) tip = 'Keep it away from your face: trousers, shoes or bags work better.';
    else tip = 'Pair it with a deep colour near your face to lift it.';

    return {
      score: score, range: { lo: Math.round(range.lo), hi: Math.round(range.hi), half: half },
      level: level, mixed: !!opts.mixed,
      verdict: verdict,
      hex: labToHex(lab), rgb: labToRgb8(lab), lab: lab, lch: r.lch,
      name: colourName(lab), description: desc,
      factors: keys.map(function (k) {
        return { key: k, label: FACTOR_LABELS[k], short: FACTOR_SHORT[k], score: Math.round(r.factors[k].score), text: texts[k] };
      }),
      explanation: sentences.join(' '),
      summary: summary,
      tip: tip,
      suggestion: sugg ? { hex: sugg.hex, rgb: sugg.rgb, score: Math.round(sugg.score), name: colourName(sugg.lab) } : null,
      palette: { near: r.palette.near ? r.palette.near.name : null, nearD: r.palette.nearD, avoid: r.palette.avoid ? r.palette.avoid.name : null, avoidD: r.palette.avoidD },
      caps: r.caps,
      raw: r
    };
  }

  var FACTOR_LABELS = { depth: 'Depth', undertone: 'Undertone', chroma: 'Chroma', separation: 'Skin separation', contrast: 'Contrast', harmony: 'Eye / hair harmony' };
  var FACTOR_SHORT = { depth: 'Depth', undertone: 'Undertone', chroma: 'Chroma', separation: 'Skin sep.', contrast: 'Contrast', harmony: 'Harmony' };

  var API = {
    // conversions
    hexToRgb8: hexToRgb8, rgb8ToHex: rgb8ToHex, rgb8ToLinear: rgb8ToLinear, linearToRgb8: linearToRgb8,
    srgbToLinear: srgbToLinear, linearToSrgb: linearToSrgb,
    linearToXyz: linearToXyz, xyzToLinear: xyzToLinear, xyzToLab: xyzToLab, labToXyz: labToXyz,
    labToLch: labToLch, lchToLab: lchToLab, hexToLab: hexToLab, labToHex: labToHex, labToRgb8: labToRgb8,
    labInGamut: labInGamut, maxChroma: maxChroma, deltaE00: deltaE00, ita: ita,
    // calibration and sampling
    samplePatch: samplePatch, analyseWhite: analyseWhite, brightReference: brightReference, makeCalibration: makeCalibration,
    adaptationMatrix: adaptationMatrix, correctSample: correctSample, describeCast: describeCast, REF_Y: REF_Y,
    // scoring
    buildPerson: buildPerson, warmthIndex: warmthIndex, scoreLab: scoreLab, quickScore: quickScore,
    scoreRange: scoreRange, suggest: suggest, evaluate: evaluate, colourName: colourName, verdictFor: verdictFor,
    WEIGHTS: WEIGHTS, FACTOR_LABELS: FACTOR_LABELS, mat3vec: mat3vec, D65: D65
  };
  root.ColourEngine = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
