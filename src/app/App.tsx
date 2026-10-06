/**
 * The application shell.
 *
 * State is the pattern choice, its parameters, and the shop profile. The graph,
 * the evaluation, the findings and the cut list are all DERIVED. Deriving them
 * rather than storing them is what guarantees the picture and the numbers
 * cannot disagree -- and it means no state library is needed yet. A graph store
 * with undo/redo arrives with tier-3 graph editing, not before.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { buildAssemblyMaps } from '../core/cutlist/assembly.js';
import { buildCutList } from '../core/cutlist/cutlist.js';
import { buildInstructions } from '../core/cutlist/instructions.js';
import { evaluate } from '../core/geometry/evaluate.js';
import { PATTERNS, type PatternParams, pattern } from '../core/generators/registry.js';
import { DEFAULT_SHOP } from '../core/model/defaults.js';
import { createProject } from '../core/model/project.js';
import type { ShopProfile } from '../core/model/types.js';
import { decodeShare, extractShareToken, shareUrl } from '../core/persist/codec.js';
import { PRECISION, degrees, inches } from '../core/units/ticks.js';
import { validate } from '../core/validation/validate.js';
import type { Finding } from '../core/validation/types.js';
import { BoardCanvas } from '../ui/canvas2d/BoardCanvas.js';
import { FindingsPanel } from '../ui/panels/FindingsPanel.js';
import { ParameterPanel } from '../ui/panels/ParameterPanel.js';
import { ShopProfilePanel } from '../ui/panels/ShopProfilePanel.js';
import { PrintSheet } from '../ui/print/PrintSheet.js';

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

export function App() {
  const [patternId, setPatternId] = useState('checkerboard');
  const [params, setParams] = useState<PatternParams>(INITIAL);
  const [shop, setShop] = useState<ShopProfile>(DEFAULT_SHOP);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [view, setView] = useState<View>('2d');
  const [sidebar, setSidebar] = useState<'pattern' | 'shop'>('pattern');
  const [copied, setCopied] = useState(false);

  // A shared link is read once, on load. It carries the design but NOT the shop
  // profile, so it re-validates against whatever this machine has.
  useEffect(() => {
    const token = extractShareToken(window.location.href);
    if (!token) return;
    try {
      const { payload } = decodeShare(token);
      if (payload.generator && PATTERNS.some((p) => p.id === payload.generator!.id)) {
        setPatternId(payload.generator.id);
        setParams({ ...INITIAL, ...(payload.generator.params as Partial<PatternParams>) });
      }
    } catch (error) {
      // A bad link should say so, not blank the screen.
       
      console.warn('Could not open shared design:', error);
    }
  }, []);

  const result = useMemo(() => {
    try {
      const definition = pattern(patternId);
      const { graph, panelCount, setupCuts } = definition.build(params, shop);
      const evaluated = evaluate(graph, shop);
      const project = createProject({
        name: `${definition.name} — ${params.speciesA.replace(/-/g, ' ')} / ${params.speciesB.replace(/-/g, ' ')}`,
        graph,
        speciesPalette: [params.speciesA, params.speciesB, params.speciesC],
        shopProfile: shop,
        generator: { id: patternId, params: { ...params } },
      });
      const validation = validate({ project, evaluated, shop });
      const cutList = buildCutList(graph, evaluated, shop, {
        name: project.meta.name,
        precision: PRECISION.THIRTY_SECOND,
      });
      return {
        ok: true as const,
        project,
        evaluated,
        validation,
        cutList,
        steps: buildInstructions(graph, evaluated, shop),
        assemblyMaps: buildAssemblyMaps(graph, evaluated),
        panelCount,
        setupCuts,
        definition,
      };
    } catch (error) {
      // A parameter combination the engine refuses is a real answer, not a
      // crash: show it rather than blanking the screen.
      return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
    }
  }, [patternId, params, shop]);

  const onShare = useCallback(() => {
    if (!result.ok) return;
    const url = shareUrl(result.project, `${window.location.origin}${window.location.pathname}`);
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
    window.history.replaceState(null, '', `#/d/${url.split('#/d/')[1] ?? ''}`);
  }, [result]);

  const header = (
    <header className="app-header">
      <h1>Butcher Block Designer</h1>
      <nav>
        {(['2d', '3d', 'split'] as const).map((v) => (
          <button key={v} type="button" className={view === v ? 'active' : ''} onClick={() => setView(v)}>
            {v === '2d' ? 'Face' : v === '3d' ? '3D' : 'Split'}
          </button>
        ))}
        <button
          type="button"
          className={view === 'print' ? 'active' : ''}
          onClick={() => setView('print')}
          disabled={!result.ok || !result.validation.canExport}
          title={result.ok && result.validation.canExport ? 'Shop document' : 'Fix the errors first'}
        >
          Cut list
        </button>
        <button type="button" onClick={onShare} disabled={!result.ok}>
          {copied ? 'Link copied' : 'Share'}
        </button>
        {view === 'print' && (
          <button type="button" onClick={() => window.print()}>
            Print
          </button>
        )}
      </nav>
    </header>
  );

  if (!result.ok) {
    return (
      <div className="app">
        {header}
        <main className="error-state">
          <h2>This design cannot be built</h2>
          <p>{result.message}</p>
          <button type="button" onClick={() => setParams(INITIAL)}>
            Reset to the reference board
          </button>
        </main>
      </div>
    );
  }

  if (view === 'print') {
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

  return (
    <div className="app">
      {header}

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
          {sidebar === 'pattern' ? (
            <ParameterPanel patternId={patternId} params={params} onPattern={setPatternId} onChange={setParams} />
          ) : (
            <ShopProfilePanel shop={shop} onChange={setShop} onReset={() => setShop(DEFAULT_SHOP)} />
          )}
        </aside>

        <main className={view === 'split' ? 'viewport viewport-split' : 'viewport'}>
          {(view === '2d' || view === 'split') && (
            <BoardCanvas workpiece={result.evaluated.workpiece} highlighted={selected?.pieces ?? []} />
          )}
          {(view === '3d' || view === 'split') && (
            <Suspense fallback={<div className="viewport3d-loading">Loading 3D preview…</div>}>
              <BoardScene workpiece={result.evaluated.workpiece} />
            </Suspense>
          )}
        </main>

        <aside className="sidebar-right">
          <FindingsPanel
            findings={result.validation.findings}
            counts={result.validation.counts}
            canExport={result.validation.canExport}
            onSelect={setSelected}
          />
        </aside>
      </div>

      {/* Always visible: board feet and warning count are how a user notices a
          design getting out of hand. Behind a tab, they get checked once. */}
      <footer className="summary-bar">
        <span>
          <strong>{result.cutList.summary.totalBoardFeet.toFixed(2)}</strong> board feet
        </span>
        <span>
          <strong>{result.cutList.summary.endGrainMultiplier.toFixed(2)}×</strong> finished volume
        </span>
        <span>
          <strong>{(result.cutList.summary.wasteFraction * 100).toFixed(0)}%</strong> waste
        </span>
        <span>{result.definition.glueUps} glue-ups</span>
        {result.panelCount === 2 && <span>Two stage-1 panels</span>}
        {result.setupCuts ? <span>{result.setupCuts} setup cuts</span> : null}
        <span>{result.steps.length} build steps</span>
      </footer>
    </div>
  );
}
