// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {AxelTournament} from "../src/AxelTournament.sol";

/// @notice Deploy the multi-tournament AxelTournament hub on Arc.
/// @dev Tournaments are created permissionlessly afterwards via
///      createTournament(...) (UI or cast) — no init step. Bonds post in the
///      NATIVE token (on Arc, native gas token is USDC).
///      Usage:
///        TESTNET:  forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.arc.io --broadcast
///        MAINNET:  forge script script/Deploy.s.sol --rpc-url https://rpc.mainnet.arc.io --broadcast
contract Deploy is Script {
    function run() external returns (AxelTournament) {
        uint256 key = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(key);
        AxelTournament game = new AxelTournament();
        vm.stopBroadcast();

        console.log("AxelTournament hub deployed at:", address(game));
        console.log("Chain ID:", block.chainid);
        console.log("Max tournament duration (s):", game.MAX_TOURNAMENT_DURATION());
        return game;
    }
}
