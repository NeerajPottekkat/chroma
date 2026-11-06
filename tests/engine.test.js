/* Run: node tests/engine.test.js  — exits non-zero on any failure */
'use strict';
const E = require('../colour.js');
const PROFILE = require('../profile.js');
const person = E.buildPerson(PROFILE);

let failures = 0, passes = 0;
function check(name, cond, detail) {
  if (cond) passes++;
  else { failures++; console.log('FAIL ' + name + (detail ? '  ' + detail : '')); }
}
const close = (a, b, tol) => Math.abs(a - b) <= tol;

/* 1. Reference conversions (sRGB D65 → CIELAB) */
const REF = [
  ['#FFFFFF', [100, 0, 0]],
  ['#000000', [0, 0, 0]],
  ['#FF0000', [53.2408, 80.0925, 67.2032]],
  ['#00FF00', [87.7347, -86.1827, 83.1793]],
  ['#0000FF', [32.2970, 79.1875, -107.8602]],
  ['#808080', [53.5850, 0, 0]],
  ['#FFFF00', [97.1393, -21.5537, 94.4780]]
];
REF.forEach(([hex, lab]) => {
  const got = E.hexToLab(hex);
  check('Lab ' + hex, close(got[0], lab[0], 0.02) && close(got[1], lab[1], 0.05) && close(got[2], lab[2], 0.05), got.map(v => v.toFixed(4)).join(','));
});
// Round trips
let maxRt = 0;
for (let i = 0; i < 4000; i++) {
  const rgb = [Math.random() * 256 | 0, Math.random() * 256 | 0, Math.random() * 256 | 0];
  const hex = E.rgb8ToHex(rgb);
  const back = E.labToHex(E.hexToLab(hex));
  if (back !== hex) maxRt++;
}
check('hex→Lab→hex round trip exact', maxRt === 0, maxRt + ' mismatches');

/* 2. CIEDE2000 — Sharma, Wu & Dalal (2005) supplementary test data, 34 pairs */
const SHARMA = `50.0000,2.6772,-79.7751,50.0000,0.0000,-82.7485,2.0425
50.0000,3.1571,-77.2803,50.0000,0.0000,-82.7485,2.8615
50.0000,2.8361,-74.0200,50.0000,0.0000,-82.7485,3.4412
50.0000,-1.3802,-84.2814,50.0000,0.0000,-82.7485,1.0000
50.0000,-1.1848,-84.8006,50.0000,0.0000,-82.7485,1.0000
50.0000,-0.9009,-85.5211,50.0000,0.0000,-82.7485,1.0000
50.0000,0.0000,0.0000,50.0000,-1.0000,2.0000,2.3669
50.0000,-1.0000,2.0000,50.0000,0.0000,0.0000,2.3669
50.0000,2.4900,-0.0010,50.0000,-2.4900,0.0009,7.1792
50.0000,2.4900,-0.0010,50.0000,-2.4900,0.0010,7.1792
50.0000,2.4900,-0.0010,50.0000,-2.4900,0.0011,7.2195
50.0000,2.4900,-0.0010,50.0000,-2.4900,0.0012,7.2195
50.0000,-0.0010,2.4900,50.0000,0.0009,-2.4900,4.8045
50.0000,-0.0010,2.4900,50.0000,0.0010,-2.4900,4.8045
50.0000,-0.0010,2.4900,50.0000,0.0011,-2.4900,4.7461
50.0000,2.5000,0.0000,50.0000,0.0000,-2.5000,4.3065
50.0000,2.5000,0.0000,73.0000,25.0000,-18.0000,27.1492
50.0000,2.5000,0.0000,61.0000,-5.0000,29.0000,22.8977
50.0000,2.5000,0.0000,56.0000,-27.0000,-3.0000,31.9030
50.0000,2.5000,0.0000,58.0000,24.0000,15.0000,19.4535
50.0000,2.5000,0.0000,50.0000,3.1736,0.5854,1.0000
50.0000,2.5000,0.0000,50.0000,3.2972,0.0000,1.0000
50.0000,2.5000,0.0000,50.0000,1.8634,0.5757,1.0000
50.0000,2.5000,0.0000,50.0000,3.2592,0.3350,1.0000
60.2574,-34.0099,36.2677,60.4626,-34.1751,39.4387,1.2644
63.0109,-31.0961,-5.8663,62.8187,-29.7946,-4.0864,1.2630
61.2901,3.7196,-5.3901,61.4292,2.2480,-4.9620,1.8731
35.0831,-44.1164,3.7933,35.0232,-40.0716,1.5901,1.8645
22.7233,20.0904,-46.6940,23.0331,14.9730,-42.5619,2.0373
36.4612,47.8580,18.3852,36.2715,50.5065,21.2231,1.4146
90.8027,-2.0831,1.4410,91.1528,-1.6435,0.0447,1.4441
90.9257,-0.5406,-0.9208,88.6381,-0.8985,-0.7239,1.5381
6.7747,-0.2908,-2.4247,5.8714,-0.0985,-2.2286,0.6377
2.0776,0.0795,-1.1350,0.9033,-0.0636,-0.5514,0.9082`;
SHARMA.split('\n').forEach((line, i) => {
  const v = line.split(',').map(Number);
  const d = E.deltaE00(v.slice(0, 3), v.slice(3, 6));
  const d2 = E.deltaE00(v.slice(3, 6), v.slice(0, 3));
  check('CIEDE2000 pair ' + (i + 1), close(d, v[6], 1e-4) && close(d2, v[6], 1e-4), d.toFixed(5) + ' vs ' + v[6]);
});

