"use client";

import { useEffect, useState } from "react";
import {
  useAccount,
  useBytecode,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { formatEther, parseEther } from "viem";
import { generatePrivateKey } from "viem/accounts";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  LinearProgress,
  Link,
  MenuItem,
  Select,
  Step,
  StepLabel,
  Stepper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import {
  AXEL_ABI,
  AXEL_ADDRESS_MAINNET,
  arcTestnet,
  hubFor,
  PAYOFFS,
  PRESETS,
  PAY_CAPTIONS,
  PHASE_LABEL,
  randomFsm,
  friendlyError,
  parseTournament,
  type Fsm,
} from "../lib/arc";
import {
  circleLayout,
  syncPositions,
  unreachableStates,
  pruneUnreachable,
  removeStateAt,
  type Pos,
} from "../lib/fsm";
import { MONO, DISPLAY } from "../lib/theme";
import FsmCanvas, { type LinkMode } from "../components/FsmCanvas";
import WalletButton from "../components/WalletButton";
import Countdown from "../components/Countdown";
import MatchList from "../components/MatchList";

const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

function short(a: string) {
  return a ? a.slice(0, 6) + "…" + a.slice(-4) : "—";
}

type Saved = { salt: `0x${string}`; fsm: Fsm; commitment: `0x${string}` };

function saltKey(chainId: number | undefined, account: string | undefined, tid: number) {
  if (!chainId || !account) return null;
  return `axel:${chainId}:${account.toLowerCase()}:${tid}`;
}

function loadSaved(chainId: number | undefined, account: string | undefined, tid: number): Saved | null {
  const k = saltKey(chainId, account, tid);
  if (!k) return null;
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

const CUSTOM_BLURB = "Your own design. Every match begins at START.";

export default function Home() {
  const { address, isConnected, chain } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  // Hub follows the wallet network (mainnet slot via NEXT_PUBLIC_hub_MAINNET).
  const hub = hubFor(chain?.id);
  const MAINNET_SET = AXEL_ADDRESS_MAINNET !== "0x0000000000000000000000000000000000000000";
  const { switchChain } = useSwitchChain();
  const doSwitch = (chainId: number) => switchChain({ chainId });

  const [tab, setTab] = useState<"play" | "guide">("play");

  // --- tournament selection (null = latest) ---
  const [tidSel, setTidSel] = useState<number | null>(null);

  // --- strategy builder state ---
  const [fsm, setFsm] = useState<Fsm>(PRESETS[0].fsm);
  const [positions, setPositions] = useState<Pos[]>(() => circleLayout(PRESETS[0].fsm.actions.length));
  const [selected, setSelected] = useState<number | null>(null);
  const [linkMode, setLinkMode] = useState<LinkMode>(null);
  const [presetName, setPresetName] = useState(PRESETS[0].name);
  const [blurb, setBlurb] = useState(PRESETS[0].blurb);

  const [saved, setSaved] = useState<Saved | null>(null);
  const [msg, setMsg] = useState("");
  const fail = (e: unknown) => setMsg("Failed: " + friendlyError(e));
  const [paySel, setPaySel] = useState("0,0");

  // --- create form ---
  const [showCreate, setShowCreate] = useState(false);
  const [fPlayers, setFPlayers] = useState("4");
  const [fRounds, setFRounds] = useState("50");
  const [fCommitMin, setFCommitMin] = useState("10");
  const [fRevealMin, setFRevealMin] = useState("10");
  const [fBond, setFBond] = useState("1");

  // --- chain reads ---
  const countQ = useReadContract({ address: hub, abi: AXEL_ABI, functionName: "tournamentCount" });
  const count = countQ.data !== undefined ? Number(countQ.data) : 0;
  const tid = tidSel ?? (count > 0 ? count - 1 : 0);
  const tidArg = BigInt(tid);

  const tournQ = useReadContract({
    address: hub, abi: AXEL_ABI, functionName: "getTournament",
    args: [tidArg],
  });
  const T = tournQ.data ? parseTournament(tournQ.data as unknown as readonly unknown[]) : null;
  const exists = !!T && T.expectedPlayers > BigInt(0);

  const phase = useReadContract({
    address: hub, abi: AXEL_ABI, functionName: "currentPhase",
    args: [tidArg],
  });
  const results = useReadContract({
    address: hub, abi: AXEL_ABI, functionName: "getResults",
    args: [tidArg],
  });
  const myCommit = useReadContract({
    address: hub, abi: AXEL_ABI, functionName: "commitments",
    args: address ? [tidArg, address] : undefined,
  });
  const myRevealed = useReadContract({
    address: hub, abi: AXEL_ABI, functionName: "hasRevealed",
    args: address ? [tidArg, address] : undefined,
  });
  const myClaimable = useReadContract({
    address: hub, abi: AXEL_ABI, functionName: "claimable",
    args: address ? [tidArg, address] : undefined,
  });
  const claimedQ = useReadContract({
    address: hub, abi: AXEL_ABI, functionName: "claimed",
    args: address ? [tidArg, address] : undefined,
  });
  // Latest tournament drives the creation gate (arg clamped; ignored when empty).
  const latestQ = useReadContract({
    address: hub, abi: AXEL_ABI, functionName: "getTournament",
    args: [BigInt(Math.max(count - 1, 0))],
  });
  const axCode = useBytecode({ address: hub });

  const queries = [countQ, tournQ, phase, results, myCommit, myRevealed, myClaimable, claimedQ, latestQ];
  const refetchAll = () => {
    for (const q of queries) q.refetch?.();
  };

  useEffect(() => {
    const i = setInterval(refetchAll, 10000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tid]);

  useEffect(() => {
    // Post-hydration localStorage sync: localStorage doesn't exist during
    // prerender, and reading it at render would hydrate-mismatch for
    // returning users. This intentionally runs once client-side per key.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(loadSaved(chain?.id, address, tid));
  }, [chain?.id, address, tid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLinkMode(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    // Firefox restores tabs (incl. after browser restart) from memory with the
    // old JS bundle and dead queries. Force a real reload in that case.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // Client wall-clock for countdown gating. Synced in callbacks (never at
  // render) so server prerenders stay deterministic — see Countdown.useNow.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    let i: ReturnType<typeof setInterval> | undefined;
    const t = setTimeout(() => {
      setNowMs(Date.now());
      i = setInterval(() => setNowMs(Date.now()), 1000);
    }, 0);
    return () => {
      clearTimeout(t);
      if (i !== undefined) clearInterval(i);
    };
  }, []);

  // --- builder helpers ---
  const markCustom = () => {
    setPresetName("Custom");
    setBlurb(CUSTOM_BLURB);
  };
  const applyFsm = (next: Fsm, relayout = false) => {
    setFsm(next);
    setPositions((prev) => (relayout ? circleLayout(next.actions.length) : syncPositions(next.actions.length, prev)));
    setSelected((s) => (s !== null && s < next.actions.length ? s : null));
    setLinkMode(null);
  };
  const applyPreset = (name: string, blurbText: string, next: Fsm) => {
    setFsm(next);
    setPositions(circleLayout(next.actions.length));
    setSelected(null);
    setLinkMode(null);
    setPresetName(name);
    setBlurb(blurbText);
  };
  const toggleAction = (i: number) => {
    const a = [...fsm.actions];
    a[i] = 1 - a[i];
    applyFsm({ ...fsm, actions: a });
    markCustom();
  };
  const tapNode = (i: number) => {
    if (linkMode) {
      const key = linkMode.kind === "C" ? "transitionsC" : "transitionsD";
      const t = [...fsm[key]];
      t[linkMode.from] = i;
      applyFsm({ ...fsm, [key]: t });
      markCustom();
      setSelected(linkMode.from);
    } else if (selected === i) {
      toggleAction(i);
    } else {
      setSelected(i);
    }
  };
  const setAction = (i: number, v: number) => {
    const a = [...fsm.actions];
    a[i] = v;
    applyFsm({ ...fsm, actions: a });
    markCustom();
  };
  const addState = () => {
    const n = fsm.actions.length;
    if (n >= 256) return;
    // Interconnect: branch off the selected state (else START). Its defect
    // arrow leads to the new state; the new state forgives back on cooperate
    // and holds itself on defect. E.g. AllC + add = Grim Trigger.
    const from = selected !== null && selected < n ? selected : 0;
    applyFsm({
      actions: [...fsm.actions, 0],
      transitionsC: [...fsm.transitionsC, from],
      transitionsD: [...fsm.transitionsD.map((t, i) => (i === from ? n : t)), n],
    });
    markCustom();
    setSelected(n);
  };
  const deleteSelected = () => {
    if (selected === null) return;
    applyFsm(removeStateAt(fsm, selected));
    markCustom();
    setSelected(null);
  };

  const createTournament = async () => {
    try {
      if (prevRunning) {
        setMsg(`Tournament #${count - 1} is still running — new games unlock when it finishes.`);
        return;
      }
      const players = Number(fPlayers);
      const rounds = Number(fRounds);
      const cw = Number(fCommitMin) * 60;
      const rw = Number(fRevealMin) * 60;
      const bondWei = parseEther(fBond || "0");
      if (!Number.isInteger(players) || players < 2 || players > 16) throw new Error("players must be 2–16");
      if (!Number.isInteger(rounds) || rounds < 1 || rounds > 1000) throw new Error("rounds must be 1–1000");
      if (cw < 60 || rw < 60) throw new Error("each window must be at least 1 minute");
      if (cw + rw > 25 * 60) throw new Error("commit + reveal windows must fit in 25 minutes (30-min game cap)");
      setMsg("Creating tournament… check your wallet.");
      await writeContractAsync({
        address: hub, abi: AXEL_ABI, functionName: "createTournament",
        args: [BigInt(players), BigInt(rounds), BigInt(cw), BigInt(rw), bondWei],
      });
      // New id = pre-creation count.
      setTidSel(count);
      setShowCreate(false);
      setMsg("Tournament created. Others can seal bots now — games run 30 minutes max.");
      setTimeout(refetchAll, 2500);
    } catch (e: unknown) {
      fail(e);
    }
  };

  const dead = unreachableStates(fsm);

  const notConfigured = hub === "0x0000000000000000000000000000000000000000";
  const phaseNum = typeof phase.data === "number" ? phase.data : Number(phase.data ?? 0);
  const phaseKnown = exists && phase.data !== undefined;
  const committed = myCommit.data !== undefined && myCommit.data !== ZERO;
  const revealed = myRevealed.data === true;

  // Creation gate: a new tournament unlocks only once the latest one finished.
  const latest = count > 0 && latestQ.data
    ? parseTournament(latestQ.data as unknown as readonly unknown[])
    : null;
  const prevRunning = !!latest && !latest.finished;

  // Withdraw gating: only when finished, never twice, never on zero.
  const [withdrawnFor, setWithdrawnFor] = useState<string | null>(null);
  const withdrawKey = `${tid}:${(address ?? "").toLowerCase()}`;
  const alreadyWithdrawn = claimedQ.data === true || withdrawnFor === withdrawKey;
  const nothingToClaim =
    myClaimable.data !== undefined && (myClaimable.data as bigint) === BigInt(0);
  const withdrawOpen = !!T?.finished && !alreadyWithdrawn && !nothingToClaim;

  const nowSec = nowMs / 1000;
  const revealOpenable =
    !!T && T.numCommitters > BigInt(0) &&
    (T.numCommitters >= T.expectedPlayers ||
      (T.commitDeadline > BigInt(0) && nowSec >= Number(T.commitDeadline)));
  const expirable =
    !!T && !T.finished && T.expiresAt > BigInt(0) && nowSec >= Number(T.expiresAt);

  const fmtDate = (ts: bigint | undefined) =>
    ts && ts > BigInt(0) ? new Date(Number(ts) * 1000).toLocaleString() : undefined;
  const commitClose = T ? fmtDate(T.commitDeadline) : undefined;
  const revealClose = T ? fmtDate(T.revealDeadline) : undefined;
  const fieldCount = T ? `${String(T.numCommitters)}/${String(T.expectedPlayers)} sealed` : undefined;

  const rows = (() => {
    const d = results.data as unknown as [`0x${string}`[], bigint[]] | undefined;
    if (!d) return [];
    return d[0].map((a, i) => ({ addr: a, pts: d[1][i] })).sort((x, y) => (y.pts > x.pts ? 1 : -1));
  })();
  const top = rows.length ? Number(rows[0].pts) : 0;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
        <Box>
          <Typography variant="h4" component="h1">Axel on Arc</Typography>
          <Typography variant="body2" color="text.secondary">
            Strategy-bot tournaments · 30 minutes max · bond pot split by score
          </Typography>
        </Box>
        <WalletButton />
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mt: 2 }}>
        <Tab value="play" label="Arena" />
        <Tab value="guide" label="Guide" />
      </Tabs>
      <Divider />

      {notConfigured && (
        <Alert severity="error" sx={{ mt: 2 }}>
          Contract not configured — set <code>NEXT_PUBLIC_hub</code> after deploying (see README).
        </Alert>
      )}
      {!notConfigured && axCode.data !== undefined && (axCode.data === "0x" || axCode.data === null) && (
        <Alert
          severity="warning"
          sx={{ mt: 2 }}
          action={
            chain?.id !== 5042 && MAINNET_SET ? (
              <Button color="inherit" size="small" onClick={() => doSwitch(5042)}>
                Switch to Arc
              </Button>
            ) : undefined
          }
        >
          No tournament contract at <code>{short(hub)}</code> on {chain?.name ?? "this network"} — switch to a network that has it{chain?.id !== 5042 && MAINNET_SET ? ", e.g. Arc mainnet" : ""}.
        </Alert>
      )}

      {tab === "guide" ? (
        <Guide paySel={paySel} setPaySel={setPaySel} />
      ) : (
        <>
          {/* tournament picker + creation */}
          <Box sx={{ mt: 2, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5 }}>
            <Typography variant="overline" color="text.secondary">Tournament</Typography>
            {count > 0 ? (
              <Select
                value={tid}
                size="small"
                onChange={(e) => setTidSel(Number(e.target.value))}
                sx={{ fontFamily: MONO, minWidth: 120 }}
              >
                {Array.from({ length: count }, (_, i) => (
                  <MenuItem key={i} value={i} sx={{ fontFamily: MONO }}>
                    #{i}{i === count - 1 ? " · latest" : ""}
                  </MenuItem>
                ))}
              </Select>
            ) : (
              <Typography variant="body2" color="text.secondary">none yet</Typography>
            )}
            <Button size="small" onClick={refetchAll}>Refresh</Button>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setShowCreate((s) => !s)}
              disabled={prevRunning}
              title={prevRunning ? `Tournament #${count - 1} is still running` : "Start a new tournament"}
            >
              {showCreate ? "Close" : "+ New tournament"}
            </Button>
          </Box>
          {prevRunning && (
            <Alert severity="info" sx={{ mt: 1.5 }}>
              Tournament #{count - 1} is still running — creating unlocks when it finishes.
            </Alert>
          )}

          {showCreate && (
            <Box sx={{ mt: 2, display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(5, 1fr)" }, gap: 1.5 }}>
              <TextField label="Players" size="small" value={fPlayers} onChange={(e) => setFPlayers(e.target.value)} helperText="2–16" />
              <TextField label="Rounds" size="small" value={fRounds} onChange={(e) => setFRounds(e.target.value)} helperText="per match" />
              <TextField label="Commit (min)" size="small" value={fCommitMin} onChange={(e) => setFCommitMin(e.target.value)} helperText="≥ 1" />
              <TextField label="Reveal (min)" size="small" value={fRevealMin} onChange={(e) => setFRevealMin(e.target.value)} helperText="≥ 1" />
              <TextField label="Bond (USDC)" size="small" value={fBond} onChange={(e) => setFBond(e.target.value)} helperText="0 = free" />
              <Box sx={{ gridColumn: "1 / -1" }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  Windows must fit in 25 minutes — every game ends ≤ 30 min after its first seal.
                </Typography>
                <Button variant="contained" onClick={createTournament} disabled={!isConnected || isPending} sx={{ mt: 1 }}>
                  Create tournament
                </Button>
              </Box>
            </Box>
          )}

          {!exists ? (
            <Alert severity="info" sx={{ mt: 2 }}>
              {count === 0
                ? "No tournaments yet — create the first one above."
                : "That tournament doesn't exist here — pick another above."}
            </Alert>
          ) : (
            <>
              <Stepper activeStep={Math.min(phaseNum, PHASE_LABEL.length - 1)} sx={{ mt: 3 }}>
                {PHASE_LABEL.map((p) => (
                  <Step key={p}>
                    <StepLabel>{p}</StepLabel>
                  </Step>
                ))}
              </Stepper>

              {/* countdowns — the missing piece */}
              <Box sx={{ mt: 1.5, display: "flex", flexWrap: "wrap", gap: 1, columnGap: 3 }}>
                {phaseNum === 0 && T.commitDeadline > BigInt(0) && (
                  <Countdown to={T.commitDeadline} prefix="Commits close in" expiredText="— commits closed" />
                )}
                {phaseNum === 0 && T.commitDeadline === BigInt(0) && (
                  <Typography variant="body2" color="text.secondary">Commit clock starts on the first seal.</Typography>
                )}
                {phaseNum === 1 && (
                  <Countdown to={T.revealDeadline} prefix="Reveals close in" expiredText="— reveals closed" />
                )}
                {T.expiresAt > BigInt(0) && !T.finished && (
                  <Countdown to={T.expiresAt} prefix="Game ends in" expiredText="— expired, force-finish available" />
                )}
              </Box>

              <Box sx={{ mt: 2, display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" }, gap: 2 }}>
                <Stat label="Field" value={`${String(T.numCommitters)}/${String(T.expectedPlayers)} sealed · ${String(T.numRevealers)} revealed`} />
                <Stat label="Matches" value={`${String(T.matchesPlayed)} / ${String(T.totalMatches)}`} />
                <Stat label="Rounds / match" value={String(T.numRounds)} />
                <Stat label="Bond pot" value={`${formatEther(T.totalBondPot)} USDC`} />
              </Box>

              {msg && (
                <Alert severity={msg.startsWith("Failed") ? "error" : "info"} sx={{ mt: 2 }}>
                  {msg}
                </Alert>
              )}

              <Divider sx={{ my: 3 }} />

              <Typography variant="overline" color="text.secondary">Step 1</Typography>
              <Typography variant="h6" gutterBottom>Build your bot</Typography>
              <Typography variant="body2" color="text.secondary">
                {presetName} — {blurb}
              </Typography>
              <Box sx={{ mt: 1.5, display: "flex", flexWrap: "wrap", gap: 1 }}>
                {PRESETS.map((p) => (
                  <Chip
                    key={p.name}
                    label={p.name}
                    clickable
                    onClick={() => applyPreset(p.name, p.blurb, p.fsm)}
                    color={presetName === p.name ? "primary" : "default"}
                    variant={presetName === p.name ? "filled" : "outlined"}
                  />
                ))}
                <Chip
                  label="Random"
                  clickable
                  variant="outlined"
                  onClick={() => applyPreset("Random", "A roll of the dice, 2–16 states. Unreadable — and unreadable invites defection.", randomFsm())}
                />
              </Box>

              <Box sx={{ mt: 2, bgcolor: "#f6f3ea", p: 1 }}>
                <FsmCanvas
                  fsm={fsm}
                  positions={positions}
                  selected={selected}
                  linkMode={linkMode}
                  onMove={(i, p) => setPositions((prev) => prev.map((q, j) => (j === i ? p : q)))}
                  onTapNode={tapNode}
                  onBackgroundTap={() => setSelected(null)}
                />
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 1, pb: 1 }}>
                  Drag circles to arrange · click to select, click again to flip C/D · gold cooperates, red defects, arrows follow the foe&apos;s last move
                </Typography>
              </Box>

              <Box sx={{ mt: 2 }}>
                {selected === null ? (
                  <Typography variant="body2" color="text.secondary">
                    Click a circle to edit it.
                    {linkMode && (
                      <> …or click a circle now to set it as the on-{linkMode.kind} target for s{linkMode.from}.{" "}
                        <Button size="small" onClick={() => setLinkMode(null)}>Cancel (Esc)</Button>
                      </>
                    )}
                  </Typography>
                ) : (
                  <Box>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <Typography variant="subtitle1" sx={{ fontFamily: MONO, fontWeight: 700 }}>
                        {selected === 0 ? "START (s0)" : `s${selected}`}
                      </Typography>
                      <Button size="small" onClick={() => setSelected(null)}>Deselect</Button>
                    </Box>
                    <Box sx={{ mt: 1, display: "flex", gap: 1 }}>
                      <Button
                        fullWidth
                        variant={fsm.actions[selected] === 0 ? "contained" : "outlined"}
                        color={fsm.actions[selected] === 0 ? "warning" : "inherit"}
                        onClick={() => setAction(selected, 0)}
                      >
                        Cooperate
                      </Button>
                      <Button
                        fullWidth
                        variant={fsm.actions[selected] === 1 ? "contained" : "outlined"}
                        color={fsm.actions[selected] === 1 ? "error" : "inherit"}
                        onClick={() => setAction(selected, 1)}
                      >
                        Defect
                      </Button>
                    </Box>
                    {(["C", "D"] as const).map((kind) => {
                      const key = kind === "C" ? "transitionsC" : "transitionsD";
                      const arming = linkMode?.from === selected && linkMode?.kind === kind;
                      return (
                        <Box key={kind} sx={{ mt: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <Typography variant="body2" color="text.secondary">
                            foe {kind} → <b style={{ fontFamily: MONO }}>s{fsm[key][selected]}</b>
                          </Typography>
                          <Button
                            size="small"
                            variant={arming ? "contained" : "outlined"}
                            onClick={() => setLinkMode({ from: selected, kind })}
                          >
                            {arming ? "click a circle…" : "Rewire"}
                          </Button>
                        </Box>
                      );
                    })}
                    <Button
                      color="error"
                      size="small"
                      onClick={deleteSelected}
                      disabled={fsm.actions.length <= 1}
                      sx={{ mt: 1 }}
                    >
                      Delete this state
                    </Button>
                  </Box>
                )}
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={addState}
                  disabled={fsm.actions.length >= 256}
                  title="Branches off the selected state's defect arrow (or START's); returns on cooperate"
                  sx={{ mt: 2 }}
                >
                  + Add state ({fsm.actions.length}/256)
                </Button>
                {dead.length > 0 && (
                  <Alert
                    severity="warning"
                    sx={{ mt: 2 }}
                    action={
                      <Button color="inherit" size="small" onClick={() => { applyFsm(pruneUnreachable(fsm), true); markCustom(); }}>
                        Prune
                      </Button>
                    }
                  >
                    s{dead.join(", s")} unreachable from START — never play{dead.length === 1 ? "s" : ""}.
                  </Alert>
                )}
              </Box>

              <Divider sx={{ my: 3 }} />

              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 3 }}>
                <Box>
                  <Typography variant="overline" color="text.secondary">Step 2</Typography>
                  <Typography variant="h6" gutterBottom>Seal it</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Hashed with a random salt{T.bondAmount !== BigInt(0) ? <> plus a <b>{formatEther(T.bondAmount)} USDC</b> bond</> : null}.
                    Salt backup downloads — keep it: no salt, no reveal.{committed ? " Sealed." : ""}
                    {fieldCount ? <> Field: {fieldCount}{commitClose ? <>, commits close {commitClose}</> : null}.</> : null}
                  </Typography>
                  <CommitBox
                    tid={tid} hub={hub} fsm={fsm} bond={T.bondAmount} disabled={!isConnected || isPending || committed || (phaseKnown && phaseNum !== 0)}
                    onDone={(s) => { setSaved(s); setMsg("Sealed. Salt saved in this browser and downloaded — come back for the reveal."); setTimeout(refetchAll, 2500); }}
                    onError={fail}
                  />
                  {phaseKnown && phaseNum !== 0 && !committed && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                      Sealing is closed — this tournament is past the commit phase.
                    </Typography>
                  )}
                </Box>
                <Box>
                  <Typography variant="overline" color="text.secondary">Step 3</Typography>
                  <Typography variant="h6" gutterBottom>Reveal &amp; play</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {phaseKnown && phaseNum === 0
                      ? <>Reveals aren&apos;t open yet — press <b>Open reveals</b> once the field is set or the commit timer lapses, then reveal here.</>
                      : <>Miss the timer and you score zero.{revealed ? " Revealed." : saved ? " Saved bot found in this browser." : " No saved bot here — reveal from the device you sealed with."}{revealClose ? <> Reveals close {revealClose}.</> : null}</>}
                  </Typography>
                  <Box sx={{ mt: 2, display: "flex", flexWrap: "wrap", gap: 1 }}>
                    <RevealBox
                      tid={tid} hub={hub} saved={saved} disabled={!isConnected || isPending || revealed || (phaseKnown && phaseNum !== 1)}
                      onDone={() => { setMsg("Revealed. Good luck."); setTimeout(refetchAll, 2500); }}
                      onError={fail}
                    />
                    <PhaseButton label="Open reveals" hub={hub} fn="startReveal" args={[tidArg]} disabled={!isConnected || isPending || (phaseKnown && (phaseNum !== 0 || !revealOpenable))} onDone={() => { setMsg("Reveal phase opened."); setTimeout(refetchAll, 2500); }} onError={fail} />
                    <PhaseButton label="Crank matches" hub={hub} fn="playMatches" args={[tidArg, BigInt(50)]} disabled={!isConnected || isPending || (phaseKnown && phaseNum !== 2)} onDone={() => { setMsg("Matches cranked."); setTimeout(refetchAll, 2500); }} onError={fail} />
                    {expirable && (
                      <PhaseButton label="Force-finish" hub={hub} fn="forceFinish" args={[tidArg]} disabled={!isConnected || isPending} onDone={() => { setMsg("Tournament force-finished. Withdraw when ready."); setTimeout(refetchAll, 2500); }} onError={fail} />
                    )}
                  </Box>
                  {phaseKnown && phaseNum === 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                      {revealOpenable
                        ? "The field is set or the timer lapsed — press Open reveals."
                        : <>Opens when the field fills ({fieldCount ?? "…"}){commitClose ? <> or after {commitClose}</> : null}.</>}
                    </Typography>
                  )}
                </Box>
              </Box>

              <Divider sx={{ my: 3 }} />

              <Typography variant="overline" color="text.secondary">Step 4</Typography>
              <Typography variant="h6" gutterBottom>Results</Typography>
              {rows.length === 0 ? (
                <Typography variant="body2" color="text.secondary">Nothing revealed yet.</Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>#</TableCell>
                      <TableCell>Player</TableCell>
                      <TableCell align="right">Points</TableCell>
                      <TableCell sx={{ width: "30%" }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((r, rank) => (
                      <TableRow key={r.addr} selected={r.addr === address}>
                        <TableCell sx={{ fontFamily: MONO }}>{rank + 1}</TableCell>
                        <TableCell sx={{ fontFamily: MONO }}>{short(r.addr)}{r.addr === address ? " · you" : ""}</TableCell>
                        <TableCell align="right" sx={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: "1.05rem" }}>{String(r.pts)}</TableCell>
                        <TableCell>
                          <LinearProgress
                            variant="determinate"
                            value={top ? (Number(r.pts) / top) * 100 : 0}
                            color={r.addr === address ? "primary" : "success"}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Box sx={{ mt: 2, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  Your share: <b>{myClaimable.data !== undefined ? `${formatEther(myClaimable.data as bigint)} USDC` : "…"}</b>
                </Typography>
                <PhaseButton label={alreadyWithdrawn ? "Withdrawn" : "Withdraw"} hub={hub} fn="withdraw" args={[tidArg]} disabled={!isConnected || isPending || !withdrawOpen} onDone={() => { setWithdrawnFor(withdrawKey); setMsg("Withdrawn."); setTimeout(refetchAll, 2500); }} onError={fail} />
              </Box>
              {exists && T.revealers.length >= 2 && (
                <MatchList
                  tid={tid}
                  hub={hub}
                  revealers={T.revealers}
                  numRounds={Number(T.numRounds)}
                  chainScores={new Map(rows.map((r) => [r.addr, r.pts]))}
                />
              )}
              {exists && !T.finished && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                  Withdraw unlocks when the tournament finishes (or is force-finished past expiry).
                </Typography>
              )}
              {exists && !!T.finished && alreadyWithdrawn && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                  Already withdrawn — each wallet can claim once.
                </Typography>
              )}
              {exists && !!T.finished && !alreadyWithdrawn && nothingToClaim && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                  Nothing to claim for this wallet in this tournament.
                </Typography>
              )}
            </>
          )}
        </>
      )}

      <Divider sx={{ my: 4 }} />
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
        {hub !== "0x0000000000000000000000000000000000000000" ? (
          <Link
            href={`${chain?.blockExplorers?.default.url ?? arcTestnet.blockExplorers.default.url}/address/${hub}`}
            target="_blank"
            rel="noreferrer"
            variant="caption"
            color="text.secondary"
            underline="hover"
            sx={{ fontFamily: MONO }}
          >
            Contract {short(hub)} ↗
          </Link>
        ) : (
          <span />
        )}
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {chain?.name ?? "Disconnected"}
        </Typography>
      </Box>
    </Container>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontFamily: MONO, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</Typography>
    </Box>
  );
}

function CommitBox({ tid, hub, fsm, bond, disabled, onDone, onError }: {
  tid: number; hub: `0x${string}`; fsm: Fsm; bond: bigint | undefined; disabled: boolean;
  onDone: (s: Saved) => void; onError: (e: string) => void;
}) {
  const { address, chain } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      if (!address || chain?.id === undefined) throw new Error("connect first");
      if (bond === undefined) throw new Error("bond unknown — no tournament contract answers on this network. Check the network picker (contract lives on one chain only), refresh, and try again.");
      const { createPublicClient, http, keccak256, encodeAbiParameters } = await import("viem");
      const rpc =
        chain.id === 5042
          ? "https://rpc.mainnet.arc.io"
          : chain.id === 31337
            ? "http://127.0.0.1:8545"
            : "https://rpc.testnet.arc.io";
      const client = createPublicClient({ transport: http(rpc) });
      const salt = generatePrivateKey() as `0x${string}`;
      const commitment = keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "bytes32" }, { type: "uint8[]" }, { type: "uint8[]" }, { type: "uint8[]" }],
          [address, salt, fsm.actions, fsm.transitionsC, fsm.transitionsD]
        )
      );
      const onchain = (await client.readContract({
        address: hub, abi: AXEL_ABI, functionName: "computeCommitment",
        args: [address, salt, fsm.actions, fsm.transitionsC, fsm.transitionsD],
      })) as `0x${string}`;
      if (onchain !== commitment) throw new Error("hash mismatch — aborting");
      await writeContractAsync({ address: hub, abi: AXEL_ABI, functionName: "commit", args: [BigInt(tid), commitment], value: bond });
      const s: Saved = { salt, fsm, commitment };
      const k = saltKey(chain.id, address, tid);
      if (k) localStorage.setItem(k, JSON.stringify(s));
      const blob = new Blob([JSON.stringify({ account: address, chainId: chain.id, tournamentId: tid, ...s }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `axel-salt-backup-${address.slice(0, 6)}-t${tid}.json`;
      a.click();
      onDone(s);
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message.slice(0, 220) : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="contained" onClick={go} disabled={disabled || busy} sx={{ mt: 2 }}>
      {busy ? "Sealing…" : "Seal strategy"}
    </Button>
  );
}

function RevealBox({ tid, hub, saved, disabled, onDone, onError }: {
  tid: number; hub: `0x${string}`; saved: Saved | null; disabled: boolean;
  onDone: () => void; onError: (e: string) => void;
}) {
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      if (!saved) throw new Error("No saved entry for this account in this browser — reveal from the device you sealed with.");
      await writeContractAsync({
        address: hub, abi: AXEL_ABI, functionName: "reveal",
        args: [BigInt(tid), saved.salt, saved.fsm.actions, saved.fsm.transitionsC, saved.fsm.transitionsD],
      });
      onDone();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message.slice(0, 220) : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="contained" color="success" onClick={go} disabled={disabled || busy || !saved}>
      {busy ? "Revealing…" : "Reveal"}
    </Button>
  );
}

function PhaseButton({ label, hub, fn, args, disabled, onDone, onError }: {
  label: string; hub: `0x${string}`; fn: "startReveal" | "playMatches" | "withdraw" | "forceFinish"; args: unknown[];
  disabled: boolean; onDone: () => void; onError: (e: string) => void;
}) {
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await writeContractAsync({ address: hub, abi: AXEL_ABI, functionName: fn, args: args as any });
      onDone();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message.slice(0, 220) : String(e));
    } finally {
      setBusy(false);
    }
  };
  const primary = fn === "withdraw";
  return (
    <Button
      variant={primary ? "contained" : "outlined"}
      color={primary ? "primary" : "inherit"}
      onClick={go}
      disabled={disabled || busy}
    >
      {busy ? "Sending…" : label}
    </Button>
  );
}

