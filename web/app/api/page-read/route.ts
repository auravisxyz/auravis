import { NextResponse } from "next/server";
import { z } from "zod";
import type { PageCapture } from "@auravis/shared";
import { HeuristicPageReader, ModelPageReader } from "@auravis/shared";

export const runtime = "nodejs";

/**
 * Page reading endpoint. Same reason for existing as /api/intent: the model
 * key lives in server env, never in the extension bundle.
 *
 * Called once per capture, before the user types. The popup renders the
 * capture immediately and folds this in when it lands, so a slow or failed
 * read costs nothing visible.
 */
const captureSchema = z.object({
  url: z.string().url().max(2048),
  title: z.string().max(512),
  excerpt: z.string().max(4096),
  priceCandidates: z.array(z.string().max(64)).max(24),
  primaryPrice: z
    .object({
      value: z.number().finite().nonnegative(),
      currency: z.string().max(8),
      raw: z.string().max(64),
      source: z.enum(["json-ld", "microdata", "meta", "guessed"]),
    })
    .optional(),
  extraCosts: z
    .object({
      shipping: z.object({ value: z.number().finite(), raw: z.string().max(64) }).optional(),
      taxAtCheckout: z.boolean(),
    })
    .optional(),
  availability: z.enum(["in-stock", "out-of-stock", "unknown"]).optional(),
  imageUrl: z.string().url().max(2048).optional(),
  capturedAt: z.string().max(64),
});

const bodySchema = z.object({ capture: captureSchema });

function buildReader() {
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) return { engine: "heuristic" as const, reader: new HeuristicPageReader() };

  const provider =
    process.env.MODEL_PROVIDER === "openai" ? ("openai" as const) : ("anthropic" as const);
  return {
    engine: "model" as const,
    reader: new ModelPageReader({
      apiKey,
      provider,
      ...(process.env.MODEL_NAME ? { model: process.env.MODEL_NAME } : {}),
      ...(process.env.MODEL_BASE_URL ? { baseUrl: process.env.MODEL_BASE_URL } : {}),
    }),
  };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: CORS });
  }

  const { engine, reader } = buildReader();
  const reading = await reader.read(parsed.data.capture as PageCapture);

  return NextResponse.json({ reading, engine }, { headers: CORS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
