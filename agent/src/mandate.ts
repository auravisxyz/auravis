import { getContract, type Address, type Hex } from "viem";
import { publicClient, walletClient } from "./chain.js";
import { auravisMandateAbi } from "./abi/AuravisMandate.js";
import { config } from "./config.js";

/**
 * Attribution suffix for the configured Builder Code, if any.
 *
 * Builder Codes are issued as opaque alphanumeric identifiers — ours is
 * `csm143igm03b0ev4`, which contains s/m/i/g/v and is therefore NOT hex.
 * Naively prefixing "0x" produces an invalid hex string and viem throws, so
 * anything non-hex is encoded as its UTF-8 bytes instead.
 *
 * ⚠️ UNVERIFIED (blocks mainnet, not testnet): OKX's Classic Swap API docs
 * expose no builderCode request parameter, and the encoding they expect for
 * on-chain attribution isn't documented in the swap reference. Two candidates:
 * this calldata suffix, or the `callDataMemo` swap parameter (which wants a
 * 128-char hex string). Confirm with OKX before relying on mainnet attribution
 * for the Launch Grant — getting this wrong means volume doesn't get credited.
 */
function builderCodeSuffix(): Hex | undefined {
  const code = config.okx.builderCode;
  if (!code) return undefined;

  if (/^0x[0-9a-fA-F]*$/.test(code)) return code as Hex;
  if (/^[0-9a-fA-F]+$/.test(code)) return `0x${code}` as Hex;

  const hex = Buffer.from(code, "utf8").toString("hex");
  return `0x${hex}` as Hex;
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
  /**
   * Skip the pre-flight simulation and broadcast regardless. Only for
   * demonstrating a refusal on-chain: normally a revert should be caught
   * locally and cost nothing, but a refusal nobody can point at in an
   * explorer is not evidence.
   */
  force?: boolean;
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

  const args = [
    params.id,
    params.router,
    params.swapData,
    params.declaredIn,
    params.minOut,
    params.reason,
  ] as const;

  if (params.force) {
    // A fixed gas limit is required: estimateGas reverts for the same reason
    // the call does, and would block the broadcast.
    return walletClient.writeContract({
      address: mandateAddress,
      abi: auravisMandateAbi,
      functionName: "execute",
      args,
      gas: 500_000n,
      ...(dataSuffix ? { dataSuffix } : {}),
    });
  }

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
