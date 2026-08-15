import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { getDb, schema } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Receives a capture + parsed intent from the extension and returns an id the
 * extension uses to open the confirm page.
 *
 * Validated rather than trusted: this endpoint is reachable from any origin a
 * browser extension runs on, so the payload is treated as untrusted input.
 * Nothing here can move money — signing happens client-side with the user's
 * own wallet — but a malformed draft reaching the confirm screen would show
 * someone nonsense about their own funds, which is its own kind of harm.
 */
const captureSchema = z.object({
  url: z.string().url().max(2048),
  title: z.string().max(512),
  excerpt: z.string().max(4096),
  priceCandidates: z.array(z.string().max(64)).max(24),
  imageUrl: z.string().url().max(2048).optional(),
  capturedAt: z.string().max(64),
});

const draftSchema = z.object({
  summary: z.string().max(1024),
  spendToken: z.string().nullable(),
  buyToken: z.string().nullable(),
  amount: z.number().finite().nonnegative().nullable(),
  currency: z.string().max(16),
  direction: z.enum(["below", "above"]),
  targetPrice: z.number().finite().nonnegative().nullable(),
  targetPercent: z.number().finite().nullable(),
  mode: z.enum(["catch", "auto"]),
  confidence: z.number().min(0).max(1),
  assumptions: z.array(z.string().max(512)).max(16),
  rawInstruction: z.string().max(2048),
});

const bodySchema = z.object({ capture: captureSchema, draft: draftSchema });

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid draft.", issues: parsed.error.issues.map((i) => i.path.join(".")) },
      { status: 400 },
    );
  }

  const id = randomBytes(12).toString("hex");

  try {
    await getDb().insert(schema.drafts).values({
      id,
      capture: parsed.data.capture,
      draft: parsed.data.draft,
    });
  } catch (err) {
    console.error("draft insert failed", err);
    return NextResponse.json({ error: "Could not save the draft." }, { status: 500 });
  }

  return NextResponse.json({ id }, { status: 201 });
}

/** The extension is a different origin, so it needs explicit CORS. */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
