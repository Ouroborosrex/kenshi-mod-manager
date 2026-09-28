import fs from "node:fs/promises";
import path from "node:path";
import { parseRecords, RECORD_LIMITS } from "./records.mjs";
import { key } from "./order.mjs";

const TYPES = {
  0: "Building",
  1: "Character",
  2: "Weapon",
  3: "Armour",
  4: "Item",
  7: "Race",
  21: "Research",
  47: "Clothing material",
  49: "Vendor list",
  52: "Squad",
  104: "Item culture",
};
const fieldValue = (f) => JSON.stringify([f.kind, f.value]);
const excerpt = (v) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 400 ? s.slice(0, 400) + "…" : s;
};

// Pure analysis, also used by fixture tests. Record IDs are case-sensitive.
export function analyzeRecords(
  draft,
  datasets,
  baseIds,
  { baseComplete = true } = {},
) {
  const active = draft.entries.filter((e) => e.enabled),
    activeIds = new Set(active.map((e) => e.id));
  const positions = new Map(active.map((e, i) => [e.id, i]));
  const entries = new Map(draft.entries.map((e) => [e.id, e]));
  const records = new Map(),
    definitions = new Map(),
    issues = [],
    inferred = new Map();
  const opaque = new Set();
  const summary = {
    scanned: 0,
    total: active.length,
    records: 0,
    fields: 0,
    incomplete: [],
    baseComplete,
  };
  for (const dataset of datasets) {
    if (activeIds.has(dataset.id)) {
      if (dataset.error) {
        summary.incomplete.push({ id: dataset.id, message: dataset.error });
        opaque.add(dataset.id);
      } else {
        summary.scanned++;
        summary.records += dataset.records.length;
        for (const message of dataset.warnings || []) {
          summary.incomplete.push({ id: dataset.id, message });
          opaque.add(dataset.id);
        }
      }
    }
    for (const record of dataset.records || []) {
      if (record.newRecord && !record.removed && !baseIds.has(record.id)) {
        if (!definitions.has(record.id)) definitions.set(record.id, []);
        definitions.get(record.id).push({ mod: dataset.id, type: record.type });
      }
      if (!activeIds.has(dataset.id)) continue;
      if (!records.has(record.id)) records.set(record.id, []);
      records.get(record.id).push({ mod: dataset.id, record });
    }
  }
  const known = new Set(datasets.map((d) => d.id));
  for (const entry of active)
    if (!known.has(entry.id)) {
      summary.incomplete.push({
        id: entry.id,
        message: "Installed mod file not found.",
      });
      opaque.add(entry.id);
    }
  const issueGroups = new Map();
  const removedRecords = new Map();
  for (const [id, writers] of records) {
    const removers = writers.filter((w) => w.record.removed).map((w) => w.mod);
    if (removers.length) removedRecords.set(id, removers);
  }
  const issue = (mod, kind, record, message) => {
    const k = JSON.stringify([mod, kind, message]);
    if (!issueGroups.has(k))
      issueGroups.set(k, {
        id: mod,
        type: kind,
        message,
        count: 0,
        examples: [],
      });
    const group = issueGroups.get(k);
    group.count++;
    if (group.examples.length < 3) group.examples.push(record);
  };
  const requireRecord = (mod, id, context, expectedType) => {
    if (removedRecords.has(id))
      issue(
        mod,
        "removed-record-reference",
        id,
        `Uses a record removed by ${removedRecords
          .get(id)
          .map((m) => entries.get(m)?.name || m)
          .join(", ")}. Later edits may not restore it.`,
      );
    if (baseIds.has(id)) return;
    const installedProviders = definitions.get(id) || [];
    const enabledProviders = installedProviders.filter((p) =>
      activeIds.has(p.mod),
    );
    const providers = enabledProviders.length
      ? enabledProviders
      : installedProviders;
    if (!baseComplete) return;
    if (providers.length !== 1) {
      if (providers.length > 1)
        issue(
          mod,
          "ambiguous-record",
          id,
          "More than one possible mod defines this record; no dependency was guessed.",
        );
      else
        issue(
          mod,
          "unresolved-record",
          id,
          "Record has no known definition in the installed mods or base files.",
        );
      return;
    }
    const provider = providers[0];
    if (provider.mod === mod) return;
    if (expectedType !== undefined && provider.type !== expectedType) {
      issue(
        mod,
        "record-type",
        id,
        "Record type differs from its defining mod; sorting cannot repair this.",
      );
      return;
    }
    if (!activeIds.has(provider.mod)) {
      issue(
        mod,
        "disabled-record",
        id,
        `Record provider ${entries.get(provider.mod)?.name || provider.mod} is disabled.`,
      );
      return;
    }
    const pair = JSON.stringify([provider.mod, mod]);
    if (!inferred.has(pair))
      inferred.set(pair, {
        from: provider.mod,
        to: mod,
        count: 0,
        examples: [],
      });
    const edge = inferred.get(pair);
    edge.count++;
    if (edge.examples.length < 3) edge.examples.push(`${context}: ${id}`);
  };
  const conflicts = [],
    protections = new Map();
  const protect = (from, to, example) => {
    if (from === to) return;
    const pair = JSON.stringify([from, to]);
    if (!protections.has(pair))
      protections.set(pair, { from, to, count: 0, example });
    protections.get(pair).count++;
  };
  for (const [recordId, writers] of records) {
    writers.sort((a, b) => positions.get(a.mod) - positions.get(b.mod));
    for (const { mod, record } of writers) {
      if (record.removed)
        issue(
          mod,
          "record-removal",
          `${record.name} (${recordId})`,
          "Removes a whole record. This can make items unavailable even when their distribution mod is enabled.",
        );
      if (!record.newRecord && !record.removed)
        requireRecord(mod, recordId, `Edits ${record.name}`, record.type);
      if (!record.removed)
        for (const target of record.targets || [])
          requireRecord(mod, target, `Used by ${record.name}`);
    }
    if (writers.length < 2) continue;
    const first = writers[0].record;
    const meta = {
      recordId,
      name: first.name || recordId,
      type: TYPES[first.type] || `Record type ${first.type}`,
    };
    const creators = writers.filter(
      (w) => w.record.newRecord && !w.record.removed,
    );
    if (!baseIds.has(recordId) && creators.length > 1)
      for (const w of creators)
        issue(
          w.mod,
          "duplicate-definition",
          recordId,
          "Multiple enabled mods define this same new record. Review merged packs and original mods together.",
        );
    // Removing a whole record competes with every edit, regardless of which field it writes.
    if (writers.some((w) => w.record.removed)) {
      const choices = writers.map((w) => ({
        mod: w.mod,
        value: w.record.removed ? "Record removed" : "Record edited",
        signature: w.record.removed ? "removed" : "edited",
        deleted: w.record.removed,
      }));
      if (new Set(choices.map((w) => w.signature)).size > 1) {
        conflicts.push({
          ...meta,
          field: "Record removal",
          kind: "removal",
          writers: choices,
          currentWinner: choices.at(-1).mod,
        });
        for (let i = 1; i < choices.length; i++)
          protect(
            choices[i - 1].mod,
            choices[i].mod,
            `${meta.name}: record removal`,
          );
      }
    }
    if (new Set(writers.map((w) => w.record.type)).size > 1)
      for (const w of writers)
        issue(
          w.mod,
          "record-type",
          recordId,
          "Mods assign different types to the same record; sorting cannot repair this.",
        );
    const fields = new Map();
    for (const { mod, record } of writers) {
      for (const field of record.fields || []) {
        summary.fields++;
        if (!fields.has(field.key))
          fields.set(field.key, { ...field, writers: [] });
        fields.get(field.key).writers.push({
          mod,
          value: excerpt(field.value),
          signature: fieldValue(field),
          deleted: !!field.deleted,
        });
      }
    }
    for (const field of fields.values()) {
      if (new Set(field.writers.map((w) => w.signature)).size < 2) continue;
      conflicts.push({
        ...meta,
        field: field.label,
        kind: field.kind,
        writers: field.writers,
        currentWinner: field.writers.at(-1).mod,
      });
      for (let i = 1; i < field.writers.length; i++)
        protect(
          field.writers[i - 1].mod,
          field.writers[i].mod,
          `${meta.name}: ${field.label}`,
        );
    }
  }
  issues.push(...issueGroups.values());
  return {
    summary,
    inferred: [...inferred.values()],
    protections: [...protections.values()],
    conflicts,
    issues,
    opaque: [...opaque],
  };
}

