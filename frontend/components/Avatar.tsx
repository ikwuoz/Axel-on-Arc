"use client";

import { useMemo } from "react";
import { blo } from "blo";

/** Wallet identicon via blo (proper blockies): deterministic SVG data URI. */
export default function Avatar({ address, size = 40 }: { address: string; size?: number }) {
  const src = useMemo(() => {
    try {
      return blo(address as `0x${string}`);
    } catch {
      return "";
    }
  }, [address]);
  if (!src) return <span style={{ display: "inline-block", width: size, height: size, background: "#f5f5f5", flexShrink: 0 }} />;
  return (
    // Data-URI identicon: next/image cannot optimize it, plain img is correct.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={address}
      width={size}
      height={size}
      style={{ flexShrink: 0, display: "block" }}
    />
  );
}
