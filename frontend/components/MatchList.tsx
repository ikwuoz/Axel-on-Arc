"use client";

import { useMemo, useState } from "react";
import { useReadContracts } from "wagmi";
import { Alert, Box, Button, Typography } from "@mui/material";
import { AXEL_ABI, type Fsm } from "../lib/arc";
import { MONO, DISPLAY } from "../lib/theme";
import { matchPairs, simulateMatch } from "../lib/replay";
import Avatar from "./Avatar";
import MatchReplay from "./MatchReplay";

/** Ultra-compact address for one-line match displays. */
export function tinyAddr(a: string) {
  return a ? a.slice(0, 4) + "…" : "—";
}

function toFsm(raw: readonly unknown[]): Fsm | null {
  try {
    const [a, c, d] = raw as [readonly unknown[], readonly unknown[], readonly unknown[]];
    if (!a || a.length === 0) return null;
    return {
      actions: a.map(Number),
      transitionsC: c.map(Number),
      transitionsD: d.map(Number),
    };
  } catch {
    return null;
  }
}

/** Match cards (reference style) + click-to-watch deterministic replays. */
export default function MatchList({
  tid,
  hub,
  revealers,
  numRounds,
  chainScores,
}: {
  tid: number;
  hub: `0x${string}`;
  revealers: `0x${string}`[];
  numRounds: number;
  /** On-chain totals per player (cross-checked against replay sims). */
  chainScores: Map<string, bigint>;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  // Close any open replay when switching tournaments (render-time reset).
  const [prevTid, setPrevTid] = useState(tid);
  if (prevTid !== tid) {
    setPrevTid(tid);
    setOpenIdx(null);
  }

  const stratQ = useReadContracts({
    contracts: revealers.map((addr) => ({
      address: hub,
      abi: AXEL_ABI,
      functionName: "getStrategy",
      args: [BigInt(tid), addr],
    })),
  });
  const stratError = stratQ.error;
  const stratRetry = stratQ.refetch;

  const fsms: (Fsm | null)[] = useMemo(
    () =>
      (stratQ.data ?? []).map((d) =>
        d.status === "success" ? toFsm(d.result as unknown as readonly unknown[]) : null
      ),
    [stratQ.data]
  );
  const ready = fsms.length === revealers.length && fsms.every(Boolean);

  const sims = useMemo(() => {
    if (!ready) return [];
    return matchPairs(revealers.length).map(([i, j]) => {
      const s = simulateMatch(fsms[i] as Fsm, fsms[j] as Fsm, numRounds);
      return { i, j, ...s };
    });
  }, [ready, fsms, revealers.length, numRounds]);

  // Cross-check: replay totals must equal on-chain scores.
  const mismatch = useMemo(() => {
    if (!ready || sims.length === 0) return false;
    const sums = new Map<string, number>();
    for (const s of sims) {
      sums.set(revealers[s.i], (sums.get(revealers[s.i]) ?? 0) + s.totalA);
      sums.set(revealers[s.j], (sums.get(revealers[s.j]) ?? 0) + s.totalB);
    }
    for (const [addr, pts] of chainScores) {
      if ((sums.get(addr) ?? -1) !== Number(pts)) return true;
    }
    return false;
  }, [ready, sims, revealers, chainScores]);

  if (revealers.length < 2) return null;

  const open = openIdx !== null ? sims[openIdx] : null;

  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="h6" gutterBottom>Matches</Typography>
      {!ready && !stratError && (
        <Typography variant="body2" color="text.secondary">Loading strategies…</Typography>
      )}
      {stratError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => stratRetry()}>
              Retry
            </Button>
          }
        >
          Couldn&apos;t load strategies: {String(stratError.message ?? stratError).slice(0, 160)}
        </Alert>
      )}
      {mismatch && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Replay totals don&apos;t match chain scores — strategies may have changed view. Scores above are on-chain truth.
        </Alert>
      )}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" },
          gap: 2,
        }}
      >
        {sims.map((s, k) => (
          <Box
            key={k}
            sx={{
              border: openIdx === k ? "2px solid #18181b" : "1px solid #e4e4e7",
              p: 2,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
              <Avatar address={revealers[s.i]} size={36} />
              <Typography variant="body2" noWrap sx={{ fontFamily: MONO, fontWeight: 700 }}>
                {tinyAddr(revealers[s.i])}
              </Typography>
              <Typography variant="caption" color="text.secondary">vs</Typography>
              <Typography variant="body2" noWrap sx={{ fontFamily: MONO, fontWeight: 700 }}>
                {tinyAddr(revealers[s.j])}
              </Typography>
              <Avatar address={revealers[s.j]} size={36} />
            </Box>
            <Box
              sx={{
                mt: 1.5,
                pt: 1.5,
                borderTop: "1px solid #e4e4e7",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Typography variant="h6" sx={{ fontFamily: DISPLAY, fontSize: "1.35rem" }}>
                {s.totalA} – {s.totalB}
              </Typography>
              <Button size="small" color="error" onClick={() => setOpenIdx(k)}>
                Watch →
              </Button>
            </Box>
          </Box>
        ))}
      </Box>
      {open && (
        <MatchReplay
          open={openIdx !== null}
          onClose={() => setOpenIdx(null)}
          addrA={revealers[open.i]}
          addrB={revealers[open.j]}
          fsmA={fsms[open.i] as Fsm}
          fsmB={fsms[open.j] as Fsm}
          numRounds={numRounds}
        />
      )}
    </Box>
  );
}
