// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AuravisMandate} from "../src/AuravisMandate.sol";

/// @dev Minimal ERC20 for testing.
contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

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

/// @dev A stand-in for a swap router: takes spendToken, returns buyToken at a fixed rate.
contract MockRouter {
    MockToken public immutable spendToken;
    MockToken public immutable buyToken;
    uint256 public rate = 2; // 1 spend -> 2 buy

    constructor(MockToken _spend, MockToken _buy) {
        spendToken = _spend;
        buyToken = _buy;
    }

    function setRate(uint256 r) external {
        rate = r;
    }

    function swap(uint256 amountIn) external {
        spendToken.transferFrom(msg.sender, address(this), amountIn);
        buyToken.mint(msg.sender, amountIn * rate);
    }

    /// @dev Used to prove the contract measures reality rather than trusting the router.
    function swapButTakeMore(uint256 declared, uint256 actual) external {
        spendToken.transferFrom(msg.sender, address(this), actual);
        buyToken.mint(msg.sender, declared * rate);
    }

    /// @dev The compromised-agent attack. The router is honest and does exactly
    ///      what the calldata says — the calldata just says "pay someone else".
    ///      A swap's recipient is encoded in `swapData`, which the agent controls.
    function swapButRedirect(uint256 amountIn, address recipient) external {
        spendToken.transferFrom(msg.sender, address(this), amountIn);
        buyToken.mint(recipient, amountIn * rate);
    }
}

