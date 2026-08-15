// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AuravisMandate
 * @notice A non-custodial vault where a user grants an AI agent bounded authority to spend.
 *
 * @dev THE CORE IDEA
 *      Agent products today enforce spending limits in the prompt. Prompts can be
 *      argued with, jailbroken, or poisoned by text the agent reads from the web.
 *      Here the limit lives in the contract. The agent may be lied to, may be
 *      compromised, may go entirely haywire — and it still cannot move a single
 *      unit beyond what the user signed for.
 *
 *      Guarantees enforced on-chain, not by our backend:
 *        1. The agent can only spend from a specific mandate, never the whole balance.
 *        2. Every mandate has a hard lifetime cap and a rolling per-window cap.
 *        3. The agent can only call routers the user allowlisted.
 *        4. Token approvals are granted for the exact amount and reset to zero after.
 *        5. The user can revoke or withdraw at any moment, without the agent's cooperation.
 *        6. The agent never holds custody. Funds and swap output stay in this
 *           contract, withdrawable only by the owner.
 *        7. Every spend must return value *to this contract*, at no worse than a
 *           price floor the owner set when opening the mandate. The agent chooses
 *           the route; it does not get a say in the floor.
 *
 *      WHY 7 EXISTS. An earlier version let the agent pass `minOut` per call.
 *      That looked like slippage protection but wasn't: `swapData` encodes the
 *      swap's recipient, so a compromised agent could point the output at its own
 *      address and pass `minOut = 0`. Spend stayed under the cap and the check
 *      passed vacuously — capping the *rate* of theft rather than preventing it.
 *      The floor now comes from owner-set mandate state and is measured against
 *      this contract's own balance delta, so redirected output reverts.
 */
