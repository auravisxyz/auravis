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

  // -- agent identity ----------------------------------------------------
  AGENT_PRIVATE_KEY: z.string().min(1, "AGENT_PRIVATE_KEY is required"),
  AGENT_POLL_INTERVAL_MS: z.coerce.number().default(15_000),

  // -- OKX -----------------------------------------------------------------
  OKX_API_KEY: z.string().optional(),
  OKX_API_SECRET: z.string().optional(),
  OKX_API_PASSPHRASE: z.string().optional(),
  OKX_PROJECT_ID: z.string().optional(),
  BUILDER_CODE: z.string().optional(),
  OKX_DEX_ROUTER: z.string().optional(),

  // -- data ------------------------------------------------------------------
  DATABASE_URL: z.string().optional(),
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

  agent: {
    privateKey: env.AGENT_PRIVATE_KEY as `0x${string}`,
    pollIntervalMs: env.AGENT_POLL_INTERVAL_MS,
  },

  okx: {
    apiKey: env.OKX_API_KEY,
    apiSecret: env.OKX_API_SECRET,
    apiPassphrase: env.OKX_API_PASSPHRASE,
    projectId: env.OKX_PROJECT_ID,
    builderCode: env.BUILDER_CODE,
    dexRouter: env.OKX_DEX_ROUTER as `0x${string}` | undefined,
  },

  databaseUrl: env.DATABASE_URL,
} as const;

export type Config = typeof config;
