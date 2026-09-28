import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseHeader } from "../core/library.mjs";
import {
  sortDraft,
  parseConfig,
  classification,
  normalizeDraft,
  key,
} from "../core/order.mjs";
import { Store, hash, importList } from "../core/store.mjs";
function strings(...values) {
  return Buffer.concat(
    values.flatMap((v) => {
      const b = Buffer.from(v);
      const n = Buffer.alloc(4);
      n.writeUInt32LE(b.length);
      return [n, b];
    }),
  );
}
function header(
  type = 17,
  {
    deps = "",
    refs = "",
    author = "测试 — author",
    description = "A compatibility patch",
  } = {},
) {
  const b = Buffer.alloc(type === 17 ? 12 : 8);
  b.writeUInt32LE(type);
  b.writeUInt32LE(42, 4);
  if (type === 17) b.writeUInt32LE(3, 8);
  return Buffer.concat([b, strings(author, description, deps, refs)]);
}
const make = (names, dependencies = {}) => ({
  draft: {
    entries: names.map((name) => ({ id: key(name), name, enabled: true })),
    rules: {},
  },
  mods: names.map((name) => ({
    id: key(name),
    name,
    dependencies: dependencies[name] || [],
    references: [],
  })),
});
const sorted = (r) => r.draft.entries.map((e) => e.name);
test("both observed binary formats parse bounded UTF-8 strings", () => {
  for (const format of [16, 17]) {
    const m = parseHeader(
      header(format, {
        deps: "rebirth.mod, Parent.mod, Newwworld.mod",
        refs: "Other.mod",
      }),
    );
    assert.deepEqual(m.dependencies, ["Parent.mod"]);
    assert.deepEqual(m.references, ["Other.mod"]);
    assert.equal(m.author, "测试 — author");
    assert.equal(m.version, format === 17 ? 3 : 42);
  }
  assert.throws(() => parseHeader(header().subarray(0, 18)));
  assert.throws(() => parseHeader(Buffer.alloc(12)));
});
test("patches move late, while dependencies and patch dependents stay ordered", () => {
  const { draft, mods } = make(
    ["A Patch.mod", "Addon.mod", "Base.mod", "Other.mod"],
    { "A Patch.mod": ["Base.mod"], "Addon.mod": ["A Patch.mod"] },
  );
  const r = sortDraft(draft, mods);
  assert(r.ok);
  assert.deepEqual(sorted(r), [
    "Base.mod",
    "Other.mod",
    "A Patch.mod",
    "Addon.mod",
  ]);
  assert.equal(sortDraft(r.draft, mods).moves.length, 0);
});
test("optional references enforce order only for enabled installed references", () => {
  const { draft, mods } = make(["Patch.mod", "Base.mod"]);
  mods[0].references = ["Base.mod", "Missing.mod"];
  const r = sortDraft(draft, mods);
  assert.deepEqual(sorted(r), ["Base.mod", "Patch.mod"]);
  assert.equal(r.issues.filter((i) => i.type === "dependency").length, 0);
});
test("generic fixes and multi-dependency addons are not falsely classified as patches", () => {
  assert.equal(
    classification({ name: "Community Bug Fix.mod", dependencies: ["A", "B"] })
      .kind,
    "normal",
  );
  assert.equal(
    classification({ name: "Compatibility Patch.mod" }).kind,
    "patch",
  );
  assert.equal(classification({ name: "Dispatch.mod" }).kind, "normal");
  assert.equal(
    classification({
      name: "A.mod",
      description: "A compatibility patch for two mods.",
    }).kind,
    "patch",
  );
  assert.equal(
    classification({ name: "Patch.mod" }, { kind: "normal" }).kind,
    "normal",
  );
});
test("pins keep exact enabled positions and prevent crossing", () => {
  const { draft, mods } = make(["A Patch.mod", "Pinned.mod", "Other.mod"]);
  draft.rules["pinned.mod"] = { pinned: true };
  const r = sortDraft(draft, mods);
  assert.deepEqual(
    sorted(r),
    draft.entries.map((e) => e.name),
  );
});
test("conflicting pins return a cycle and no proposed order", () => {
  const { draft, mods } = make(["Child.mod", "Parent.mod"], {
    "Child.mod": ["Parent.mod"],
  });
  draft.rules["child.mod"] = { pinned: true };
  const r = sortDraft(draft, mods);
  assert.equal(r.ok, false);
  assert.equal(r.cycle.length, 2);
  assert.equal(r.draft, undefined);
});
test("cycle report does not blame downstream nodes", () => {
  const { draft, mods } = make(["A.mod", "B.mod", "C.mod"], {
    "A.mod": ["B.mod"],
    "B.mod": ["A.mod"],
    "C.mod": ["B.mod"],
  });
  const r = sortDraft(draft, mods);
  assert.equal(r.ok, false);
  assert.deepEqual(new Set(r.cycle), new Set(["a.mod", "b.mod"]));
});
test("missing and disabled mods remain in draft, disabled positions stay fixed", () => {
  const { draft, mods } = make(
    ["Patch.mod", "Disabled.mod", "Missing.mod", "Base.mod"],
    { "Patch.mod": ["Disabled.mod"] },
  );
  draft.entries[1].enabled = false;
  mods.splice(2, 1);
  const r = sortDraft(draft, mods);
  assert(r.ok);
  assert.equal(r.draft.entries[1].name, "Disabled.mod");
  assert.equal(r.draft.entries[1].enabled, false);
  assert(r.draft.entries.some((e) => e.name === "Missing.mod"));
  assert(r.issues.some((i) => i.type === "dependency"));
});
test("custom load-after and load-last rules beat the default priority", () => {
  const { draft, mods } = make(["A.mod", "B.mod", "C.mod"]);
  draft.rules["a.mod"] = { kind: "last", after: [] };
  draft.rules["c.mod"] = { after: ["A.mod"] };
  assert.deepEqual(sorted(sortDraft(draft, mods)), ["B.mod", "A.mod", "C.mod"]);
});
test("exact name matching avoids substring collisions", () => {
  const { draft, mods } = make(["A Patch.mod", "A.mod", "AA.mod"], {
    "A Patch.mod": ["AA.mod"],
  });
  assert.deepEqual(sorted(sortDraft(draft, mods)), [
    "A.mod",
    "AA.mod",
    "A Patch.mod",
  ]);
});
test("config/import validation rejects line injection, traversal and duplicate IDs", () => {
  assert.throws(() => parseConfig("../A.mod"));
  assert.throws(() => parseConfig("A.mod\na.MOD"));
  assert.throws(() =>
    normalizeDraft({ entries: [{ name: "A.mod\nB.mod", enabled: true }] }),
  );
  assert.deepEqual(
    parseConfig("\uFEFFA.mod\r\nB.mod\r\n").map((e) => e.name),
    ["A.mod", "B.mod"],
  );
  assert.throws(() => importList('{"schema":"wrong"}'));
  const d = make(["A.mod"]).draft;
  assert.deepEqual(
    importList(
      JSON.stringify({ schema: "kenshi-mod-list", version: 1, draft: d }),
    ).draft,
    d,
  );
});
test("random DAGs: permutation, precedence, determinism and idempotence", () => {
  let seed = 13432;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let t = 0; t < 80; t++) {
    const names = Array.from(
      { length: 40 },
      (_, i) => `${i % 4 === 0 ? "Patch " : ""}Mod${i}.mod`,
    );
    const deps = {};
    for (let i = 0; i < 40; i++)
      deps[names[i]] = names.slice(0, i).filter(() => rand() < 0.08);
    const shuffled = [...names];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const { draft, mods } = make(shuffled, deps);
    const r = sortDraft(draft, mods);
    assert(r.ok);
    const result = sorted(r);
    assert.equal(new Set(result).size, 40);
    for (const [name, parents] of Object.entries(deps))
      for (const p of parents) assert(result.indexOf(p) < result.indexOf(name));
    assert.equal(sortDraft(r.draft, mods).moves.length, 0);
    assert.deepEqual(sortDraft(draft, mods), r);
  }
});
test("storage preserves exact backup, rejects stale apply, roundtrips profiles and draft", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kmm-core-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const game = path.join(root, "steamapps/common/Kenshi");
  await fs.mkdir(path.join(game, "data"), { recursive: true });
  await fs.mkdir(path.join(game, "mods/A"), { recursive: true });
  await fs.writeFile(
    path.join(game, "mods/A/A.mod"),
    header(16, { description: "Test" }),
  );
  await fs.writeFile(path.join(game, "mods/A/Disabled.mod"), header(16));
  const cfg = path.join(game, "data/mods.cfg");
  const original = Buffer.from("A.mod\r\nMissing.mod\r\n");
  await fs.writeFile(cfg, original);
  const s = new Store(path.join(root, "state"), game);
  const snapshot = await s.init();
  assert.equal(snapshot.mods.length, 3);
  assert.equal(snapshot.gameEntries.length, 2);
  assert(snapshot.gameEntries.every((e) => e.enabled));
  const d = snapshot.draft;
  const result = await s.saveProfile({ name: "Example", draft: d });
  assert.deepEqual((await s.loadProfile(result.profile.id)).draft, d);
  await s.saveSession({ draft: d, fingerprint: hash(original) });
  assert.deepEqual((await s.snapshot()).draft, d);
  d.entries[0].enabled = false;
  const applied = await s.apply({ draft: d, fingerprint: hash(original) });
  assert.deepEqual(await fs.readFile(applied.backup), original);
  assert.equal(await fs.readFile(cfg, "utf8"), "Missing.mod\n");
  await fs.writeFile(cfg, "External.mod\n");
  await assert.rejects(
    s.apply({ draft: d, fingerprint: applied.fingerprint }),
    /another manager changed/,
  );
  assert.equal(await fs.readFile(cfg, "utf8"), "External.mod\n");
  await s.deleteProfile(result.profile.id);
  assert.equal((await s.profiles()).length, 0);
});
test("description hints find unlabeled patches without treating linked patch ads as the mod", () => {
  assert.equal(
    classification({
      name: "Slopeless Buildings.mod",
      description:
        "[h1]Summary:[/h1]\nSlopeless patch for Forgotten Buildings.",
    }).kind,
    "patch",
  );
  assert.equal(
    classification({
      name: "Some Tweaks.mod",
      description: "A small patch for another mod.",
    }).kind,
    "patch",
  );
  assert.equal(
    classification({
      name: "Some Animations.mod",
      description: "This is a multiple species patch for animations.",
    }).kind,
    "patch",
  );
  assert.equal(
    classification({
      name: "Armor.mod",
      description:
        "English translation patch (machine translation)\nClick here to visit the link",
    }).kind,
    "normal",
  );
  assert.equal(
    classification({
      name: "Some Fix.mod",
      description: "This mod adds clothing. A patch is available separately.",
    }).kind,
    "normal",
  );
  assert.equal(
    classification({
      name: "Fancy Clothing Fixes.mod",
      dependencies: ["Fancy Clothing.mod"],
    }).kind,
    "patch",
  );
});
test("advertising a separate compatibility patch does not classify the parent as a patch", () => {
  assert.equal(
    classification({
      name: "Heavy weapon combat stance.mod",
      description:
        "Adds heavy weapon shoulder resting combat stance for vanilla races\n\nIf you want to use it with More Combat Stance mod then INSTALL COMPATIBILITY PATCH below order",
    }).kind,
    "normal",
  );
  assert.equal(
    classification({
      name: "Master Plugin.mod",
      description: "A massive compatability patch for Kenshi Fancy Edition.",
    }).kind,
    "patch",
  );
});
test("Steam discovery includes Windows registry/custom roots and standard locations", async () => {
  const { steamRoots, discoverGame } = await import("../core/library.mjs");
  assert.deepEqual(
    steamRoots({
      platform: "win32",
      env: {
        "ProgramFiles(x86)": "D:\\Programs (x86)",
        ProgramFiles: "D:\\Programs",
      },
      registryPath: "E:\\Games\\Steam",
    }),
    ["E:\\Games\\Steam", "D:\\Programs (x86)\\Steam", "D:\\Programs\\Steam"],
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kmm-discovery-"));
  try {
    const steam = path.join(root, "Steam"),
      library = path.join(root, "Second Library");
    await fs.mkdir(path.join(steam, "steamapps"), { recursive: true });
    const game = path.join(library, "steamapps/common/Kenshi");
    await fs.mkdir(path.join(game, "data"), { recursive: true });
    await fs.writeFile(path.join(game, "data/mods.cfg"), "");
    await fs.writeFile(
      path.join(steam, "steamapps/libraryfolders.vdf"),
      `"libraryfolders" { "1" { "path" "${library.replaceAll("\\", "\\\\")}" } }`,
    );
    assert.equal(await discoverGame({ roots: [steam] }), game);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
