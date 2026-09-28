import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { normalizeDraft, parseConfig } from "./order.mjs";
import { discoverGame, scanLibrary } from "./library.mjs";
import { Worker } from "node:worker_threads";

export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function atomicWrite(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temp, "wx", 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temp, file);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
}
async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new Error(
      `Cannot read ${path.basename(file)}. The existing file was preserved: ${error.message}`,
    );
  }
}
export class Store {
  constructor(userData, gameOverride) {
    this.root = userData;
    this.gameOverride = gameOverride;
    this.mods = [];
    this.pending = Promise.resolve();
    this.settings = { scale: 1.25 };
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true });
    this.settings = await readJson(path.join(this.root, "settings.json"), {
      scale: 1.25,
    });
    this.gamePath =
      this.gameOverride || this.settings.gamePath || (await discoverGame());
    return this.snapshot();
  }
  exclusive(action) {
    const task = this.pending.then(action);
    this.pending = task.catch(() => {});
    return task;
  }
  async snapshot({ fromGame = false } = {}) {
    const profiles = await this.profiles();
    if (!this.gamePath)
      return { needsSetup: true, profiles, scale: this.settings.scale || 1.25 };
    const config = path.join(this.gamePath, "data/mods.cfg");
    const bytes = await fs.readFile(config);
    const gameEntries = parseConfig(bytes.toString("utf8"));
    const { mods, warnings } = await scanLibrary(this.gamePath);
    this.mods = mods;
    const session = fromGame
      ? null
      : await readJson(path.join(this.root, "session.json"), null);
    const saved =
      session && session.gamePath === this.gamePath ? session : null;
    let draft = saved
      ? normalizeDraft(saved.draft)
      : { entries: gameEntries.map((entry) => ({ ...entry })), rules: {} };
    const listed = new Set(draft.entries.map((e) => e.id));
    draft.entries.push(
      ...mods
        .filter((m) => !listed.has(m.id))
        .map((m) => ({ id: m.id, name: m.name, enabled: false })),
    );
    const installed = new Set(mods.map((m) => m.id));
    const missing = draft.entries
      .filter((e) => !installed.has(e.id))
      .map((e) => ({
        id: e.id,
        name: e.name,
        source: "Missing",
        missing: true,
        description: "",
        dependencies: [],
        references: [],
      }));
    return {
      gamePath: this.gamePath,
      configPath: config,
      mods: [...mods, ...missing],
      warnings,
      profiles,
      draft,
      gameEntries,
      fingerprint: saved?.fingerprint || hash(bytes),
      currentFingerprint: hash(bytes),
      scale: this.settings.scale || 1.25,
      activeProfile: saved?.activeProfile || null,
      dataPath: this.root,
    };
  }
  async configure(gamePath) {
    const real = await fs.realpath(gamePath);
    const file = path.join(real, "data/mods.cfg");
    parseConfig(await fs.readFile(file, "utf8"));
    this.gamePath = real;
    this.settings.gamePath = real;
    await atomicWrite(
      path.join(this.root, "settings.json"),
      JSON.stringify(this.settings, null, 2),
    );
    return this.snapshot({ fromGame: true });
  }
  async analyze(draft) {
    draft = normalizeDraft(draft);
    if (!this.gamePath) throw new Error("Choose a Kenshi folder first.");
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("./analyze-worker.mjs", import.meta.url),
        {
          workerData: { gamePath: this.gamePath, draft },
          execArgv: [],
          resourceLimits: { maxOldGenerationSizeMb: 1536 },
        },
      );
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        worker.terminate();
        if (error) reject(error);
        else resolve(value);
      };
      const timeout = setTimeout(
        () =>
          finish(
            new Error("Record scan took too long. Try a smaller enabled list."),
          ),
        120000,
      );
      worker.once("message", (message) => {
        if (!message.ok) {
          finish(new Error(message.error));
          return;
        }
        const result = message.value;
        const conflicts = result.analysis.conflicts;
        const names = new Map(draft.entries.map((e) => [e.id, e.name]));
        this.analysisReport = {
          token: randomUUID(),
          conflicts,
          search: conflicts.map((c) =>
            [
              c.name,
              c.type,
              c.recordId,
              c.field,
              ...c.writers.map((w) => names.get(w.mod) || w.mod),
            ]
              .join("\n")
              .toLowerCase(),
          ),
        };
        delete result.analysis.conflicts;
        result.analysis.token = this.analysisReport.token;
        result.analysis.conflictCount = conflicts.length;
        finish(null, result);
      });
      worker.once("error", (error) => finish(error));
      worker.once("exit", (code) => {
        if (!settled)
          finish(new Error(`Record scan stopped unexpectedly (${code}).`));
      });
    });
  }
  conflictPage({ token, query = "", changedOnly = false, offset = 0 } = {}) {
    const report = this.analysisReport;
    if (!report || token !== report.token)
      throw new Error("This scan has expired. Run autosort again.");
    if (
      typeof query !== "string" ||
      query.length > 500 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw new Error("Invalid conflict search.");
    const q = query.trim().toLowerCase(),
      results = [];
    let total = 0;
    for (let i = 0; i < report.conflicts.length; i++) {
      const conflict = report.conflicts[i];
      if (
        (changedOnly && !conflict.changed) ||
        (q && !report.search[i].includes(q))
      )
        continue;
      if (total >= offset && results.length < 20) results.push(conflict);
      total++;
    }
    return { total, results };
  }
  async saveSession(payload) {
    const draft = normalizeDraft(payload.draft);
    if (
      typeof payload.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(payload.fingerprint)
    )
      throw new Error("Invalid game baseline.");
    await atomicWrite(
      path.join(this.root, "session.json"),
      JSON.stringify({
        gamePath: this.gamePath,
        draft,
        fingerprint: payload.fingerprint,
        activeProfile: payload.activeProfile || null,
      }),
    );
  }
  async profiles() {
    const dir = path.join(this.root, "profiles");
    await fs.mkdir(dir, { recursive: true });
    const results = [];
    for (const file of await fs.readdir(dir)) {
      if (!file.endsWith(".json")) continue;
      const p = await readJson(path.join(dir, file), null);
      if (p)
        results.push({
          id: p.id,
          name: p.name,
          updatedAt: p.updatedAt,
          count: p.draft.entries.filter((e) => e.enabled).length,
        });
    }
    return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async saveProfile({ id, name, draft }) {
    name = typeof name === "string" ? name.trim() : "";
    if (!name || name.length > 100)
      throw new Error("List names must be between 1 and 100 characters.");
    if (id && !/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid list ID.");
    id ||= randomUUID();
    const profile = {
      schema: "kenshi-mod-list",
      version: 1,
      id,
      name,
      updatedAt: new Date().toISOString(),
      draft: normalizeDraft(draft),
    };
    await atomicWrite(
      path.join(this.root, "profiles", `${id}.json`),
      JSON.stringify(profile, null, 2),
    );
    return { profile, profiles: await this.profiles() };
  }
  async loadProfile(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid list ID.");
    const profile = await readJson(
      path.join(this.root, "profiles", `${id}.json`),
      null,
    );
    if (!profile) throw new Error("This saved list no longer exists.");
    return { ...profile, draft: normalizeDraft(profile.draft) };
  }
  async deleteProfile(id) {
    await this.loadProfile(id);
    await fs.unlink(path.join(this.root, "profiles", `${id}.json`));
    return this.profiles();
  }
  async apply({ draft, fingerprint }) {
    draft = normalizeDraft(draft);
    const file = path.join(this.gamePath, "data/mods.cfg");
    const old = await fs.readFile(file);
    if (hash(old) !== fingerprint)
      throw new Error(
        "Kenshi or another manager changed mods.cfg. Reload from game before applying; your draft has been kept.",
      );
    const backup = path.join(
      this.root,
      "backups",
      `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.cfg`,
    );
    await atomicWrite(backup, old);
    // Recheck after writing the backup, before the final atomic replacement.
    if (hash(await fs.readFile(file)) !== fingerprint)
      throw new Error(
        "mods.cfg changed during the operation. Nothing was applied; reload from game.",
      );
    const enabled = draft.entries.filter((e) => e.enabled);
    const content =
      enabled.map((e) => e.name).join("\n") + (enabled.length ? "\n" : "");
    await atomicWrite(file, content);
    return { fingerprint: hash(content), backup, gameEntries: enabled };
  }
  async setScale(scale) {
    if (![1, 1.15, 1.25, 1.5, 1.75].includes(scale))
      throw new Error("Unsupported interface scale.");
    this.settings.scale = scale;
    await atomicWrite(
      path.join(this.root, "settings.json"),
      JSON.stringify(this.settings, null, 2),
    );
  }
}
export function importList(text) {
  if (Buffer.byteLength(text) > 5 * 1024 * 1024)
    throw new Error("List is too large.");
  if (text.trimStart().startsWith("{")) {
    const p = JSON.parse(text);
    if (p.schema !== "kenshi-mod-list" || p.version !== 1)
      throw new Error(
        "Unsupported list format. Use a Kenshi Mod Manager JSON list or plain mods.cfg.",
      );
    return {
      name: typeof p.name === "string" ? p.name.slice(0, 100) : "Imported list",
      draft: normalizeDraft(p.draft),
    };
  }
  return {
    name: "Imported list",
    draft: { entries: parseConfig(text), rules: {} },
  };
}