/* 3. Bradford adaptation */
const src = [0.7, 0.62, 0.30], dst = [0.95047 * 0.86, 0.86, 1.08883 * 0.86];
const M = E.adaptationMatrix(src, dst);
const mapped = E.mat3vec(M, src);
check('Bradford maps source white to target', mapped.every((v, i) => close(v, dst[i], 1e-9)));
const I = E.adaptationMatrix(dst, dst);
check('Bradford identity', [0, 1, 2].every(i => [0, 1, 2].every(j => close(I[i][j], i === j ? 1 : 0, 1e-9))));

/* 4. Calibration round trip under simulated store lighting
 * A camera that already white-balanced imperfectly leaves a residual cast and
 * an exposure error. We apply that to both a white tag and the fabric, then
 * correct using the tag and compare with the truth. */
function simulateCast(hex, gains, exposure) {
  const lin = E.rgb8ToLinear(E.hexToRgb8(hex));
  return lin.map((v, i) => Math.min(1, v * gains[i] * exposure));
}
const paperLin = E.xyzToLinear([0.95047 * 0.86, 0.86, 1.08883 * 0.86]);
const casts = {
  'warm 3000K residual': [1.0, 0.86, 0.62],
  'mild warm': [1.0, 0.93, 0.82],
  'cool LED': [0.86, 0.95, 1.0],
  'green fluorescent': [0.88, 1.0, 0.86]
};
const fabrics = ['#4A5028', '#6A2028', '#285050', '#B5541E', '#1F2A44', '#3B2416', '#C19A6B', '#808080', '#F1E3C3', '#9B111E'];
let worst = 0, worstName = '';
Object.entries(casts).forEach(([castName, g]) => {
  [0.55, 0.8, 1.0].forEach(exp => {
    const whiteSample = { lin: paperLin.map((v, i) => Math.min(1, v * g[i] * exp)), clippedFrac: 0, rawHex: '#FFFFFF' };
    const white = E.analyseWhite(whiteSample, 'white');
    const calib = E.makeCalibration(white);
    fabrics.forEach(hex => {
      const truth = E.hexToLab(hex);
      const seen = simulateCast(hex, g, exp);
      const corrected = E.correctSample(seen, calib);
      const d = E.deltaE00(truth, corrected);
      if (d > worst) { worst = d; worstName = castName + ' x' + exp + ' ' + hex; }
      const sTrue = E.quickScore(truth, person), sCorr = E.quickScore(corrected, person);
      check('calibrated score ' + castName + ' x' + exp + ' ' + hex, Math.abs(sTrue - sCorr) <= 6, sTrue.toFixed(1) + ' vs ' + sCorr.toFixed(1));
    });
  });
});
console.log('Calibration worst-case ΔE00 after correction: ' + worst.toFixed(2) + ' (' + worstName + ')');
check('calibration error small', worst < 4.5, worst.toFixed(2));
// White checks
check('dark white rejected', !E.analyseWhite({ lin: [0.04, 0.04, 0.04], clippedFrac: 0, rawHex: '#333' }, 'white').ok);
check('coloured white rejected', !E.analyseWhite({ lin: E.rgb8ToLinear([230, 150, 60]), clippedFrac: 0, rawHex: '' }, 'white').ok);
check('warm cast labelled', /warm/i.test(E.analyseWhite({ lin: E.rgb8ToLinear([250, 236, 205]), clippedFrac: 0, rawHex: '' }, 'white').cast.label));
check('cool cast labelled', /cool/i.test(E.analyseWhite({ lin: E.rgb8ToLinear([225, 235, 252]), clippedFrac: 0, rawHex: '' }, 'white').cast.label));
check('grey card accepted', E.analyseWhite({ lin: E.rgb8ToLinear([119, 119, 121]), clippedFrac: 0, rawHex: '' }, 'grey').ok);