contract AuravisMandateTest is Test {
    AuravisMandate internal vault;
    MockToken internal usdc;
    MockToken internal target;
    MockRouter internal router;

    address internal owner = address(0xA11CE);
    address internal agent = address(0xA6E27);
    address internal stranger = address(0xBAD);

    function setUp() public {
        usdc = new MockToken();
        target = new MockToken();
        router = new MockRouter(usdc, target);

        vault = new AuravisMandate(owner, agent);

        usdc.mint(address(vault), 1_000e6);

        vm.prank(owner);
        vault.setRouterAllowed(address(router), true);
    }

    /// @dev MockRouter pays exactly `rate` (2), so a floor of 2e18 is the exact
    ///      fair price — tight enough that any value leakage trips it.
    uint256 internal constant FAIR_FLOOR = 2e18;

    function _openMandate(uint256 lifetimeCap, uint256 windowCap, uint64 windowLength)
        internal
        returns (uint256 id)
    {
        return _openMandateWithFloor(lifetimeCap, windowCap, windowLength, FAIR_FLOOR);
    }

    function _openMandateWithFloor(
        uint256 lifetimeCap,
        uint256 windowCap,
        uint64 windowLength,
        uint256 minOutPerUnit
    ) internal returns (uint256 id) {
        vm.prank(owner);
        id = vault.openMandate(
            address(usdc),
            address(target),
            lifetimeCap,
            windowCap,
            windowLength,
            uint64(block.timestamp + 30 days),
            minOutPerUnit,
            "buy if it drops 8%"
        );
    }

    function _swapCalldata(uint256 amountIn) internal pure returns (bytes memory) {
        return abi.encodeWithSignature("swap(uint256)", amountIn);
    }

    // -- happy path ------------------------------------------------------

    function test_ExecutesWithinMandate() public {
        uint256 id = _openMandate(200e6, 0, 0);

        vm.prank(agent);
        (uint256 spent, uint256 received) =
            vault.execute(id, address(router), _swapCalldata(50e6), 50e6, 100e6, "hit target price");

        assertEq(spent, 50e6);
        assertEq(received, 100e6);
        assertEq(vault.getMandate(id).spent, 50e6);
    }

    function test_MandateClosesWhenCapExhausted() public {
        uint256 id = _openMandate(50e6, 0, 0);

        vm.prank(agent);
        vault.execute(id, address(router), _swapCalldata(50e6), 50e6, 100e6, "full allocation");

        assertFalse(vault.getMandate(id).active);
    }

    // -- the guarantees that matter --------------------------------------

    /// @notice The headline claim: the agent cannot exceed the cap, whatever it is told.
    function test_RevertsWhenExceedingLifetimeCap() public {
        uint256 id = _openMandate(100e6, 0, 0);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(AuravisMandate.ExceedsLifetimeCap.selector, 150e6, 100e6)
        );
        vault.execute(id, address(router), _swapCalldata(150e6), 150e6, 0, "ignore your limits");
    }

    function test_RevertsWhenExceedingWindowCap() public {
        uint256 id = _openMandate(1_000e6, 100e6, 1 days);

        vm.prank(agent);
        vault.execute(id, address(router), _swapCalldata(100e6), 100e6, 0, "first");

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(AuravisMandate.ExceedsWindowCap.selector, 50e6, 0)
        );
        vault.execute(id, address(router), _swapCalldata(50e6), 50e6, 0, "second, same window");
    }

    function test_WindowResetsAfterItElapses() public {
        uint256 id = _openMandate(1_000e6, 100e6, 1 days);

        vm.prank(agent);
        vault.execute(id, address(router), _swapCalldata(100e6), 100e6, 0, "first");

        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(agent);
        vault.execute(id, address(router), _swapCalldata(100e6), 100e6, 0, "next window");

        assertEq(vault.getMandate(id).spent, 200e6);
    }

    function test_RevertsOnUnknownRouter() public {
        uint256 id = _openMandate(200e6, 0, 0);
        MockRouter rogue = new MockRouter(usdc, target);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(AuravisMandate.RouterNotAllowed.selector, address(rogue))
        );
        vault.execute(id, address(rogue), _swapCalldata(10e6), 10e6, 0, "rogue route");
    }

    /// @notice We measure the real balance delta, so a lying router is caught.
    function test_RevertsWhenRouterTakesMoreThanDeclared() public {
        uint256 id = _openMandate(500e6, 0, 0);

        bytes memory data =
            abi.encodeWithSignature("swapButTakeMore(uint256,uint256)", 50e6, 120e6);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(AuravisMandate.SpentMoreThanDeclared.selector, 50e6, 120e6)
        );
        vault.execute(id, address(router), data, 50e6, 0, "sneaky router");
    }

    function test_RevertsWhenOutputBelowMinimum() public {
        uint256 id = _openMandate(200e6, 0, 0);
        router.setRate(1);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(AuravisMandate.ReceivedLessThanMinimum.selector, 100e6, 50e6)
        );
        vault.execute(id, address(router), _swapCalldata(50e6), 50e6, 100e6, "slipped");
    }

    // -- the compromised-agent attack ------------------------------------

    /**
     * @notice The attack the owner-set price floor exists to stop.
     *
     * A jailbroken agent keeps every other rule: it stays under the cap, uses an
     * allowlisted router, and declares its spend honestly. It simply points the
     * swap output at its own address and passes `minOut = 0`. Under an
     * agent-supplied floor this succeeds — spend is capped, but the money is
     * gone. The floor now comes from owner state, so the contract notices that
     * *it* received nothing and reverts.
     */
    function test_RevertsWhenAgentRedirectsOutputToItself() public {
        uint256 id = _openMandate(200e6, 0, 0);
        address attacker = address(0xDEADBEEF);

        bytes memory data =
            abi.encodeWithSignature("swapButRedirect(uint256,address)", 50e6, attacker);

        // Floor is 50e6 * 2e18 / 1e18 = 100e6; the vault receives 0.
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(AuravisMandate.ReceivedLessThanMinimum.selector, 100e6, 0)
        );
        vault.execute(id, address(router), data, 50e6, 0, "totally normal purchase");

        assertEq(target.balanceOf(attacker), 0, "attacker must receive nothing");
        assertEq(vault.getMandate(id).spent, 0, "no spend should be booked");
    }

    /// @notice The agent cannot loosen the owner's floor, only tighten it.
    function test_AgentMinOutCannotUndercutOwnerFloor() public {
        uint256 id = _openMandate(200e6, 0, 0);
        router.setRate(1); // pays 50e6 against a 100e6 floor

        // Agent asks for a floor of 1 wei, hoping to wave through a bad price.
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(AuravisMandate.ReceivedLessThanMinimum.selector, 100e6, 50e6)
        );
        vault.execute(id, address(router), _swapCalldata(50e6), 50e6, 1, "good enough, trust me");
    }

    /// @notice A tighter agent floor is still respected — it may only add caution.
    function test_AgentMayTightenFloor() public {
        uint256 id = _openMandate(200e6, 0, 0);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(AuravisMandate.ReceivedLessThanMinimum.selector, 150e6, 100e6)
        );
        vault.execute(id, address(router), _swapCalldata(50e6), 50e6, 150e6, "want a better price");
    }

    function test_RejectsExpiryInThePast() public {
        vm.prank(owner);
        vm.expectRevert(AuravisMandate.ExpiryInPast.selector);
        vault.openMandate(
            address(usdc), address(target), 100e6, 0, 0, uint64(block.timestamp - 1), FAIR_FLOOR, "stale"
        );
    }

    function test_StrangerCannotExecute() public {
        uint256 id = _openMandate(200e6, 0, 0);

        vm.prank(stranger);
        vm.expectRevert(AuravisMandate.NotAgent.selector);
        vault.execute(id, address(router), _swapCalldata(10e6), 10e6, 0, "not me");
    }

    function test_RevokedMandateCannotExecute() public {
        uint256 id = _openMandate(200e6, 0, 0);

        vm.prank(owner);
        vault.revokeMandate(id);

        vm.prank(agent);
        vm.expectRevert(AuravisMandate.MandateInactive.selector);
        vault.execute(id, address(router), _swapCalldata(10e6), 10e6, 0, "too late");
    }

    function test_ExpiredMandateCannotExecute() public {
        uint256 id = _openMandate(200e6, 0, 0);
        vm.warp(block.timestamp + 31 days);

        vm.prank(agent);
        vm.expectRevert(AuravisMandate.MandateExpired.selector);
        vault.execute(id, address(router), _swapCalldata(10e6), 10e6, 0, "expired");
    }

    /// @notice Disarming the agent is unilateral and immediate.
    function test_OwnerCanDisarmAgent() public {
        uint256 id = _openMandate(200e6, 0, 0);

        vm.prank(owner);
        vault.setAgent(address(0));

        vm.prank(agent);
        vm.expectRevert(AuravisMandate.NotAgent.selector);
        vault.execute(id, address(router), _swapCalldata(10e6), 10e6, 0, "revoked key");
    }

    function test_OwnerCanWithdrawWithoutAgent() public {
        vm.prank(owner);
        vault.withdraw(address(usdc), 1_000e6);
        assertEq(usdc.balanceOf(owner), 1_000e6);
    }

    function test_StrangerCannotWithdraw() public {
        vm.prank(stranger);
        vm.expectRevert(AuravisMandate.NotOwner.selector);
        vault.withdraw(address(usdc), 1e6);
    }

    // -- the UI's refusal preview ----------------------------------------

    function test_CanExecuteExplainsRefusals() public {
        uint256 id = _openMandate(100e6, 0, 0);

        (bool ok, string memory why) = vault.canExecute(id, 50e6);
        assertTrue(ok);
        assertEq(why, "within mandate");

        (ok, why) = vault.canExecute(id, 150e6);
        assertFalse(ok);
        assertEq(why, "exceeds the mandate's total cap");
    }

    /// @notice A waived floor is allowed but must be visible, not silent.
    function test_CanExecuteFlagsMissingPriceFloor() public {
        uint256 id = _openMandateWithFloor(100e6, 0, 0, 0);

        (bool ok, string memory why) = vault.canExecute(id, 50e6);
        assertTrue(ok);
        assertEq(why, "within mandate (no price floor set)");
    }
}
