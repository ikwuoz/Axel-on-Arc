// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title Axel — Iterated Prisoner's Dilemma strategy tournaments, built for Arc
/// @notice One deployment hosts many tournaments. Players submit finite-state-machine
///         strategies sealed (commit) then revealed. Every revealed strategy plays every
///         other for a fixed number of rounds; points earn equal shares of the bond pot.
/// @dev Each tournament is hard-bounded to 30 minutes from first commit to game end:
///      commitDuration + revealDuration must fit in 25 minutes (leaving a play buffer),
///      and `expiresAt` (first commit + 30 min) lets anyone force-finish stragglers.
///      Payoffs follow Axelrod (1980): R=3, T=5, S=0, P=1.
///      Strategy encoding (matches the reference Axel game):
///        - Action 0 = cooperate, 1 = defect.
///        - actions[i] = move played in state i.
///        - transitionsC[i] = next state when the opponent just cooperated.
///        - transitionsD[i] = next state when the opponent just defected.
///        - Every match starts both machines at state 0.
///      Bonds are posted in the NATIVE token (on Arc, native gas token is USDC).
contract AxelTournament {
    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------
    enum Phase {
        Commit,
        Reveal,
        Playing,
        Finished
    }

    struct Strategy {
        uint8[] actions;
        uint8[] transitionsC;
        uint8[] transitionsD;
    }

    struct Tournament {
        // params (immutable after creation)
        uint256 expectedPlayers;
        uint256 numRounds;
        uint256 commitDuration;
        uint256 revealDuration;
        uint256 bondAmount;
        uint256 createdAt;
        // commit phase (commitDeadline/expiresAt set on first commit)
        uint256 commitDeadline;
        uint256 expiresAt;
        address[] committers;
        // reveal phase
        bool revealStarted;
        uint256 revealDeadline;
        address[] revealers;
        // play phase (round-robin cursors)
        uint256 cursorI;
        uint256 cursorJ;
        uint256 matchesPlayed;
        uint256 totalMatches;
        uint256 totalScore;
        uint256 totalBondPot;
        bool finished;
        // accounting
        uint256 paidOut;
        uint256 withdrawnScore;
    }

    // ------------------------------------------------------------------
    // Constants (validation caps)
    // ------------------------------------------------------------------
    uint256 public constant MAX_STATES = 256;
    uint256 public constant MAX_ROUNDS = 1000;
    uint256 public constant MIN_PLAYERS = 2;
    uint256 public constant MAX_PLAYERS = 16;

    uint256 public constant PAYOFF_R = 3; // mutual cooperation
    uint256 public constant PAYOFF_T = 5; // defect vs cooperate
    uint256 public constant PAYOFF_S = 0; // cooperate vs defect
    uint256 public constant PAYOFF_P = 1; // mutual defection

    /// @notice Hard cap: each tournament ends at most 30 min after its first commit.
    uint256 public constant MAX_TOURNAMENT_DURATION = 30 minutes;
    /// @notice Phase windows must leave room to play inside the cap.
    uint256 public constant MAX_PHASE_BUDGET = 25 minutes;
    /// @notice Floor against instant-expiry footguns.
    uint256 public constant MIN_WINDOW = 60;

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------
    uint256 public tournamentCount;
    mapping(uint256 => Tournament) private _tournaments;

    mapping(uint256 => mapping(address => bytes32)) public commitments;
    mapping(uint256 => mapping(address => Strategy)) private _strategies;
    mapping(uint256 => mapping(address => bool)) public hasRevealed;
    mapping(uint256 => mapping(address => uint256)) public scores;
    mapping(uint256 => mapping(address => bool)) public claimed;

    bool private _locked;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------
    event TournamentCreated(
        uint256 indexed tournamentId, address indexed organizer, uint256 entryBond, uint256 expectedPlayers, uint256 numRounds
    );
    event Committed(uint256 indexed tournamentId, address indexed player);
    event RevealPhaseStarted(uint256 indexed tournamentId, uint256 revealDeadline);
    event Revealed(uint256 indexed tournamentId, address indexed player);
    event MatchPlayed(uint256 indexed tournamentId, address indexed a, address indexed b, uint256 scoreA, uint256 scoreB);
    event TournamentFinished(uint256 indexed tournamentId);
    event Withdrawn(uint256 indexed tournamentId, address indexed player, uint256 amount);

    error BadParams();
    error WrongPhase();
    error AlreadyCommitted();
    error WrongBond();
    error CommitClosed();
    error RevealNotOpen();
    error AlreadyRevealed();
    error RevealClosed();
    error InvalidStrategy();
    error InvalidReveal();
    error NothingToClaim();
    error AlreadyClaimed();
    error TransferFailed();
    error Reentrant();
    error NotExpired();

    modifier nonReentrant() {
        if (_locked) revert Reentrant();
        _locked = true;
        _;
        _locked = false;
    }

    // ------------------------------------------------------------------
    // Creation
    // ------------------------------------------------------------------

    /// @notice Create a tournament. Anyone can create; commit opens immediately.
    /// @param _expectedPlayers seats in the field, 2..16 (reveal opens early when full).
    /// @param _numRounds rounds per pair, 1..MAX_ROUNDS.
    /// @param _commitDuration commit window once the first bot arrives (60s..budget).
    /// @param _revealDuration reveal window once opened (60s..budget).
    /// @param _bondAmount native-token bond per entry (0 = free entry).
    /// @dev Requires _commitDuration + _revealDuration <= 25 min so every game,
    ///      from first commit to force-finishable end, fits in 30 minutes.
    function createTournament(
        uint256 _expectedPlayers,
        uint256 _numRounds,
        uint256 _commitDuration,
        uint256 _revealDuration,
        uint256 _bondAmount
    ) external returns (uint256 tournamentId) {
        if (_expectedPlayers < MIN_PLAYERS || _expectedPlayers > MAX_PLAYERS) revert BadParams();
        if (_numRounds == 0 || _numRounds > MAX_ROUNDS) revert BadParams();
        if (_commitDuration < MIN_WINDOW || _revealDuration < MIN_WINDOW) revert BadParams();
        if (_commitDuration + _revealDuration > MAX_PHASE_BUDGET) revert BadParams();

        tournamentId = tournamentCount++;
        Tournament storage t = _tournaments[tournamentId];
        t.expectedPlayers = _expectedPlayers;
        t.numRounds = _numRounds;
        t.commitDuration = _commitDuration;
        t.revealDuration = _revealDuration;
        t.bondAmount = _bondAmount;
        t.createdAt = block.timestamp;

        emit TournamentCreated(tournamentId, msg.sender, _bondAmount, _expectedPlayers, _numRounds);
    }

    /// @notice Pure helper so clients hash exactly what the contract checks.
    function computeCommitment(
        address committer,
        bytes32 salt,
        uint8[] calldata actions,
        uint8[] calldata transitionsC,
        uint8[] calldata transitionsD
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(committer, salt, actions, transitionsC, transitionsD));
    }

    // ------------------------------------------------------------------
    // Phase 1 — Commit (sealed strategies + bond)
    // ------------------------------------------------------------------

    /// @notice Enter a tournament: lock a strategy hash + post the bond.
    /// @dev The first commit starts the 30-minute clock (deadlines anchored here).
    function commit(uint256 tournamentId, bytes32 commitment) external payable {
        Tournament storage t = _tournaments[tournamentId];
        if (t.expectedPlayers == 0) revert BadParams();
        if (currentPhase(tournamentId) != Phase.Commit) revert WrongPhase();
        if (commitments[tournamentId][msg.sender] != bytes32(0)) revert AlreadyCommitted();
        if (t.committers.length >= t.expectedPlayers) revert CommitClosed();
        if (t.commitDeadline != 0 && block.timestamp > t.commitDeadline) revert CommitClosed();
        if (msg.value != t.bondAmount) revert WrongBond();

        if (t.committers.length == 0) {
            t.commitDeadline = block.timestamp + t.commitDuration;
            t.expiresAt = block.timestamp + MAX_TOURNAMENT_DURATION;
        }
        commitments[tournamentId][msg.sender] = commitment;
        t.committers.push(msg.sender);
        t.totalBondPot += msg.value;
        emit Committed(tournamentId, msg.sender);
    }

    /// @notice Open the reveal phase once the field is set or the timer lapsed.
    /// @dev Permissionless: anyone can crank it. Needs at least 1 committer;
    ///      tournaments with <2 revealers simply pay bonds back (see claimable).
    function startReveal(uint256 tournamentId) external {
        Tournament storage t = _tournaments[tournamentId];
        if (t.expectedPlayers == 0) revert BadParams();
        if (currentPhase(tournamentId) != Phase.Commit) revert WrongPhase();
        if (t.committers.length != t.expectedPlayers && block.timestamp < t.commitDeadline) {
            revert CommitClosed();
        }
        if (t.committers.length == 0) revert BadParams();
        t.revealStarted = true;
        t.revealDeadline = block.timestamp + t.revealDuration;
        emit RevealPhaseStarted(tournamentId, t.revealDeadline);
    }

    function currentPhase(uint256 tournamentId) public view returns (Phase) {
        Tournament storage t = _tournaments[tournamentId];
        if (t.expectedPlayers == 0) revert BadParams();
        if (t.finished) return Phase.Finished;
        if (!t.revealStarted) return Phase.Commit;
        if (block.timestamp <= t.revealDeadline) return Phase.Reveal;
        return Phase.Playing;
    }

    // ------------------------------------------------------------------
    // Phase 2 — Reveal
    // ------------------------------------------------------------------

    /// @notice Reveal a committed FSM strategy. No reveal = disqualified with zero.
    function reveal(
        uint256 tournamentId,
        bytes32 salt,
        uint8[] calldata actions,
        uint8[] calldata transitionsC,
        uint8[] calldata transitionsD
    ) external {
        Tournament storage t = _tournaments[tournamentId];
        if (currentPhase(tournamentId) != Phase.Reveal) revert RevealNotOpen();
        if (block.timestamp > t.revealDeadline) revert RevealClosed();
        if (commitments[tournamentId][msg.sender] == bytes32(0)) revert InvalidReveal();
        if (hasRevealed[tournamentId][msg.sender]) revert AlreadyRevealed();
        if (
            keccak256(abi.encode(msg.sender, salt, actions, transitionsC, transitionsD))
                != commitments[tournamentId][msg.sender]
        ) revert InvalidReveal();
        _validate(actions, transitionsC, transitionsD);
        _strategies[tournamentId][msg.sender] = Strategy(actions, transitionsC, transitionsD);
        hasRevealed[tournamentId][msg.sender] = true;
        t.revealers.push(msg.sender);
        emit Revealed(tournamentId, msg.sender);
    }

    function _validate(uint8[] calldata actions, uint8[] calldata tc, uint8[] calldata td)
        internal
        pure
    {
        uint256 n = actions.length;
        if (n == 0 || n > MAX_STATES) revert InvalidStrategy();
        if (tc.length != n || td.length != n) revert InvalidStrategy();
        for (uint256 i = 0; i < n; i++) {
            if (actions[i] > 1) revert InvalidStrategy();
            if (tc[i] >= n || td[i] >= n) revert InvalidStrategy();
        }
    }

    function getStrategy(uint256 tournamentId, address player)
        external
        view
        returns (uint8[] memory actions, uint8[] memory transitionsC, uint8[] memory transitionsD)
    {
        Strategy storage s = _strategies[tournamentId][player];
        return (s.actions, s.transitionsC, s.transitionsD);
    }

    // ------------------------------------------------------------------
    // Phase 3 — Play (permissionless cranking)
    // ------------------------------------------------------------------

    /// @notice Play up to maxMatches round-robin pairings. Anyone can call, repeatedly.
    /// @dev First call after the reveal deadline snapshots the field of revealers.
    function playMatches(uint256 tournamentId, uint256 maxMatches) external {
        Tournament storage t = _tournaments[tournamentId];
        if (t.finished) revert WrongPhase();
        if (!t.revealStarted || block.timestamp <= t.revealDeadline) revert WrongPhase();
        if (t.totalMatches == 0) {
            uint256 n = t.revealers.length;
            if (n >= 2) {
                t.totalMatches = (n * (n - 1)) / 2;
            } else {
                // Nobody (or one body) to play: tournament is over, bonds refundable.
                t.finished = true;
                emit TournamentFinished(tournamentId);
                return;
            }
        }
        uint256 played = 0;
        uint256 nPlayers = t.revealers.length;
        while (played < maxMatches && t.matchesPlayed < t.totalMatches) {
            // advance cursors to next valid pair (i < j)
            if (t.cursorJ <= t.cursorI) t.cursorJ = t.cursorI + 1;
            if (t.cursorJ >= nPlayers) {
                t.cursorI += 1;
                t.cursorJ = t.cursorI + 1;
            }
            address a = t.revealers[t.cursorI];
            address b = t.revealers[t.cursorJ];
            (uint256 sA, uint256 sB) = _playMatch(tournamentId, a, b);
            scores[tournamentId][a] += sA;
            scores[tournamentId][b] += sB;
            t.totalScore += sA + sB;
            t.matchesPlayed += 1;
            played += 1;
            emit MatchPlayed(tournamentId, a, b, sA, sB);
            t.cursorJ += 1;
        }
        if (t.matchesPlayed >= t.totalMatches) {
            t.finished = true;
            emit TournamentFinished(tournamentId);
        }
    }

    /// @notice Force-finish a tournament past its 30-minute expiry. Permissionless.
    /// @dev Partial scores stand (paid pro-rata); with no scores, bonds refund.
    function forceFinish(uint256 tournamentId) external {
        Tournament storage t = _tournaments[tournamentId];
        if (t.expectedPlayers == 0) revert BadParams();
        if (t.finished) revert WrongPhase();
        if (t.expiresAt == 0 || block.timestamp <= t.expiresAt) revert NotExpired();
        t.finished = true;
        emit TournamentFinished(tournamentId);
    }

    /// @notice Simulate numRounds of iterated PD between two FSM strategies.
    function _playMatch(uint256 tournamentId, address a, address b)
        internal
        view
        returns (uint256 sA, uint256 sB)
    {
        Tournament storage t = _tournaments[tournamentId];
        Strategy storage sa = _strategies[tournamentId][a];
        Strategy storage sb = _strategies[tournamentId][b];
        uint256 ia;
        uint256 ib;
        for (uint256 r = 0; r < t.numRounds; r++) {
            bool coopA = sa.actions[ia] == 0;
            bool coopB = sb.actions[ib] == 0;
            if (coopA && coopB) {
                sA += PAYOFF_R;
                sB += PAYOFF_R;
            } else if (!coopA && coopB) {
                sA += PAYOFF_T;
                sB += PAYOFF_S;
            } else if (coopA && !coopB) {
                sA += PAYOFF_S;
                sB += PAYOFF_T;
            } else {
                sA += PAYOFF_P;
                sB += PAYOFF_P;
            }
            ia = coopB ? sa.transitionsC[ia] : sa.transitionsD[ia];
            ib = coopA ? sb.transitionsC[ib] : sb.transitionsD[ib];
        }
    }

    function getResults(uint256 tournamentId)
        external
        view
        returns (address[] memory addrs, uint256[] memory pts)
    {
        Tournament storage t = _tournaments[tournamentId];
        uint256 n = t.revealers.length;
        addrs = new address[](n);
        pts = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            addrs[i] = t.revealers[i];
            pts[i] = scores[tournamentId][t.revealers[i]];
        }
    }

    // ------------------------------------------------------------------
    // Payouts — pull your share of the bond pot
    // ------------------------------------------------------------------

    /// @notice Points earn equal shares: score(who) / totalScore * pot.
    /// @dev If nothing scored (no matches), everyone gets their bond back.
    function claimable(uint256 tournamentId, address who) public view returns (uint256) {
        Tournament storage t = _tournaments[tournamentId];
        if (claimed[tournamentId][who]) return 0;
        if (commitments[tournamentId][who] == bytes32(0)) return 0;
        if (!t.finished) return 0;
        if (t.totalScore == 0) return t.bondAmount;
        return (scores[tournamentId][who] * t.totalBondPot) / t.totalScore;
    }

    function withdraw(uint256 tournamentId) external nonReentrant {
        Tournament storage t = _tournaments[tournamentId];
        if (!t.finished) revert WrongPhase();
        if (claimed[tournamentId][msg.sender]) revert AlreadyClaimed();
        uint256 amount = claimable(tournamentId, msg.sender);
        if (amount == 0) revert NothingToClaim();
        claimed[tournamentId][msg.sender] = true;
        t.withdrawnScore += scores[tournamentId][msg.sender];
        t.paidOut += amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(tournamentId, msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Views (frontend helpers)
    // ------------------------------------------------------------------

    /// @notice Full tournament snapshot for the UI (params, clocks, counts).
    function getTournament(uint256 tournamentId)
        external
        view
        returns (
            uint256 expectedPlayers,
            uint256 numRounds,
            uint256 commitDuration,
            uint256 revealDuration,
            uint256 bondAmount,
            uint256 createdAt,
            uint256 commitDeadline,
            uint256 expiresAt,
            uint256 numCommitters,
            bool revealStarted,
            uint256 revealDeadline,
            uint256 numRevealers,
            uint256 matchesPlayed,
            uint256 totalMatches,
            uint256 totalScore,
            uint256 totalBondPot,
            bool finished,
            address[] memory committers,
            address[] memory revealers
        )
    {
        Tournament storage t = _tournaments[tournamentId];
        return (
            t.expectedPlayers,
            t.numRounds,
            t.commitDuration,
            t.revealDuration,
            t.bondAmount,
            t.createdAt,
            t.commitDeadline,
            t.expiresAt,
            t.committers.length,
            t.revealStarted,
            t.revealDeadline,
            t.revealers.length,
            t.matchesPlayed,
            t.totalMatches,
            t.totalScore,
            t.totalBondPot,
            t.finished,
            t.committers,
            t.revealers
        );
    }
}
