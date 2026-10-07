/**
 * The decomposer, off the main thread.
 *
 * ## Honest note on whether this is needed
 *
 * It is insurance rather than necessity. The search turned out far cheaper than
 * the spec budgeted for -- the maximal-split formulation gives a two-way
 * recursion instead of a dynamic program over every cut position, so a
 * realistic board (8 x 10 cells) decomposes in about a millisecond, and a
 * deliberately absurd 48 x 48 grid of 2,304 pieces takes 54 ms end to end
 * against the spec's 2-second budget.
 *
 * It is still worth having, for two reasons that are about the product rather
 * than the algorithm. A fine-grained image import can ask for far more cells
 * than anyone would paint by hand, and a target that *fails* drags the snapper
 * through repeated searches. Neither should be able to freeze the canvas
 * mid-drag, and the cost of this file is one message type.
 *
 * ## Cancellation
 *
 * By termination, not by a flag. The search's `shouldCancel` hook cannot be
 * read across a thread boundary without a `SharedArrayBuffer`, which needs
 * cross-origin isolation headers that GitHub Pages does not serve. Terminating
 * is immediate, needs no headers, and a decomposition has no side effects to
 * unwind -- so the simple mechanism is also the correct one here.
 */

import { decompose } from '../core/decompose/decompose.js';
import { targetToPartition } from '../core/decompose/target.js';
import type { DecomposeResult, PaintTarget } from '../core/decompose/types.js';
import type { ShopProfile, Ticks } from '../core/model/types.js';

export interface DecomposeRequest {
  readonly kind: 'decompose';
  /** Echoed back, so a late reply from a superseded run can be dropped. */
  readonly id: number;
  readonly target: PaintTarget;
  readonly shop: ShopProfile;
  readonly boardThickness: Ticks;
  readonly maxStages?: number;
  readonly maxStockThickness?: Ticks;
}

export type DecomposeResponse =
  | { readonly kind: 'progress'; readonly id: number; readonly fraction: number }
  | { readonly kind: 'done'; readonly id: number; readonly result: DecomposeResult; readonly ms: number }
  | { readonly kind: 'error'; readonly id: number; readonly message: string };

/**
 * Throttle progress to roughly one message per animation frame.
 *
 * The search calls back every 64 states, which on a large target is thousands
 * of messages. Each one is a structured clone and a React render, so unthrottled
 * progress reporting costs more than the work it reports on.
 */
const PROGRESS_INTERVAL_MS = 16;

self.onmessage = (event: MessageEvent<DecomposeRequest>) => {
  const request = event.data;
  if (request.kind !== 'decompose') return;

  const started = performance.now();
  let lastReport = 0;

  try {
    const result = decompose(targetToPartition(request.target), request.shop, {
      boardThickness: request.boardThickness,
      // Spread rather than assign: under `exactOptionalPropertyTypes` an
      // explicit `undefined` is not the same as an absent key.
      ...(request.maxStages === undefined ? {} : { maxStages: request.maxStages }),
      ...(request.maxStockThickness === undefined
        ? {}
        : { maxStockThickness: request.maxStockThickness }),
      onProgress: (fraction) => {
        const now = performance.now();
        if (fraction < 1 && now - lastReport < PROGRESS_INTERVAL_MS) return;
        lastReport = now;
        post({ kind: 'progress', id: request.id, fraction });
      },
    });
    post({ kind: 'done', id: request.id, result, ms: performance.now() - started });
  } catch (error) {
    // A thrown error here is a fault in the tool, not a refusal addressed to
    // the user, and the two must not arrive looking the same. The caller
    // presents this as an internal error that should be reported.
    post({
      kind: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

function post(message: DecomposeResponse): void {
  (self as unknown as { postMessage: (m: DecomposeResponse) => void }).postMessage(message);
}
