import { encodeFunctionData, formatUnits, type Address, type Hex } from "viem";
import { config } from "./config.js";
import { publicClient } from "./chain.js";
import { getMandate, executeMandate } from "./mandate.js";
import { getSwapQuote } from "./swap.js";

/**
 * The execution half of the agent: given a fired trigger, actually swap.
 *
 * Deliberately does NOT re-implement any safety logic. The contract enforces
 * caps, router allowlist and price floor; canExecute() was already consulted
 * by the watcher before the fire. This module's whole job is routing — build
 * calldata, send, report what happened in words a user can read.
 */

const TESTNET_ROUTER_ABI = [
  {
    type: "function",
    name: "swap",
    stateMutability: "nonpayable",
    inputs: [{ name: "amountIn", type: "uint256" }],
    outputs: [],
  },
] as const;

export interface ExecutionOutcome {
  ok: boolean;
  txHash?: Hex;
  /** Human sentence for the "what I did and why" feed — never a raw stack. */
  reason: string;
}

interface Route {
  router: Address;
  data: Hex;
  minOut: bigint;
  description: string;
}

/**
 * Mainnet routes through the OKX aggregator. Testnet routes through the
 * rehearsal rig, because the aggregator has no testnet deployment (error
 * 50026) — same `execute()` path, same enforcement, different liquidity.
 */
async function buildRoute(
  spendToken: Address,
  buyToken: Address,
  amountIn: bigint,
): Promise<Route | { error: string }> {
  if (config.network === "mainnet") {
    const quote = await getSwapQuote({
      fromToken: spendToken,
      toToken: buyToken,
      amount: amountIn,
      vaultAddress: config.mandateAddress as Address,
    });
    return {
      router: quote.router,
      data: quote.data,
      minOut: quote.minReceiveAmount,
      description: `via OKX aggregator, ${quote.priceImpactPercent}% impact`,
    };
  }

  if (config.mockRouter) {
    return {
      router: config.mockRouter,
      data: encodeFunctionData({
        abi: TESTNET_ROUTER_ABI,
        functionName: "swap",
        args: [amountIn],
      }),
      // 0 defers entirely to the owner's on-chain floor, which is the binding
      // one anyway — and letting the floor do the rejecting is exactly what
      // the rehearsal is for.
      minOut: 0n,
      description: "via testnet rehearsal router",
    };
  }

  return {
    error:
      "No route available: the OKX aggregator doesn't serve testnet and " +
      "MOCK_ROUTER_TESTNET isn't set. Deploy the rig (DeployTestnetRig.s.sol) first.",
  };
}

export async function executeAuto(mandateId: bigint, amountIn: bigint): Promise<ExecutionOutcome> {
  const mandate = await getMandate(mandateId);

  const route = await buildRoute(
    mandate.spendToken as Address,
    mandate.buyToken as Address,
    amountIn,
  );
  if ("error" in route) return { ok: false, reason: route.error };

  const human = formatUnits(amountIn, 6);

  try {
    const txHash = await executeMandate({
      id: mandateId,
      router: route.router,
      swapData: route.data,
      declaredIn: amountIn,
      minOut: route.minOut,
      reason: `Auto: target crossed, swapping ${human} ${route.description}.`,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      return { ok: false, txHash, reason: "Transaction reverted on-chain after submission." };
    }
    return { ok: true, txHash, reason: `Swapped ${human} ${route.description}.` };
  } catch (err) {
    // executeMandate simulates first, so contract refusals land here with the
    // decoded custom error (ExceedsWindowCap, ReceivedLessThanMinimum, …).
    // That name IS the explanation — surface it, don't bury it.
    const message =
      err instanceof Error
        ? "shortMessage" in err && typeof (err as { shortMessage?: unknown }).shortMessage === "string"
          ? (err as { shortMessage: string }).shortMessage
          : err.message
        : String(err);
    return { ok: false, reason: `The chain refused: ${message.slice(0, 280)}` };
  }
}
