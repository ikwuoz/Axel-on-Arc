"use client";

import { ReactNode } from "react";
import {
  connectorsForWallets,
  RainbowKitProvider,
  lightTheme,
} from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  coinbaseWallet,
  braveWallet,
  rabbyWallet,
  phantomWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, WagmiProvider, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { localhost } from "wagmi/chains";
import { arcTestnet, arcMainnet } from "../lib/arc";
import { theme } from "../lib/theme";

// Curated wallet list. Two constraints shape it:
// 1. RainbowKit's default list pulls in the Base smart wallet SDK, which
//    breaks the Next SSR build (missing @x402/* modules).
// 2. Most popular entries (MetaMask, Rainbow, Trust, …) eagerly require a
//    WalletConnect projectId. These five don't — they detect the installed
//    extension and otherwise link to the download.
// To add the full list incl. WalletConnect QR: get a free ID from
// https://cloud.walletconnect.com, set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
// and add walletConnectWallet (plus @x402/*, already installed).
const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [injectedWallet, coinbaseWallet, braveWallet, rabbyWallet, phantomWallet],
    },
  ],
  {
    appName: "Axel on Arc",
    projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
  }
);

// Arc testnet is first = the default chain everywhere (reads + connects).
const config = createConfig({
  chains: [arcTestnet, arcMainnet, localhost],
  connectors,
  ssr: true,
  transports: {
    [arcTestnet.id]: http("https://rpc.testnet.arc.io"),
    [arcMainnet.id]: http("https://rpc.mainnet.arc.io"),
    [localhost.id]: http("http://127.0.0.1:8545"),
  },
});

const qc = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider
          initialChain={arcTestnet}
          modalSize="compact"
          theme={lightTheme({
            accentColor: "#18181b",
            accentColorForeground: "white",
            borderRadius: "large",
          })}
        >
          <ThemeProvider theme={theme}>
            <CssBaseline />
            {children}
          </ThemeProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
