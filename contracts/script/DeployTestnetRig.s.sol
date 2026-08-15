// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AuravisMandate} from "../src/AuravisMandate.sol";
import {TestnetToken, TestnetRouter} from "../src/mocks/TestnetRig.sol";

/**
 * @notice One-shot testnet rehearsal rig: tokens, vault, router, funding,
 *         allowlist, and an open mandate — everything `execute()` needs to run
 *         on a live chain, in one broadcast.
 *
 * Usage:
 *   forge script script/DeployTestnetRig.s.sol:DeployTestnetRig \
 *     --rpc-url xlayer_testnet --broadcast
 *
 * Broadcasts with AGENT_PRIVATE_KEY: on testnet the one disposable faucet-funded
 * wallet deliberately plays deployer, owner and agent. That's fine here and
 * only here — the three-key separation is enforced for mainnet by
 * setup-mainnet.ts, and the whole point of this rig is rehearsal, not custody.
 *
 * Afterwards, copy the logged addresses into .env:
 *   MANDATE_ADDRESS_TESTNET, MOCK_ROUTER_TESTNET,
 *   MOCK_USDT_TESTNET, MOCK_USDC_TESTNET
 */
contract DeployTestnetRig is Script {
    function run() external {
        uint256 key = vm.envUint("AGENT_PRIVATE_KEY");
        address me = vm.addr(key);

        vm.startBroadcast(key);

        TestnetToken tUSDT = new TestnetToken("Test USDT", "tUSDT", 6);
        TestnetToken tUSDC = new TestnetToken("Test USDC", "tUSDC", 6);

        AuravisMandate vault = new AuravisMandate(me, me);
        TestnetRouter router = new TestnetRouter(tUSDT, tUSDC);

        // Vault holds what it will spend; router holds what it will pay out.
        // The router paying from a balance (rather than minting on demand)
        // keeps the transfer paths honest.
        tUSDT.mint(address(vault), 1_000e6);
        tUSDC.mint(address(router), 10_000e6);

        vault.setRouterAllowed(address(router), true);

        // Floor 0.99e18: accept no worse than 0.99 out per 1.0 in. The router
        // pays 0.9995, so normal swaps pass; drop rateBps below 9900 with
        // setRateBps and the vault starts refusing — the demo's kill shot.
        uint256 id = vault.openMandate(
            address(tUSDT),
            address(tUSDC),
            200e6, // lifetime cap: 200 tUSDT
            50e6, // window cap: 50 tUSDT
            3600, // per hour
            0, // no expiry
            990_000_000_000_000_000,
            "testnet rehearsal: swap tUSDT to tUSDC when the price is right"
        );

        vm.stopBroadcast();

        console2.log("=== testnet rig deployed ===");
        console2.log("MANDATE_ADDRESS_TESTNET=", address(vault));
        console2.log("MOCK_ROUTER_TESTNET=", address(router));
        console2.log("MOCK_USDT_TESTNET=", address(tUSDT));
        console2.log("MOCK_USDC_TESTNET=", address(tUSDC));
        console2.log("owner/agent:", me);
        console2.log("mandate id:", id);
        console2.log("vault tUSDT balance: 1000.00, router tUSDC reserve: 10000.00");
    }
}
