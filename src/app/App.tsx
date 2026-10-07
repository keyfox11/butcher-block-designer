/**
 * The application shell.
 *
 * Two tiers now share one pipeline. Tier 1 turns parameters into a graph; tier
 * 2 turns a painted target into a graph. From the graph down -- evaluation,
 * validation, cut list, instructions, assembly maps -- everything is identical,
 * because the graph is the only thing the rest of the tool knows about.
 *
 * That is the architectural bet paying off a second time. The free-paint
 * surface needed a decomposer; it needed no changes at all to the cut list, the
 * validator, the 3-D view or the print sheet, and a painted design gets the
 * same allowance ledger and the same findings as a generated one.
 *
 * Everything below the graph stays DERIVED rather than stored, which is what
 * guarantees the picture and the numbers cannot disagree.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { buildAssemblyMaps } from '../core/cutlist/assembly.js';
import { buildCutList } from '../core/cutlist/cutlist.js';
import { buildInstructions } from '../core/cutlist/instructions.js';
import { evaluate } from '../core/geometry/evaluate.js';
import { PATTERNS, type PatternParams, pattern } from '../core/generators/registry.js';
import { DEFAULT_SHOP } from '../core/model/defaults.js';
import { createProject } from '../core/model/project.js';
import type { ShopProfile, SpeciesId } from '../core/model/types.js';
import { decodeShare, extractShareToken, shareUrl } from '../core/persist/codec.js';
import { PRECISION, degrees, inches } from '../core/units/ticks.js';
import { validate } from '../core/validation/validate.js';
import type { Finding } from '../core/validation/types.js';
import { BoardCanvas } from '../ui/canvas2d/BoardCanvas.js';
import { FindingsPanel } from '../ui/panels/FindingsPanel.js';
import { ParameterPanel } from '../ui/panels/ParameterPanel.js';
import { ShopProfilePanel } from '../ui/panels/ShopProfilePanel.js';
import { PrintSheet } from '../ui/print/PrintSheet.js';
import { PaintCanvas, PaintDefs, type PaintTool } from '../ui/paint/PaintCanvas.js';
import { PaintPanel } from '../ui/paint/PaintPanel.js';
import { useDecomposer } from '../ui/paint/useDecomposer.js';
import {
  checkerTarget,
  mergeRect,
  paintCell,
  resizeGrid,
  splitPieceAt,
} from '../core/decompose/target.js';
import type { PaintTarget } from '../core/decompose/types.js';

/**
 * Three.js is roughly a megabyte, and the 2-D face view plus the cut list are
 * what make this tool useful. Loading the renderer only when someone opens the
 * 3-D view keeps the first paint fast for everyone else.
 */
const BoardScene = lazy(() =>
  import('../ui/viewport3d/BoardScene.js').then((m) => ({ default: m.BoardScene })),
);

const INITIAL: PatternParams = {
  cellSize: inches(1.5),
  columns: 8,
  rows: 10,
  boardThickness: inches(1.5),
  speciesA: 'hard-maple',
  speciesB: 'black-walnut',
  speciesC: 'black-cherry',
  angle: degrees(15),
  seed: 42,
  // Six stripes across a 3" herringbone tile is 1/2" each: right at the safe
  // rip width, and fine enough to read as a pattern rather than as planks.
  stripes: 6,
  edgeResolution: 'trimThrough',
};

type View = '2d' | '3d' | 'split' | 'print';
type Tier = 'parameters' | 'paint';

/** The id a shared painted design carries where a generator name would go. */
const PAINT_GENERATOR_ID = 'paint';

