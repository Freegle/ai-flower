/**
 * ELK.js-based auto-layout for Vue Flow graphs.
 * Uses the layered algorithm with orthogonal edge routing to eliminate
 * the overlapping-lines problem that plagues dagre-based layouts.
 *
 * Requires: elkjs (peer dependency)
 */

export interface FlowNode {
  id: string
  position: { x: number; y: number }
  data?: unknown
  [key: string]: unknown
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  [key: string]: unknown
}

interface ElkNode {
  id: string
  width?: number
  height?: number
  children?: ElkNode[]
  edges?: ElkEdge[]
  layoutOptions?: Record<string, string>
}

interface ElkEdge {
  id: string
  sources: string[]
  targets: string[]
}

interface ElkResult {
  children?: Array<ElkNode & { x: number; y: number }>
}

const NODE_WIDTH = 180
const NODE_HEIGHT = 60

const DEFAULT_ELK_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.spacing.nodeNode': '60',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.mergeEdges': 'true',
}

/**
 * Apply ELK layered layout to a set of Vue Flow nodes and edges.
 * Returns the same nodes with updated positions.
 */
export async function applyElkLayout(
  nodes: FlowNode[],
  edges: FlowEdge[],
  options: Record<string, string> = {}
): Promise<FlowNode[]> {
  // Dynamic import — only loaded when layout is requested
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  const elk = new ELK()

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: { ...DEFAULT_ELK_OPTIONS, ...options },
    children: nodes.map(n => ({
      id: n.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: edges.map(e => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  }

  const result = await elk.layout(graph) as ElkResult

  const positionMap = new Map<string, { x: number; y: number }>()
  for (const child of result.children ?? []) {
    positionMap.set(child.id, { x: child.x, y: child.y })
  }

  return nodes.map(n => ({
    ...n,
    position: positionMap.get(n.id) ?? n.position,
  }))
}
