import { PAYOFFS, type Fsm } from "./arc";

export type Round = {
  a: boolean; // true = cooperate
  b: boolean;
  gainA: number;
  gainB: number;
  cumA: number;
  cumB: number;
  sa: number; // A's machine state this round
  sb: number; // B's machine state this round
};

export type MatchSim = {
  rounds: Round[];
  totalA: number;
  totalB: number;
};

/**
 * Replays a match exactly as the contract's _playMatch does: both machines
 * start at state 0, each round plays actions, scores R/T/S/P, then advances
 * on the OPPONENT's move. Deterministic — identical inputs, identical rounds.
 */
export function simulateMatch(fsmA: Fsm, fsmB: Fsm, numRounds: number): MatchSim {
  let ia = 0;
  let ib = 0;
  let cumA = 0;
  let cumB = 0;
  const rounds: Round[] = [];
  for (let r = 0; r < numRounds; r++) {
    const a = fsmA.actions[ia] === 0;
    const b = fsmB.actions[ib] === 0;
    let gainA = 0;
    let gainB = 0;
    if (a && b) {
      gainA = PAYOFFS.R;
      gainB = PAYOFFS.R;
    } else if (!a && b) {
      gainA = PAYOFFS.T;
      gainB = PAYOFFS.S;
    } else if (a && !b) {
      gainA = PAYOFFS.S;
      gainB = PAYOFFS.T;
    } else {
      gainA = PAYOFFS.P;
      gainB = PAYOFFS.P;
    }
    cumA += gainA;
    cumB += gainB;
    rounds.push({ a, b, gainA, gainB, cumA, cumB, sa: ia, sb: ib });
    ia = (b ? fsmA.transitionsC : fsmA.transitionsD)[ia];
    ib = (a ? fsmB.transitionsC : fsmB.transitionsD)[ib];
  }
  return { rounds, totalA: cumA, totalB: cumB };
}

/** Round-robin pair order matches the contract cursors: (0,1), (0,2), …, (1,2), … */
export function matchPairs(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push([i, j]);
  return out;
}

/** Per-round step so a full replay never exceeds 10 seconds. */
export function replayStepMs(numRounds: number): number {
  if (numRounds <= 0) return 400;
  return Math.max(30, Math.min(600, Math.floor(10000 / numRounds)));
}
