import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { baseFiles, modFile } from "./mod-fixture.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "kmm-record-ui-"));
const game = path.join(root, "Kenshi");
const coat = {
  id: "coat.base",
  name: "Desert coat",
  int: { price: 5 },
  flags: 16,
};
await baseFiles(game, [coat, { id: "vendor.base", type: 49, flags: 16 }]);
const records = new Map([
  ["General Patch.mod", [{ ...coat, flags: 17, int: { price: 10 } }]],
  [
    "Distribution.mod",
    [
      {
        id: "vendor.base",
        type: 49,
        refs: { clothing: [{ target: "shirt-Clothing.mod" }] },
      },
    ],
  ],
  [
    "Clothing.mod",
    [
      { ...coat, flags: 17, int: { price: 20 } },
      { id: "shirt-Clothing.mod", name: "New shirt", flags: 16 },
    ],
  ],
]);
for (const [name, data] of records) {
  const folder = path.join(game, "mods", name.slice(0, -4));
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, name),
    modFile({ format: 17, records: data }),
  );
}
const config = path.join(game, "data/mods.cfg"),
  original = [...records.keys()].join("\n") + "\n";
await fs.writeFile(config, original);
const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    KMM_GAME_PATH: game,
    KMM_USER_DATA: path.join(root, "state"),
  },
});
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(
    page.getByRole("heading", { name: "Load order", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Autosort", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review autosort" }),
  ).toBeVisible();
  await expect(
    page.getByText("record dependency links", { exact: false }),
  ).toContainText("1");
  await page.getByLabel("Search record overwrites").fill("Desert coat");
  await expect(page.locator(".overwrite-card")).toHaveCount(1);
  await expect(page.locator(".overwrite-value.winning")).toContainText(
    "Clothing.mod",
  );
  await expect(page.getByRole("checkbox", { name: /I reviewed/ })).toHaveCount(
    0,
  );
  assert.equal(await fs.readFile(config, "utf8"), original);
  await page
    .getByRole("button", { name: "Load this mod last", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review autosort" }),
  ).toBeVisible();
  const review = page.getByRole("checkbox", {
    name: "I reviewed the overwrite changes and scan limitations",
    exact: true,
  });
  await expect(review).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept order", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".overwrite-value.winning")).toContainText(
    "General Patch.mod",
  );
  await review.check();
  await page.getByRole("button", { name: "Accept order", exact: true }).click();
  assert.equal(await fs.readFile(config, "utf8"), original);
  await page
    .getByRole("button", { name: "Apply to game", exact: true })
    .click();
  await page.getByRole("button", { name: "Apply 3 mods", exact: true }).click();
  await expect(
    page.getByText("Matches game load order", { exact: true }),
  ).toBeVisible();
  const applied = (await fs.readFile(config, "utf8")).trim().split("\n");
  assert.equal(applied.at(-1), "General Patch.mod");
  assert(applied.indexOf("Clothing.mod") < applied.indexOf("Distribution.mod"));
  const backups = await fs.readdir(path.join(root, "state/backups"));
  assert.equal(
    await fs.readFile(path.join(root, "state/backups", backups[0]), "utf8"),
    original,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: record dependencies, overwrite search, explicit winner rule, review gate, draft-only acceptance and backup.",
  );
} finally {
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
}
