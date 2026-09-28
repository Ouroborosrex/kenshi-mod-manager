import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { modFile, baseFiles } from "./mod-fixture.mjs";
if (!process.env.KMM_PACKAGED_EXECUTABLE)
  throw new Error(
    "Set KMM_PACKAGED_EXECUTABLE to the packaged application executable.",
  );
const build = JSON.parse(await fs.readFile("electron/build-info.json", "utf8"));
const root = await fs.mkdtemp(path.join(os.tmpdir(), "kmm-packaged-"));
const game = path.join(root, "steamapps/common/Kenshi");
await baseFiles(game);
await fs.mkdir(path.join(game, "mods/Test"), { recursive: true });
const config = path.join(game, "data/mods.cfg");
await fs.writeFile(config, "Test.mod\n");
await fs.writeFile(path.join(game, "mods/Test/Test.mod"), modFile());
const app = await electron.launch({
  executablePath: path.resolve(process.env.KMM_PACKAGED_EXECUTABLE),
  args: ["--disable-gpu"],
  env: {
    ...process.env,
    KMM_GAME_PATH: game,
    KMM_USER_DATA: path.join(root, "state"),
  },
  timeout: 45000,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(
    page.getByRole("heading", { name: "Load order", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Mod manager version")).toContainText(
    `v${build.version}`,
  );
  await expect(page.getByLabel("Mod manager version")).toContainText(
    build.commit.slice(0, 7),
  );
  await expect(page.getByText("Working draft", { exact: true })).toHaveCount(0);
  // Small desktops and larger UI scales must leave bulk actions accessible.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setContentSize(1100, 850);
    window.webContents.setZoomFactor(1.25);
  });
  await expect(page.getByLabel("Mod details", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Show mod details", exact: true })
    .click();
  await expect(page.getByLabel("Mod details", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Hide mod details", exact: true })
    .click();
  // Workers must launch from the packaged ASAR on both platforms.
  await page.getByRole("button", { name: "Autosort", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review autosort" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Record overwrites" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Select actions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Disable selected mods", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Enable Test.mod", exact: true }),
  ).not.toBeChecked();
  assert.equal(await fs.readFile(config, "utf8"), "Test.mod\n");
  await page
    .getByRole("button", { name: "Apply to game", exact: true })
    .click();
  await page.getByRole("button", { name: "Apply 0 mods", exact: true }).click();
  await expect(
    page.getByText("Matches game load order", { exact: true }),
  ).toBeVisible();
  assert.equal(await fs.readFile(config, "utf8"), "");
  const backups = await fs.readdir(path.join(root, "state/backups"));
  assert.equal(backups.length, 1);
  assert.equal(
    await fs.readFile(path.join(root, "state/backups", backups[0]), "utf8"),
    "Test.mod\n",
  );
  await page
    .getByRole("button", { name: "Select actions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Enable selected mods", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Enable Test.mod", exact: true }),
  ).toBeChecked();
  assert.deepEqual(errors, []);
  console.log(
    `Packaged ${process.platform} app passed: v${build.version}, ${build.commit.slice(0, 7)}, bulk actions, apply and backup.`,
  );
} finally {
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
}
