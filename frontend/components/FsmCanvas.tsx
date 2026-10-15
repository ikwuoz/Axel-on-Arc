"use client";

import { useId, useRef } from "react";
import type { Fsm } from "../lib/arc";
import { CANVAS_W, CANVAS_H, NODE_R, clampPos, type Pos } from "../lib/fsm";

export type LinkMode = { from: number; kind: "C" | "D" } | null;

/** A transition taken this round (replay highlight). kind = foe's move. */
export type ActiveEdge = { from: number; to: number; kind: "C" | "D" | "any" } | null;

type Edge = { from: number; to: number; kinds: ("C" | "D")[] };

function buildEdges(fsm: Fsm): Edge[] {
  const map = new Map<string, Edge>();
  fsm.actions.forEach((_, i) => {
    const pairs: [("C" | "D"), number][] = [
      ["C", fsm.transitionsC[i]],
      ["D", fsm.transitionsD[i]],
    ];
    for (const [kind, to] of pairs) {
      const key = `${i}->${to}`;
      const e = map.get(key);
      if (e) e.kinds.push(kind);
      else map.set(key, { from: i, to, kinds: [kind] });
    }
  });
  return [...map.values()];
}

function edgeLabel(kinds: ("C" | "D")[]): string {
  return kinds.length === 2 ? "any" : kinds[0];
}

function quadPoint(p0: Pos, c: Pos, p1: Pos): Pos {
  return {
    x: 0.25 * p0.x + 0.5 * c.x + 0.25 * p1.x,
    y: 0.25 * p0.y + 0.5 * c.y + 0.25 * p1.y,
  };
}