export function App() {
  const [tier, setTier] = useState<Tier>('parameters');
  const [patternId, setPatternId] = useState('checkerboard');
  const [params, setParams] = useState<PatternParams>(INITIAL);
  const [shop, setShop] = useState<ShopProfile>(DEFAULT_SHOP);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [view, setView] = useState<View>('2d');
  const [sidebar, setSidebar] = useState<'pattern' | 'shop'>('pattern');
  const [copied, setCopied] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);

  const [paintTarget, setPaintTarget] = useState<PaintTarget>(() =>
    checkerTarget(8, 10, INITIAL.cellSize, INITIAL.speciesA, INITIAL.speciesB),
  );
  const [paintTool, setPaintTool] = useState<PaintTool>('paint');
  const [brush, setBrush] = useState<SpeciesId>(INITIAL.speciesB);

  const palette = useMemo(
    () => [params.speciesA, params.speciesB, params.speciesC],
    [params.speciesA, params.speciesB, params.speciesC],
  );

  const decomposer = useDecomposer(paintTarget, {
    shop,
    boardThickness: params.boardThickness,
    enabled: tier === 'paint',
  });

  // A shared link is read once, on load. It carries the design but NOT the shop
  // profile, so it re-validates against whatever this machine has.
  useEffect(() => {
    const token = extractShareToken(window.location.href);
    if (!token) return;
    try {
      const { payload } = decodeShare(token);
      if (payload.generator?.id === PAINT_GENERATOR_ID) {
        // A painted design shares its TARGET, not its graph. The graph for an
        // 80-cell painting runs to several kilobytes; the target is a few
        // hundred bytes and the decomposer rebuilds the rest.
        setPaintTarget(payload.generator.params.target as PaintTarget);
        setTier('paint');
        return;
      }
      if (payload.generator && PATTERNS.some((p) => p.id === payload.generator!.id)) {
        setPatternId(payload.generator.id);
        setParams({ ...INITIAL, ...(payload.generator.params as Partial<PatternParams>) });
      }
    } catch (error) {
      // A bad link should say so, not blank the screen.

      console.warn('Could not open shared design:', error);
    }
  }, []);

  /** Tier 1: the graph a generator produces from its parameters. */
  const generated = useMemo(() => {
    if (tier !== 'parameters') return null;
    try {
      const definition = pattern(patternId);
      const built = definition.build(params, shop);
      return {
        ok: true as const,
        graph: built.graph,
        name: `${definition.name} — ${params.speciesA.replace(/-/g, ' ')} / ${params.speciesB.replace(/-/g, ' ')}`,
        generator: { id: patternId, params: { ...params } },
        palette,
        glueUps: definition.glueUps,
        panelCount: built.panelCount,
        setupCuts: built.setupCuts,
      };
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
    }
  }, [tier, patternId, params, shop, palette]);

  /**
   * Whichever tier produced it, the graph is the only input from here down.
   *
   * The paint tier deliberately keeps showing the last design that built, so a
   * refusal marks the viewport stale rather than emptying it.
   */
  const design = useMemo(() => {
    if (tier === 'paint') {
      if (!decomposer.graph) return null;
      const species = [...new Set(paintTarget.pieces.map((p) => p.species))];
      return {
        graph: decomposer.graph,
        name: 'Painted design',
        generator: {
          id: PAINT_GENERATOR_ID,
          params: { target: decomposer.builtFrom ?? paintTarget },
        },
        palette: species,
        glueUps: decomposer.glueUps,
        panelCount: decomposer.panelCount,
        setupCuts: undefined as number | undefined,
      };
    }
    return generated?.ok ? generated : null;
  }, [tier, decomposer.graph, decomposer.glueUps, decomposer.panelCount, decomposer.builtFrom, paintTarget, generated]);

  const result = useMemo(() => {
    if (!design) return null;
    try {
      const evaluated = evaluate(design.graph, shop);
      const project = createProject({
        name: design.name,
        graph: design.graph,
        speciesPalette: design.palette,
        shopProfile: shop,
        generator: design.generator,
      });
      const validation = validate({ project, evaluated, shop });
      return {
        ok: true as const,
        project,
        evaluated,
        validation,
        cutList: buildCutList(design.graph, evaluated, shop, {
          name: project.meta.name,
          precision: PRECISION.THIRTY_SECOND,
        }),
        steps: buildInstructions(design.graph, evaluated, shop),
        assemblyMaps: buildAssemblyMaps(design.graph, evaluated),
        panelCount: design.panelCount,
        setupCuts: design.setupCuts,
        glueUps: design.glueUps,
      };
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
    }
  }, [design, shop]);

  const onShare = useCallback(() => {
    if (!result?.ok) return;
    const url = shareUrl(result.project, `${window.location.origin}${window.location.pathname}`);
    window.history.replaceState(null, '', `#/d/${url.split('#/d/')[1] ?? ''}`);

    // The URL is already in the address bar, so a refused clipboard has an
    // accurate and useful fallback. Calling writeText with no .catch leaves an
    // unhandled rejection and tells the user nothing at all.
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      setShareNote('Copy the link from the address bar.');
      setTimeout(() => setShareNote(null), 4000);
      return;
    }
    clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      },
      () => {
        setShareNote('Clipboard blocked — copy the link from the address bar.');
        setTimeout(() => setShareNote(null), 4000);
      },
    );
  }, [result]);

  const paintStale = tier === 'paint' && decomposer.refusal !== null && decomposer.graph !== null;

  const header = (
    <header className="app-header">
      <h1>Butcher Block Designer</h1>
      <nav>
        <div className="tier-switch">
          {(['parameters', 'paint'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={tier === t ? 'active' : ''}
              onClick={() => setTier(t)}
              title={
                t === 'parameters'
                  ? 'Pick a pattern and adjust it'
                  : 'Paint directly; the decomposer finds a way to build it'
              }
            >
              {t === 'parameters' ? 'Patterns' : 'Paint'}
            </button>
          ))}
        </div>
        {(['2d', '3d', 'split'] as const).map((v) => (
          <button key={v} type="button" className={view === v ? 'active' : ''} onClick={() => setView(v)}>
            {v === '2d' ? 'Face' : v === '3d' ? '3D' : 'Split'}
          </button>
        ))}
        <button
          type="button"
          className={view === 'print' ? 'active' : ''}
          onClick={() => setView('print')}
          disabled={!result?.ok || !result.validation.canExport}
          title={result?.ok && result.validation.canExport ? 'Shop document' : 'Fix the errors first'}
        >
          Cut list
        </button>
        <button type="button" onClick={onShare} disabled={!result?.ok}>
          {copied ? 'Link copied' : 'Share'}
        </button>
        {view === 'print' && (
          <button type="button" onClick={() => window.print()}>
            Print
          </button>
        )}
      </nav>
      {shareNote && <p className="share-note">{shareNote}</p>}
    </header>
  );

  // Tier 1 has nothing to fall back on when a generator refuses, so it still
  // shows the refusal full-screen. Tier 2 does -- see `paintStale`.
  if (tier === 'parameters' && generated && !generated.ok) {
    return (
      <div className="app">
        {header}
        <main className="error-state">
          <h2>This design cannot be built</h2>
          <p>{generated.message}</p>
          <button type="button" onClick={() => setParams(INITIAL)}>
            Reset to the reference board
          </button>
        </main>
      </div>
    );
  }

  if (view === 'print' && result?.ok) {
    return (
      <div className="app print-view">
        {header}
        <PrintSheet
          cutList={result.cutList}
          steps={result.steps}
          findings={result.validation.findings}
          assemblyMaps={result.assemblyMaps}
        />
      </div>
    );
  }

  const achieved =
    result?.ok ? (
      <BoardCanvas workpiece={result.evaluated.workpiece} highlighted={selected?.pieces ?? []} />
    ) : (
      <div className="viewport3d-loading">
        {tier === 'paint' && decomposer.running ? 'Working out how to build this…' : 'Nothing to show yet'}
      </div>
    );

  return (
    <div className="app">
      {header}
      {tier === 'paint' && <PaintDefs />}

      <div className="layout">
        <aside className="sidebar-left">
          <div className="sidebar-tabs">
            <button
              type="button"
              className={sidebar === 'pattern' ? 'active' : ''}
              onClick={() => setSidebar('pattern')}
            >
              Design
            </button>
            <button type="button" className={sidebar === 'shop' ? 'active' : ''} onClick={() => setSidebar('shop')}>
              Shop
            </button>
          </div>
          {sidebar === 'shop' ? (
            <ShopProfilePanel shop={shop} onChange={setShop} onReset={() => setShop(DEFAULT_SHOP)} />
          ) : tier === 'paint' ? (
            <PaintPanel
              target={paintTarget}
              tool={paintTool}
              brush={brush}
              palette={palette}
              cellSize={params.cellSize}
              refusal={decomposer.refusal}
              suggestion={decomposer.suggestion}
              internalError={decomposer.internalError}
              running={decomposer.running}
              progress={decomposer.progress}
              onTool={setPaintTool}
              onBrush={setBrush}
              onResize={(cols, rows, cellSize) => {
                setParams((p) => ({ ...p, cellSize }));
                setPaintTarget((t) => resizeGrid(t, cols, rows, cellSize, brush));
              }}
              onTarget={setPaintTarget}
              onCancel={decomposer.cancel}
            />
          ) : (
            <ParameterPanel patternId={patternId} params={params} onPattern={setPatternId} onChange={setParams} />
          )}
        </aside>

        <main className={view === 'split' || tier === 'paint' ? 'viewport viewport-split' : 'viewport'}>
          {tier === 'paint' && view !== '3d' && (
            <div className="paint-pane">
              <PaintCanvas
                target={paintTarget}
                tool={paintTool}
                problemRegions={decomposer.refusal?.regions ?? []}
                onPaintCell={(col, row) => setPaintTarget((t) => paintCell(t, col, row, brush))}
                onMergeRect={(col, row, cols, rows) =>
                  setPaintTarget((t) => mergeRect(t, col, row, cols, rows, brush).target)
                }
                onSplitCell={(col, row) => setPaintTarget((t) => splitPieceAt(t, col, row))}
              />
            </div>
          )}

          {(view === '2d' || view === 'split' || tier === 'paint') && view !== '3d' && (
            <div className="paint-pane">
              {paintStale && (
                <p className="stale-badge">
                  Showing the last design that built. The current painting is refused — see the
                  panel.
                </p>
              )}
              {tier === 'paint' ? achieved : achieved}
            </div>
          )}

          {(view === '3d' || view === 'split') && (
            <Suspense fallback={<div className="viewport3d-loading">Loading 3D preview…</div>}>
              {result?.ok ? <BoardScene workpiece={result.evaluated.workpiece} /> : null}
            </Suspense>
          )}
        </main>

        <aside className="sidebar-right">
          {result?.ok ? (
            <FindingsPanel
              findings={result.validation.findings}
              counts={result.validation.counts}
              canExport={result.validation.canExport}
              onSelect={setSelected}
            />
          ) : (
            <div className="panel">
              <h2>Findings</h2>
              <p className="field-hint">
                {result?.ok === false ? result.message : 'Nothing to check yet.'}
              </p>
            </div>
          )}
        </aside>
      </div>

      {/* Always visible: board feet and warning count are how a user notices a
          design getting out of hand. Behind a tab, they get checked once. */}
      <footer className="summary-bar">
        {result?.ok ? (
          <>
            <span>
              <strong>{result.cutList.summary.totalBoardFeet.toFixed(2)}</strong> board feet
            </span>
            <span>
              <strong>{result.cutList.summary.endGrainMultiplier.toFixed(2)}×</strong> finished volume
            </span>
            <span>
              <strong>{(result.cutList.summary.wasteFraction * 100).toFixed(0)}%</strong> waste
            </span>
            <span>{result.glueUps} glue-ups</span>
            {result.panelCount && result.panelCount > 1 ? (
              <span>
                {result.panelCount} stage-1 panel{result.panelCount === 1 ? '' : 's'}
              </span>
            ) : null}
            {result.setupCuts ? <span>{result.setupCuts} setup cuts</span> : null}
            <span>{result.steps.length} build steps</span>
            {tier === 'paint' && decomposer.ms > 0 && (
              <span className="summary-timing">decomposed in {decomposer.ms.toFixed(0)} ms</span>
            )}
          </>
        ) : (
          <span>{tier === 'paint' ? 'Paint a design to see what it costs.' : 'No design yet.'}</span>
        )}
      </footer>
    </div>
  );
}
