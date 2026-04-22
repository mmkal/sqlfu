/*
 * Inspired by @pnpm/deps.graph-sequencer:
 * - package: https://www.npmjs.com/package/@pnpm/deps.graph-sequencer
 * - source: https://github.com/pnpm/pnpm/tree/main/deps/graph-sequencer
 *
 * This is a small TypeScript adaptation of the published package contents from version 1100.0.0.
 * Modifications for sqlfu:
 * - converted the published JavaScript into local TypeScript
 * - kept the API surface minimal to the single graphSequencer function and its result types
 */

export type Graph<T> = Map<T, T[]>;

export type GraphSequencerResult<T> = {
  safe: boolean;
  chunks: (T[])[];
  cycles: (T[])[];
};

export function graphSequencer<T>(graph: Graph<T>, includedNodes = [...graph.keys()]): GraphSequencerResult<T> {
  const reverseGraph = new Map<T, T[]>();
  for (const key of graph.keys()) {
    reverseGraph.set(key, []);
  }

  const nodes = new Set(includedNodes);
  const visited = new Set<T>();
  const outDegree = new Map<T, number>();

  for (const [from, edges] of graph.entries()) {
    outDegree.set(from, 0);
    for (const to of edges) {
      if (nodes.has(from) && nodes.has(to)) {
        changeOutDegree(from, 1);
        reverseGraph.get(to)!.push(from);
      }
    }

    if (!nodes.has(from)) {
      visited.add(from);
    }
  }

  const chunks: T[][] = [];
  const cycles: T[][] = [];
  let safe = true;

  while (nodes.size > 0) {
    const chunk: T[] = [];
    let minDegree = Number.MAX_SAFE_INTEGER;

    for (const node of nodes) {
      const degree = outDegree.get(node)!;
      if (degree === 0) {
        chunk.push(node);
      }
      minDegree = Math.min(minDegree, degree);
    }

    if (minDegree === 0) {
      chunk.forEach(removeNode);
      chunks.push(chunk);
      continue;
    }

    const cycleNodes: T[] = [];
    for (const node of nodes) {
      const cycle = findCycle(node);
      if (cycle.length === 0) {
        continue;
      }

      cycles.push(cycle);
      cycle.forEach(removeNode);
      cycleNodes.push(...cycle);
      if (cycle.length > 1) {
        safe = false;
      }
    }
    chunks.push(cycleNodes);
  }

  return {safe, chunks, cycles};

  function changeOutDegree(node: T, value: number) {
    const degree = outDegree.get(node) || 0;
    outDegree.set(node, degree + value);
  }

  function removeNode(node: T) {
    for (const from of reverseGraph.get(node) || []) {
      changeOutDegree(from, -1);
    }
    visited.add(node);
    nodes.delete(node);
  }

  function findCycle(startNode: T): T[] {
    const queue: Array<[T, T[]]> = [[startNode, [startNode]]];
    const cycleVisited = new Set<T>();
    const foundCycles: T[][] = [];

    while (queue.length > 0) {
      const [id, cycle] = queue.shift()!;
      for (const to of graph.get(id) || []) {
        if (to === startNode) {
          cycleVisited.add(to);
          foundCycles.push([...cycle]);
          continue;
        }

        if (visited.has(to) || cycleVisited.has(to)) {
          continue;
        }

        cycleVisited.add(to);
        queue.push([to, [...cycle, to]]);
      }
    }

    if (foundCycles.length === 0) {
      return [];
    }

    foundCycles.sort((left, right) => right.length - left.length);
    return foundCycles[0]!;
  }
}
