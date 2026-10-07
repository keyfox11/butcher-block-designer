/**
 * Driving the decomposer from React.
 *
 * Three jobs, and the last one is the interesting one:
 *
 * 1. Debounce, so dragging a brush across twenty cells runs one search.
 * 2. Keep the worker alive between runs, and replace it on cancel.
 * 3. **Keep the last good design.** This is the P5 lesson applied before P5:
 *    a refusal must not blank the viewport. The last graph that built stays on
 *    screen, marked stale, so "undo the last stroke" is available as a recovery
 *    rather than something the user has to reconstruct from memory.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DecomposeRequest, DecomposeResponse } from '../../app/decompose.worker.js';
import type { DecomposeFailure, PaintTarget, Refusal } from '../../core/decompose/types.js';
import type { Graph, ShopProfile, Ticks } from '../../core/model/types.js';

export interface DecomposerState {
  /** True while a search is in flight. */
  readonly running: boolean;
  readonly progress: number;
  /** The last successful decomposition, which survives a later refusal. */
  readonly graph: Graph | null;
  readonly stages: number;
  readonly glueUps: number;
  readonly panelCount: number;
  /** The target the surviving graph was built from. */
  readonly builtFrom: PaintTarget | null;
  /** Set when the current target does not build. */
  readonly refusal: Refusal | null;
  /** A buildable alternative, when the snapper found one worth offering. */
  readonly suggestion: NonNullable<DecomposeFailure['suggestion']> | null;
  /** A fault in the tool, not a refusal. Shown differently on purpose. */
  readonly internalError: string | null;
  /** Milliseconds the last completed search took. */
  readonly ms: number;
}

const IDLE: DecomposerState = {
  running: false,
  progress: 0,
  graph: null,
  stages: 0,
  glueUps: 0,
  panelCount: 0,
  builtFrom: null,
  refusal: null,
  suggestion: null,
  internalError: null,
  ms: 0,
};

/**
 * Long enough that a brush drag is one search, short enough that releasing the
 * mouse feels like it answered immediately.
 */
const DEBOUNCE_MS = 120;

export interface DecomposerOptions {
  readonly shop: ShopProfile;
  readonly boardThickness: Ticks;
  readonly maxStages?: number;
  readonly maxStockThickness?: Ticks;
  /**
   * False while the paint surface is closed.
   *
   * React hooks run unconditionally, so without this the worker -- and the
   * megabyte of module graph behind it -- would be spun up for every user who
   * never leaves the parameter panel.
   */
  readonly enabled?: boolean;
}

export function useDecomposer(target: PaintTarget, options: DecomposerOptions): DecomposerState & {
  cancel: () => void;
} {
  const [state, setState] = useState<DecomposerState>(IDLE);
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ensureWorker = useCallback((): Worker => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(new URL('../../app/decompose.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<DecomposeResponse>) => {
      const message = event.data;
      // Drop replies from a superseded run. Without this a slow search started
      // three strokes ago can overwrite the answer to the current one.
      if (message.id !== requestId.current) return;

      if (message.kind === 'progress') {
        setState((prev) => ({ ...prev, progress: message.fraction }));
        return;
      }
      if (message.kind === 'error') {
        setState((prev) => ({
          ...prev,
          running: false,
          progress: 1,
          internalError: message.message,
          refusal: null,
        }));
        return;
      }

      const result = message.result;
      setState((prev) =>
        result.ok
          ? {
              running: false,
              progress: 1,
              graph: result.graph,
              stages: result.stages,
              glueUps: result.glueUps,
              panelCount: result.panelCount,
              builtFrom: pendingTarget.current,
              refusal: null,
              suggestion: null,
              internalError: null,
              ms: message.ms,
            }
          : {
              // Everything about the last good design is carried forward. The
              // viewport keeps showing a board; only the badge changes.
              ...prev,
              running: false,
              progress: 1,
              refusal: result.refusal,
              suggestion: result.suggestion ?? null,
              internalError: null,
              ms: message.ms,
            },
      );
    };
    workerRef.current = worker;
    return worker;
  }, []);

  const pendingTarget = useRef<PaintTarget>(target);

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    if (timer.current) clearTimeout(timer.current);
    // Bump the id so any message already in flight is ignored.
    requestId.current += 1;
    setState((prev) => ({ ...prev, running: false, progress: 0 }));
  }, []);

  const enabled = options.enabled ?? true;

  useEffect(() => {
    pendingTarget.current = target;
    if (timer.current) clearTimeout(timer.current);
    if (!enabled) return;

    timer.current = setTimeout(() => {
      const worker = ensureWorker();
      const id = ++requestId.current;
      const request: DecomposeRequest = {
        kind: 'decompose',
        id,
        target,
        shop: options.shop,
        boardThickness: options.boardThickness,
        ...(options.maxStages === undefined ? {} : { maxStages: options.maxStages }),
        ...(options.maxStockThickness === undefined
          ? {}
          : { maxStockThickness: options.maxStockThickness }),
      };
      setState((prev) => ({ ...prev, running: true, progress: 0, internalError: null }));
      worker.postMessage(request);
    }, DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
     
  }, [
    target,
    enabled,
    options.shop,
    options.boardThickness,
    options.maxStages,
    options.maxStockThickness,
    ensureWorker,
  ]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  return { ...state, cancel };
}

/** Is the design on screen older than the target being edited? */
export function isStale(state: DecomposerState, target: PaintTarget): boolean {
  return state.graph !== null && state.builtFrom !== null && state.builtFrom !== target;
}
