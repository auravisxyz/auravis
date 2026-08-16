// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {DemoRouter, IERC20Like} from "../src/mocks/DemoRouter.sol";

/**
 * @notice Deploys the mainnet DemoRouter for native USDT → native USDC.
 *
 * Usage:
 *   forge script script/DeployDemoRouter.s.sol:DeployDemoRouter \
 *     --rpc-url xlayer --broadcast
 *
 * Broadcasts with DEPLOYER_PRIVATE_KEY (it has mainnet OKB). The deployer
 * becomes the router's owner — the key that can set the rate and reclaim the
 * reserve. After deploying, follow the printed steps: fund the reserve with a
 * few USDC, allowlist the router from the vault owner, set
 * DEMO_ROUTER_MAINNET in .env.
 */
contract DeployDemoRouter is Script {
    // Native X Layer stablecoins — from OKX's token list, not guessed.
    address constant USDT = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant USDC = 0xB6CEceAB302E2E4948951eE7843FC24E92933061;

    function run() external {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(key);
        DemoRouter router = new DemoRouter(IERC20Like(USDT), IERC20Like(USDC));
        vm.stopBroadcast();

        console2.log("=== DemoRouter deployed (X Layer mainnet) ===");
        console2.log("DEMO_ROUTER_MAINNET=", address(router));
        console2.log("owner (rate/rescue key):", vm.addr(key));
        console2.log("");
        console2.log("Next:");
        console2.log("1. Send ~5 USDC to the router address above (its payout reserve)");
        console2.log("2. Vault owner: setRouterAllowed(router, true)");
        console2.log("3. Add DEMO_ROUTER_MAINNET to .env, then npm run execute:mainnet");
    }
}
