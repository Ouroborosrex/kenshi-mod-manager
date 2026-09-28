// Read-only integration/visual check. No apply or game launch calls.
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { discoverGame } from "../core/library.mjs";
import { parseConfig } from "../core/order.mjs";
const game = process.env.KMM_GAME_PATH || (await discoverGame());
if (!game)
  throw new Error("Set KMM_GAME_PATH to an installed Kenshi game folder.");
await fs.mkdir("artifacts", { recursive: true });
const cfg = path.join(game, "data/mods.cfg");
const original = await fs.readFile(cfg);
const userData = await fs.mkdtemp(path.join(os.tmpdir(), "kmm-real-ui-"));
const app = await electron.launch({
  args: ["."],
  env: { ...process.env, KMM_GAME_PATH: game, KMM_USER_DATA: userData },
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(
    page.getByRole("heading", { name: "Load order", exact: true }),
  ).toBeVisible();
  const initial = await page.evaluate(() => window.manager.initial());
  assert.deepEqual(
    initial.draft.entries.filter((e) => e.enabled),
    parseConfig(original.toString("utf8")),
  );
  await expect(page.getByTestId("mod-row")).toHaveCount(
    initial.draft.entries.length,
  );
  await page.getByRole("button", { name: "Save list", exact: true }).click();
  await page.getByLabel("List name").fill("Current playthrough");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save list", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Select a real compatibility patch without changing the list.
  await page
    .getByRole("textbox", { name: "Search mods" })
    .fill(
      initial.draft.entries.find((e) => e.enabled)?.name ||
        initial.mods[0]?.name ||
        "",
    );
  await page.getByTestId("mod-row").first().click();
  await page.getByRole("button", { name: "Clear search" }).click();
  const selected = page.locator(".mod-row.selected");
  await selected.scrollIntoViewIfNeeded();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const capture = async (file) => {
    const client = await page.context().newCDPSession(page);
    const bounds = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    const zoom = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
    );
    const r = await client.send("Page.captureScreenshot", {
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
    await fs.writeFile(file, Buffer.from(r.data, "base64"));
    await client.detach();
  };
  await capture("artifacts/real-library.png");
  await page.getByRole("button", { name: "Autosort", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Accept order", exact: true }),
  ).toBeVisible();
  await capture("artifacts/real-autosort.png");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  // Check every scale at a smaller desktop size for horizontal overflow.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1300, 900),
  );
  for (const scale of ["1", "1.25", "1.5", "1.75"]) {
    await page.getByLabel("Interface size").selectOption(scale);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Math.abs(document.documentElement.scrollWidth - innerWidth),
        ),
      )
      .toBeLessThan(2);
    await expect(
      page.getByRole("button", { name: "Autosort", exact: true }),
    ).toBeVisible();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(await fs.readFile(cfg), original);
  console.log(
    "PASS: real library, metadata, sort preview, four scales, no game changes.",
  );
} finally {
  await app.close();
  assert.deepEqual(await fs.readFile(cfg), original);
}
