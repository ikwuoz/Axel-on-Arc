import type { Fsm } from "./arc";

export type Pos = { x: number; y: number };

export const CANVAS_W = 640;
export const CANVAS_H = 400;
export const NODE_R = 32;

/** Even circular layout with margins that keep nodes + loops on-canvas. */
export function circleLayout(n: number): Pos[] {
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2 + 6;
  if (n <= 1) return [{ x: cx, y: cy }];
  if (n === 2) return [{ x: cx - 150, y: cy }, { x: cx + 150, y: cy }];
  const rx = Math.min(215, CANVAS_W / 2 - 70);
  const ry = Math.min(128, CANVAS_H / 2 - 88);
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
}

export function clampPos(p: Pos): Pos {
  return {
    x: Math.min(584, Math.max(56, p.x)),
    y: Math.min(352, Math.max(80, p.y)),
  };
}

/** Keep positions for surviving indices; park brand-new states bottom-center. */
export function syncPositions(nextLen: number, prev: Pos[]): Pos[] {
  return Array.from({ length: nextLen }, (_, i) => {
    if (i < prev.length) return prev[i];
    const k = i - prev.length;
    return { x: 320 + (k % 2 === 0 ? -1 : 1) * Math.ceil(k / 2) * 90, y: 330 };
  });
}

/** States reachable from s0 following both transition tables. */
export function reachableStates(fsm: Fsm): Set<number> {
  const seen = new Set<number>([0]);
  const stack = [0];
  while (stack.length) {
    const s = stack.pop()!;
    for (const t of [fsm.transitionsC[s], fsm.transitionsD[s]]) {
      if (!seen.has(t)) {
        seen.add(t);
        stack.push(t);
      }
    }
  }
  return seen;
}

export function unreachableStates(fsm: Fsm): number[] {
  const reach = reachableStates(fsm);
  return fsm.actions.map((_, i) => i).filter((i) => !reach.has(i));
}

/** Drop unreachable states and remap transition targets. */
export function pruneUnreachable(fsm: Fsm): Fsm {
  const keep = fsm.actions.map((_, i) => i).filter((i) => reachableStates(fsm).has(i));
  const remap = new Map(keep.map((oldI, newI) => [oldI, newI]));
  return {
    actions: keep.map((i) => fsm.actions[i]),
    transitionsC: keep.map((i) => remap.get(fsm.transitionsC[i])!),
    transitionsD: keep.map((i) => remap.get(fsm.transitionsD[i])!),
  };
}

/** Remove state i; targets past it shift down, targets at it fall back to START. */
export function removeStateAt(fsm: Fsm, at: number): Fsm {
  const n = fsm.actions.length;
  if (n <= 1) return fsm;
  const fix = (t: number[]) =>
    t.filter((_, i) => i !== at).map((x) => (x === at ? 0 : x > at ? x - 1 : x));
  return {
    actions: fsm.actions.filter((_, i) => i !== at),
    transitionsC: fix(fsm.transitionsC),
    transitionsD: fix(fsm.transitionsD),
  };
}
