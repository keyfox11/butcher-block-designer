/**
 * Image import: a picture to a painted grid.
 *
 * A thin layer over the decomposer, and the spec names it the most likely
 * source of disappointment, so the funnel is deliberately explicit. Quantising
 * a photograph to three or four wood tones destroys nearly all of it. The job
 * of this module is to make that visible **before** anything is generated,
 * which is why it returns the quantised grid as data the UI can show side by
 * side with the source rather than going straight to a graph.
 *
 * Images with bold shapes and strong contrast work. Photographs do not. The
 * honest thing is to let the user see which they have.
 *
 * No DOM here. The caller does the `<canvas>` draw and hands over plain pixel
 * data, which keeps `core/` free of the browser and lets this run in a worker
 * or a test with no renderer.
 */

import { SPECIES } from '../knowledge/species.js';
import type { SpeciesId, Ticks } from '../model/types.js';
import type { PaintPiece, PaintTarget } from './types.js';

/** Pixel data as `CanvasRenderingContext2D.getImageData` hands it over. */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** RGBA, 8 bits each, row-major from the top-left. */
  readonly data: Uint8ClampedArray;
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */

export interface Oklab {
  readonly L: number;
  readonly a: number;
  readonly b: number;
}

/**
 * sRGB to linear light.
 *
 * Averaging must happen in linear light, not in sRGB. Averaging gamma-encoded
 * values biases every mixed cell dark -- the classic error -- and in a palette
 * of browns that all differ mainly in lightness, a dark bias is exactly the
 * error that picks the wrong species.
 */
function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Linear sRGB to Oklab.
 *
 * Oklab rather than raw RGB distance because the palette is wood: warm browns,
 * reds and creams clustered in one corner of RGB space. Euclidean RGB distance
 * there does not match what a person sees, so the nearest colour by that metric
 * is regularly not the nearest colour to the eye. Oklab is built to make
 * straight-line distance perceptually even, which is precisely the property
 * "nearest species" needs.
 */
export function linearToOklab(r: number, g: number, b: number): Oklab {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l3 = Math.cbrt(l);
  const m3 = Math.cbrt(m);
  const s3 = Math.cbrt(s);

  return {
    L: 0.2104542553 * l3 + 0.793617785 * m3 - 0.0040720468 * s3,
    a: 1.9779984951 * l3 - 2.428592205 * m3 + 0.4505937099 * s3,
    b: 0.0259040371 * l3 + 0.7827717662 * m3 - 0.808675766 * s3,
  };
}

export function hexToOklab(hex: string): Oklab {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }
  return linearToOklab(toLinear(r), toLinear(g), toLinear(b));
}

function distance(a: Oklab, b: Oklab): number {
  return (a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2;
}

/* -------------------------------------------------------------------------- */
/* Sampling                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Average one cell's worth of pixels, in linear light.
 *
 * The whole cell is averaged rather than point-sampled at its centre. A point
 * sample of a detailed image is noise -- move the grid by one pixel and the
 * species changes -- and the averaged version at least reports what is actually
 * there.
 */
function averageCell(
  pixels: Pixels,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { r: number; g: number; b: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;

  const left = Math.max(0, Math.floor(x0));
  const right = Math.min(pixels.width, Math.max(left + 1, Math.ceil(x1)));
  const top = Math.max(0, Math.floor(y0));
  const bottom = Math.min(pixels.height, Math.max(top + 1, Math.ceil(y1)));

  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * pixels.width + x) * 4;
      // Weight by alpha so a transparent border does not drag every edge cell
      // towards whatever the canvas was cleared to.
      const alpha = (pixels.data[i + 3] ?? 255) / 255;
      if (alpha === 0) continue;
      r += toLinear(pixels.data[i] ?? 0) * alpha;
      g += toLinear(pixels.data[i + 1] ?? 0) * alpha;
      b += toLinear(pixels.data[i + 2] ?? 0) * alpha;
      n += alpha;
    }
  }

  if (n === 0) return { r: 0, g: 0, b: 0 };
  return { r: r / n, g: g / n, b: b / n };
}

/* -------------------------------------------------------------------------- */
/* Quantisation                                                               */
/* -------------------------------------------------------------------------- */

