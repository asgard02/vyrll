/**
 * Coupe-circuit RAM : le plafond 2,9 Go est le spec.
 * Dépassement → fail immédiat (pas de retry qui re-télécharge).
 */
import fs from "fs";

export const DEFAULT_RAM_SOFT_MB = 2900;

export class RamBudgetExceeded extends Error {
  constructor(usedMb, limitMb) {
    super(`RAM_BUDGET_EXCEEDED used=${usedMb.toFixed(0)}MB limit=${limitMb}MB`);
    this.name = "RamBudgetExceeded";
    this.code = "RAM_BUDGET_EXCEEDED";
    this.usedMb = usedMb;
    this.limitMb = limitMb;
  }
}

function readCgroupBytes() {
  const paths = [
    "/sys/fs/cgroup/memory.current",
    "/sys/fs/cgroup/memory/memory.usage_in_bytes",
  ];
  for (const p of paths) {
    try {
      const raw = fs.readFileSync(p, "utf8").trim();
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    } catch {
      // ignore missing cgroup (local macOS)
    }
  }
  if (typeof process.memoryUsage === "function") {
    const rss = process.memoryUsage().rss;
    if (rss > 0) return rss;
  }
  return 0;
}

function readCgroupStatMb() {
  try {
    const raw = fs.readFileSync("/sys/fs/cgroup/memory.stat", "utf8");
    let anon = 0;
    let file = 0;
    for (const line of raw.split("\n")) {
      const [key, value] = line.split(/\s+/);
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      if (key === "anon") anon = n;
      if (key === "file") file = n;
    }
    return {
      anonMb: anon / (1024 * 1024),
      fileMb: file / (1024 * 1024),
    };
  } catch {
    return { anonMb: 0, fileMb: 0 };
  }
}

export function ramUsageMb() {
  return readCgroupBytes() / (1024 * 1024);
}

export function ramSoftLimitMb() {
  const n = Number(process.env.JOB_RAM_SOFT_MB);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return DEFAULT_RAM_SOFT_MB;
}

export function assertRamBudget(label = "") {
  const used = ramUsageMb();
  const limit = ramSoftLimitMb();
  const { anonMb, fileMb } = readCgroupStatMb();
  if (used > limit) {
    throw new RamBudgetExceeded(used, limit);
  }
  return { usedMb: used, limitMb: limit, label, anonMb, fileMb };
}

/** Poll RAM. stop() pour arrêter. throwIfTripped() relance l’erreur du tick. */
export function startRamWatchdog({ intervalMs = 2000, onSample, onTrip } = {}) {
  /** @type {Error | null} */
  let tripped = null;
  const trip = (err) => {
    if (tripped) return;
    tripped = err instanceof Error ? err : new Error(String(err));
    if (typeof onTrip === "function") {
      try {
        onTrip(tripped);
      } catch {
        // ignore
      }
    }
  };
  const tick = () => {
    const sample = assertRamBudget("watchdog");
    if (typeof onSample === "function") onSample(sample);
  };
  try {
    tick();
  } catch (err) {
    trip(err);
  }
  const id = setInterval(() => {
    try {
      const sample = assertRamBudget("watchdog");
      if (!tripped && typeof onSample === "function") onSample(sample);
    } catch (err) {
      const first = !tripped;
      trip(err);
      // Tick suivants : tuer les ffmpeg/python nés après le premier trip.
      if (!first && typeof onTrip === "function") {
        try {
          onTrip(tripped);
        } catch {
          // ignore
        }
      }
    }
  }, Math.max(500, intervalMs));
  return {
    stop() {
      clearInterval(id);
    },
    throwIfTripped() {
      if (tripped) throw tripped;
      assertRamBudget("throwIfTripped");
    },
  };
}
