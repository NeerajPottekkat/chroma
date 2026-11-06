/*
 * Colour Check — personal colour profile.
 *
 * Everything the scoring engine knows about you lives in this file, so you can
 * adjust it later without touching any logic. Colours are sRGB hex values.
 *
 * Derived from: your own description (Deep Autumn, Deep Winter overlap,
 * neutral-warm undertone with a subtle olive influence, high contrast) and
 * measurements taken from your window-lit selfie (forehead, nose, neck,
 * shadowed cheek, hair and iris, then averaged and corrected for the phone's
 * brightening). Skin #BC8874 = CIELAB L* 61.3, a* 17.3, b* 18.6, hue 47°,
 * ITA 31° (medium / "intermediate", on the edge of "tan").
 */
(function (root) {
  'use strict';

  var PROFILE = {
    label: 'Deep Autumn · Deep Winter overlap',

    // Your natural colouring
    skin: '#BC8874',   // medium to medium-tan, neutral-warm
    hair: '#1F1F21',   // soft black / darkest brown, no visible warmth
    eyes: '#261E1D',   // very dark brown, slightly warm

    // Axes run from -1 to +1 (same convention as 12-season references)
    undertone: 0.30,   // -1 cool … 0 neutral … +1 warm   (neutral-warm)
    depth: 0.80,       // -1 light … +1 deep               (Deep season)
    chroma: 0.20,      // -1 muted … +1 clear              (rich, not neon)
    olive: 0.35,       //  0 none … 1 strong               (subtle olive influence)

    // How much the neighbouring season is allowed to count (0 … 1)
    secondaryWeight: 0.55,

    /*
     * Reference swatches used as an independent cross-check on the model.
     * weight 1   = core Deep Autumn colour
     * weight <1  = Deep Winter overlap or a light neutral
     */
    palette: [
      // Dark neutrals
      { name: 'Espresso',          hex: '#3B2416', weight: 1 },
      { name: 'Dark chocolate',    hex: '#4A2818', weight: 1 },
      { name: 'Bronzed black',     hex: '#241E18', weight: 1 },
      { name: 'Warm charcoal',     hex: '#3A3836', weight: 1 },
      { name: 'Marine navy',       hex: '#1F3B4A', weight: 1 },
      { name: 'Warm taupe',        hex: '#6E5B4C', weight: 0.8 },
      // Reds
      { name: 'Oxblood',           hex: '#6A2028', weight: 1 },
      { name: 'Burgundy',          hex: '#681820', weight: 1 },
      { name: 'Mahogany',          hex: '#5C2A20', weight: 1 },
      { name: 'Brick red',         hex: '#8E3A2A', weight: 1 },
      { name: 'Chili red',         hex: '#A83224', weight: 1 },
      { name: 'Terracotta',        hex: '#A85A3E', weight: 1 },
      // Oranges, golds
      { name: 'Rust',              hex: '#9A4A22', weight: 1 },
      { name: 'Burnt orange',      hex: '#B5541E', weight: 1 },
      { name: 'Copper',            hex: '#9C5A2C', weight: 1 },
      { name: 'Bronze',            hex: '#7F5E2E', weight: 1 },
      { name: 'Old gold',          hex: '#9E7B2C', weight: 1 },
      { name: 'Mustard',           hex: '#B08A1E', weight: 0.9 },
      // Greens
      { name: 'Dark olive',        hex: '#4A5028', weight: 1 },
      { name: 'Bronze olive',      hex: '#5E5A2A', weight: 1 },
      { name: 'Moss',              hex: '#5B6634', weight: 1 },
      { name: 'Forest green',      hex: '#284B32', weight: 1 },
      // Blues
      { name: 'Deep teal',         hex: '#285050', weight: 1 },
      { name: 'Petrol',            hex: '#1D4E57', weight: 1 },
      { name: 'Muted dark blue',   hex: '#2E3F5A', weight: 0.9 },
      // Purples
      { name: 'Aubergine',         hex: '#3E2338', weight: 1 },
      { name: 'Plum',              hex: '#5A2A45', weight: 1 },
      { name: 'Dark berry',        hex: '#5C1F3A', weight: 1 },
      // Light neutrals (highlights, not main colours)
      { name: 'Warm ivory',        hex: '#EFE6D2', weight: 0.7 },
      { name: 'Candlelight cream', hex: '#F1E3C3', weight: 0.7 },
      // Deep Winter overlap
      { name: 'Black',             hex: '#121212', weight: 0.55 },
      { name: 'Ink navy',          hex: '#1B2238', weight: 0.55 },
      { name: 'Emerald',           hex: '#0B5F45', weight: 0.55 },
      { name: 'Pine',              hex: '#1E4D3B', weight: 0.55 },
      { name: 'Garnet',            hex: '#7E1530', weight: 0.55 },
      { name: 'Cranberry',         hex: '#8A1C3A', weight: 0.55 },
      { name: 'Blackberry',        hex: '#3A1D35', weight: 0.55 },
      { name: 'Sapphire',          hex: '#1F3C8C', weight: 0.5 },
      { name: 'Cool charcoal',     hex: '#36393F', weight: 0.55 },
      { name: 'Crisp white',       hex: '#F7F7F5', weight: 0.3 }
    ],

    // Colours repeatedly listed as ones to avoid for Deep Autumn
    avoid: [
      { name: 'Icy pastel pink', hex: '#F4D8E0' },
      { name: 'Pastel pink',     hex: '#F8C8DC' },
      { name: 'Powder pink',     hex: '#F2C9CF' },
      { name: 'Bubble-gum pink', hex: '#FF8FC8' },
      { name: 'Icy blue',        hex: '#D6EFFA' },
      { name: 'Icy turquoise',   hex: '#A6EDE6' },
      { name: 'Baby blue',       hex: '#A9CFEA' },
      { name: 'Dusty blue',      hex: '#93A9C2' },
      { name: 'Lavender',        hex: '#E6E6FA' },
      { name: 'Dusty lavender',  hex: '#B9A9C9' },
      { name: 'Powdery lilac',   hex: '#CDB8DA' },
      { name: 'Mint',            hex: '#BFE8D2' },
      { name: 'Butter yellow',   hex: '#F0D878' },
      { name: 'Peach',           hex: '#F7C6A3' },
      { name: 'Silver grey',     hex: '#C0C0C0' },
      { name: 'Cool grey',       hex: '#A0A8B0' },
      { name: 'Icy grey',        hex: '#DCE0E5' },
      { name: 'Neon pink',       hex: '#FF2E9A' },
      { name: 'Neon green',      hex: '#4DFF3A' },
      { name: 'Neon yellow',     hex: '#E6FF2E' },
      { name: 'Electric coral',  hex: '#FF5A4E' },
      { name: 'Cool fuchsia',    hex: '#E0379A' }
    ]
  };

  root.COLOUR_PROFILE = PROFILE;
  if (typeof module !== 'undefined' && module.exports) module.exports = PROFILE;
})(typeof window !== 'undefined' ? window : globalThis);