export default function FsmCanvas({
  fsm,
  positions,
  selected = null,
  linkMode = null,
  interactive = true,
  activeState = null,
  activeEdge = null,
  onMove,
  onTapNode,
  onBackgroundTap,
}: {
  fsm: Fsm;
  positions: Pos[];
  selected?: number | null;
  linkMode?: LinkMode;
  interactive?: boolean;
  /** Replay mode: state whose action is playing this round (dims the rest). */
  activeState?: number | null;
  /** Replay mode: transition taken this round. */
  activeEdge?: ActiveEdge;
  onMove?: (i: number, p: Pos) => void;
  onTapNode?: (i: number) => void;
  onBackgroundTap?: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const arrowId = `axel-arrow-${uid}`;
  const drag = useRef<{ i: number; moved: boolean; cx: number; cy: number } | null>(null);
  const replaying = activeState !== null && activeState !== undefined;

  const toLocal = (clientX: number, clientY: number): Pos => {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * CANVAS_W,
      y: ((clientY - r.top) / r.height) * CANVAS_H,
    };
  };

  const edges = buildEdges(fsm);
  const edgeSet = new Set(edges.map((e) => `${e.from}->${e.to}`));

  const renderEdge = (e: Edge, idx: number) => {
    const p = positions[e.from];
    const q = positions[e.to];
    if (!p || !q) return null;
    const label = edgeLabel(e.kinds);
    const hot =
      !!activeEdge &&
      e.from === activeEdge.from &&
      e.to === activeEdge.to &&
      (activeEdge.kind === "any" ? e.kinds.length === 2 : e.kinds.includes(activeEdge.kind));
    const dimmed = replaying && !hot;

    if (e.from === e.to) {
      // Self-loop arcing over the node.
      const d = `M ${p.x - 11} ${p.y - NODE_R + 2} C ${p.x - 48} ${p.y - NODE_R - 52}, ${p.x + 48} ${p.y - NODE_R - 52}, ${p.x + 11} ${p.y - NODE_R + 2}`;
      return (
        <g key={idx} opacity={dimmed ? 0.22 : 1}>
          <path d={d} fill="none" stroke="#1c1917" strokeWidth={hot ? 3.5 : 2} markerEnd={`url(#${arrowId})`} />
          <text x={p.x} y={p.y - NODE_R - 56} textAnchor="middle" fontSize={13} fontFamily="monospace" fill="#1c1917"
            style={{ paintOrder: "stroke" }} stroke="#f7f4ec" strokeWidth={4}>
            {label}
          </text>
        </g>
      );
    }

    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const gap = NODE_R + 4;
    const p0 = { x: p.x + ux * gap, y: p.y + uy * gap };
    const p1 = { x: q.x - ux * (gap + 2), y: q.y - uy * (gap + 2) };
    const hasReverse = edgeSet.has(`${e.to}->${e.from}`);
    const bend = hasReverse ? 38 : 15;
    const sign = e.from < e.to ? 1 : -1;
    const c = {
      x: (p0.x + p1.x) / 2 + -uy * bend * sign,
      y: (p0.y + p1.y) / 2 + ux * bend * sign,
    };
    const mid = quadPoint(p0, c, p1);
    return (
      <g key={idx} opacity={dimmed ? 0.22 : 1}>
        <path d={`M ${p0.x} ${p0.y} Q ${c.x} ${c.y} ${p1.x} ${p1.y}`} fill="none"
          stroke="#1c1917" strokeWidth={hot ? 3.5 : 2} markerEnd={`url(#${arrowId})`} />
        <text x={mid.x} y={mid.y - 6} textAnchor="middle" fontSize={13} fontFamily="monospace" fill="#1c1917"
          style={{ paintOrder: "stroke" }} stroke="#f7f4ec" strokeWidth={4}>
          {label}
        </text>
      </g>
    );
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      className="h-auto w-full touch-none select-none"
      onPointerMove={(ev) => {
        const d = drag.current;
        if (!d || !interactive) return;
        const pt = toLocal(ev.clientX, ev.clientY);
        if (Math.hypot(ev.clientX - d.cx, ev.clientY - d.cy) > 5) d.moved = true;
        if (d.moved) onMove?.(d.i, clampPos(pt));
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved && interactive) onTapNode?.(d.i);
      }}
      onPointerLeave={() => {
        drag.current = null;
      }}
      onClick={(ev) => {
        if (ev.target === ev.currentTarget && interactive) onBackgroundTap?.();
      }}
    >
      <defs>
        <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5"
          markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9 z" fill="#1c1917" />
        </marker>
      </defs>

      {edges.map(renderEdge)}

      {positions.map((pos, i) => {
        if (i >= fsm.actions.length) return null;
        const coop = fsm.actions[i] === 0;
        const isSel = selected === i;
        const isSrc = linkMode?.from === i;
        const isHot = replaying && activeState === i;
        return (
          <g
            key={i}
            transform={`translate(${pos.x},${pos.y})`}
            opacity={replaying && !isHot ? 0.35 : 1}
            className={interactive ? "cursor-grab" : undefined}
            onPointerDown={(ev) => {
              if (!interactive) return;
              (ev.target as Element).setPointerCapture?.(ev.pointerId);
              drag.current = { i, moved: false, cx: ev.clientX, cy: ev.clientY };
            }}
          >
            {i === 0 && (
              <circle r={NODE_R + 6} fill="none" stroke="#a8a29e" strokeWidth={1.5} />
            )}
            {(isSel || isSrc || isHot) && (
              <circle r={NODE_R + 10} fill="none" stroke="#1c1917" strokeWidth={2}
                strokeDasharray={isSrc ? "5 4" : undefined} />
            )}
            <circle r={NODE_R} fill={coop ? "#fbbf24" : "#dc2626"} stroke="#1c1917" strokeWidth={2.5} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={26} fontWeight={700}
              fontFamily="var(--font-display), Georgia, serif"
              fill={coop ? "#1c1917" : "#ffffff"}>
              {coop ? "C" : "D"}
            </text>
            <text y={NODE_R + 20} textAnchor="middle" fontSize={12} fontFamily="monospace" fill="#78716c">
              {i === 0 ? "START" : `s${i}`}
            </text>
          </g>
        );
      })}

      {interactive && linkMode && (
        <text x={12} y={24} fontSize={13} fontFamily="monospace" fill="#1c1917">
          {`click a circle → on-${linkMode.kind} target for s${linkMode.from}`}
        </text>
      )}
    </svg>
  );
}
