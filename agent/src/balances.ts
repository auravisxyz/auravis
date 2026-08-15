import { formatUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { publicClient, activeChain } from "./chain.js";

/**
 * Where is the money? Checks every role wallet and the vault against both
 * stablecoins plus native OKB.
 *
 * Exists because "owner has 0 USDT" has several possible causes — wrong
 * wallet, wrong token, wrong chain, still pending — and guessing between them
 * wastes more time than one table answers.
 *
 * Run: npm run balances
 */

const ERC20 = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

const TOKENS: Array<{ label: string; address: Address; decimals: number }> = [
  { label: "USDT", address: "0x779ded0c9e1022225f8e0630b35a9b54be713736", decimals: 6 },
  { label: "USDC", address: "0xb6ceceab302e2e4948951ee7843fc24e92933061", decimals: 6 },
];

async function tokenBalance(token: Address, holder: Address, decimals: number): Promise<string> {
  try {
    const raw = (await publicClient.readContract({
      address: token,
      abi: ERC20,
      functionName: "balanceOf",
      args: [holder],
    })) as bigint;
    return Number(formatUnits(raw, decimals)).toFixed(2);
  } catch {
    return "err";
  }
}

async function main() {
  const wallets: Array<{ role: string; address: Address }> = [];

  if (config.ownerPrivateKey) {
    wallets.push({ role: "owner", address: privateKeyToAccount(config.ownerPrivateKey).address });
  }
  wallets.push({
    role: "agent",
    address: privateKeyToAccount(config.agent.privateKey).address,
  });
  if (process.env.DEPLOYER_PRIVATE_KEY) {
    wallets.push({
      role: "deployer",
      address: privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`).address,
    });
  }
  if (config.mandateAddress) {
    wallets.push({ role: "VAULT", address: config.mandateAddress as Address });
  }

  console.log(`\n${activeChain.name} (chain ${activeChain.id})\n`);
  console.log("role      address                                       OKB      USDT      USDC");
  console.log("─".repeat(88));

  for (const w of wallets) {
    const native = await publicClient.getBalance({ address: w.address });
    const okb = Number(formatUnits(native, 18)).toFixed(4);
    const usdt = await tokenBalance(TOKENS[0]!.address, w.address, 6);
    const usdc = await tokenBalance(TOKENS[1]!.address, w.address, 6);
    console.log(
      `${w.role.padEnd(9)} ${w.address}  ${okb.padStart(8)}  ${usdt.padStart(8)}  ${usdc.padStart(8)}`,
    );
  }

  console.log(
    "\nIf USDT shows 0 everywhere but you sent it: it likely went to another\n" +
      "chain (must be X Layer, not ERC-20/BSC) or arrived as a different token.\n" +
      "Check the sending address on the explorer to see which asset actually moved.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("balances failed:", err);
  process.exit(1);
});
