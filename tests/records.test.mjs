import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { modFile, baseFiles } from "./mod-fixture.mjs";
import { parseRecords } from "../core/records.mjs";
import {
  analyzeRecords,
  compareWinners,
  scanRecords,
} from "../core/conflicts.mjs";
import { sortDraft, key } from "../core/order.mjs";
import { Store } from "../core/store.mjs";

const dataset = (name, records) => ({
  id: key(name),
  ...parseRecords(modFile({ records })),
});
const make = (names) => ({
  entries: names.map((name) => ({ name, id: key(name), enabled: true })),
  rules: {},
});
const mods = (draft) =>
  draft.entries.map((e) => ({ ...e, dependencies: [], references: [] }));
const record = (value, extra = {}) => ({
  id: "coat.base",
  name: "Desert coat",
  int: { price: value },
  ...extra,
});

test("formats 16 and 17 read typed fields, UTF-8, references, removals and instances", () => {
  for (const format of [16, 17]) {
    const result = parseRecords(
      modFile({
        format,
        records: [
          {
            id: "coat",
            name: "外套",
            flags: -2147483646,
            bool: { craft: true },
            float: { weight: 1.25 },
            int: { price: -5 },
            vector3: { position: [1, 2, 3] },
            vector4: { rotation: [1, 0, 0, 0] },
            string: { description: "测试" },
            file: { mesh: "coat.mesh" },
            refs: {
              clothing: [
                { target: "shirt", values: [3, 2, 1] },
                { target: "removed", values: [0, 0, 2147483647] },
              ],
            },
            instances: [
              { id: "instance", target: "building", states: ["state"] },
            ],
          },
        ],
      }),
    );
    assert.equal(result.records[0].name, "外套");
    assert.equal(result.records[0].newRecord, true);
    assert.deepEqual(result.records[0].targets, ["shirt", "building", "state"]);
    assert.equal(
      result.records[0].fields.find((f) => f.target === "removed").value,
      "Removed",
    );
    assert.deepEqual(
      result.records[0].fields.find((f) => f.label === "position").value,
      [1, 2, 3],
    );
    assert.equal(
      result.records[0].fields.find((f) => f.label === "weight").value,
      1.25,
    );
  }
  assert.equal(
    parseRecords(modFile({ records: [record(1, { bool: { REMOVED: true } })] }))
      .records[0].removed,
    true,
  );
  assert.equal(
    parseRecords(
      modFile({
        format: 17,
        deleteRequests: [{ mod: "old.mod", records: ["a", "b"] }],
      }),
    ).warnings.length,
    1,
  );
});

test("malformed files fail closed instead of returning partial records", () => {
  const file = modFile({ records: [record(10)] });
  for (let n = 0; n < file.length; n++)
    assert.throws(() => parseRecords(file.subarray(0, n)), `truncation ${n}`);
  assert.throws(
    () => parseRecords(Buffer.concat([file, Buffer.from([0])])),
    /trailing/,
  );
  assert.throws(
    () => parseRecords(modFile({ records: [record(1), record(2)] })),
    /duplicate/,
  );
  const invalid = Buffer.from(file);
  invalid.writeInt32LE(-1, 8);
  assert.throws(() => parseRecords(invalid));
  const header = modFile({ format: 17 });
  header.writeInt32LE(2147483647, 4);
  assert.throws(() => parseRecords(header), /header/);
});

test("distinct vendor additions and equal values are not overwrite conflicts", () => {
  const draft = make(["A.mod", "B.mod"]);
  const data = [
    dataset("A.mod", [record(10, { refs: { clothing: [{ target: "a" }] } })]),
    dataset("B.mod", [record(10, { refs: { clothing: [{ target: "b" }] } })]),
  ];
  assert.equal(
    analyzeRecords(draft, data, new Set(["coat.base", "a", "b"])).conflicts
      .length,
    0,
  );
});

test("different additive instance states do not look like a replace-all conflict", () => {
  const draft = make(["A.mod", "B.mod"]);
  const data = [
    dataset("A.mod", [
      record(10, {
        instances: [{ id: "building", target: "house", states: ["one"] }],
      }),
    ]),
    dataset("B.mod", [
      record(10, {
        instances: [{ id: "building", target: "house", states: ["two"] }],
      }),
    ]),
  ];
  assert.equal(
    analyzeRecords(draft, data, new Set(["coat.base", "house", "one", "two"]))
      .conflicts.length,
    0,
  );
});

test("name-based patch sorting cannot reverse a clothing field winner", () => {
  const draft = make(["General Patch.mod", "Clothing.mod", "Other.mod"]);
  const data = [
    dataset("General Patch.mod", [record(0)]),
    dataset("Clothing.mod", [record(100)]),
  ];
  data.push(dataset("Other.mod", []));
  const analysis = analyzeRecords(draft, data, new Set(["coat.base"]));
  assert.equal(
    compareWinners(analysis, sortDraft(draft, mods(draft)).draft)[0].changed,
    true,
  );
  const result = sortDraft(draft, mods(draft), analysis);
  assert(result.ok);
  assert.equal(compareWinners(analysis, result.draft)[0].changed, false);
  assert.equal(
    result.draft.entries.findIndex((e) => e.id === "general patch.mod") <
      result.draft.entries.findIndex((e) => e.id === "clothing.mod"),
    true,
  );
});

