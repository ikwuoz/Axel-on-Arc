"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Button, Menu, MenuItem, Typography } from "@mui/material";
import { useAccount, useBalance, useConfig, useDisconnect, useSwitchChain, useChains } from "wagmi";
import { formatEther } from "viem";
import { localhost } from "wagmi/chains";
import { arcMainnet, arcTestnet } from "../lib/arc";

export const DEFAULT_CHAIN_ID = arcTestnet.id; // Arc testnet (funded via faucet)
const NETWORKS = [arcTestnet, arcMainnet, localhost];

/** Drop wagmi's persisted connector pick so a dead provider isn't re-picked on reload. */
async function forgetRecentConnector(config: {
  storage?: { removeItem(k: string): void | Promise<void> } | undefined | null;
}) {
  try {
    await config.storage?.removeItem("recentConnectorId");
  } catch {
    // storage unavailable — nothing to clear
  }
}

function short(a: string) {
  return a ? a.slice(0, 6) + "…" + a.slice(-4) : "—";
}

/** Compact header balance: "39.95016565" → "39.95", dust → "<0.01". */
function fmtBal(v?: string): string {
  if (!v) return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (n === 0) return "0";
  if (n < 0.01) return "<0.01";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Address pill with balance: first click arms, second click disconnects. */
function AddressPill({ address }: { address: `0x${string}` }) {
  const { disconnect } = useDisconnect();
  const config = useConfig();
  const { data: bal } = useBalance({ address });
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  const quit = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    disconnect();
    void forgetRecentConnector(config);
  };

  const label = `${short(address)}${bal ? ` · ${fmtBal(formatEther(bal.value))} ${bal.symbol}` : ""}`;
  return (
    <Button
      size="small"
      variant={armed ? "contained" : "outlined"}
      color={armed ? "error" : "inherit"}
      onClick={quit}
      onBlur={() => setArmed(false)}
      title={armed ? "Click again to disconnect" : "Click to disconnect"}
      sx={{ fontFamily: "var(--font-roboto-mono), monospace", textTransform: "none", whiteSpace: "nowrap" }}
    >
      {armed ? "Disconnect?" : label}
    </Button>
  );
}

/** Network picker using wagmi directly (reliable with custom Arc chains). */
function NetworkButton({ currentId }: { currentId: number | undefined }) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const { switchChain, isPending, variables, error, reset } = useSwitchChain();

  const pick = (chainId: number) => {
    reset();
    switchChain(
      { chainId },
      {
        onSuccess: () => setAnchor(null),
        // keep menu open on error so the message is visible
      }
    );
  };

  const current = NETWORKS.find((n) => n.id === currentId);
  return (
    <>
      <Button
        size="small"
        variant="outlined"
        color="inherit"
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ whiteSpace: "nowrap" }}
      >
        {current?.name ?? "Network"}
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {NETWORKS.map((n) => (
          <MenuItem
            key={n.id}
            selected={n.id === currentId}
            disabled={isPending}
            onClick={() => pick(n.id)}
          >
            {n.name}
            {n.id === DEFAULT_CHAIN_ID ? " · default" : ""}
            {isPending && variables?.chainId === n.id ? " · switching…" : ""}
          </MenuItem>
        ))}
        {error && (
          <Typography variant="caption" color="error" sx={{ display: "block", px: 2, py: 1, maxWidth: 260 }}>
            Couldn&apos;t switch: {error.message.slice(0, 140)}
          </Typography>
        )}
      </Menu>
    </>
  );
}

/**
 * Connecting state with watchdog. Mounted fresh on every attempt, so its
 * timers start clean with no reset logic needed.
 */
function ConnectingPanel({ onTimeout }: { onTimeout: () => void }) {
  const config = useConfig();
  const { disconnect } = useDisconnect();
  const [showStuck, setShowStuck] = useState(false);

  useEffect(() => {
    const started = Date.now();
    const hint = setTimeout(() => setShowStuck(true), 8000);
    // Dead providers (e.g. a wallet extension whose background page died)
    // never settle the handshake. Once 25s have passed, and whenever the page
    // is focused (i.e. the user is NOT mid-approve in a popup), give up and
    // forget the pick so reloads stop re-selecting it. Interval (not one-shot)
    // so returning to the tab later still recovers.
    const watch = setInterval(() => {
      if (Date.now() - started >= 25000 && document.hasFocus()) {
        clearInterval(watch);
        disconnect();
        void forgetRecentConnector(config).then(onTimeout);
      }
    }, 2000);
    return () => {
      clearTimeout(hint);
      clearInterval(watch);
    };
  }, [config, disconnect, onTimeout]);

  const cancel = () => {
    disconnect();
    void forgetRecentConnector(config);
  };

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <Button variant="outlined" size="small" disabled sx={{ whiteSpace: "nowrap" }}>
        Connecting…
      </Button>
      <Button size="small" onClick={cancel}>
        Cancel
      </Button>
      {showStuck && (
        <Typography variant="caption" color="warning.main" sx={{ maxWidth: 220 }}>
          Stuck? Unlock your wallet / disable conflicting wallet extensions, then Cancel + reconnect.
        </Typography>
      )}
    </span>
  );
}

/**
 * Truthful connection button driven by wagmi status (not RainbowKit's
 * account presence, which can show a stale connected face while the
 * connector is still handshaking).
 */
export default function WalletButton() {
  const { address, status, chain } = useAccount();
  const configured = useChains();
  const supported = chain !== undefined && configured.some((c) => c.id === chain.id);
  const { switchChain } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const [timedOut, setTimedOut] = useState(false);
  const handleTimeout = useCallback(() => setTimedOut(true), []);

  if (status === "connected" && address && supported) {
    return (
      <span style={{ display: "inline-flex", gap: 8, flexShrink: 0, whiteSpace: "nowrap" }}>
        <NetworkButton currentId={chain.id} />
        <AddressPill address={address} />
      </span>
    );
  }

  if (status === "connected" && !supported) {
    return (
      <Button
        variant="contained"
        size="small"
        color="warning"
        onClick={() => switchChain({ chainId: DEFAULT_CHAIN_ID })}
        sx={{ whiteSpace: "nowrap" }}
      >
        Wrong network · Switch to Arc Testnet
      </Button>
    );
  }

  if (status === "connecting" || status === "reconnecting") {
    return <ConnectingPanel onTimeout={handleTimeout} />;
  }

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <Button
        variant="contained"
        size="small"
        onClick={() => {
          setTimedOut(false);
          openConnectModal?.();
        }}
        sx={{ whiteSpace: "nowrap" }}
      >
        Connect wallet
      </Button>
      {timedOut && (
        <Typography variant="caption" color="error.main" sx={{ maxWidth: 200 }}>
          Last attempt timed out — the wallet didn&apos;t answer. Pick a different wallet, or unlock it first.
        </Typography>
      )}
    </span>
  );
}
