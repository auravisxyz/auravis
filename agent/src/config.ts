import "dotenv/config";
import { z } from "zod";

/**
 * All runtime configuration, validated once at startup. If something required
 * is missing we want to know immediately, not three hours into a demo.
 */
const schema = z.object({
  // -- chain ---------------------------------------------------------------
  XLAYER_TESTNET_RPC: z.string().url(),
  XLAYER_MAINNET_RPC: z.string().url(),
  XLAYER_TESTNET_CHAIN_ID: z.coerce.number().default(1952),
  XLAYER_MAINNET_CHAIN_ID: z.coerce.number().default(196),
  NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),

  // -- deployed contract -----------------------------------------------------
  MANDATE_ADDRESS_TESTNET: z.string().optional(),
  MANDATE_ADDRESS_MAINNET: z.string().optional(),

  // -- testnet rehearsal rig (contracts/script/DeployTestnetRig.s.sol) -------
  // The OKX aggregator is mainnet-only, so testnet auto-execution routes
  // through this rig instead. All optional; without them, auto mode on
  // testnet degrades to a recorded "no route" skip.
  MOCK_ROUTER_TESTNET: z.string().optional(),
  MOCK_USDT_TESTNET: z.string().optional(),
  MOCK_USDC_TESTNET: z.string().optional(),

  // Mainnet fallback router (contracts/src/mocks/DemoRouter.sol). Exists
  // because the OKX aggregator's X Layer routes revert on-chain for every
  // caller (vault and EOA alike) despite quoting fine. Real tokens, our router.
  DEMO_ROUTER_MAINNET: z.string().optional(),

  // -- agent identity ----------------------------------------------------
  AGENT_PRIVATE_KEY: z.string().min(1, "AGENT_PRIVATE_KEY is required"),
  AGENT_POLL_INTERVAL_MS: z.coerce.number().default(15_000),

  // -- owner identity ----------------------------------------------------
  // Only needed by setup scripts (allowlist, deposit, openMandate). The agent
  // service never reads this and must never be given it — the entire security
  // model is that the owner key can overrule the agent key.
  OWNER_PRIVATE_KEY: z.string().optional(),

  // -- public demo vault (testnet only) ----------------------------------
  // Deliberately publishable. Every vault has one owner, so a reviewer with
  // their own wallet can only ever look; this key hands them a vault of their
  // own with nothing of value in it. Never used on mainnet.
  DEMO_PRIVATE_KEY: z.string().optional(),
  DEMO_VAULT_TESTNET: z.string().optional(),

  // -- deployer identity -------------------------------------------------
  // Owns DemoRouter, so it is the only key that can move the demo's rate
  // lever (`npm run set:rate`). Nothing else reads it.
  DEPLOYER_PRIVATE_KEY: z.string().optional(),

  // -- OKX -----------------------------------------------------------------
  OKX_API_KEY: z.string().optional(),
  OKX_API_SECRET: z.string().optional(),
  OKX_API_PASSPHRASE: z.string().optional(),
  OKX_PROJECT_ID: z.string().optional(),
  BUILDER_CODE: z.string().optional(),
  OKX_DEX_ROUTER: z.string().optional(),

  // -- data ------------------------------------------------------------------
  DATABASE_URL: z.string().optional(),

  // -- local testing ---------------------------------------------------------
  // Forces the mock price feed even when OKX credentials are present, so the
  // watch loop can be exercised end to end from a network that can't reach
  // OKX. Everything else stays real: real Neon, real contract, real checks.
  PRICE_FEED: z.enum(["auto", "mock", "okx"]).default("auto"),
  MOCK_PRICE: z.coerce.number().default(100),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid or missing environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsed.data;

export const config = {
  network: env.NETWORK,
  rpcUrl: env.NETWORK === "mainnet" ? env.XLAYER_MAINNET_RPC : env.XLAYER_TESTNET_RPC,
  chainId: env.NETWORK === "mainnet" ? env.XLAYER_MAINNET_CHAIN_ID : env.XLAYER_TESTNET_CHAIN_ID,
  mandateAddress:
    env.NETWORK === "mainnet" ? env.MANDATE_ADDRESS_MAINNET : env.MANDATE_ADDRESS_TESTNET,

  mockRouter: env.MOCK_ROUTER_TESTNET as `0x${string}` | undefined,
  demoRouter: env.DEMO_ROUTER_MAINNET as `0x${string}` | undefined,
  mockUsdt: env.MOCK_USDT_TESTNET as `0x${string}` | undefined,
  mockUsdc: env.MOCK_USDC_TESTNET as `0x${string}` | undefined,

  agent: {
    privateKey: env.AGENT_PRIVATE_KEY as `0x${string}`,
    pollIntervalMs: env.AGENT_POLL_INTERVAL_MS,
  },

  ownerPrivateKey: env.OWNER_PRIVATE_KEY as `0x${string}` | undefined,
  deployerPrivateKey: env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined,
  demoPrivateKey: env.DEMO_PRIVATE_KEY as `0x${string}` | undefined,
  demoVault: env.DEMO_VAULT_TESTNET as `0x${string}` | undefined,

  okx: {
    apiKey: env.OKX_API_KEY,
    apiSecret: env.OKX_API_SECRET,
    apiPassphrase: env.OKX_API_PASSPHRASE,
    projectId: env.OKX_PROJECT_ID,
    builderCode: env.BUILDER_CODE,
    dexRouter: env.OKX_DEX_ROUTER as `0x${string}` | undefined,
  },

  databaseUrl: env.DATABASE_URL,

  priceFeed: env.PRICE_FEED,
  mockPrice: env.MOCK_PRICE,
} as const;

export type Config = typeof config;
