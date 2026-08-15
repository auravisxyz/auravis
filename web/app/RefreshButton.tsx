"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * The page reads the chain and the database on every render; this re-runs
 * that render on demand. A dashboard about live money that can only be
 * refreshed with ⌘R reads as a mockup — this one button is what makes it
 * feel like an instrument.
 */
export default function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      className="btn-ghost px-3 py-1.5 text-xs"
    >
      {pending ? "Refreshing…" : "Refresh"}
    </button>
  );
}
