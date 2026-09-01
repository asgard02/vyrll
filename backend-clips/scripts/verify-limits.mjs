#!/usr/bin/env node
/**
 * Palier 0 — le lecteur RAM et le plafond 2,9 Go.
 * Échelle ensuite (humain, Railway metrics < 2,9 Go sur TOUT le job) :
 *   1. YouTube ~20 min + LONG_AUTO_FORCE=1
 *   2. YouTube ~1h20
 *   3. Twitch ~1 h
 *   4. Twitch 4 h, 1 replica, 10 clips
 *   5. LONG_AUTO_ENABLED=1 prod seulement si RAM tenue
 */
import { ramUsageMb, ramSoftLimitMb, assertRamBudget, RamBudgetExceeded } from "../ram-budget.js";

const used = ramUsageMb();
const limit = ramSoftLimitMb();
console.log(
  JSON.stringify(
    {
      ramMb: Math.round(used * 10) / 10,
      limitMb: limit,
      underLimit: used <= limit,
    },
    null,
    2
  )
);
if (used > limit) {
  console.error("FAIL: process already over JOB_RAM_SOFT_MB");
  process.exit(1);
}
try {
  assertRamBudget("verify-limits");
} catch (err) {
  if (err instanceof RamBudgetExceeded) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const fourHours = 4 * 3600;
const windowSec = 60 + 2 * 30;
const clipsMax = 10;
const longCredits = Math.ceil((clipsMax * windowSec) / 60);
const naiveCredits = Math.ceil(fourHours / 60);
if (longCredits >= naiveCredits) {
  console.error("FAIL: long-auto credits should be << source minutes", {
    longCredits,
    naiveCredits,
  });
  process.exit(1);
}
console.log(
  JSON.stringify({
    credits4hWindows: longCredits,
    credits4hSourceMinutes: naiveCredits,
  })
);
console.log("verify-limits: ok");
console.log(
  [
    "Ladder (vert seulement si RAM Railway < 2.9 Go sur TOUT le job):",
    "  1. YouTube ~20 min + LONG_AUTO_FORCE=1",
    "  2. YouTube ~1h20 (0 full 1080p)",
    "  3. Twitch ~1 h (pas mute)",
    "  4. Twitch 4 h, 1 replica, 10 clips",
    "  5. LONG_AUTO_ENABLED=1 seulement si les paliers tiennent",
  ].join("\n")
);
