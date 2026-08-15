// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AuravisMandate} from "../src/AuravisMandate.sol";

/**
 * @notice Deploys AuravisMandate for a single user (owner) with a given agent key.
 *
 * Usage:
 *   forge script script/Deploy.s.sol:Deploy \
 *     --rpc-url xlayer_testnet \
 *     --broadcast \
 *     --verify
 *
 * Required env vars (see ../.env.example):
 *   DEPLOYER_PRIVATE_KEY   — pays gas, becomes msg.sender for the deploy tx
 *   VAULT_OWNER            — the human who owns the mandate vault
 *   AGENT_ADDRESS          — the agent's hot wallet address
 *   OKX_DEX_ROUTER         — router address to allowlist on X Layer
 */
contract Deploy is Script {
    function run() external returns (AuravisMandate vault) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.envOr("VAULT_OWNER", vm.addr(deployerKey));
        address agent = vm.envAddress("AGENT_ADDRESS");
        address router = vm.envOr("OKX_DEX_ROUTER", address(0));

        vm.startBroadcast(deployerKey);

        vault = new AuravisMandate(owner, agent);
        console2.log("AuravisMandate deployed:", address(vault));
        console2.log("  owner:", owner);
        console2.log("  agent:", agent);

        // setRouterAllowed is onlyOwner, and we are broadcasting as the deployer.
        // If the owner is someone else (the common case — deploy key is
        // disposable, owner is the real wallet), this call would revert and take
        // the whole deploy with it. So only attempt it when they're the same.
        if (router == address(0)) {
            console2.log("  no OKX_DEX_ROUTER set — allowlist a router before executing");
        } else if (owner == vm.addr(deployerKey)) {
            vault.setRouterAllowed(router, true);
            console2.log("  router allowlisted:", router);
        } else {
            console2.log("  router NOT allowlisted — owner differs from deployer.");
            console2.log("  Owner must call setRouterAllowed() for:", router);
        }

        vm.stopBroadcast();
    }
}