function Guide({ paySel, setPaySel }: { paySel: string; setPaySel: (s: string) => void }) {
  const cells: [string, string][] = [["0,0", `${PAYOFFS.R},${PAYOFFS.R}`], ["0,1", `${PAYOFFS.S},${PAYOFFS.T}`], ["1,0", `${PAYOFFS.T},${PAYOFFS.S}`], ["1,1", `${PAYOFFS.P},${PAYOFFS.P}`]];
  const tft = PRESETS[0];
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="h5" gutterBottom>
        An iterated prisoner&apos;s dilemma, run as a tournament.
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Two strategies meet and play the same small game over and over. Each round both choose, at the same moment,
        to cooperate or defect. What helps you most in a single round tends to leave you both worse off across many.
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Defecting never scores worse in the moment, so the pull is always there. But if both sides keep defecting you
        each settle for one, when you could have shared three. Stretch that across hundreds of rounds against many
        opponents and the real question appears: when do you trust, and when do you punish?
      </Typography>

      <Divider sx={{ my: 3 }} />

      <Typography variant="h6" gutterBottom>Tit for Tat, drawn</Typography>
      <Typography variant="body2" color="text.secondary">{tft.blurb}</Typography>
      <Box sx={{ mt: 2, bgcolor: "#f6f3ea", p: 1 }}>
        <FsmCanvas fsm={tft.fsm} positions={circleLayout(tft.fsm.actions.length)} interactive={false} />
      </Box>

      <Divider sx={{ my: 3 }} />

      <Typography variant="h6" gutterBottom>Every round pays out like this. Tap a square to see each outcome.</Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0.5, maxWidth: 360 }}>
        <span />
        <Typography variant="caption" align="center" color="text.secondary">They cooperate</Typography>
        <Typography variant="caption" align="center" color="text.secondary">They defect</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>You cooperate</Typography>
        {cells.slice(0, 2).map(([k, v]) => <PayCell key={k} k={k} v={v} sel={paySel} set={setPaySel} />)}
        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>You defect</Typography>
        {cells.slice(2).map(([k, v]) => <PayCell key={k} k={k} v={v} sel={paySel} set={setPaySel} />)}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: MONO, mt: 1, display: "block" }}>
        your points / their points
      </Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>{PAY_CAPTIONS[paySel]}</Typography>

      <Divider sx={{ my: 3 }} />

      <Typography variant="h6" gutterBottom>Your strategy is a little machine</Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        A strategy can&apos;t see the future, only react to the past. Here it is a small state machine: each circle
        plays one move, gold to cooperate, red to defect, and the arrows say where to go next based on the move the
        opponent just made. Every match begins at START.
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Every revealed strategy plays every other for a fixed number of rounds. Your score is the sum of points from
        all your matches, and the highest total wins. This is the format Robert Axelrod used in the experiments that
        made tit-for-tat famous.
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Entries are committed in secret first, then revealed once the field is set. Keeping a strategy hidden until
        everyone is locked in means no one can copy or counter yours. Everything settles onchain, so the result is
        verifiable by anyone.
      </Typography>
    </Box>
  );
}

const PAY_BG: Record<string, string> = { "0,0": "#fde68a", "1,1": "#fecaca" };

function PayCell({ k, v, sel, set }: { k: string; v: string; sel: string; set: (s: string) => void }) {
  return (
    <Button
      onClick={() => set(k)}
      sx={{
        minWidth: 0,
        py: 2.5,
        fontSize: "1.4rem",
        fontWeight: 700,
        fontFamily: DISPLAY,
        color: "black",
        bgcolor: PAY_BG[k] ?? "#f5f5f5",
        borderRadius: 0,
        outline: k === sel ? "2px solid #18181b" : "none",
        outlineOffset: -2,
        "&:hover": { bgcolor: PAY_BG[k] ?? "#eeeeee" },
      }}
    >
      {v}
    </Button>
  );
}