test("record references discover undeclared providers without guessing from filename suffixes", () => {
  const draft = make(["Distribution.mod", "Clothing.mod"]);
  const data = [
    dataset("Distribution.mod", [
      {
        id: "vendor.base",
        type: 49,
        refs: { clothing: [{ target: "1-OldName.mod" }] },
      },
    ]),
    dataset("Clothing.mod", [{ id: "1-OldName.mod", flags: 16 }]),
  ];
  const analysis = analyzeRecords(draft, data, new Set(["vendor.base"]));
  assert.deepEqual(
    analysis.inferred.map((e) => [e.from, e.to]),
    [["clothing.mod", "distribution.mod"]],
  );
  const result = sortDraft(draft, mods(draft), analysis);
  assert.deepEqual(
    result.draft.entries.map((e) => e.id),
    ["clothing.mod", "distribution.mod"],
  );
  const base = analyzeRecords(
    draft,
    data,
    new Set(["vendor.base", "1-OldName.mod"]),
  );
  assert.equal(base.inferred.length, 0);
});

test("ambiguous, disabled and unknown providers are reported, never enabled or guessed", () => {
  const draft = make(["Consumer.mod", "A.mod", "B.mod"]);
  draft.entries.push({
    name: "Disabled.mod",
    id: "disabled.mod",
    enabled: false,
  });
  const data = [
    dataset("Consumer.mod", [
      record(1, {
        refs: {
          clothing: [
            { target: "shared" },
            { target: "disabled" },
            { target: "missing" },
          ],
        },
      }),
    ]),
    dataset("A.mod", [{ id: "shared", flags: 16 }]),
    dataset("B.mod", [{ id: "shared", flags: 16 }]),
    dataset("Disabled.mod", [{ id: "disabled", flags: 16 }]),
  ];
  const analysis = analyzeRecords(draft, data, new Set(["coat.base"]));
  assert.equal(analysis.inferred.length, 0);
  assert.deepEqual(
    new Set(analysis.issues.map((i) => i.type)),
    new Set([
      "ambiguous-record",
      "disabled-record",
      "unresolved-record",
      "duplicate-definition",
    ]),
  );
  assert.equal(
    sortDraft(draft, mods(draft), analysis).draft.entries.at(-1).enabled,
    false,
  );
});

test("explicit rules outrank overwrite preservation and report changed values", () => {
  const draft = make(["A.mod", "B.mod"]);
  draft.rules["a.mod"] = { after: ["B.mod"] };
  const analysis = analyzeRecords(
    draft,
    [dataset("A.mod", [record(1)]), dataset("B.mod", [record(2)])],
    new Set(["coat.base"]),
  );
  const result = sortDraft(draft, mods(draft), analysis);
  assert(result.ok);
  assert.equal(result.relaxed.length, 1);
  assert.equal(compareWinners(analysis, result.draft)[0].changed, true);
});

test("removal competes with edits; reference deletion only competes with the same target", () => {
  const draft = make(["A.mod", "B.mod"]);
  const data = [
    dataset("A.mod", [record(1, { refs: { clothing: [{ target: "coat" }] } })]),
    dataset("B.mod", [
      {
        id: "coat.base",
        name: "Desert coat",
        bool: { REMOVED: true },
        refs: { clothing: [{ target: "coat", values: [0, 0, 2147483647] }] },
      },
    ]),
  ];
  const result = analyzeRecords(draft, data, new Set(["coat.base", "coat"]));
  assert(result.conflicts.some((c) => c.kind === "removal"));
  assert(
    result.conflicts.some(
      (c) => c.kind === "reference" && c.writers.at(-1).deleted,
    ),
  );
});

test("unreadable installed files remain anchored and record dependency cycles refuse sorting", () => {
  const draft = make(["A Patch.mod", "Unknown.mod", "B.mod"]);
  const analysis = analyzeRecords(
    draft,
    [
      dataset("A Patch.mod", []),
      { id: "unknown.mod", error: "Unreadable", records: [] },
      dataset("B.mod", []),
    ],
    new Set(),
  );
  const result = sortDraft(draft, mods(draft), analysis);
  assert.deepEqual(result.draft.entries, draft.entries);
  analysis.inferred = [
    { from: "a patch.mod", to: "b.mod", count: 1, examples: ["a"] },
    { from: "b.mod", to: "a patch.mod", count: 1, examples: ["b"] },
  ];
  assert.equal(sortDraft(draft, mods(draft), analysis).ok, false);
});

test("a sole deletion of a vanilla item is reported along with its live shop references", () => {
  const draft = make(["Remove Coat.mod", "Shop.mod"]);
  const analysis = analyzeRecords(
    draft,
    [
      dataset("Remove Coat.mod", [record(1, { bool: { REMOVED: true } })]),
      dataset("Shop.mod", [
        {
          id: "shop.base",
          type: 49,
          refs: { clothing: [{ target: "coat.base" }] },
        },
      ]),
    ],
    new Set(["coat.base", "shop.base"]),
  );
  assert(
    analysis.issues.some(
      (i) => i.id === "remove coat.mod" && i.type === "record-removal",
    ),
  );
  assert(
    analysis.issues.some(
      (i) => i.id === "shop.mod" && i.type === "removed-record-reference",
    ),
  );
});

