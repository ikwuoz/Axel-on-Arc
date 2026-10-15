import { createTheme } from "@mui/material/styles";

export const MONO =
  "var(--font-roboto-mono), ui-monospace, SFMono-Regular, Menlo, monospace";

export const DISPLAY =
  "var(--font-display), 'Zilla Slab', Georgia, 'Times New Roman', serif";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#18181b" },
    background: { default: "#ffffff", paper: "#ffffff" },
  },
  shape: { borderRadius: 4 },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontFamily: DISPLAY, fontWeight: 700, letterSpacing: "-0.01em" },
    h5: { fontFamily: DISPLAY, fontWeight: 700, letterSpacing: "-0.01em" },
    h6: { fontFamily: DISPLAY, fontWeight: 700 },
    overline: { fontFamily: MONO, letterSpacing: "0.12em" },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { fontFamily: MONO } },
    },
    MuiChip: { styleOverrides: { root: { borderRadius: 4 } } },
    MuiTab: { styleOverrides: { root: { fontFamily: MONO } } },
  },
});
