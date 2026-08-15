// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * TESTNET ONLY. Never deploy either contract to mainnet.
 *
 * The OKX aggregator has no X Layer testnet deployment (quote endpoint returns
 * error 50026 for chain 1952), so a real `execute()` can't be exercised there
 * against real infrastructure. This rig stands in: two toy tokens and a router
 * that swaps them at a configurable rate, letting the whole
 * approve → call → measure → enforce-floor path run on a live chain with
 * faucet gas before a cent of real money is involved.
 */

/// @dev Open mint, tolerant transfers — a prop, not a token.
contract TestnetToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/**
 * @dev Swaps tokenIn for tokenOut from its own reserve at `rateBps` / 10_000.
 *
 *      `setRateBps` is deliberately unpermissioned: it is the demo's lever.
 *      Drop the rate below the mandate's price floor mid-demo and the vault
 *      refuses the swap on-chain — the "attack the agent live and watch the
 *      chain say no" beat, rehearsable on testnet for free.
 */
contract TestnetRouter {
    TestnetToken public immutable tokenIn;
    TestnetToken public immutable tokenOut;

    /// @notice Out paid per 1.0 in, in basis points. 9995 = a realistic 0.05% spread.
    uint256 public rateBps = 9995;

    constructor(TestnetToken _tokenIn, TestnetToken _tokenOut) {
        tokenIn = _tokenIn;
        tokenOut = _tokenOut;
    }

    function setRateBps(uint256 _rateBps) external {
        rateBps = _rateBps;
    }

    function swap(uint256 amountIn) external {
        tokenIn.transferFrom(msg.sender, address(this), amountIn);
        tokenOut.transfer(msg.sender, (amountIn * rateBps) / 10_000);
    }
}