/* 5. Sampling */
function makeImage(w, h, painter) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = painter(x, y); const i = (y * w + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return data;
}
const base = E.hexToRgb8('#4A5028');
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const weave = makeImage(200, 200, (x, y) => {
  const k = ((x % 4 < 2) !== (y % 4 < 2)) ? 0.82 : 1.12; // weave shading
  const spec = rnd() < 0.03 ? 3 : 1;                       // a few highlights
  return base.map(v => Math.min(255, v * k * spec + (rnd() - 0.5) * 8));
});
const s1 = E.samplePatch(weave, 200, 200, 100, 100, 16, 'fabric');
const dWeave = E.deltaE00(E.correctSample(s1.lin, null), E.hexToLab('#4A5028'));
check('weave sample close to base colour', dWeave < 4, 'ΔE00 ' + dWeave.toFixed(2));
check('weave not flagged as mixed', !s1.mixed, 'ab ' + s1.abSpread.toFixed(1) + ' L ' + s1.lSpread.toFixed(1));
const stripes = makeImage(200, 200, (x) => (Math.floor(x / 5) % 2 ? E.hexToRgb8('#B5341E') : E.hexToRgb8('#1F2A44')));
const s2 = E.samplePatch(stripes, 200, 200, 100, 100, 16, 'fabric');
check('stripes flagged as mixed', s2.mixed, 'ab ' + s2.abSpread.toFixed(1) + ' L ' + s2.lSpread.toFixed(1));
const navyWhite = makeImage(200, 200, (x) => (Math.floor(x / 5) % 2 ? [245, 245, 245] : E.hexToRgb8('#1F2A44')));
const s3 = E.samplePatch(navyWhite, 200, 200, 100, 100, 16, 'fabric');
check('navy/white stripes flagged as mixed', s3.mixed, 'ab ' + s3.abSpread.toFixed(1) + ' L ' + s3.lSpread.toFixed(1));
const tag = makeImage(60, 60, () => [255, 255, 255]);
const s4 = E.samplePatch(tag, 60, 60, 30, 30, 10, 'white');
check('clipped white measured as clipped', s4.clippedFrac > 0.9);

