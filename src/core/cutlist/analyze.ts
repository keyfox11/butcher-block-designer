/**
 * Reading the build structure back out of a construction graph.
 *
 * The cut list and the ledger are derived from the graph rather than from
 * whatever metadata a generator happened to attach, so a hand-built or
 * decomposer-produced graph gets the same quality of output.
 */

import { inputRefs } from '../geometry/evaluate.js';
import type {
  BilletOp,
  CrosscutOp,
  FlattenOp,
  Graph,
  GraphNode,
  LaminateOp,
  NodeId,
  Op,
  RipOp,
  TrimOp,
} from '../model/types.js';

export interface Staged<T extends Op> {
  readonly id: NodeId;
  readonly op: T;
  readonly label: string | undefined;
}

export interface BuildAnalysis {
  /** Nodes in build order: dependencies always precede dependents. */
  readonly order: readonly GraphNode[];
  readonly billets: readonly Staged<BilletOp>[];
  readonly rips: readonly Staged<RipOp>[];
  readonly laminates: readonly Staged<LaminateOp>[];
  readonly crosscuts: readonly Staged<CrosscutOp>[];
  readonly flattens: readonly Staged<FlattenOp>[];
  readonly trims: readonly Staged<TrimOp>[];
  /** The last laminate, which assembles the finished board. */
  readonly finalLaminate: Staged<LaminateOp> | null;
  /** Laminates that build stage-1 panels, i.e. everything before the rotation. */
  readonly stagePanels: readonly Staged<LaminateOp>[];
}

/**
 * Topological order, reachable nodes only.
 *
 * Unreachable nodes are material cut and never used; they are excluded here so
 * they do not appear as build steps, and the ledger reports them as offcuts.
 */
export function buildOrder(graph: Graph): GraphNode[] {
  const visited = new Set<NodeId>();
  const order: GraphNode[] = [];

  const visit = (id: NodeId): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = graph.nodes[id];
    if (!node) return;
    for (const ref of inputRefs(node.op)) visit(ref.node);
    order.push(node);
  };

  visit(graph.output.node);
  return order;
}

export function analyze(graph: Graph): BuildAnalysis {
  const order = buildOrder(graph);
  const of = <K extends Op['kind']>(kind: K): Staged<Extract<Op, { kind: K }>>[] =>
    order
      .filter((n) => n.op.kind === kind)
      .map((n) => ({ id: n.id, op: n.op as Extract<Op, { kind: K }>, label: n.label }));

  const laminates = of('laminate');
  const reorientIds = new Set(order.filter((n) => n.op.kind === 'reorient').map((n) => n.id));

  // A laminate is a stage-1 panel when none of its members came through the
  // rotation to end grain.
  const stagePanels = laminates.filter(
    (l) => !l.op.members.some((m) => reorientIds.has(m.piece.node)),
  );

  return {
    order,
    billets: of('billet'),
    rips: of('rip'),
    laminates,
    crosscuts: of('crosscut'),
    flattens: of('flatten'),
    trims: of('trim'),
    finalLaminate: laminates[laminates.length - 1] ?? null,
    stagePanels,
  };
}
