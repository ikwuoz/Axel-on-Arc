"use client";

import { useEffect, useState } from "react";
import { Typography } from "@mui/material";
import { MONO } from "../lib/theme";

/** Ticking wall-clock (1s) so countdowns stay live without refetching. Syncs in a
 *  callback so server prerenders stay deterministic (no Date.now at render). */
export function useNow(stepMs = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    let i: ReturnType<typeof setInterval> | undefined;
    const t = setTimeout(() => {
      setNow(Date.now());
      i = setInterval(() => setNow(Date.now()), stepMs);
    }, 0);
    return () => {
      clearTimeout(t);
      if (i !== undefined) clearInterval(i);
    };
  }, [stepMs]);
  return now;
}

export function fmtLeft(ms: number): string {
  if (ms <= 0) return "00:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${p(h)}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
}

/** Live "label mm:ss" countdown to a unix-seconds deadline. Renders null when unset. */
export default function Countdown({
  to,
  prefix,
  expiredText = "ended",
}: {
  to?: bigint | number;
  prefix: string;
  expiredText?: string;
}) {
  const now = useNow();
  if (to === undefined || Number(to) === 0) return null;
  const ms = Number(to) * 1000 - now;
  if (ms <= 0) {
    return (
      <Typography variant="body2" color="warning.main">
        {prefix} {expiredText}
      </Typography>
    );
  }
  return (
    <Typography variant="body2">
      {prefix} <b style={{ fontFamily: MONO }}>{fmtLeft(ms)}</b>
    </Typography>
  );
}