/* 6. Scoring sanity suite — expectations from Deep Autumn / Deep Winter references */
const SUITE = [
  // [name, hex, min, max]
  // Core Deep Autumn (also in the palette)
  ['Espresso', '#3B2416', 84, 100], ['Dark chocolate', '#4A2818', 84, 100], ['Oxblood', '#6A2028', 84, 100],
  ['Burgundy', '#681820', 84, 100], ['Rust', '#9A4A22', 82, 100], ['Brick red', '#8E3A2A', 82, 100],
  ['Dark olive', '#4A5028', 84, 100], ['Forest green', '#284B32', 82, 100], ['Deep teal', '#285050', 82, 100],
  ['Petrol', '#1D4E57', 80, 100], ['Aubergine', '#3E2338', 80, 100], ['Burnt orange', '#B5541E', 74, 100],
  ['Terracotta', '#A85A3E', 74, 100], ['Bronze', '#7F5E2E', 80, 100], ['Moss', '#5B6634', 80, 100],
  ['Marine navy', '#1F3B4A', 80, 100], ['Mahogany', '#5C2A20', 84, 100], ['Copper', '#9C5A2C', 78, 100],
  // Not in the palette, should still score well (independent check)
  ['Hunter green', '#355E3B', 76, 100], ['Saddle brown', '#8B4513', 76, 100], ['Sienna', '#A0522D', 74, 100],
  ['Maroon', '#800000', 74, 100], ['Wine', '#5B1A2C', 80, 100], ['Olive drab', '#556B2F', 76, 100],
  ['Teal', '#008080', 68, 95], ['Dark slate', '#2F4F4F', 72, 100], ['Plum', '#673147', 76, 100],
  ['Chestnut', '#6E3B2A', 80, 100], ['Dark cyan petrol', '#0E4C5A', 74, 100],
  // Deep Winter overlap: good but usually not the very best
  ['Navy', '#1F2A44', 68, 92], ['Black', '#111111', 64, 86], ['Charcoal', '#36454F', 66, 96],
  ['Emerald', '#046A38', 64, 92], ['Ruby', '#9B111E', 64, 97], ['Deep purple', '#4B1E5A', 58, 88],
  ['Bottle green', '#006A4E', 66, 92], ['Dark magenta', '#8B0A50', 55, 90],
  // Middling
  ['Mustard (bright)', '#C49102', 45, 72], ['Mustard (palette)', '#B08A1E', 58, 90], ['Old gold', '#9E7B2C', 70, 100], ['Olive', '#808000', 58, 84], ['Cobalt', '#0047AB', 42, 72],
  ['Orange', '#FF8C00', 30, 62], ['Tomato', '#FF6347', 25, 60], ['Coral', '#FF7F50', 30, 62],
  ['White', '#FFFFFF', 45, 70], ['Cream', '#F1E3C3', 52, 76], ['Ivory', '#FFFFF0', 45, 78],
  ['Taupe', '#8B8589', 40, 68], ['Denim', '#1560BD', 40, 70], ['Royal blue', '#4169E1', 30, 60],
  ['Steel blue', '#4682B4', 30, 62], ['Mid grey', '#808080', 30, 62],
  // Should be weak or poor
  ['Camel', '#C19A6B', 0, 58], ['Tan', '#D2B48C', 0, 57], ['Beige', '#D8C3A5', 0, 48],
  ['Light grey', '#BFBFBF', 0, 50], ['Silver', '#C0C0C0', 0, 45], ['Khaki', '#C3B091', 0, 57],
  ['Sage', '#9CAF88', 0, 58], ['Dusty rose', '#C9A0A0', 0, 50], ['Salmon', '#FA8072', 0, 52],
  ['Turquoise', '#40E0D0', 0, 52], ['Sky blue', '#87CEEB', 0, 45], ['Gold yellow', '#FFD700', 0, 55],
  ['Lime', '#32CD32', 0, 55],
  ['Baby pink', '#F4C2C2', 0, 40], ['Pastel pink', '#F8C8DC', 0, 35], ['Baby blue', '#A9CFEA', 0, 40],
  ['Icy blue', '#D6EFFA', 0, 35], ['Lavender', '#E6E6FA', 0, 35], ['Lilac', '#C8A2C8', 0, 45],
  ['Mint', '#BFE8D2', 0, 40], ['Peach', '#F7C6A3', 0, 40], ['Butter yellow', '#F0D878', 0, 45],
  ['Lemon', '#FFF44F', 0, 45], ['Neon pink', '#FF2E9A', 0, 45], ['Neon green', '#39FF14', 0, 40],
  ['Neon yellow', '#DFFF00', 0, 40], ['Hot pink', '#FF69B4', 0, 55], ['Electric blue', '#7DF9FF', 0, 40],
  ['Chartreuse', '#7FFF00', 0, 40], ['Fuchsia', '#FF00FF', 0, 45], ['Periwinkle', '#CCCCFF', 0, 40]
];
const rows = [];
SUITE.forEach(([name, hex, lo, hi]) => {
  const r = E.evaluate(E.hexToLab(hex), person, { level: 'calibrated' });
  rows.push([r.score, name, hex, r.raw.model, r]);
  check('score ' + name + ' ' + hex + ' in [' + lo + ',' + hi + ']', r.score >= lo && r.score <= hi, 'got ' + r.score);
});
// Independent of the palette: the model alone must already rank core colours highly
['#3B2416', '#6A2028', '#4A5028', '#285050', '#9A4A22', '#284B32', '#355E3B', '#8B4513', '#5B1A2C'].forEach(hex => {
  const r = E.scoreLab(E.hexToLab(hex), person);
  check('model-only good ' + hex, r.model >= 76, r.model.toFixed(1));
});
['#F8C8DC', '#D6EFFA', '#E6E6FA', '#FF2E9A', '#39FF14', '#D2B48C', '#C0C0C0'].forEach(hex => {
  const r = E.scoreLab(E.hexToLab(hex), person);
  check('model-only bad ' + hex, r.model <= 58, r.model.toFixed(1));
});
// Ordering checks from the research (same depth, temperature decides)
const sc = hex => E.quickScore(E.hexToLab(hex), person);
check('espresso ≥ black', sc('#3B2416') >= sc('#111111'), sc('#3B2416').toFixed(1) + ' vs ' + sc('#111111').toFixed(1));
check('cream ≥ white', sc('#F1E3C3') >= sc('#FFFFFF') - 1, sc('#F1E3C3').toFixed(1) + ' vs ' + sc('#FFFFFF').toFixed(1));
check('marine navy ≥ ink navy', sc('#1F3B4A') >= sc('#1B2238') - 1);
check('dark olive > khaki', sc('#4A5028') > sc('#C3B091') + 20);
check('brick red > coral', sc('#8E3A2A') > sc('#FF7F50') + 15);
check('burgundy > pastel pink', sc('#681820') > sc('#F8C8DC') + 40);
check('deep teal > turquoise', sc('#285050') > sc('#40E0D0') + 20);
check('charcoal > light grey', sc('#36454F') > sc('#BFBFBF') + 15);

