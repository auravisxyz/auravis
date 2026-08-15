"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-renders the server page every few seconds while the tab is visible.
 *
 * This is what makes the dashboard an instrument instead of a report: run the
 * agent in a terminal and watch the feed move on its own. Pauses when the tab
 * is hidden — background polling a demo dashboard would be pure waste.
 */
export default function AutoRefresh({ seconds = 8 }: { seconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);

  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-faint">
      <span className="dot dot-active animate-pulse" />
      live
    </span>
  );
}
