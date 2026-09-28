import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "kenshi-manager-ui-"));
const game = path.join(root, "steamapps/common/Kenshi");
await fs.mkdir(path.join(game, "data"), { recursive: true });
const names = [
  "Desert Gear - Compatibility Patch.mod",
  "Desert Gear.mod",
  "Reactive World.mod",
  "Community Bug Fix.mod",
  "Forgotten Buildings.mod",
  "Dark UI.mod",
];
function header(name) {
  const nums = Buffer.alloc(8);
  nums.writeUInt32LE(16);
  nums.writeUInt32LE(1, 4);
  const strings = [
    "Test Author",
    `${name} brings new things to the wasteland.`,
    name.includes("Patch") ? "Desert Gear.mod" : "",
    "",
  ].flatMap((s) => {
    const b = Buffer.from(s);
    const l = Buffer.alloc(4);
    l.writeUInt32LE(b.length);
    return [l, b];
  });
  return Buffer.concat([nums, ...strings]);
}
for (const name of names) {
  const dir = path.join(game, "mods", name.slice(0, -4));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), header(name));
}
const original = names.slice(0, 5).join("\n") + "\nMissing Mod.mod\n";
await fs.writeFile(path.join(game, "data/mods.cfg"), original);
await fs.mkdir("artifacts", { recursive: true });
let app;
const errors = [];
async function capture(file) {
  const page = await app.firstWindow();
  const zoom = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
  );
  const bounds = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  const client = await page.context().newCDPSession(page);
  let result;
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.waitForTimeout(150);
    try {
      result = await client.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width: bounds.width * zoom,
          height: bounds.height * zoom,
          scale: 1,
        },
      });
      break;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  await fs.writeFile(file, Buffer.from(result.data, "base64"));
  await client.detach();
}
try {
  app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      KMM_GAME_PATH: game,
      KMM_USER_DATA: path.join(root, "state"),
    },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(
    page.getByRole("heading", { name: "Load order", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("mod-row")).toHaveCount(7);
  console.log(
    "Layout:",
    await page.evaluate(() => ({
      innerWidth,
      dpr: devicePixelRatio,
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      workspace: document
        .querySelector(".workspace")
        .getBoundingClientRect()
        .toJSON(),
      inspector: document
        .querySelector(".inspector")
        .getBoundingClientRect()
        .toJSON(),
    })),
  );
  await capture("artifacts/fixture-desktop.png");
  await page.getByRole("textbox", { name: "Search mods" }).fill("Desert Gear");
  await expect(page.getByTestId("mod-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  const checkbox = page.getByRole("checkbox", {
    name: "Enable Desert Gear.mod",
    exact: true,
  });
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
  await page
    .getByRole("button", { name: "Undo (Ctrl Z)", exact: true })
    .click();
  await expect(checkbox).toBeChecked();
  await page.getByRole("button", { name: "Save list", exact: true }).click();
  await page.getByLabel("List name").fill("Test playthrough");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save list", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Load Test playthrough", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Autosort", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review autosort" }),
  ).toBeVisible();
  await capture("artifacts/sort-preview.png");
  await page.getByRole("button", { name: "Accept order" }).click();
  assert.equal(
    await fs.readFile(path.join(game, "data/mods.cfg"), "utf8"),
    original,
  );
  await page
    .getByRole("button", { name: "Apply to game", exact: true })
    .click();
  await page.getByRole("button", { name: "Apply 6 mods", exact: true }).click();
  await expect(
    page.getByText("Matches game load order", { exact: true }),
  ).toBeVisible();
  const applied = await fs.readFile(path.join(game, "data/mods.cfg"), "utf8");
  assert.equal(
    applied.trim().split("\n").at(-1),
    "Desert Gear - Compatibility Patch.mod",
  );
  const backups = await fs.readdir(path.join(root, "state/backups"));
  assert.equal(backups.length, 1);
  assert.equal(
    await fs.readFile(path.join(root, "state/backups", backups[0]), "utf8"),
    original,
  );
  await page
    .getByRole("button", { name: "Load Test playthrough", exact: true })
    .click();
  await expect(
    page.getByText("Changes not applied", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Interface size").selectOption("1.5");
  await expect(
    page.getByRole("heading", { name: "Load order", exact: true }),
  ).toBeVisible();
  await capture("artifacts/scale-150.png");
  // Persisted edits survive a desktop restart.
  await expect
    .poll(
      async () =>
        JSON.parse(
          await fs.readFile(path.join(root, "state/session.json"), "utf8"),
        ).activeProfile,
    )
    .not.toBeNull();
  await app.close();
  app = null;
  app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      KMM_GAME_PATH: game,
      KMM_USER_DATA: path.join(root, "state"),
    },
    timeout: 30000,
  });
  const reopened = await app.firstWindow();
  await expect(
    reopened.getByRole("heading", { name: "Load order", exact: true }),
  ).toBeVisible();
  await expect(reopened.getByLabel("Interface size")).toHaveValue("1.5");
  await expect(
    reopened.getByRole("button", {
      name: "Load Test playthrough",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    reopened.getByText("Changes not applied", { exact: true }),
  ).toBeVisible();
  // Pinned positions can expose a real dependency contradiction.
  await reopened.getByRole("button", { name: "Pin", exact: true }).click();
  await reopened.getByRole("button", { name: "Autosort", exact: true }).click();
  await expect(
    reopened.getByText("Conflicting order rules", { exact: true }),
  ).toBeVisible();
  await expect(
    reopened.getByRole("button", { name: "Accept order", exact: true }),
  ).toBeDisabled();
  await reopened.getByRole("button", { name: "Cancel", exact: true }).click();
  await reopened.getByRole("button", { name: "Pinned", exact: true }).click();
  // Exercise file dialog boundaries with fixture-selected paths.
  const exportFile = path.join(root, "exported.json");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, exportFile);
  await reopened
    .getByRole("button", { name: "Export list", exact: true })
    .click();
  await reopened.getByRole("button", { name: /Complete mod list/ }).click();
  await expect(reopened.getByRole("dialog")).toHaveCount(0);
  const exported = JSON.parse(await fs.readFile(exportFile, "utf8"));
  assert.equal(exported.schema, "kenshi-mod-list");
  assert.equal(exported.draft.entries.filter((e) => e.enabled).length, 6);
  const importFile = path.join(root, "import.cfg");
  await fs.writeFile(importFile, "Dark UI.mod\nMissing Import.mod\n");
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, importFile);
  await reopened
    .getByRole("button", { name: "Import list", exact: true })
    .click();
  await expect(
    reopened.getByRole("checkbox", { name: "Enable Dark UI.mod", exact: true }),
  ).toBeChecked();
  await expect(
    reopened.getByRole("checkbox", {
      name: "Enable Missing Import.mod",
      exact: true,
    }),
  ).toBeChecked();
  // A concurrent external edit must survive an attempted apply.
  await fs.writeFile(path.join(game, "data/mods.cfg"), "External.mod\n");
  await reopened
    .getByRole("button", { name: "Apply to game", exact: true })
    .click();
  await reopened
    .getByRole("button", { name: "Apply 2 mods", exact: true })
    .click();
  await expect(reopened.getByRole("alert")).toContainText(
    "another manager changed",
  );
  await expect(reopened.getByRole("dialog")).toHaveCount(0);
  assert.equal(
    await fs.readFile(path.join(game, "data/mods.cfg"), "utf8"),
    "External.mod\n",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Electron UI search, toggle, undo, save/load profile, autosort, cycles, explicit apply, backup, scaling, restart, import/export, and concurrent-edit protection.",
  );
  console.log("Fixture:", root);
} finally {
  if (app) await app.close();
}
