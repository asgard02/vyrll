#!/usr/bin/env node
/**
 * Palier 0 — le lecteur RAM et le plafond 2,9 Go.
 * Un job YouTube auto ne dépasse jamais 1h15 de source (refus API + worker).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  ramUsageMb,
  ramSoftLimitMb,
  assertRamBudget,
  RamBudgetExceeded,
  DEFAULT_RAM_SOFT_MB,
} from "../ram-budget.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = fs.readFileSync(path.join(root, "..", "server.js"), "utf8");
const railwayToml = fs.readFileSync(path.join(root, "..", "railway.toml"), "utf8");

const used = ramUsageMb();
const limit = ramSoftLimitMb();
if (DEFAULT_RAM_SOFT_MB !== 2900) {
  console.error("FAIL: DEFAULT_RAM_SOFT_MB must be 2900");
  process.exit(1);
}
if (limit > 2900) {
  console.error("FAIL: JOB_RAM_SOFT_MB above 2900", { limit });
  process.exit(1);
}
if (!/MAX_VIDEO_DURATION_SEC = 75 \* 60/.test(serverSrc)) {
  console.error("FAIL: auto full-download cap is not 75 min");
  process.exit(1);
}
if (!serverSrc.includes('["--concurrent-fragments", "1"]')) {
  console.error("FAIL: yt-dlp must download 1 HLS fragment at a time");
  process.exit(1);
}
if (
  !/MAX_CONCURRENT_JOBS = Math\.max\(1, Number\(process\.env\.MAX_CONCURRENT_JOBS\) \|\| 1\)/.test(
    serverSrc
  )
) {
  console.error("FAIL: MAX_CONCURRENT_JOBS default is not 1");
  process.exit(1);
}
if (
  !railwayToml.includes("numReplicas = 1") ||
  !railwayToml.includes("memoryBytes = 4000000000")
) {
  console.error("FAIL: Railway replica must be 1 × 4GB");
  process.exit(1);
}
if (!serverSrc.includes("YOUTUBE_TOO_LONG")) {
  console.error("FAIL: YouTube >1h15 must map to YOUTUBE_TOO_LONG");
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ramMb: Math.round(used * 10) / 10,
      limitMb: limit,
      underLimit: used <= limit,
      maxSourceSec: 75 * 60,
      replicaRamGb: 4,
      replicas: 1,
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
const sourceCredits = Math.ceil(fourHours / 60);
console.log(
  JSON.stringify({
    credits4hSourceMinutes: sourceCredits,
  })
);
console.log("verify-limits: ok");
