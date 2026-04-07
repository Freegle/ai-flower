/**
 * ELK.js-based auto-layout for Vue Flow graphs.
 * Uses the layered algorithm with orthogonal edge routing to eliminate
 * the overlapping-lines problem that plagues dagre-based layouts.
 *
 * Requires: elkjs (peer dependency)
 */
export interface FlowNode {
    id: string;
    position: {
        x: number;
        y: number;
    };
    data?: unknown;
    [key: string]: unknown;
}
export interface FlowEdge {
    id: string;
    source: string;
    target: string;
    [key: string]: unknown;
}
/**
 * Apply ELK layered layout to a set of Vue Flow nodes and edges.
 * Returns the same nodes with updated positions.
 */
export declare function applyElkLayout(nodes: FlowNode[], edges: FlowEdge[], options?: Record<string, string>): Promise<FlowNode[]>;
//# sourceMappingURL=elk-layout.d.ts.map