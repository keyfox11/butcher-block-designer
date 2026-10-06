/**
 * Shared graph construction for the pattern generators.
 *
 * Extracted at P2 because the tumbling block would have been a third copy. A
 * generator's job is to emit nodes; how node ids are minted is not part of any
 * pattern's definition, and three independent counters would be three places
 * for the numbering to drift.
 */

import type { Graph, GraphNode, NodeId, Ref } from '../model/types.js';

export class GraphBuilder {
  private readonly nodes: Record<NodeId, GraphNode> = {};
  private counter = 0;

  add(op: GraphNode['op'], label?: string): NodeId {
    const id = `n${++this.counter}`;
    this.nodes[id] = label === undefined ? { id, op } : { id, op, label };
    return id;
  }

  build(output: Ref): Graph {
    return { nodes: this.nodes, output };
  }
}
