import { PatternIntentExtractor } from "./intent.js";
import type { PageCapture } from "./index.js";

/**
 * Plain assertions, no test runner — this package has no build step and the
 * whole point is that it runs anywhere with `npx tsx src/intent.test.ts`.
 *
 * Every case below is one that was actually broken during development. The
 * regexes read as though they work; only running them showed otherwise.
 */

const capture: PageCapture = {
  url: "https://example.com/headphones",
  title: "Sony WH-1000XM5",
  excerpt: "Wireless noise cancelling headphones",
  priceCandidates: ["$399"],
  capturedAt: new Date().toISOString(),
};

const extractor = new PatternIntentExtractor();
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}: expected ${expected}, got ${actual}`);
}

async function main() {
  console.log('"buy $200 worth if it drops 8%"');
  let d = await extractor.extract(capture, "buy $200 worth if it drops 8%");
  check("amount", d.amount, 200);
  check("direction", d.direction, "below");
  check("targetPercent", d.targetPercent, 8);
  check("mode", d.mode, "catch");

  // Was returning null: the pattern only matched "at"/"hits", not "below".
  console.log('"buy 500 usd if it falls below 50"');
  d = await extractor.extract(capture, "buy 500 usd if it falls below 50");
  check("amount", d.amount, 500);
  check("targetPrice", d.targetPrice, 50);

  // Two bugs here: \bautomatic\b never matched "automatically", and "hits"
  // was treated as a rise, flipping a buy-the-dip into a buy-the-rally.
  console.log('"grab $100 automatically when it hits $42"');
  d = await extractor.extract(capture, "grab $100 automatically when it hits $42");
  check("mode", d.mode, "auto");
  check("targetPrice", d.targetPrice, 42);
  check("direction", d.direction, "below");

  console.log('"buy if it goes above 1000"');
  d = await extractor.extract(capture, "buy if it goes above 1000");
  check("direction", d.direction, "above");
  check("targetPrice", d.targetPrice, 1000);
  check("amount", d.amount, null);

  // Garbage in should mean low confidence, never a confident guess.
  console.log('"watch this"');
  d = await extractor.extract(capture, "watch this");
  check("amount", d.amount, null);
  check("low confidence", d.confidence < 0.3, true);
  check("flags assumptions", d.assumptions.length > 0, true);

  console.log(failures === 0 ? "\nAll passed." : `\n${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
