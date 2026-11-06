# Colour Check

A personal web app that scores how well a shirt or fabric colour suits you. Take a photo, tap something white to calibrate the lighting, tap the fabric, and get a score out of 100 with reasons.

Everything runs in your browser. The photo is decoded into a canvas on the page and never uploaded, stored or sent anywhere. The page makes no network requests at all (it uses system fonts and has no libraries).

## Files

| File | What it is |
|---|---|
| `index.html` | Page shell |
| `style.css` | Mobile layout, plus the desktop split view from 900 px wide |
| `profile.js` | **Your colour profile.** Edit this to adjust the scoring |
| `colour.js` | Colour science and the scoring engine (no dependencies) |
| `app.js` | Screens, eyedropper, loupe, calibration flow |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Offline use and "Add to Home Screen" |
| `tests/engine.test.js` | 294 automated checks (`node tests/engine.test.js`) |
| `tools/build_single.py` | Bundles everything into one HTML file (`dist/index.html`) |

## Hosting it (free)

The camera picker and offline mode need the page served over HTTPS. GitHub Pages is the simplest:

1. Create a new repository on GitHub and upload all the files in this folder (keep the folder structure).
2. Go to **Settings → Pages**, choose **Deploy from a branch**, then `main` and `/ (root)`, and save.
3. Open the link GitHub gives you on your phone and use **Add to Home Screen**. After the first visit it works offline in shops.

Netlify Drop (drag the folder onto app.netlify.com/drop) works too.

## How to use it well

- **Calibrate every photo.** Phones change white balance and exposure on every shot, so the correction is measured fresh from each photo. Tap a white price tag, receipt or white card in the same photo. A photography grey card is even better; switch to **Grey card** if you use one.
- **Tap a flat, evenly lit part of the fabric**, not a fold, a shadow or a shiny spot. Press and drag to use the magnifier.
- **Prints and stripes:** if the spot mixes colours, the app tries a smaller spot automatically. If it's still mixed, it says so rather than giving a confident verdict.
- **Skipping calibration** still gives a score, but as an estimate with a range (for example ~78 ± 8), and no colour suggestion.

## How the score works

The fabric colour is converted to CIELAB (D65) and judged on six factors, each scored 0 to 100:

| Factor | Weight | What it measures |
|---|---|---|
| Depth | 30 % | Lightness against your ideal range. Deep is your primary characteristic, so it carries the most weight. Light neutrals (cream, ivory, white) are treated as highlight colours, not pastels |
| Undertone | 22 % | Warm or cool lean of the colour (scaled by how saturated it is) against your neutral-warm undertone. Includes a small sallowness check for yellow-greens at skin-level lightness (olive influence) |
| Chroma | 13 % | Clear versus muted, relative to what that hue can reach. Penalises dusty pastels and neons, but not deep neutrals |
| Skin separation | 14 % | CIEDE2000 distance from your skin. Low means it blends in and washes you out |
| Contrast | 12 % | Value contrast against your skin, plus colour contrast when the colour is clearly richer than your skin |
| Eye / hair harmony | 9 % | Echoes your dark hair and eyes, makes your brown eyes pop (teal-blue complements), or tones with your skin |

The factors are combined with a weighted power mean (p = −3), so one bad factor pulls the score down instead of being averaged away. A reference palette then acts as an independent cross-check: core Deep Autumn colours, with Deep Winter overlap at lower weight, give a small bonus; colours close to the classic avoid list (icy pastels, neons, cool greys) get a penalty and a hard cap. All the rules change smoothly, so a tiny change in the reading can't flip the verdict.

**Calibration** uses Bradford chromatic adaptation, the standard used in ICC colour management. The colour of your white reference is mapped to D65 white at paper brightness, which corrects both the colour cast and the exposure. In testing with simulated store lighting, it brought colour error down from 5–10 ΔE00 to about 1, so the score matched the true colour within 1 point.

Verdicts: 85+ Excellent · 75 Very good · 65 Good · 55 Okay · 45 Weak · below 45 Poor.

## Editing your profile

Open `profile.js`:

- `skin`, `hair`, `eyes`: hex colours of your natural colouring.
- `undertone` (−1 cool … +1 warm), `depth` (−1 light … +1 deep), `chroma` (−1 muted … +1 clear), `olive` (0 … 1).
- `palette` and `avoid`: reference swatches. `weight` 1 marks a core colour; lower values mark secondary or overlap colours.

Run `node tests/engine.test.js --table` to see how 84 reference colours score after a change.

## Limits

Phone processing (tone curves, beauty filters) can't be reversed perfectly. Calibration removes most of the error but not all of it, which is why scores within about 5 points of each other should be treated as equal. Seasonal colour analysis is a stylist framework, not physics. Treat the score as a consistent, well-reasoned second opinion.
