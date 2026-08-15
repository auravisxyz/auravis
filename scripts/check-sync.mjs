#!/usr/bin/env node
/**
 * Fails if the duplicated files between agent/ and web/ have drifted.
 *
 * Next.js can't import across the package boundary without awkward config, so
 * the schema and ABI exist twice. Duplication is survivable; *silent*
 * duplication is not — a renamed column would leave the dashboard compiling
 * happily against a shape the database no longer has.
 *
 * Run: node scripts/check-sync.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const PAIRS = [
  ["agent/src/db/schema.ts", "web/lib/schema.ts"],
  ["agent/src/abi/AuravisMandate.ts", "web/lib/abi.ts"],
];

/** Import specifiers legitimately differ between the two copies. */
function normalise(src) {
  return src
    .split("\n")
    .filter((line) => !/^\s*import\s|^\s*export\s+\{[^}]*\}\s+from\s/.test(line))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

let failed = 0;

for (const [a, b] of PAIRS) {
  let left;
  let right;
  try {
    left = readFileSync(path.join(root, a), "utf8");
    right = readFileSync(path.join(root, b), "utf8");
  } catch (err) {
    console.error(`✗ ${a} ↔ ${b}: ${err.message}`);
    failed++;
    continue;
  }

  if (normalise(left) === normalise(right)) {
    console.log(`ok   ${a} ↔ ${b}`);
  } else {
    console.error(`✗    ${a} ↔ ${b} HAVE DRIFTED`);
    console.error(`     copy one over the other, then re-run.`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} pair(s) out of sync.`);
  process.exit(1);
}
console.log("\nAll duplicated files match.");
