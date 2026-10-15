import type { Metadata } from "next";
import { Roboto, Roboto_Mono, Zilla_Slab } from "next/font/google";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";
import { Providers } from "../components/Providers";

const roboto = Roboto({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-roboto",
});

const robotoMono = Roboto_Mono({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-roboto-mono",
});

const display = Zilla_Slab({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "Axel on Arc — Prisoner's Dilemma Tournaments",
  description:
    "Buy in with USDC, play iterated Prisoner's Dilemma round-robins, take the pot. Built for Arc.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${roboto.variable} ${robotoMono.variable} ${display.variable}`}>
      <body>
        <AppRouterCacheProvider>
          <Providers>{children}</Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
