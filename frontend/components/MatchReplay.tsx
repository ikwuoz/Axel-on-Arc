"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Typography,
} from "@mui/material";
import type { Fsm } from "../lib/arc";
import { MONO, DISPLAY } from "../lib/theme";
import { circleLayout } from "../lib/fsm";
import { simulateMatch, replayStepMs, type MatchSim } from "../lib/replay";
import Avatar from "./Avatar";
import FsmCanvas, { type ActiveEdge } from "./FsmCanvas";

/** Ultra-compact address for one-line match displays. */
function tiny(a: string) {
  return a ? a.slice(0, 4) + "…" : "—";
}

function cellColor(r: { a: boolean; b: boolean }): string {
  if (r.a && r.b) return "#a5d6a7"; // mutual cooperate
  if (!r.a && !r.b) return "#ef9a9a"; // mutual defect
  return "#ffe082"; // split
}

/** One bot panel: address header + FSM with the live state/transition lit up. */
function BotPanel({
  addr,
  fsm,
  state,
  edge,
  score,
}: {
  addr: string;
  fsm: Fsm;
  state: number | null;
  edge: ActiveEdge;
  score: number;
}) {
  const positions = useMemo(() => circleLayout(fsm.actions.length), [fsm]);
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        <Avatar address={addr} size={28} />
        <Typography variant="body2" sx={{ fontFamily: MONO, fontWeight: 700 }}>
          {tiny(addr)}
        </Typography>
          <Typography variant="h6" sx={{ fontFamily: DISPLAY, fontSize: "1.6rem", ml: "auto" }}>
            {score}
          </Typography>
      </Box>
      <Box sx={{ bgcolor: "#f6f3ea", p: 0.5 }}>
        <FsmCanvas
          fsm={fsm}
          positions={positions}
          interactive={false}
          activeState={state}
          activeEdge={edge}
        />
      </Box>
    </Box>
  );
}

/** Interactive turn-by-turn replay: both bots animate state-by-state. ≤ 10s. */
export default function MatchReplay({
  open,
  onClose,
  addrA,
  addrB,
  fsmA,
  fsmB,
  numRounds,
}: {
  open: boolean;
  onClose: () => void;
  addrA: string;
  addrB: string;
  fsmA: Fsm;
  fsmB: Fsm;
  numRounds: number;
}) {
  const sim: MatchSim = useMemo(
    () => simulateMatch(fsmA, fsmB, numRounds),
    [fsmA, fsmB, numRounds]
  );
  const [idx, setIdx] = useState(0); // current round index
  const [playing, setPlaying] = useState(true);
  const stepMs = replayStepMs(numRounds);

  // Reset whenever a different match opens (render-time adjustment keeps this
  // deterministic for prerender; the dialog starts closed on both sides).
  const openKey = `${open}-${addrA}-${addrB}`;
  const [prevKey, setPrevKey] = useState(openKey);
  if (prevKey !== openKey) {
    setPrevKey(openKey);
    setIdx(0);
    setPlaying(true);
  }

  const done = idx >= sim.rounds.length - 1;
  const active = open && playing && !done;
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setIdx((i) => Math.min(i + 1, sim.rounds.length - 1)), stepMs);
    return () => clearTimeout(t);
  }, [active, idx, sim.rounds.length, stepMs]);

  const cur = sim.rounds[idx];

  // Transition taken this round (foe's move drives it), for edge highlight.
  const edgeA: ActiveEdge = cur
    ? {
        from: cur.sa,
        to: (cur.b ? fsmA.transitionsC : fsmA.transitionsD)[cur.sa],
        kind: cur.b ? "C" : "D",
      }
    : null;
  const edgeB: ActiveEdge = cur
    ? {
        from: cur.sb,
        to: (cur.a ? fsmB.transitionsC : fsmB.transitionsD)[cur.sb],
        kind: cur.a ? "C" : "D",
      }
    : null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontFamily: MONO, fontSize: "1rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {tiny(addrA)} vs {tiny(addrB)}
        <Typography variant="body2" color="text.secondary" component="span" sx={{ ml: 2 }}>
          Round {sim.rounds.length === 0 ? 0 : idx + 1}/{sim.rounds.length}
          {cur ? ` · this turn ${cur.a ? "C" : "D"}–${cur.b ? "C" : "D"} (+${cur.gainA}/+${cur.gainB})` : ""}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            gap: 2,
          }}
        >
          <BotPanel addr={addrA} fsm={fsmA} state={cur ? cur.sa : null} edge={edgeA} score={cur ? cur.cumA : 0} />
          <BotPanel addr={addrB} fsm={fsmB} state={cur ? cur.sb : null} edge={edgeB} score={cur ? cur.cumB : 0} />
        </Box>

        <LinearProgress
          variant="determinate"
          value={sim.rounds.length <= 1 ? 100 : (idx / (sim.rounds.length - 1)) * 100}
          sx={{ mt: 2 }}
        />

        {/* filmstrip: every turn, click to seek */}
        <Box sx={{ display: "flex", gap: "2px", mt: 1.5, flexWrap: "nowrap", overflow: "hidden" }}>
          {sim.rounds.map((r, i) => (
            <Box
              key={i}
              onClick={() => {
                setIdx(i);
                setPlaying(false);
              }}
              title={`Round ${i + 1}: ${r.a ? "C" : "D"}–${r.b ? "C" : "D"} (${r.cumA}–${r.cumB})`}
              sx={{
                flex: "1 1 0",
                minWidth: 3,
                height: 22,
                bgcolor: cellColor(r),
                outline: i === idx ? "2px solid #18181b" : "none",
                outlineOffset: -2,
                cursor: "pointer",
              }}
            />
          ))}
        </Box>

        <Box sx={{ display: "flex", gap: 1, mt: 2 }}>
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              setIdx(0);
              setPlaying(true);
            }}
          >
            Restart
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              setPlaying(false);
              setIdx((i) => Math.max(0, i - 1));
            }}
          >
            Prev
          </Button>
          <Button
            size="small"
            variant="contained"
            onClick={() => {
              if (done) {
                setIdx(0);
                setPlaying(true);
              } else {
                setPlaying((p) => !p);
              }
            }}
          >
            {playing ? "Pause" : done ? "Replay" : "Play"}
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              setPlaying(false);
              setIdx((i) => Math.min(sim.rounds.length - 1, i + 1));
            }}
          >
            Next
          </Button>
          <Button size="small" onClick={onClose} sx={{ ml: "auto" }}>
            Close
          </Button>
        </Box>

        {done && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            Final: {tiny(addrA)} {sim.totalA} – {sim.totalB} {tiny(addrB)}
            {sim.totalA === sim.totalB
              ? " — dead heat."
              : ` — ${tiny(sim.totalA > sim.totalB ? addrA : addrB)} takes it.`}
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
}
