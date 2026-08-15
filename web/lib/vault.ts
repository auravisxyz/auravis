import { createPublicClient, http, formatUnits, type Address } from "viem";
import { activeChain, vaultAddress, auravisMandateAbi } from "./chain";

export const publicClient = createPublicClient({
  chain: activeChain,
  transport: http(),
});

export interface MandateView {
  id: string;
  intent: string;
  spendToken: Address;
  buyToken: Address;
  lifetimeCap: bigint;
  spent: bigint;
  windowCap: bigint;
  windowSpent: bigint;
  active: boolean;
  minOutPerUnit: bigint;
  /** The contract's own verdict, in its own words. */
  check: { allowed: boolean; why: string };
}

/**
 * Reads every mandate straight off the chain rather than from our database.
 *
 * This is the point of the product: what the dashboard shows and what the
 * contract enforces are the same thing. If we cached these in Postgres they
 * could disagree, and the version the user reads would be the one that isn't
 * binding.
 */
export async function readMandates(): Promise<MandateView[]> {
  if (!vaultAddress) return [];

  const count = (await publicClient.readContract({
    address: vaultAddress,
    abi: auravisMandateAbi,
    functionName: "mandateCount",
  })) as bigint;

  const out: MandateView[] = [];
  for (let i = 0n; i < count; i++) {
    const m = (await publicClient.readContract({
      address: vaultAddress,
      abi: auravisMandateAbi,
      functionName: "getMandate",
      args: [i],
    })) as {
      spendToken: Address;
      buyToken: Address;
      lifetimeCap: bigint;
      spent: bigint;
      windowCap: bigint;
      windowSpent: bigint;
      active: boolean;
      intent: string;
      minOutPerUnit: bigint;
    };

    const [allowed, why] = (await publicClient.readContract({
      address: vaultAddress,
      abi: auravisMandateAbi,
      functionName: "canExecute",
      args: [i, 1n],
    })) as [boolean, string];

    out.push({
      id: i.toString(),
      intent: m.intent,
      spendToken: m.spendToken,
      buyToken: m.buyToken,
      lifetimeCap: m.lifetimeCap,
      spent: m.spent,
      windowCap: m.windowCap,
      windowSpent: m.windowSpent,
      active: m.active,
      minOutPerUnit: m.minOutPerUnit,
      check: { allowed, why },
    });
  }
  return out;
}

/** Token amounts are 6-decimal stablecoins throughout this build. */
export function amount(value: bigint): string {
  return formatUnits(value, 6);
}