contract AuravisMandate {
    // ---------------------------------------------------------------------
    // Errors — named so the UI can render exactly why an action was refused.
    // The demo depends on these being legible.
    // ---------------------------------------------------------------------
    error NotOwner();
    error NotAgent();
    error MandateInactive();
    error MandateExpired();
    error ExceedsLifetimeCap(uint256 requested, uint256 remaining);
    error ExceedsWindowCap(uint256 requested, uint256 remaining);
    error RouterNotAllowed(address router);
    error SpentMoreThanDeclared(uint256 declared, uint256 actual);
    error ReceivedLessThanMinimum(uint256 minOut, uint256 actual);
    error RouterCallFailed();
    error ZeroAmount();
    error Reentrancy();
    error TransferFailed();
    error ExpiryInPast();

    // ---------------------------------------------------------------------
    // Events — the dashboard's "what I did and why" feed reads directly from these.
    // ---------------------------------------------------------------------
    event MandateOpened(
        uint256 indexed id,
        address indexed spendToken,
        address indexed buyToken,
        uint256 lifetimeCap,
        uint256 windowCap,
        uint64 windowLength,
        uint64 expiry,
        uint256 minOutPerUnit,
        string intent
    );
    event MandateExecuted(
        uint256 indexed id,
        uint256 spent,
        uint256 received,
        uint256 lifetimeRemaining,
        string reason
    );
    event MandateRevoked(uint256 indexed id);
    event AgentChanged(address indexed previousAgent, address indexed newAgent);
    event RouterAllowed(address indexed router, bool allowed);
    event Deposited(address indexed token, uint256 amount);
    event Withdrawn(address indexed token, uint256 amount);

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice The human. Can do anything, at any time, without the agent.
    address public immutable owner;

    /// @notice The agent's hot key. Powerful inside a mandate, powerless outside one.
    address public agent;

    /// @dev Routers the agent is permitted to call (e.g. the OKX DEX router).
    ///      Without this, "spend up to $200" would let a compromised agent send
    ///      $200 to any address it liked. This narrows it to swapping, only.
    mapping(address => bool) public allowedRouters;

    struct Mandate {
        address spendToken;      // what the agent is allowed to spend
        address buyToken;        // what it must acquire in return
        uint256 lifetimeCap;     // absolute ceiling for this mandate, ever
        uint256 spent;           // cumulative spend against the ceiling
        uint256 windowCap;       // ceiling per rolling window (rate limit)
        uint256 windowSpent;     // spend inside the current window
        uint64  windowLength;    // seconds per window (0 disables rate limiting)
        uint64  windowStart;     // when the current window opened
        uint64  expiry;          // mandate dies at this timestamp
        bool    active;          // false once revoked or exhausted
        string  intent;          // the user's own words, kept for the audit trail
        /// @dev Price floor, set by the owner, never by the agent: the minimum
        ///      buyToken base units this contract must receive per 1e18 base
        ///      units of spendToken spent. Set 0 only to waive the floor
        ///      entirely (test/demo use — see openMandate).
        uint256 minOutPerUnit;
    }

    /// @dev Fixed-point scale for `minOutPerUnit`.
    uint256 private constant UNIT = 1e18;

    Mandate[] private _mandates;

    uint256 private _lock = 1;

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address _owner, address _agent) {
        owner = _owner;
        agent = _agent;
    }

    // ---------------------------------------------------------------------
    // Owner controls — always available, never gated on the agent
    // ---------------------------------------------------------------------

    function deposit(address token, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        _pullFrom(token, msg.sender, amount);
        emit Deposited(token, amount);
    }

    /// @notice Withdraw at any time. The agent cannot block, delay, or veto this.
    function withdraw(address token, uint256 amount) external onlyOwner {
        _push(token, owner, amount);
        emit Withdrawn(token, amount);
    }

    /// @notice Rotate or disable the agent key. Setting address(0) disarms everything.
    function setAgent(address newAgent) external onlyOwner {
        emit AgentChanged(agent, newAgent);
        agent = newAgent;
    }

    function setRouterAllowed(address router, bool allowed) external onlyOwner {
        allowedRouters[router] = allowed;
        emit RouterAllowed(router, allowed);
    }

    /**
     * @notice Open a mandate: a bounded, revocable licence for the agent to act.
     * @param intent The user's instruction in their own words. Stored so that every
     *        later action can be audited against what was actually asked for.
     * @param minOutPerUnit Price floor: minimum buyToken base units this contract
     *        must receive per 1e18 base units of spendToken spent. This is the
     *        owner's protection against a compromised agent routing value away
     *        (see the contract header). Passing 0 waives it — acceptable for a
     *        throwaway test mandate, never for one holding real funds.
     */
    function openMandate(
        address spendToken,
        address buyToken,
        uint256 lifetimeCap,
        uint256 windowCap,
        uint64 windowLength,
        uint64 expiry,
        uint256 minOutPerUnit,
        string calldata intent
    ) external onlyOwner returns (uint256 id) {
        if (lifetimeCap == 0) revert ZeroAmount();
        if (expiry != 0 && expiry <= block.timestamp) revert ExpiryInPast();

        _mandates.push(
            Mandate({
                spendToken: spendToken,
                buyToken: buyToken,
                lifetimeCap: lifetimeCap,
                spent: 0,
                windowCap: windowCap == 0 ? lifetimeCap : windowCap,
                windowSpent: 0,
                windowLength: windowLength,
                windowStart: uint64(block.timestamp),
                expiry: expiry,
                active: true,
                intent: intent,
                minOutPerUnit: minOutPerUnit
            })
        );

        id = _mandates.length - 1;
        emit MandateOpened(
            id, spendToken, buyToken, lifetimeCap, windowCap, windowLength, expiry, minOutPerUnit, intent
        );
    }

    function revokeMandate(uint256 id) external onlyOwner {
        _mandates[id].active = false;
        emit MandateRevoked(id);
    }

    // ---------------------------------------------------------------------
    // Agent execution — the only thing the agent can do, and it is fenced in
    // ---------------------------------------------------------------------

    /**
     * @notice Execute a swap inside a mandate.
     * @dev Every check below is deliberately on-chain. If our backend were fully
     *      compromised tomorrow, an attacker still could not exceed these bounds.
     *
     * @param id          Which mandate authorises this.
     * @param router      Swap router to call. Must be allowlisted by the owner.
     * @param swapData    Calldata built off-chain by the agent (routing is the
     *                    agent's job; safety is this contract's job).
     * @param declaredIn  Amount of spendToken the agent claims it will use. We
     *                    approve exactly this and verify the true spend after.
     * @param minOut      An *additional* floor the agent may impose on itself
     *                    (e.g. tighter slippage than the mandate demands). The
     *                    binding floor is always the owner's `minOutPerUnit`;
     *                    this can only tighten it, never loosen it. Passing 0
     *                    simply defers entirely to the owner's floor.
     * @param reason      One-line explanation, emitted for the user's feed.
     */
    function execute(
        uint256 id,
        address router,
        bytes calldata swapData,
        uint256 declaredIn,
        uint256 minOut,
        string calldata reason
    ) external onlyAgent nonReentrant returns (uint256 spent, uint256 received) {
        Mandate storage m = _mandates[id];

        _authorize(m, router, declaredIn);
        (spent, received) = _swapAndMeasure(m, router, swapData, declaredIn, minOut);

        // --- Book it ----------------------------------------------------------
        m.spent += spent;
        m.windowSpent += spent;
        if (m.spent >= m.lifetimeCap) m.active = false;

        emit MandateExecuted(id, spent, received, m.lifetimeCap - m.spent, reason);
    }

    /// @dev All authority checks. Reverts with a specific error the UI can render.
    ///      Split out of `execute` deliberately: this is the part a reviewer should
    ///      be able to read in one sitting and convince themselves is airtight.
    function _authorize(Mandate storage m, address router, uint256 declaredIn) private {
        if (!m.active) revert MandateInactive();
        if (m.expiry != 0 && block.timestamp > m.expiry) revert MandateExpired();
        if (!allowedRouters[router]) revert RouterNotAllowed(router);
        if (declaredIn == 0) revert ZeroAmount();

        // Lifetime cap — the absolute ceiling the user signed for.
        uint256 remaining = m.lifetimeCap - m.spent;
        if (declaredIn > remaining) revert ExceedsLifetimeCap(declaredIn, remaining);

        // Rolling window cap — rate limiting. Stops an agent draining a large
        // mandate in one burst and gives the user time to notice and revoke.
        if (m.windowLength > 0 && block.timestamp >= m.windowStart + m.windowLength) {
            m.windowStart = uint64(block.timestamp);
            m.windowSpent = 0;
        }
        remaining = m.windowCap - m.windowSpent;
        if (declaredIn > remaining) revert ExceedsWindowCap(declaredIn, remaining);
    }

    /// @dev Perform the swap and measure what actually happened, rather than
    ///      trusting whatever the router or the agent claims happened.
    function _swapAndMeasure(
        Mandate storage m,
        address router,
        bytes calldata swapData,
        uint256 declaredIn,
        uint256 minOut
    ) private returns (uint256 spent, uint256 received) {
        address spendToken = m.spendToken;
        address buyToken = m.buyToken;

        uint256 inBefore = _balance(spendToken);
        uint256 outBefore = _balance(buyToken);

        _approveExact(spendToken, router, declaredIn);
        (bool ok, ) = router.call(swapData);
        if (!ok) revert RouterCallFailed();
        _approveExact(spendToken, router, 0); // never leave a standing approval

        // Measured against *this contract's* balances, not the router's claims.
        // This is what makes redirected output detectable: if swapData sent the
        // proceeds elsewhere, `received` is 0 here no matter what the router says.
        spent = inBefore - _balance(spendToken);
        received = _balance(buyToken) - outBefore;

        // The router may pull less than declared (fine) but never more.
        if (spent > declaredIn) revert SpentMoreThanDeclared(declaredIn, spent);

        // The binding floor is the owner's, scaled to what was actually spent.
        // The agent's `minOut` may only tighten it.
        uint256 floor = (spent * m.minOutPerUnit) / UNIT;
        if (minOut > floor) floor = minOut;
        if (received < floor) revert ReceivedLessThanMinimum(floor, received);
    }

    // ---------------------------------------------------------------------
    // Views — the dashboard uses these to explain refusals *before* they happen
    // ---------------------------------------------------------------------

    /**
     * @notice Dry-run the authority checks without executing.
     * @dev Lets the UI say "I would have bought, but this exceeds your weekly cap
     *      by $40" instead of surfacing a raw revert. The explanation of a refusal
     *      is a product feature, not an error message.
     */
    function canExecute(uint256 id, uint256 amountIn)
        external
        view
        returns (bool allowed, string memory why)
    {
        if (id >= _mandates.length) return (false, "mandate does not exist");
        Mandate storage m = _mandates[id];

        if (!m.active) return (false, "mandate is no longer active");
        if (m.expiry != 0 && block.timestamp > m.expiry) return (false, "mandate has expired");
        if (amountIn == 0) return (false, "amount is zero");
        if (amountIn > m.lifetimeCap - m.spent) return (false, "exceeds the mandate's total cap");

        uint256 windowSpent = m.windowSpent;
        if (m.windowLength > 0 && block.timestamp >= m.windowStart + m.windowLength) {
            windowSpent = 0; // window would roll over on execution
        }
        if (amountIn > m.windowCap - windowSpent) return (false, "exceeds the cap for this window");

        // Allowed, but worth saying out loud: without a floor the agent's routing
        // is unchecked on price. The UI should surface this, not bury it.
        if (m.minOutPerUnit == 0) return (true, "within mandate (no price floor set)");

        return (true, "within mandate");
    }

    function mandateCount() external view returns (uint256) {
        return _mandates.length;
    }

    function getMandate(uint256 id) external view returns (Mandate memory) {
        return _mandates[id];
    }

    // ---------------------------------------------------------------------
    // Minimal ERC20 helpers — tolerant of tokens that don't return a bool
    // ---------------------------------------------------------------------

    function _balance(address token) private view returns (uint256) {
        (bool ok, bytes memory data) =
            token.staticcall(abi.encodeWithSelector(0x70a08231, address(this))); // balanceOf
        if (!ok || data.length < 32) revert TransferFailed();
        return abi.decode(data, (uint256));
    }

    function _pullFrom(address token, address from, uint256 amount) private {
        _call(token, abi.encodeWithSelector(0x23b872dd, from, address(this), amount)); // transferFrom
    }

    function _push(address token, address to, uint256 amount) private {
        _call(token, abi.encodeWithSelector(0xa9059cbb, to, amount)); // transfer
    }

    function _approveExact(address token, address spender, uint256 amount) private {
        _call(token, abi.encodeWithSelector(0x095ea7b3, spender, amount)); // approve
    }

    function _call(address token, bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
