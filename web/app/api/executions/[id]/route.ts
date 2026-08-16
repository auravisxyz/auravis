import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";

export const runtime = "nodejs";

/** One pending catch, with enough of its trigger to render a confirm screen. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const executionId = Number(id);
  if (!Number.isInteger(executionId)) {
    return NextResponse.json({ error: "Bad id." }, { status: 400 });
  }

  const db = getDb();
  const [execution] = await db
    .select()
    .from(schema.executions)
    .where(eq(schema.executions.id, executionId))
    .limit(1);
  if (!execution) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const [trigger] = await db
    .select()
    .from(schema.triggers)
    .where(eq(schema.triggers.id, execution.triggerId))
    .limit(1);

  return NextResponse.json({
    id: execution.id,
    status: execution.status,
    reason: execution.reason,
    txHash: execution.txHash,
    mandateId: execution.mandateId.toString(),
    createdAt: execution.createdAt,
    trigger: trigger
      ? {
          intent: trigger.intent,
          amountIn: trigger.amountIn,
          token: trigger.token,
          mode: trigger.mode,
        }
      : null,
  });
}

const patchSchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

/**
 * The user completed the swap — record the hash and settle both halves.
 *
 * Trust note: this endpoint takes the hash at face value. The chain remains
 * the source of truth (the vault's events say what actually happened); this
 * row only drives the feed's bookkeeping. Verifying receipt server-side is a
 * post-hackathon TODO, stated here rather than silently skipped.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const executionId = Number(id);
  if (!Number.isInteger(executionId)) {
    return NextResponse.json({ error: "Bad id." }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected a transaction hash." }, { status: 400 });
  }

  const db = getDb();
  const [execution] = await db
    .select()
    .from(schema.executions)
    .where(eq(schema.executions.id, executionId))
    .limit(1);
  if (!execution) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (execution.status !== "pending") {
    return NextResponse.json({ error: "Already settled." }, { status: 409 });
  }

  await db
    .update(schema.executions)
    .set({
      status: "confirmed",
      txHash: parsed.data.txHash,
      reason: `${execution.reason ?? ""} Confirmed by you through the swap interface.`.trim(),
    })
    .where(eq(schema.executions.id, executionId));

  await db
    .update(schema.triggers)
    .set({ status: "fired", firedAt: new Date() })
    .where(eq(schema.triggers.id, execution.triggerId));

  return NextResponse.json({ ok: true });
}
