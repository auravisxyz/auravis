import {
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  formatUnits,
  type Address,
  type Hex,
} from "viem";
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
export async function buildRoute(
  spendToken: Address,
  buyToken: Address,
  amountIn: bigint,
): Promise<Route | { error: string }> {
  if (config.network === "mainnet") {
    // The OKX aggregator's X Layer routes for this pair revert on-chain for
    // every caller we tested — vault AND plain EOA — while quoting fine.
    // (Aug 15 2026; ticket pending.) Until routes actually fill, autonomous
    // mainnet execution goes through our DemoRouter: real tokens, identical
    // vault enforcement. NOTE: the Catch-mode widget likely rides the same
    // routing — verify a manual widget swap on this pair before demo day.
    if (config.demoRouter) {
      return {
        router: config.demoRouter,
        data: encodeFunctionData({
          abi: TESTNET_ROUTER_ABI,
          functionName: "swap",
          args: [amountIn],
        }),
        minOut: 0n, // the owner's on-chain floor binds
        description: "via DemoRouter (real USDT→USDC; OKX aggregator routes currently revert on X Layer)",
      };
    }
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
    return { ok: false, reason: `The chain refused: ${describeRefusal(err)}` };
  }
}

/**
 * Turn a revert into a sentence a person can read.
 *
 * viem buries the decoded custom error two levels down (`shortMessage` alone
 * yields the useless 'The contract function "execute" reverted.'). Walk to the
 * ContractFunctionRevertedError, take the error NAME and ARGS, and translate
 * the ones our contract actually throws. The refusal explaining itself is the
 * product's defining feature — this string IS the demo's kill-shot copy.
 */
function describeRefusal(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data) {
      return humanizeError(revert.data.errorName, revert.data.args);
    }
    return err.shortMessage.slice(0, 280);
  }
  return (err instanceof Error ? err.message : String(err)).slice(0, 280);
}

function humanizeError(name: string, args: readonly unknown[] | undefined): string {
  // All amounts in this build are 6-decimal stablecoins. Two decimals always:
  // formatUnits gives "9.9", and money that drops a trailing zero looks like
  // a bug to anyone reading the feed.
  const fmt = (v: unknown): string => {
    try {
      return Number(formatUnits(BigInt(v as string | number | bigint), 6)).toFixed(2);
    } catch {
      return String(v);
    }
  };

  switch (name) {
    case "ReceivedLessThanMinimum":
      return (
        `the router offered too little — your floor requires ${fmt(args?.[0])}, ` +
        `it offered ${fmt(args?.[1])}. The price floor held.`
      );
    case "ExceedsLifetimeCap":
      return (
        `it would break the mandate's total cap — asked for ${fmt(args?.[0])}, ` +
        `only ${fmt(args?.[1])} remains. The cap held.`
      );
    case "ExceedsWindowCap":
      return (
        `it would break this window's rate limit — asked for ${fmt(args?.[0])}, ` +
        `only ${fmt(args?.[1])} is allowed right now. The rate limit held.`
      );
    case "SpentMoreThanDeclared":
      return (
        `the router tried to take more than declared — declared ${fmt(args?.[0])}, ` +
        `attempted ${fmt(args?.[1])}. Caught by the balance check and reverted.`
      );
    case "RouterNotAllowed":
      return `router ${String(args?.[0] ?? "").slice(0, 10)}… is not on the owner's allowlist.`;
    case "MandateInactive":
      return "the mandate has been revoked or exhausted.";
    case "MandateExpired":
      return "the mandate has expired.";
    case "NotAgent":
      return "the caller is not the authorised agent key.";
    default:
      return `${name}${args?.length ? `(${args.map(String).join(", ")})` : ""}`;
  }
}
