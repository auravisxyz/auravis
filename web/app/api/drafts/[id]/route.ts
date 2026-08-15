import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const [row] = await getDb()
    .select()
    .from(schema.drafts)
    .where(eq(schema.drafts.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    capture: row.capture,
    draft: row.draft,
    status: row.status,
    mandateId: row.mandateId?.toString() ?? null,
    txHash: row.txHash,
    createdAt: row.createdAt,
  });
}

const patchSchema = z.object({
  mandateId: z.string().regex(/^\d+$/),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

/**
 * Marks a draft signed once the mandate exists on-chain.
 *
 * The chain is the source of truth here, not this row — if this write fails
 * the mandate is still real and the agent still honours it. This only keeps
 * the UI from offering to sign the same draft twice.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected mandateId and txHash." }, { status: 400 });
  }

  await getDb()
    .update(schema.drafts)
    .set({
      status: "signed",
      mandateId: BigInt(parsed.data.mandateId),
      txHash: parsed.data.txHash,
    })
    .where(eq(schema.drafts.id, id));

  return NextResponse.json({ ok: true });
}
