import { NextResponse } from "next/server";
import { z } from "zod";
import type { PageCapture } from "@auravis/shared";
import { ModelIntentExtractor, PatternIntentExtractor } from "@auravis/shared";

export const runtime = "nodejs";

/**
 * Intent extraction endpoint. Exists so the model API key lives here, in
 * server env, and never inside the extension bundle.
 *
 * Engine selection is env-driven:
 *   MODEL_API_KEY set   → LLM (MODEL_PROVIDER anthropic|openai, MODEL_NAME,
 *                         MODEL_BASE_URL for OpenAI-compatible gateways)
 *   MODEL_API_KEY empty → pattern extractor, same behaviour as offline
 *
 * The response says which engine answered — the popup surfaces nothing, but
 * it makes "why did this parse badly" debuggable in one glance.
 */
const bodySchema = z.object({
  capture: z.object({
    url: z.string().url().max(2048),
    title: z.string().max(512),
    excerpt: z.string().max(4096),
    priceCandidates: z.array(z.string().max(64)).max(24),
    primaryPrice: z
      .object({
        value: z.number().finite().nonnegative(),
        currency: z.string().max(8),
        raw: z.string().max(64),
        source: z.enum(["json-ld", "microdata", "meta", "guessed", "corrected"]),
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
  }),
  instruction: z.string().min(1).max(2048),
});

function buildExtractor() {
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) return { engine: "pattern" as const, extractor: new PatternIntentExtractor() };

  const provider = process.env.MODEL_PROVIDER === "openai" ? ("openai" as const) : ("anthropic" as const);
  return {
    engine: "model" as const,
    extractor: new ModelIntentExtractor({
      apiKey,
      provider,
      ...(process.env.MODEL_NAME ? { model: process.env.MODEL_NAME } : {}),
      ...(process.env.MODEL_BASE_URL ? { baseUrl: process.env.MODEL_BASE_URL } : {}),
    }),
  };
}

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { engine, extractor } = buildExtractor();
  const draft = await extractor.extract(parsed.data.capture as PageCapture, parsed.data.instruction);

  return NextResponse.json({ draft, engine }, { headers: CORS });
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
