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

  /**
   * Three numbers, three meanings.
   *
   * The popup told someone who had typed "buy 83$ price drops 8%" that no
   * spend amount was found: the money pattern only accepted a leading "$", so
   * a trailing one parsed as nothing. Everything below is a phrasing that
   * broke, or nearly broke, once that was fixed.
   */
  console.log("\n-- money, counts and thresholds --");

  console.log('"buy 83$ price drops 8%"');
  d = await extractor.extract(capture, "buy 83$ price drops 8%");
  check("amount", d.amount, 83);
  // Without a whole-number guard this reported a quantity of 8, from the "8"
  // inside "83".
  check("quantity", d.quantity, null);
  check("targetPercent", d.targetPercent, 8);

  console.log('"buy 1 if prices drops to 82$"');
  d = await extractor.extract(capture, "buy 1 if prices drops to 82$");
  check("quantity", d.quantity, 1);
  check("amount", d.amount, null);
  check("targetPrice", d.targetPrice, 82);

  console.log('"buy at 85$ if price drops 8%"');
  d = await extractor.extract(capture, "buy at 85$ if price drops 8%");
  check("targetPrice", d.targetPrice, 85);
  check("targetPercent", d.targetPercent, 8);
  check("amount", d.amount, null);

  // "under 40" with no currency marker. Previously invisible.
  console.log('"buy 2 when it goes under 40"');
  d = await extractor.extract(capture, "buy 2 when it goes under 40");
  check("quantity", d.quantity, 2);
  check("targetPrice", d.targetPrice, 40);

  console.log('"spend 50 dollars if it falls below 30"');
  d = await extractor.extract(capture, "spend 50 dollars if it falls below 30");
  check("amount", d.amount, 50);
  check("targetPrice", d.targetPrice, 30);

  console.log('"buy two if it drops 8%"');
  d = await extractor.extract(capture, "buy two if it drops 8%");
  check("quantity", d.quantity, 2);

  console.log('"buy $1,250.50 worth if it drops 7.5%"');
  d = await extractor.extract(capture, "buy $1,250.50 worth if it drops 7.5%");
  check("amount", d.amount, 1250.5);
  check("targetPercent", d.targetPercent, 7.5);

  console.log('"buy 1 if it drops to 0.75"');
  d = await extractor.extract(capture, "buy 1 if it drops to 0.75");
  check("targetPrice", d.targetPrice, 0.75);
  check("quantity", d.quantity, 1);

  // "under" here is English, not a threshold. Must not invent a price.
  console.log('"buy 1 under any circumstances"');
  d = await extractor.extract(capture, "buy 1 under any circumstances");
  check("targetPrice", d.targetPrice, null);
  check("quantity", d.quantity, 1);

  // A quantity alone is a complete instruction; don't claim nothing was given.
  console.log('"buy 1 if it drops 8%" states what to buy');
  d = await extractor.extract(capture, "buy 1 if it drops 8%");
  check(
    "no missing-amount complaint",
    d.assumptions.some((a) => a.includes("No amount or quantity")),
    false,
  );

  console.log(failures === 0 ? "\nAll passed." : `\n${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
