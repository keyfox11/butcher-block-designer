/**
 * The application shell.
 *
 * State is just the generator parameters and the shop profile; the graph, the
 * evaluation, the findings and the cut list are all derived. Deriving them
 * rather than storing them is what guarantees the picture and the numbers
 * cannot disagree -- and it means no state library is needed yet. A graph store
 * with undo/redo arrives with tier-3 graph editing, not before.
 */

import { useMemo, useState } from 'react';
import { buildCutList } from '../core/cutlist/cutlist.js';
import { buildInstructions } from '../core/cutlist/instructions.js';
import { evaluate } from '../core/geometry/evaluate.js';
import { checkerboard } from '../core/generators/checkerboard.js';
import { DEFAULT_SHOP } from '../core/model/defaults.js';
import { createProject } from '../core/model/project.js';
import { PRECISION, inches } from '../core/units/ticks.js';
import { validate } from '../core/validation/validate.js';
import type { Finding } from '../core/validation/types.js';
import { BoardCanvas } from '../ui/canvas2d/BoardCanvas.js';
import { FindingsPanel } from '../ui/panels/FindingsPanel.js';
import { ParameterPanel, type BoardParams } from '../ui/panels/ParameterPanel.js';
import { PrintSheet } from '../ui/print/PrintSheet.js';

const INITIAL: BoardParams = {
  cellSize: inches(1.5),
  speciesA: 'hard-maple',
  speciesB: 'black-walnut',
  columns: 8,
  rows: 10,
  boardThickness: inches(1.5),
  bond: 'checker',
};

export function App() {
  const [params, setParams] = useState<BoardParams>(INITIAL);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [view, setView] = useState<'design' | 'print'>('design');

  const result = useMemo(() => {
    try {
      const { graph, derived } = checkerboard(params, DEFAULT_SHOP);
      const evaluated = evaluate(graph, DEFAULT_SHOP);
      const project = createProject({
        name: describe(params),
        graph,
        speciesPalette: [params.speciesA, params.speciesB],
        shopProfile: DEFAULT_SHOP,
        generator: { id: 'checkerboard', params: { ...params } },
      });
      const validation = validate({ project, evaluated, shop: DEFAULT_SHOP });
      const cutList = buildCutList(graph, evaluated, DEFAULT_SHOP, {
        name: describe(params),
        precision: PRECISION.THIRTY_SECOND,
      });
      const steps = buildInstructions(graph, evaluated, DEFAULT_SHOP);
      return { ok: true as const, evaluated, validation, cutList, steps, derived };
    } catch (error) {
      // A parameter combination the engine refuses is a real answer, not a
      // crash: show it rather than blanking the screen.
      return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
    }
  }, [params]);

  if (!result.ok) {
    return (
      <div className="app">
        <Header view={view} setView={setView} canExport={false} />
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
        <Header view={view} setView={setView} canExport={result.validation.canExport} />
        <PrintSheet
          cutList={result.cutList}
          steps={result.steps}
          findings={result.validation.findings}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <Header view={view} setView={setView} canExport={result.validation.canExport} />

      <div className="layout">
        <aside className="sidebar-left">
          <ParameterPanel params={params} onChange={setParams} />
        </aside>

        <main className="viewport">
          <BoardCanvas
            workpiece={result.evaluated.workpiece}
            highlighted={selected?.pieces ?? []}
          />
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
        <span>{result.derived.panelCount === 2 ? 'Two stage-1 panels' : 'One stage-1 panel'}</span>
        <span>{result.steps.length} build steps</span>
      </footer>
    </div>
  );
}

function Header({
  view,
  setView,
  canExport,
}: {
  view: 'design' | 'print';
  setView: (v: 'design' | 'print') => void;
  canExport: boolean;
}) {
  return (
    <header className="app-header">
      <h1>Butcher Block Designer</h1>
      <nav>
        <button
          type="button"
          className={view === 'design' ? 'active' : ''}
          onClick={() => setView('design')}
        >
          Design
        </button>
        <button
          type="button"
          className={view === 'print' ? 'active' : ''}
          onClick={() => setView('print')}
          disabled={!canExport}
          title={canExport ? 'Shop document' : 'Fix the errors first'}
        >
          Cut list
        </button>
        {view === 'print' && (
          <button type="button" onClick={() => window.print()}>
            Print
          </button>
        )}
      </nav>
    </header>
  );
}

function describe(params: BoardParams): string {
  const a = params.speciesA.replace(/-/g, ' ');
  const b = params.speciesB.replace(/-/g, ' ');
  return `${a} / ${b} ${params.bond === 'brick' ? 'brick' : 'checkerboard'}`;
}
