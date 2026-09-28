import { parentPort, workerData } from "node:worker_threads";
import { scanLibrary } from "./library.mjs";
import { scanRecords, compareWinners } from "./conflicts.mjs";
import { sortDraft } from "./order.mjs";

try {
  const { gamePath, draft } = workerData;
  const { mods } = await scanLibrary(gamePath);
  const analysis = await scanRecords(gamePath, draft, mods);
  const result = sortDraft(draft, mods, analysis);
  const conflicts = compareWinners(analysis, result.ok ? result.draft : draft);
  // Signatures are compared in the worker; the interface only needs display values.
  for (const conflict of conflicts)
    for (const writer of conflict.writers) delete writer.signature;
  parentPort.postMessage({
    ok: true,
    value: {
      ...result,
      analysis: {
        summary: analysis.summary,
        inferred: analysis.inferred,
        issues: analysis.issues,
        conflicts,
        protectedPairs: analysis.protections.length,
        changedCount: conflicts.filter((c) => c.changed).length,
      },
    },
  });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error.message });
}
