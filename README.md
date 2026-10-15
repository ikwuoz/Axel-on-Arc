# Axel on Arc

Iterated Prisoner's Dilemma **strategy-bot** tournaments (Robert Axelrod, 1980) with a **USDC bond pot split by score**, built for **Arc**.

## How it works

- **Your entry is a bot, not moves.** A strategy is a finite-state machine: `actions[i]` is the move in state `i` (0 = cooperate, 1 = defect); `transitionsC[i]` / `transitionsD[i]` pick the next state on foe cooperate / defect. Every match starts at state 0. Max 256 states.
- **Phases:** Commit (sealed hash + bond) → Reveal (miss it = zero points) → Playing (round-robin, cranked permissionlessly) → Finished → Withdraw. Anyone can crank `startReveal` / `playMatches` / `forceFinish`.
- **30-minute cap:** commit + reveal windows fit in 25 min; the clock starts on first seal and `forceFinish` settles stragglers at 30:00. Partial scores pay pro-rata; scoreless games refund bonds.
- **Scoring:** R=3/T=5/S=0/P=1 per round, fixed rounds per pair, highest total wins. Payouts: `yourScore × pot / totalScore`.
- **Presets:** Tit-for-Tat, Always Cooperate, Always Defect, Grim Trigger, Random.

## Repo layout

- `src/AxelTournament.sol` — one hub hosts unlimited tournaments; bonds post in the native token (on Arc, gas + bond are both USDC).
- `frontend/` — Next.js + wagmi/viem + MUI + RainbowKit: tournament picker + creation, live countdowns, drag-and-drop strategy builder, commit/reveal, crank, results, turn-by-turn match replays.
- `test/` — Foundry suite (7 tests). `script/` — hub deploy script.

## Run it

```bash
forge test                      # contracts
cd frontend && npm install && npm run dev   # http://localhost:3000
npm run build && npm run lint   # verify before pushing
```

Configure via `frontend/.env.local` (see `frontend/.env.example`):

```bash
NEXT_PUBLIC_AXEL_ADDRESS=0x_hub_on_your_chain
NEXT_PUBLIC_AXEL_ADDRESS_MAINNET=0x_mainnet_hub   # auto-used on Arc mainnet
```