// Suggestions exist and improve
['#C19A6B', '#808080', '#FF7F50', '#4169E1', '#F8C8DC', '#9CAF88'].forEach(hex => {
  const lab = E.hexToLab(hex), base = E.quickScore(lab, person);
  const s = E.suggest(lab, person, base);
  check('suggestion for ' + hex, !!s && s.score >= Math.max(base + 6, 78) - 1, s ? s.hex + ' ' + s.score.toFixed(1) : 'none');
});

// Uncertainty: uncalibrated range wider than calibrated
const rc = E.scoreRange(E.hexToLab('#808000'), person, 'calibrated');
const ru = E.scoreRange(E.hexToLab('#808000'), person, 'uncalibrated');
check('uncalibrated range wider', (ru.hi - ru.lo) > (rc.hi - rc.lo));


// Continuity: no hidden thresholds. A 0.1-unit nudge must move the score by
// well under 2 points (a real discontinuity would jump regardless of size).
function worstNudge(step, n) {
  let worst = 0, at = '';
  for (let i = 0; i < n; i++) {
    const rgb = [Math.random() * 256 | 0, Math.random() * 256 | 0, Math.random() * 256 | 0];
    const lab = E.hexToLab(E.rgb8ToHex(rgb));
    const a = E.quickScore(lab, person);
    const dir = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
    const len = Math.hypot(...dir);
    const b = E.quickScore(lab.map((v, k) => v + dir[k] / len * step), person);
    if (Math.abs(a - b) > worst) { worst = Math.abs(a - b); at = E.rgb8ToHex(rgb); }
  }
  return [worst, at];
}
const [j1, a1] = worstNudge(0.1, 4000);
const [j2, a2] = worstNudge(1.0, 3000);
console.log('Largest change: 0.1 nudge ' + j1.toFixed(2) + ' (' + a1 + '), 1.0 nudge ' + j2.toFixed(2) + ' (' + a2 + ')');
check('score has no jumps', j1 < 2, j1.toFixed(2));
check('score changes gently', j2 < 10, j2.toFixed(2));

// Skin model sanity
check('profile ITA is intermediate/tan (10–41°)', person.ita > 10 && person.ita < 41, person.ita.toFixed(1));
check('profile contrast is high', person.contrastLevel === 'high', person.naturalContrast.toFixed(1));

rows.sort((a, b) => b[0] - a[0]);
if (process.argv.includes('--table')) {
  rows.forEach(([s, name, hex, model, r]) => {
    const f = r.factors.map(x => x.short.slice(0, 4) + ' ' + String(x.score).padStart(3)).join('  ');
    console.log(String(s).padStart(3) + '  ' + name.padEnd(18) + hex + '  model ' + model.toFixed(0).padStart(3) + '  ' + f + '  | ' + r.verdict.title);
  });
}
if (process.argv.includes('--text')) {
  ['#4A5028', '#C19A6B', '#111111', '#FF2E9A', '#285050', '#FFFFFF', '#808080', '#4169E1'].forEach(hex => {
    const r = E.evaluate(E.hexToLab(hex), person, { level: 'calibrated' });
    console.log('\n' + hex + ' ' + r.score + ' ' + r.verdict.title + ' [' + r.verdict.chip + ']');
    console.log('  summary: ' + r.summary);
    console.log('  explain: ' + r.explanation);
    console.log('  tip:     ' + r.tip + (r.suggestion ? ' → ' + r.suggestion.hex + ' (' + r.suggestion.name + ', ~' + r.suggestion.score + ')' : ''));
    console.log('  factors: ' + r.factors.map(f => f.short + ' ' + f.score + ' ' + f.text).join(' | '));
  });
}
console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
