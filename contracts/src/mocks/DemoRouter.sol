// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice Minimal fixed-rate router for the mainnet demo, swapping REAL
 *         tokens from its own reserve.
 *
 * WHY THIS EXISTS. The OKX aggregator on X Layer quotes USDT→USDC happily,
 * but every returned route REVERTS on-chain — tested Aug 15 2026 across seven
 * route shapes from the vault (a contract) and again from the owner (a plain
 * EOA), down to 1 USDT. Quotes are theoretical paths; the pools behind them
 * don't fill. This is an aggregator/liquidity issue on this pair, not
 * anything about Auravis's architecture — the identical execute() path works
 * end-to-end against any router that actually fills (see the testnet rig).
 * Support ticket pending; autonomous execution routes through this instead.
 *
 * The enforcement being demonstrated — caps, windows, allowlist, price floor,
 * balance-delta measurement — all lives in AuravisMandate and is completely
 * unaffected by which router fills the swap.
 *
 * Scope-limited on purpose:
 *  - swaps one fixed pair, from a reserve the deployer funds (a few dollars)
 *  - `setRateBps` is owner-only and exists as the demo's lever: drop the rate
 *    below a mandate's floor and the vault refuses ON MAINNET, with real money
 *  - `rescue` lets the owner reclaim the reserve afterwards; it cannot touch
 *    vault funds, which never sit here beyond the instant of a swap
 */
interface IERC20Like {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address holder) external view returns (uint256);
}

contract DemoRouter {
    address public immutable owner;
    IERC20Like public immutable tokenIn;
    IERC20Like public immutable tokenOut;

    /// @notice Out paid per 1.0 in, in basis points. 9995 = a realistic 0.05% spread.
    uint256 public rateBps = 9995;

    error NotOwner();
    error TransferFailed();

    constructor(IERC20Like _tokenIn, IERC20Like _tokenOut) {
        owner = msg.sender;
        tokenIn = _tokenIn;
        tokenOut = _tokenOut;
    }

    function setRateBps(uint256 _rateBps) external {
        if (msg.sender != owner) revert NotOwner();
        rateBps = _rateBps;
    }

    function swap(uint256 amountIn) external {
        if (!tokenIn.transferFrom(msg.sender, address(this), amountIn)) revert TransferFailed();
        if (!tokenOut.transfer(msg.sender, (amountIn * rateBps) / 10_000)) revert TransferFailed();
    }

    /// @notice Owner reclaims the reserve once the demo is done.
    function rescue(IERC20Like token, uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        if (!token.transfer(owner, amount)) revert TransferFailed();
    }
}