export async function scanRecords(gamePath, draft, mods) {
  const active = new Set(
    draft.entries.filter((e) => e.enabled).map((e) => e.id),
  );
  const baseIds = new Set(),
    datasets = [],
    snapshots = new Map(),
    shared = new Map();
  let baseComplete = true,
    totalBytes = 0;
  const baseErrors = [];
  const read = async (file) => {
    const stat = await fs.stat(file);
    if (stat.size > RECORD_LIMITS.bytes)
      throw new Error("Mod exceeds the 256 MiB scan limit.");
    totalBytes += stat.size;
    if (totalBytes > 1024 * 1024 * 1024)
      throw new Error("Library scan exceeds the 1 GiB read limit.");
    const data = await fs.readFile(file);
    const after = await fs.stat(file);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
      throw new Error("File changed during analysis. Scan again.");
    return {
      parsed: parseRecords(data),
      stamp: `${stat.size}:${stat.mtimeMs}`,
    };
  };
  const dataDir = path.join(gamePath, "data");
  const files = await fs.readdir(dataDir);
  for (const name of [
    "gamedata.base",
    "newwworld.mod",
    "dialogue.mod",
    "rebirth.mod",
  ]) {
    try {
      const file = files.find((f) => key(f) === name);
      if (!file) throw new Error("File not found.");
      const { parsed } = await read(path.join(dataDir, file));
      for (const r of parsed.records) baseIds.add(r.id);
    } catch (e) {
      baseComplete = false;
      baseErrors.push({
        id: name,
        message: `Base data unavailable: ${e.message}`,
      });
    }
  }
  // Two passes retain only overlapping fields; large overhaul files stay out of IPC.
  for (const mod of mods.filter((m) => !m.missing)) {
    try {
      const { parsed, stamp } = await read(mod.path);
      snapshots.set(mod.id, stamp);
      const records = parsed.records.map(({ fields, ...r }) => {
        if (active.has(mod.id)) shared.set(r.id, (shared.get(r.id) || 0) + 1);
        else r.targets = [];
        return r;
      });
      datasets.push({ id: mod.id, records, warnings: parsed.warnings });
    } catch (e) {
      datasets.push({ id: mod.id, records: [], error: e.message });
    }
  }
  const paths = new Map(mods.map((m) => [m.id, m.path]));
  for (const dataset of datasets.filter((d) => active.has(d.id) && !d.error)) {
    try {
      const { parsed, stamp } = await read(paths.get(dataset.id));
      if (snapshots.get(dataset.id) !== stamp)
        throw new Error("File changed during analysis. Scan again.");
      dataset.records = parsed.records.map((r) =>
        shared.get(r.id) > 1 ? r : { ...r, fields: [] },
      );
    } catch (e) {
      dataset.error = e.message;
      dataset.records = [];
    }
  }
  const analysis = analyzeRecords(draft, datasets, baseIds, { baseComplete });
  analysis.summary.incomplete.push(...baseErrors);
  analysis.summary.disabledUnreadable = datasets.filter(
    (d) => !active.has(d.id) && d.error,
  ).length;
  return analysis;
}

export function compareWinners(analysis, draft) {
  const positions = new Map(
    draft.entries.filter((e) => e.enabled).map((e, i) => [e.id, i]),
  );
  return analysis.conflicts.map((conflict) => {
    const writers = [...conflict.writers].sort(
      (a, b) => positions.get(a.mod) - positions.get(b.mod),
    );
    const before = conflict.writers.at(-1),
      after = writers.at(-1);
    return {
      ...conflict,
      proposedWinner: after.mod,
      changed: before.signature !== after.signature,
    };
  });
}
