import { defineChain } from "viem";

// Canonical multicall3, genesis-deployed on both Arc chains (verified on-chain).
// Declaring it lets viem/wagmi batch reads; without it, batched reads stall.
const MULTICALL3 = {
  address: "0xca11bde05977b3631167028862be2a173976ca11",
  blockCreated: 0,
} as const;

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { decimals: 18, name: "USDC", symbol: "USDC" },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" },
  },
  contracts: { multicall3: MULTICALL3 },
  testnet: true,
});

export const arcMainnet = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { decimals: 18, name: "USDC", symbol: "USDC" },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.arc.io" },
  },
  contracts: { multicall3: MULTICALL3 },
});

/// Deployed AxelTournament hub — set via NEXT_PUBLIC_AXEL_ADDRESS.
/// Points at testnet by default; point .env.local wherever you're testing.
export const AXEL_ADDRESS = (process.env.NEXT_PUBLIC_AXEL_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

/// Mainnet hub slot — set via NEXT_PUBLIC_AXEL_ADDRESS_MAINNET once deployed.
export const AXEL_ADDRESS_MAINNET = (process.env.NEXT_PUBLIC_AXEL_ADDRESS_MAINNET ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

/// Hub registry by chain ID. Disconnected users resolve to the default hub.
/// To add a chain, add one line here + one env var (no call-site changes).
const HUBS: Record<number, `0x${string}` | undefined> = {
  5042: AXEL_ADDRESS_MAINNET,
  5042002: AXEL_ADDRESS,
  31337: AXEL_ADDRESS,
};

/** Resolve the hub for a chain (wallet network switches retarget automatically). */
export function hubFor(chainId: number | undefined): `0x${string}` {
  if (chainId !== undefined && HUBS[chainId] !== undefined) {
    return HUBS[chainId] as `0x${string}`;
  }
  return AXEL_ADDRESS;
}

export const AXEL_ABI = [
  { type: "function", name: "createTournament", stateMutability: "nonpayable",
    inputs: [
      { name: "expectedPlayers", type: "uint256" },
      { name: "numRounds", type: "uint256" },
      { name: "commitDuration", type: "uint256" },
      { name: "revealDuration", type: "uint256" },
      { name: "bondAmount", type: "uint256" },
    ], outputs: [{ name: "tournamentId", type: "uint256" }] },
  { type: "function", name: "commit", stateMutability: "payable",
    inputs: [
      { name: "tournamentId", type: "uint256" },
      { name: "commitment", type: "bytes32" },
    ], outputs: [] },
  { type: "function", name: "startReveal", stateMutability: "nonpayable",
    inputs: [{ name: "tournamentId", type: "uint256" }], outputs: [] },
  { type: "function", name: "reveal", stateMutability: "nonpayable",
    inputs: [
      { name: "tournamentId", type: "uint256" },
      { name: "salt", type: "bytes32" },
      { name: "actions", type: "uint8[]" },
      { name: "transitionsC", type: "uint8[]" },
      { name: "transitionsD", type: "uint8[]" },
    ], outputs: [] },
  { type: "function", name: "playMatches", stateMutability: "nonpayable",
    inputs: [
      { name: "tournamentId", type: "uint256" },
      { name: "maxMatches", type: "uint256" },
    ], outputs: [] },
  { type: "function", name: "forceFinish", stateMutability: "nonpayable",
    inputs: [{ name: "tournamentId", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable",
    inputs: [{ name: "tournamentId", type: "uint256" }], outputs: [] },
  { type: "function", name: "computeCommitment", stateMutability: "pure",
    inputs: [
      { name: "committer", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "actions", type: "uint8[]" },
      { name: "transitionsC", type: "uint8[]" },
      { name: "transitionsD", type: "uint8[]" },
    ], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "currentPhase", stateMutability: "view",
    inputs: [{ name: "tournamentId", type: "uint256" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "claimable", stateMutability: "view",
    inputs: [
      { name: "tournamentId", type: "uint256" },
      { name: "who", type: "address" },
    ], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getResults", stateMutability: "view",
    inputs: [{ name: "tournamentId", type: "uint256" }],
    outputs: [
      { name: "addrs", type: "address[]" },
      { name: "pts", type: "uint256[]" },
    ] },
  { type: "function", name: "getStrategy", stateMutability: "view",
    inputs: [
      { name: "tournamentId", type: "uint256" },
      { name: "player", type: "address" },
    ],
    outputs: [
      { name: "actions", type: "uint8[]" },
      { name: "transitionsC", type: "uint8[]" },
      { name: "transitionsD", type: "uint8[]" },
    ] },
  { type: "function", name: "getTournament", stateMutability: "view",
    inputs: [{ name: "tournamentId", type: "uint256" }],
    outputs: [
      { name: "expectedPlayers", type: "uint256" },
      { name: "numRounds", type: "uint256" },
      { name: "commitDuration", type: "uint256" },
      { name: "revealDuration", type: "uint256" },
      { name: "bondAmount", type: "uint256" },
      { name: "createdAt", type: "uint256" },
      { name: "commitDeadline", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
      { name: "numCommitters", type: "uint256" },
      { name: "revealStarted", type: "bool" },
      { name: "revealDeadline", type: "uint256" },
      { name: "numRevealers", type: "uint256" },
      { name: "matchesPlayed", type: "uint256" },
      { name: "totalMatches", type: "uint256" },
      { name: "totalScore", type: "uint256" },
      { name: "totalBondPot", type: "uint256" },
      { name: "finished", type: "bool" },
      { name: "committers", type: "address[]" },
      { name: "revealers", type: "address[]" },
    ] },
  { type: "function", name: "tournamentCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "MAX_TOURNAMENT_DURATION", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "MAX_STATES", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "MAX_ROUNDS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "scores", stateMutability: "view",
    inputs: [
      { name: "tournamentId", type: "uint256" },
      { name: "", type: "address" },
    ], outputs: [{ type: "uint256" }] },
  { type: "function", name: "commitments", stateMutability: "view",
    inputs: [
      { name: "tournamentId", type: "uint256" },
      { name: "", type: "address" },
    ], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "hasRevealed", stateMutability: "view",
    inputs: [
      { name: "tournamentId", type: "uint256" },
      { name: "player", type: "address" },
    ], outputs: [{ type: "bool" }] },
  { type: "function", name: "claimed", stateMutability: "view",
    inputs: [
      { name: "tournamentId", type: "uint256" },
      { name: "", type: "address" },
    ], outputs: [{ type: "bool" }] },
  // Custom errors (no inputs) so viem/wagmi decode revert reasons into names.
  { type: "error", name: "BadParams", inputs: [] },
  { type: "error", name: "WrongPhase", inputs: [] },
  { type: "error", name: "AlreadyCommitted", inputs: [] },
  { type: "error", name: "WrongBond", inputs: [] },
  { type: "error", name: "CommitClosed", inputs: [] },
  { type: "error", name: "RevealNotOpen", inputs: [] },
  { type: "error", name: "AlreadyRevealed", inputs: [] },
  { type: "error", name: "RevealClosed", inputs: [] },
  { type: "error", name: "InvalidStrategy", inputs: [] },
  { type: "error", name: "InvalidReveal", inputs: [] },
  { type: "error", name: "NothingToClaim", inputs: [] },
  { type: "error", name: "AlreadyClaimed", inputs: [] },
  { type: "error", name: "TransferFailed", inputs: [] },
  { type: "error", name: "Reentrant", inputs: [] },
  { type: "error", name: "NotExpired", inputs: [] },
] as const;

/** Human-readable translations of contract revert names. */
const FRIENDLY: [string, string][] = [
  ["CommitClosed", "Reveals can't open yet — the field isn't full and the commit timer hasn't lapsed."],
  ["WrongPhase", "That action isn't valid in the current phase."],
  ["AlreadyCommitted", "This wallet already sealed a bot."],
  ["WrongBond", "The bond must match exactly — don't edit the value."],
  ["RevealNotOpen", "Reveals aren't open yet — press Open reveals first."],
  ["AlreadyRevealed", "Already revealed."],
  ["RevealClosed", "The reveal window closed — that entry scores zero."],
  ["InvalidReveal", "Salt or bot doesn't match the sealed commitment. Reveal from the device you sealed with, or import the salt backup."],
  ["InvalidStrategy", "That bot breaks the rules (empty, over 256 states, or a transition pointing nowhere)."],
  ["NothingToClaim", "Nothing to withdraw for this wallet."],
  ["AlreadyClaimed", "Already withdrawn."],
  ["BadParams", "The tournament isn't configured correctly."],
  ["NotExpired", "Too early — the 30-minute game clock hasn't run out yet."],
];

/** Turn a wagmi/viem failure into a one-line human message. */
export function friendlyError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  for (const [name, text] of FRIENDLY) {
    if (m.includes(name)) return `${text} (${name})`;
  }
  const line = m.split("\n")[0];
  return line.slice(0, 220);
}

export const PAYOFFS = { R: 3, T: 5, S: 0, P: 1 };

// Reference strategy presets — byte-identical encodings (0 = cooperate, 1 = defect).
export type Fsm = { actions: number[]; transitionsC: number[]; transitionsD: number[] };
export const PRESETS: { name: string; blurb: string; fsm: Fsm }[] = [
  {
    name: "Tit for Tat",
    blurb: "Opens by cooperating, then simply echoes whatever the opponent did last. Forgiving, but never a pushover.",
    fsm: { actions: [0, 1], transitionsC: [0, 0], transitionsD: [1, 1] },
  },
  {
    name: "Always Cooperate",
    blurb: "One state, always gold. Thrives among friends, bleeds against sharks.",
    fsm: { actions: [0], transitionsC: [0], transitionsD: [0] },
  },
  {
    name: "Always Defect",
    blurb: "One state, always red. Never loses a round — rarely wins a tournament.",
    fsm: { actions: [1], transitionsC: [0], transitionsD: [0] },
  },
  {
    name: "Grim Trigger",
    blurb: "Cooperates until the first betrayal, then defects forever. Never forgives.",
    fsm: { actions: [0, 1], transitionsC: [0, 1], transitionsD: [1, 1] },
  },
];

export function randomFsm(states = 2 + Math.floor(Math.random() * 15)): Fsm {
  const r = (n: number) => Math.floor(Math.random() * n);
  return {
    actions: Array.from({ length: states }, () => r(2)),
    transitionsC: Array.from({ length: states }, () => r(states)),
    transitionsD: Array.from({ length: states }, () => r(states)),
  };
}

export const PAY_CAPTIONS: Record<string, string> = {
  "0,0": "Mutual cooperation: three each. Not the most you could grab, but the best the two of you can do together.",
  "0,1": "You cooperated, they defected. They take five, you get nothing. This is the cost of misplaced trust.",
  "1,0": "You defected on a cooperator and grab the most, five. They get nothing.",
  "1,1": "Mutual defection: one each, far worse than the three you would both get by cooperating.",
};

export const PHASE_LABEL = ["Commit", "Reveal", "Playing", "Finished"];

/** Named view over the 19-field getTournament tuple. */
export type TournamentView = {
  expectedPlayers: bigint;
  numRounds: bigint;
  commitDuration: bigint;
  revealDuration: bigint;
  bondAmount: bigint;
  createdAt: bigint;
  commitDeadline: bigint;
  expiresAt: bigint;
  numCommitters: bigint;
  revealStarted: boolean;
  revealDeadline: bigint;
  numRevealers: bigint;
  matchesPlayed: bigint;
  totalMatches: bigint;
  totalScore: bigint;
  totalBondPot: bigint;
  finished: boolean;
  committers: `0x${string}`[];
  revealers: `0x${string}`[];
};

export function parseTournament(d: readonly unknown[]): TournamentView {
  const [
    expectedPlayers, numRounds, commitDuration, revealDuration, bondAmount,
    createdAt, commitDeadline, expiresAt, numCommitters, revealStarted,
    revealDeadline, numRevealers, matchesPlayed, totalMatches, totalScore,
    totalBondPot, finished, committers, revealers,
  ] = d as [
    bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean,
    bigint, bigint, bigint, bigint, bigint, bigint, boolean,
    `0x${string}`[], `0x${string}`[],
  ];
  return {
    expectedPlayers, numRounds, commitDuration, revealDuration, bondAmount,
    createdAt, commitDeadline, expiresAt, numCommitters, revealStarted,
    revealDeadline, numRevealers, matchesPlayed, totalMatches, totalScore,
    totalBondPot, finished, committers, revealers,
  };
}
