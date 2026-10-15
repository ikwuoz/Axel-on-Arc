// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AxelTournament} from "../src/AxelTournament.sol";

/// @notice Tests for the multi-tournament model (30-min cap, force-finish).
///         Action 0 = cooperate, 1 = defect. Encodings mirror the reference presets.
contract AxelTournamentTest is Test {
    AxelTournament game;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);

    uint256 constant BOND = 1 ether; // native-token bond (USDC on Arc)
    uint256 constant ROUNDS = 10;

    // Reference presets (byte-identical encodings).
    uint8[] tftActions;
    uint8[] tftC;
    uint8[] tftD;

    function setUp() public {
        game = new AxelTournament();
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);

        tftActions = [0, 1];
        tftC = [0, 0];
        tftD = [1, 1];
    }

    function _create(uint256 players, uint256 cw, uint256 rw) internal returns (uint256 tid) {
        tid = game.createTournament(players, ROUNDS, cw, rw, BOND);
    }

    function _commit(uint256 tid, address who, bytes32 salt, uint8[] memory a, uint8[] memory c, uint8[] memory d)
        internal
    {
        bytes32 h = game.computeCommitment(who, salt, a, c, d);
        vm.prank(who);
        game.commit{value: BOND}(tid, h);
    }

    function _reveal(uint256 tid, address who, bytes32 salt, uint8[] memory a, uint8[] memory c, uint8[] memory d)
        internal
    {
        vm.prank(who);
        game.reveal(tid, salt, a, c, d);
    }

    function _one() internal pure returns (uint8[] memory a, uint8[] memory c, uint8[] memory d) {
        a = new uint8[](1);
        c = new uint8[](1);
        d = new uint8[](1);
    }

    function _allDefect() internal pure returns (uint8[] memory a, uint8[] memory c, uint8[] memory d) {
        (a, c, d) = _one();
        a[0] = 1;
    }

    /// @dev getTournament returns 19 fields; these helpers slice what tests need.
    ///      Order: expPlayers,numRounds,commitDur,revealDur,bond,createdAt,
    ///      commitDl,expiresAt,nComm,revealStarted,revealDl,nRev,
    ///      matchesPlayed,totalMatches,totalScore,pot,finished,committers,revealers
    function _clocks(uint256 tid) internal view returns (uint256 dl, uint256 exp, uint256 rdl) {
        (,,,,,, dl, exp,,, rdl,,,,,,,,) = game.getTournament(tid);
    }

    function _stats(uint256 tid)
        internal
        view
        returns (uint256 mp, uint256 tm, uint256 ts, uint256 pot, bool fin)
    {
        (,,,,,,,,,,,, mp, tm, ts, pot, fin,,) = game.getTournament(tid);
    }

    // -- full tournament -------------------------------------------------

    function test_fullTournament_tftVsAllC_vsAllD() public {
        uint256 tid = _create(3, 300, 300);
        (uint8[] memory cA, uint8[] memory cC, uint8[] memory cD) = _one();
        (uint8[] memory dA, uint8[] memory dC, uint8[] memory dD) = _allDefect();

        _commit(tid, alice, bytes32("alice-salt"), tftActions, tftC, tftD);
        _commit(tid, bob, bytes32("bob-salt"), cA, cC, cD);
        _commit(tid, carol, bytes32("carol-salt"), dA, dC, dD);

        game.startReveal(tid);
        assertEq(uint8(game.currentPhase(tid)), uint8(AxelTournament.Phase.Reveal));

        _reveal(tid, alice, bytes32("alice-salt"), tftActions, tftC, tftD);
        _reveal(tid, bob, bytes32("bob-salt"), cA, cC, cD);
        _reveal(tid, carol, bytes32("carol-salt"), dA, dC, dD);

        vm.warp(block.timestamp + 301);
        game.playMatches(tid, 10);

        assertEq(uint8(game.currentPhase(tid)), uint8(AxelTournament.Phase.Finished));
        (uint256 mp, uint256 tm, uint256 ts, , ) = _stats(tid);
        assertEq(mp, 3);
        assertEq(tm, 3);
        assertEq(ts, 39 + 30 + 64);

        // TFT vs AllC: 10x (3,3)          -> A=30, B=30
        // TFT vs AllD: (0,5) then 9x (1,1) -> A=9,  C=14
        // AllC vs AllD: 10x (0,5)         -> B+=0, C+=50
        assertEq(game.scores(tid, alice), 30 + 9);
        assertEq(game.scores(tid, bob), 30 + 0);
        assertEq(game.scores(tid, carol), 14 + 50);

        uint256 pot = 3 * BOND;
        assertEq(game.claimable(tid, alice), (39 * pot) / 133);
        assertEq(game.claimable(tid, bob), (30 * pot) / 133);
        assertEq(game.claimable(tid, carol), (64 * pot) / 133);

        vm.prank(alice);
        game.withdraw(tid);
        vm.prank(bob);
        game.withdraw(tid);
        vm.prank(carol);
        game.withdraw(tid);

        assertLe(address(game).balance, 3);
    }

    // -- isolation between concurrent tournaments -------------------------

    function test_twoTournaments_isolated() public {
        uint256 t0 = _create(2, 300, 300);
        uint256 t1 = _create(2, 300, 300);
        assertEq(t0, 0);
        assertEq(t1, 1);
        assertEq(game.tournamentCount(), 2);

        (uint8[] memory cA, uint8[] memory cC, uint8[] memory cD) = _one();
        (uint8[] memory dA, uint8[] memory dC, uint8[] memory dD) = _allDefect();

        // Interleave commits across tournaments.
        _commit(t0, alice, bytes32("a0"), tftActions, tftC, tftD);
        _commit(t1, alice, bytes32("a1"), cA, cC, cD);
        _commit(t0, bob, bytes32("b0"), cA, cC, cD);
        _commit(t1, bob, bytes32("b1"), dA, dC, dD);

        game.startReveal(t0);
        game.startReveal(t1);
        _reveal(t0, alice, bytes32("a0"), tftActions, tftC, tftD);
        _reveal(t1, alice, bytes32("a1"), cA, cC, cD);
        _reveal(t0, bob, bytes32("b0"), cA, cC, cD);
        _reveal(t1, bob, bytes32("b1"), dA, dC, dD);

        vm.warp(block.timestamp + 301);
        game.playMatches(t0, 5);
        // t0: TFT vs AllC -> 30/30. t1 untouched: still Playing, zero score.
        assertEq(game.scores(t0, alice), 30);
        assertEq(game.scores(t1, alice), 0);
        assertEq(uint8(game.currentPhase(t0)), uint8(AxelTournament.Phase.Finished));
        assertEq(uint8(game.currentPhase(t1)), uint8(AxelTournament.Phase.Playing));

        game.playMatches(t1, 5);
        // t1: AllC vs AllD -> 0/50, winner takes all.
        assertEq(game.scores(t1, alice), 0);
        assertEq(game.scores(t1, bob), 50);
        assertEq(game.claimable(t1, alice), 0);
        assertEq(game.claimable(t1, bob), 2 * BOND);
    }

    // -- 30-minute budget enforcement -------------------------------------

    function test_budget_rejectsOversizeWindows() public {
        // Each window plausible alone, but the sum exceeds the 25-min budget.
        vm.expectRevert(AxelTournament.BadParams.selector);
        game.createTournament(2, ROUNDS, 20 minutes, 10 minutes, BOND);
        // Too-short windows rejected (instant-expiry footguns).
        vm.expectRevert(AxelTournament.BadParams.selector);
        game.createTournament(2, ROUNDS, 30, 300, BOND);
        // Exactly on budget passes.
        uint256 tid = game.createTournament(2, ROUNDS, 15 minutes, 10 minutes, BOND);
        assertEq(game.tournamentCount(), tid + 1);
    }

    function test_expiryAnchoredAtFirstCommit() public {
        uint256 tid = _create(4, 300, 300);
        (uint8[] memory cA, uint8[] memory cC, uint8[] memory cD) = _one();
        // Clock hasn't started: no deadlines before the first commit.
        (uint256 dl0, uint256 exp0, ) = _clocks(tid);
        assertEq(dl0, 0);
        assertEq(exp0, 0);

        vm.warp(10_000);
        _commit(tid, alice, bytes32("a"), cA, cC, cD);
        (uint256 dl1, uint256 exp1, ) = _clocks(tid);
        assertEq(dl1, 10_000 + 300);
        assertEq(exp1, 10_000 + 30 minutes);

        // Force-finish too early reverts.
        vm.expectRevert(AxelTournament.NotExpired.selector);
        game.forceFinish(tid);

        // After expiry anyone can force-finish; lone committer refunded.
        vm.warp(10_000 + 30 minutes + 1);
        game.forceFinish(tid);
        assertEq(uint8(game.currentPhase(tid)), uint8(AxelTournament.Phase.Finished));
        assertEq(game.claimable(tid, alice), BOND);
        vm.prank(alice);
        game.withdraw(tid);
        assertEq(address(game).balance, 0);
    }

    function test_forceFinish_midPlay_paysProRata() public {
        uint256 tid = _create(3, 200, 200);
        (uint8[] memory cA, uint8[] memory cC, uint8[] memory cD) = _one();
        (uint8[] memory dA, uint8[] memory dC, uint8[] memory dD) = _allDefect();
        _commit(tid, alice, bytes32("a"), tftActions, tftC, tftD);
        _commit(tid, bob, bytes32("b"), cA, cC, cD);
        _commit(tid, carol, bytes32("c"), dA, dC, dD);
        game.startReveal(tid);
        _reveal(tid, alice, bytes32("a"), tftActions, tftC, tftD);
        _reveal(tid, bob, bytes32("b"), cA, cC, cD);
        _reveal(tid, carol, bytes32("c"), dA, dC, dD);
        vm.warp(block.timestamp + 201);
        game.playMatches(tid, 1); // only the first pairing played
        (uint256 mp, , uint256 ts, , ) = _stats(tid);
        assertEq(mp, 1);
        assertGt(ts, 0);

        // Stall past expiry, then force-finish: partial scores stand.
        (, uint256 exp, ) = _clocks(tid);
        vm.warp(exp + 1);
        game.forceFinish(tid);
        assertEq(uint8(game.currentPhase(tid)), uint8(AxelTournament.Phase.Finished));
        uint256 paid = 0;
        vm.prank(alice);
        game.withdraw(tid);
        paid = 3 * BOND - address(game).balance;
        assertGt(paid, 0);
    }

    // -- ghosts, bad reveals -----------------------------------------------

    function test_ghostDisqualified_zeroPoints_refundPath() public {
        uint256 tid = _create(2, 300, 300);
        (uint8[] memory cA, uint8[] memory cC, uint8[] memory cD) = _one();
        _commit(tid, alice, bytes32("a"), tftActions, tftC, tftD);
        _commit(tid, bob, bytes32("b"), cA, cC, cD);
        vm.warp(302); // past commit deadline (1 + 300)
        game.startReveal(tid);
        _reveal(tid, alice, bytes32("a"), tftActions, tftC, tftD);
        // bob ghosts; warp past reveal deadline, crank with 1 revealer.
        (, , uint256 rdl) = _clocks(tid);
        vm.warp(rdl + 1);
        game.playMatches(tid, 10);
        assertEq(uint8(game.currentPhase(tid)), uint8(AxelTournament.Phase.Finished));
        assertEq(game.claimable(tid, alice), BOND);
        assertEq(game.claimable(tid, bob), BOND);
    }

    function test_badReveal_rejected() public {
        uint256 tid = _create(2, 300, 300);
        _commit(tid, alice, bytes32("a"), tftActions, tftC, tftD);
        uint8[] memory badT = new uint8[](2);
        badT[0] = 0;
        badT[1] = 7;
        bytes32 h = game.computeCommitment(bob, bytes32("s"), tftActions, tftC, badT);
        vm.prank(bob);
        game.commit{value: BOND}(tid, h);
        vm.warp(block.timestamp + 301);
        game.startReveal(tid);
        vm.prank(alice);
        vm.expectRevert(AxelTournament.InvalidReveal.selector);
        game.reveal(tid, bytes32("wrong"), tftActions, tftC, tftD);
        vm.prank(bob);
        vm.expectRevert(AxelTournament.InvalidStrategy.selector);
        game.reveal(tid, bytes32("s"), tftActions, tftC, badT);
    }
}
