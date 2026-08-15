import { getContract, type Address, type Hex } from "viem";
import { publicClient, walletClient } from "./chain.js";
import { auravisMandateAbi } from "./abi/AuravisMandate.js";
import { config } from "./config.js";

/** ERC-8021 attribution suffix for the configured Builder Code, if any. */
function builderCodeSuffix(): Hex | undefined {
  if (!config.okx.builderCode) return undefined;
  return config.okx.builderCode.startsWith("0x")
    ? (config.okx.builderCode as Hex)
    : (`0x${config.okx.builderCode}` as Hex);
}

if (!config.mandateAddress) {
  throw new Error(
    `No mandate address configured for network "${config.network}". ` +
      `Set MANDATE_ADDRESS_${config.network.toUpperCase()} in .env after deploying.`,
  );
}

const mandateAddress = config.mandateAddress as Address;

export const mandateContract = getContract({
  address: mandateAddress,
  abi: auravisMandateAbi,
  client: { public: publicClient, wallet: walletClient },
});

export type Mandate = Awaited<ReturnType<typeof mandateContract.read.getMandate>>;

export async function getMandate(id: bigint): Promise<Mandate> {
  return mandateContract.read.getMandate([id]);
}

export async function mandateCount(): Promise<bigint> {
  return mandateContract.read.mandateCount();
}

/**
 * Dry-run the on-chain checks before spending real gas. This is also what
 * powers the dashboard's "here's why I didn't buy" copy — a refusal here
 * becomes a plain-English explanation shown to the user, not a silent skip.
 */
export async function canExecute(
  id: bigint,
  amountIn: bigint,
): Promise<{ allowed: boolean; why: string }> {
  const [allowed, why] = await mandateContract.read.canExecute([id, amountIn]);
  return { allowed, why };
}

export interface ExecuteParams {
  id: bigint;
  router: Address;
  swapData: Hex;
  declaredIn: bigint;
  minOut: bigint;
  reason: string;
}

/**
 * Submits `execute()`. The contract itself enforces every limit — this
 * function does not (and must not) duplicate that logic. If the mandate,
 * cap, router, or slippage checks fail, the chain reverts and we surface
 * the specific reason to the caller rather than swallowing it.
 *
 * `dataSuffix` is viem's built-in support for exactly this pattern (referral
 * / attribution codes appended to calldata) — it's how the Builder Code gets
 * attached without us hand-building the transaction. See RULES.md and
 * CONTEXT.md for what Builder Codes unlock on X Layer.
 */
export async function executeMandate(params: ExecuteParams): Promise<Hex> {
  const dataSuffix = builderCodeSuffix();

  const { request } = await publicClient.simulateContract({
    address: mandateAddress,
    abi: auravisMandateAbi,
    functionName: "execute",
    args: [
      params.id,
      params.router,
      params.swapData,
      params.declaredIn,
      params.minOut,
      params.reason,
    ],
    account: walletClient.account,
    ...(dataSuffix ? { dataSuffix } : {}),
  });

  return walletClient.writeContract(request);
}