test("incomplete scans preserve positions only where real dependencies allow", () => {
  const draft = make(["Consumer.mod", "Unknown.mod"]);
  const analysis = {
    inferred: [
      {
        from: "unknown.mod",
        to: "consumer.mod",
        count: 1,
        examples: ["record"],
      },
    ],
    protections: [],
    opaque: ["unknown.mod"],
  };
  const result = sortDraft(draft, mods(draft), analysis);
  assert(result.ok);
  assert.deepEqual(
    result.draft.entries.map((e) => e.id),
    ["unknown.mod", "consumer.mod"],
  );
  assert.equal(result.relaxed.length, 1);
});

test("incomplete base scan never fabricates providers; disabled alternatives do not obscure a unique enabled provider", () => {
  const draft = make(["Consumer.mod", "A.mod", "B.mod"]);
  draft.entries[2].enabled = false;
  const data = [
    dataset("Consumer.mod", [record(1)]),
    dataset("A.mod", [record(1, { flags: 16 })]),
    dataset("B.mod", [record(1, { flags: 16 })]),
  ];
  assert.equal(
    analyzeRecords(draft, data, new Set(), { baseComplete: false }).inferred
      .length,
    0,
  );
  assert.equal(
    analyzeRecords(draft, data, new Set()).inferred[0].from,
    "a.mod",
  );
});

test("random overlap chains preserve field winners, permutations and repeated-sort stability", () => {
  let seed = 7241;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let trial = 0; trial < 60; trial++) {
    const draft = make(
      Array.from(
        { length: 12 },
        (_, i) => `${i}${random() < 0.4 ? " Patch" : ""}.mod`,
      ),
    );
    const data = draft.entries.map((entry) =>
      dataset(
        entry.name,
        Array.from({ length: 8 }, (_, j) =>
          record(Math.floor(random() * 4), { id: `record-${j}` }),
        ).filter(() => random() < 0.5),
      ),
    );
    const baseIds = new Set(Array.from({ length: 8 }, (_, j) => `record-${j}`));
    const analysis = analyzeRecords(draft, data, baseIds);
    const result = sortDraft(draft, mods(draft), analysis);
    assert(result.ok);
    assert.deepEqual(
      new Set(result.draft.entries.map((e) => e.id)),
      new Set(draft.entries.map((e) => e.id)),
    );
    assert.equal(
      compareWinners(analysis, result.draft).some((c) => c.changed),
      false,
    );
    const nextAnalysis = analyzeRecords(result.draft, data, baseIds);
    assert.equal(
      sortDraft(result.draft, mods(draft), nextAnalysis).moves.length,
      0,
    );
  }
});

test("real worker scans files read-only, searches all conflicts and invalidates old reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kmm-record-test-"));
  try {
    const extras = Array.from({ length: 25 }, (_, i) =>
      record(1, { id: `extra-${i}`, name: `Other item ${i}` }),
    );
    await baseFiles(root, [
      record(1, { flags: 16 }),
      ...extras.map((r) => ({ ...r, flags: 16 })),
    ]);
    const draft = make(["A Patch.mod", "B.mod"]);
    for (const [n, entry] of draft.entries.entries()) {
      const dir = path.join(root, "mods", entry.name.slice(0, -4));
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, entry.name),
        modFile({
          records: [
            record(n * 10),
            ...extras.map((r) => ({ ...r, int: { price: n * 10 } })),
          ],
        }),
      );
    }
    await fs.writeFile(
      path.join(root, "data/mods.cfg"),
      "A Patch.mod\nB.mod\n",
    );
    const before = await fs.readFile(path.join(root, "data/mods.cfg"));
    const store = new Store(path.join(root, "state"), root);
    await store.init();
    const result = await store.analyze(draft);
    assert.equal(result.analysis.conflictCount, 26);
    assert.equal(
      store.conflictPage({ token: result.analysis.token }).results.length,
      20,
    );
    assert.equal(
      store.conflictPage({ token: result.analysis.token, offset: 20 }).results
        .length,
      6,
    );
    assert.equal(result.analysis.changedCount, 0);
    assert.equal(result.analysis.summary.scanned, 2);
    assert.equal(result.analysis.conflicts, undefined);
    assert.equal(
      store.conflictPage({ token: result.analysis.token, query: "coat" }).total,
      1,
    );
    assert.equal(
      store.conflictPage({ token: result.analysis.token, changedOnly: true })
        .total,
      0,
    );
    await store.analyze(draft);
    assert.throws(
      () => store.conflictPage({ token: result.analysis.token }),
      /expired/,
    );
    assert.deepEqual(
      await fs.readFile(path.join(root, "data/mods.cfg")),
      before,
    );
    await assert.rejects(fs.stat(path.join(root, "state/backups")), {
      code: "ENOENT",
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
