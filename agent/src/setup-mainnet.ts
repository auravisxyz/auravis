import { createWalletClient, http, getContract, formatUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { activeChain, publicClient, agentAccount } from "./chain.js";
import { auravisMandateAbi } from "./abi/AuravisMandate.js";
import { getSwapQuote } from "./swap.js";

/**
 * Guided mainnet setup. Dry-run by default — pass --confirm to send anything.
 *
 *   npm run setup:mainnet            # inspect, sends nothing
 *   npm run setup:mainnet -- --confirm
 *
 * Order matters and each step is checked before the next: a vault with no
 * allowlisted router, or a mandate whose buyToken is wrong, fails at execute()
 * time with real money already deposited. Better to catch it here.
 */

const CONFIRM = process.argv.includes("--confirm");

// X Layer mainnet. Verify against the token list endpoint if these ever move.
const USDT: Address = "0x1e4a5963abfd975d8c9021ce480b42188849d41d";
const USDC: Address = "0x74b7f16337b8972027f6196a17a631ac6de26d22";

const SPEND_AMOUNT = 10_000_000n; // 10 USDT (6 decimals)
const LIFETIME_CAP = 20_000_000n; // 20 USDT
const WINDOW_CAP = 10_000_000n; // 10 USDT per window
const WINDOW_SECONDS = 3_600n; // 1 hour
/** 0.99e18 — reject anything more than ~1% worse than parity. */
const MIN_OUT_PER_UNIT = 990_000_000_000_000_000n;

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "s", type: "address" },
      { name: "v", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

function fail(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

async function main() {
  console.log(CONFIRM ? "MAINNET SETUP — LIVE\n" : "MAINNET SETUP — DRY RUN (nothing will be sent)\n");

  // --- preflight ---------------------------------------------------------
  if (config.network !== "mainnet") {
    fail(`NETWORK is "${config.network}". Set NETWORK=mainnet in .env first.`);
  }
  if (!config.ownerPrivateKey) {
    fail("OWNER_PRIVATE_KEY is not set. Add it to .env — it never leaves your machine.");
  }
  if (!config.mandateAddress) {
    fail("MANDATE_ADDRESS_MAINNET is not set. Deploy the contract first, then re-run.");
  }

  const owner = privateKeyToAccount(config.ownerPrivateKey);
  const vault = config.mandateAddress as Address;

  const ownerClient = createWalletClient({
    account: owner,
    chain: activeChain,
    transport: http(config.rpcUrl),
  });

  console.log(`chain:  ${activeChain.name} (${activeChain.id})`);
  console.log(`vault:  ${vault}`);
  console.log(`owner:  ${owner.address}`);
  console.log(`agent:  ${agentAccount.address}`);

  // The guarantee only exists if these are different keys.
  if (owner.address.toLowerCase() === agentAccount.address.toLowerCase()) {
    fail(
      "Owner and agent are the SAME address. The security model requires the\n" +
        "  owner to be able to overrule a compromised agent — identical keys make\n" +
        "  that impossible. Generate separate keys before going further.",
    );
  }

  const contract = getContract({
    address: vault,
    abi: auravisMandateAbi,
    client: { public: publicClient, wallet: ownerClient },
  });

  const onChainOwner = (await contract.read.owner()) as Address;
  if (onChainOwner.toLowerCase() !== owner.address.toLowerCase()) {
    fail(`Vault owner is ${onChainOwner}, but OWNER_PRIVATE_KEY is ${owner.address}.`);
  }

  const ownerGas = await publicClient.getBalance({ address: owner.address });
  const agentGas = await publicClient.getBalance({ address: agentAccount.address });
  console.log(`\nowner OKB: ${formatUnits(ownerGas, 18)}`);
  console.log(`agent OKB: ${formatUnits(agentGas, 18)}`);
  if (agentGas === 0n) {
    console.warn("⚠️  Agent has no OKB — it cannot pay gas to call execute().");
  }

  // --- 1. live quote, to learn the router --------------------------------
  console.log("\n[1] Fetching a live quote to discover the router…");
  const quote = await getSwapQuote({
    fromToken: USDT,
    toToken: USDC,
    amount: SPEND_AMOUNT,
    vaultAddress: vault, // NOT the agent — the vault is the caller on-chain
    slippagePercent: "0.5",
  });
  console.log(`    router:     ${quote.router}`);
  console.log(`    expect out: ${formatUnits(quote.toTokenAmount, 6)} USDC`);
  console.log(`    min out:    ${formatUnits(quote.minReceiveAmount, 6)} USDC`);
  console.log(`    impact:     ${quote.priceImpactPercent}%`);

  // --- 2. allowlist ------------------------------------------------------
  const already = (await contract.read.allowedRouters([quote.router])) as boolean;
  console.log(`\n[2] Router allowlisted: ${already}`);
  if (!already) {
    if (!CONFIRM) {
      console.log("    would call setRouterAllowed(router, true)");
    } else {
      const hash = await contract.write.setRouterAllowed([quote.router, true]);
      console.log(`    sent ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
      console.log("    confirmed");
    }
  }

  // --- 3. funding --------------------------------------------------------
  const usdt = getContract({ address: USDT, abi: ERC20_ABI, client: publicClient });
  const vaultBal = (await usdt.read.balanceOf([vault])) as bigint;
  const ownerBal = (await usdt.read.balanceOf([owner.address])) as bigint;
  console.log(`\n[3] USDT — vault ${formatUnits(vaultBal, 6)}, owner ${formatUnits(ownerBal, 6)}`);

  if (vaultBal < SPEND_AMOUNT) {
    const short = SPEND_AMOUNT - vaultBal;
    if (ownerBal < short) {
      fail(
        `Vault needs ${formatUnits(short, 6)} more USDT and the owner only has ` +
          `${formatUnits(ownerBal, 6)}. Send USDT to ${owner.address} first.`,
      );
    }
    if (!CONFIRM) {
      console.log(`    would approve + deposit ${formatUnits(short, 6)} USDT into the vault`);
    } else {
      const approve = await ownerClient.writeContract({
        address: USDT,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [vault, short],
        chain: activeChain,
        account: owner,
      });
      await publicClient.waitForTransactionReceipt({ hash: approve });
      const dep = await contract.write.deposit([USDT, short]);
      console.log(`    deposit ${dep}`);
      await publicClient.waitForTransactionReceipt({ hash: dep });
      console.log("    confirmed");
    }
  }

  // --- 4. mandate --------------------------------------------------------
  const count = (await contract.read.mandateCount()) as bigint;
  console.log(`\n[4] Mandates on vault: ${count}`);
  if (count === 0n) {
    if (!CONFIRM) {
      console.log(
        `    would openMandate(USDT → USDC, cap ${formatUnits(LIFETIME_CAP, 6)}, ` +
          `window ${formatUnits(WINDOW_CAP, 6)}/hr, floor ${MIN_OUT_PER_UNIT})`,
      );
    } else {
      const hash = await contract.write.openMandate([
        USDT,
        USDC,
        LIFETIME_CAP,
        WINDOW_CAP,
        WINDOW_SECONDS,
        0n, // no expiry
        MIN_OUT_PER_UNIT,
        "buy USDC with USDT when the price is right",
      ]);
      console.log(`    sent ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
      console.log("    confirmed");
    }
  }

  // --- 5. dry run --------------------------------------------------------
  const finalCount = (await contract.read.mandateCount()) as bigint;
  if (finalCount > 0n) {
    const [allowed, why] = (await contract.read.canExecute([0n, SPEND_AMOUNT])) as [boolean, string];
    console.log(`\n[5] canExecute(0, ${formatUnits(SPEND_AMOUNT, 6)}): ${allowed} — "${why}"`);
  } else {
    console.log("\n[5] No mandate yet — re-run with --confirm to create one.");
  }

  console.log(
    CONFIRM
      ? "\nSetup complete. Nothing has been swapped yet — run the execute step separately."
      : "\nDry run finished. Nothing was sent. Re-run with --confirm when the numbers look right.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("\nsetup failed:", err);
  process.exit(1);
});
