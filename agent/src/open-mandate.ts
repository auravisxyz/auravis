import { createWalletClient, http, formatUnits, parseUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { publicClient, activeChain } from "./chain.js";
import { auravisMandateAbi } from "./abi/AuravisMandate.js";
import { TOKENS } from "./constants.js";

/**
 * Opens a mandate with wording of your choosing.
 *
 * The intent string is the only part of a mandate a person ever reads. It is
 * what the dashboard prints, what the extension echoes back, and what ends up
 * on screen in a demo. The first mandate said "buy USDC with USDT when the
 * price is right", which describes the transaction accurately and the product
 * not at all.
 *
 *   npm run open:mandate -- --intent "watch it and buy when it drops"
 *   npm run open:mandate -- --intent "..." --cap 20 --window 10 --confirm
 *
 * Owner only, by the contract. Caps are in whole tokens; the price floor is
 * fixed at 0.99 out per 1.00 in, matching the existing mandate so the refusal
 * demo behaves identically.
 */

const CONFIRM = process.argv.includes("--confirm");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const INTENT = arg("intent");
const CAP = parseUnits(arg("cap") ?? "20", 6);
const WINDOW_CAP = parseUnits(arg("window") ?? "10", 6);
const WINDOW_SECONDS = 3600n;
const FLOOR = 990_000_000_000_000_000n; // 0.99 out per 1.00 in

async function main() {
  if (!INTENT) {
    console.error('Pass one, e.g. --intent "buy it the moment it drops 8%"');
    process.exit(1);
  }
  if (!config.ownerPrivateKey) {
    console.error("OWNER_PRIVATE_KEY not set. Only the owner can open a mandate.");
    process.exit(1);
  }
  if (!config.mandateAddress) {
    console.error(`No vault configured for ${config.network}.`);
    process.exit(1);
  }

  const owner = privateKeyToAccount(config.ownerPrivateKey);
  const vault = config.mandateAddress as Address;

  console.log(CONFIRM ? "OPEN MANDATE — LIVE\n" : "OPEN MANDATE — DRY RUN\n");
  console.log(`vault   ${vault}`);
  console.log(`network ${config.network}`);
  console.log(`intent  "${INTENT}"`);
  console.log(`cap     ${formatUnits(CAP, 6)}, window ${formatUnits(WINDOW_CAP, 6)}/hr`);
  console.log(`floor   0.99 out per 1.00 in`);

  const onChainOwner = (await publicClient.readContract({
    address: vault,
    abi: auravisMandateAbi,
    functionName: "owner",
  })) as Address;

  if (onChainOwner.toLowerCase() !== owner.address.toLowerCase()) {
    console.error(`\nVault owner is ${onChainOwner}, but OWNER_PRIVATE_KEY is ${owner.address}.`);
    process.exit(1);
  }

  const before = (await publicClient.readContract({
    address: vault,
    abi: auravisMandateAbi,
    functionName: "mandateCount",
  })) as bigint;
  console.log(`\nexisting mandates: ${before}. This will be #${before}.`);
  console.log("Existing mandates are untouched. Revoke separately if you want them gone.");

  if (!CONFIRM) {
    console.log("\nDry run. Re-run with --confirm to open it.");
    process.exit(0);
  }

  const wallet = createWalletClient({
    account: owner,
    chain: activeChain,
    transport: http(config.rpcUrl),
  });

  const hash = await wallet.writeContract({
    address: vault,
    abi: auravisMandateAbi,
    functionName: "openMandate",
    args: [TOKENS.USDT, TOKENS.USDC, CAP, WINDOW_CAP, WINDOW_SECONDS, 0n, FLOOR, INTENT],
    chain: activeChain,
    account: owner,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`\nOpened mandate #${before}. tx ${hash}  status: ${receipt.status}`);
  console.log(`${activeChain.blockExplorers?.default.url}/tx/${hash}`);
  console.log(`\nTo execute against it: npm run execute:mainnet -- --mandate ${before}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("open-mandate failed:", err);
  process.exit(1);
});