export interface QuantiseResult {
  readonly target: PaintTarget;
  /** The averaged source colour per cell, indexed `[row * cols + col]`. */
  readonly sourceColors: readonly string[];
  /** How far each cell had to move to reach its species, in Oklab units. */
  readonly errors: readonly number[];
  /** Mean of `errors`. Above roughly 0.1 the result stops resembling the source. */
  readonly meanError: number;
  /** Cells assigned to each species, so a dominant-species warning is possible. */
  readonly usage: Readonly<Record<SpeciesId, number>>;
}

/**
 * Quantise an image onto a painted grid.
 *
 * Every cell becomes its own piece. That is deliberate: the result is a plain
 * grid, which the decomposer's banding path always accepts, so an imported
 * image never fails to build. The disappointment, where there is any, is in the
 * picture rather than in the buildability -- and that is the one the preview is
 * there to surface.
 */
export function quantiseImage(
  pixels: Pixels,
  cols: number,
  rows: number,
  cellSize: Ticks,
  palette: readonly SpeciesId[],
): QuantiseResult {
  if (cols < 1 || rows < 1) throw new Error('The target grid needs at least one cell');
  if (palette.length === 0) throw new Error('Quantising needs at least one species');

  const paletteLab = palette.map((id) => {
    const info = SPECIES[id];
    if (!info) throw new Error(`Unknown species: ${id}`);
    return { id, lab: hexToOklab(info.color), color: info.color };
  });

  const cellW = pixels.width / cols;
  const cellH = pixels.height / rows;

  const pieces: PaintPiece[] = [];
  const sourceColors: string[] = [];
  const errors: number[] = [];
  const usage: Record<SpeciesId, number> = {};

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Grid row 0 maps to the image's TOP row, matching how the 2-D canvas
      // draws y downward. Flipping here would import every picture upside down.
      const avg = averageCell(pixels, col * cellW, row * cellH, (col + 1) * cellW, (row + 1) * cellH);
      const lab = linearToOklab(avg.r, avg.g, avg.b);

      let best = paletteLab[0]!;
      let bestDistance = distance(lab, best.lab);
      for (const candidate of paletteLab.slice(1)) {
        const d = distance(lab, candidate.lab);
        if (d < bestDistance) {
          bestDistance = d;
          best = candidate;
        }
      }

      pieces.push({ col, row, cols: 1, rows: 1, species: best.id });
      sourceColors.push(toHex(avg));
      errors.push(Math.sqrt(bestDistance));
      usage[best.id] = (usage[best.id] ?? 0) + 1;
    }
  }

  return {
    target: {
      columns: Array.from({ length: cols }, () => cellSize),
      rows: Array.from({ length: rows }, () => cellSize),
      pieces,
    },
    sourceColors,
    errors,
    meanError: errors.reduce((a, b) => a + b, 0) / errors.length,
    usage,
  };
}

/** Linear light back to an sRGB hex string, for the side-by-side preview. */
function toHex(c: { r: number; g: number; b: number }): string {
  const encode = (v: number) => {
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(s * 255)))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${encode(c.r)}${encode(c.g)}${encode(c.b)}`;
}

/**
 * How well the quantised grid resembles the source, in words.
 *
 * A number in Oklab units means nothing to anyone, and the point of the preview
 * is to set expectations with a picture rather than with hope. This is the
 * caption under that picture.
 */
export function quantiseQuality(result: QuantiseResult): {
  verdict: 'good' | 'fair' | 'poor';
  note: string;
} {
  const distinct = Object.keys(result.usage).length;
  const total = result.errors.length;
  const dominant = Math.max(...Object.values(result.usage));

  if (dominant / total > 0.9) {
    return {
      verdict: 'poor',
      note: 'Almost every cell came out the same species, so the pattern has nothing left of the image. Try an image with stronger contrast, or a bolder palette.',
    };
  }
  if (result.meanError > 0.12) {
    return {
      verdict: 'poor',
      note: `The palette is a long way from these colours${distinct < 3 ? ' and only has a few tones to work with' : ''}. Expect the board to read as a pattern rather than as this picture.`,
    };
  }
  if (result.meanError > 0.07) {
    return {
      verdict: 'fair',
      note: 'The shapes should survive, the shading will not. Check the preview against the source before going on.',
    };
  }
  return {
    verdict: 'good',
    note: 'The palette covers these colours well. What the preview shows is what the board will look like.',
  };
}
