import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  screen,
} from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, atomicWrite, importList } from "../core/store.mjs";
import { normalizeDraft } from "../core/order.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
app.setPath(
  "userData",
  process.env.KMM_USER_DATA ||
    path.join(app.getPath("appData"), "kenshi-mod-manager"),
);
app.setName("Kenshi Mod Manager");
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window, store;
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      store = new Store(app.getPath("userData"), process.env.KMM_GAME_PATH);
      let initial;
      try {
        initial = await store.init();
      } catch (error) {
        initial = { error: error.message, needsSetup: true, scale: 1.25 };
      }
      const area = screen.getPrimaryDisplay().workAreaSize;
      window = new BrowserWindow({
        width: Math.min(area.width - 80, 2200),
        height: Math.min(area.height - 80, 1400),
        minWidth: 1060,
        minHeight: 700,
        backgroundColor: "#1b1d1b",
        title: "Kenshi Mod Manager",
        icon: path.join(here, "../assets/icon.png"),
        webPreferences: {
          preload: path.join(here, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          zoomFactor: initial.scale || 1.25,
        },
      });
      Menu.setApplicationMenu(null);
      let closing = false;
      window.on("close", (event) => {
        if (!closing) {
          event.preventDefault();
          store.pending.finally(() => {
            closing = true;
            window.close();
          });
        }
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      const handle = (name, fn) =>
        ipcMain.handle(`manager:${name}`, async (event, arg) => {
          if (
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame
          )
            throw new Error("Invalid sender");
          try {
            return { ok: true, value: await store.exclusive(() => fn(arg)) };
          } catch (error) {
            return { ok: false, error: error.message };
          }
        });
      handle("initial", () => initial);
      handle("refresh", () => store.snapshot());
      handle("reloadGame", () => store.snapshot({ fromGame: true }));
      handle("session", (data) => store.saveSession(data));
      handle("saveProfile", (data) => store.saveProfile(data));
      handle("loadProfile", (id) => store.loadProfile(id));
      handle("deleteProfile", (id) => store.deleteProfile(id));
      handle("apply", (data) => store.apply(data));
      handle("analyze", (draft) => store.analyze(draft));
      handle("conflicts", (query) => store.conflictPage(query));
      handle("scale", async (scale) => {
        await store.setScale(scale);
        window.webContents.setZoomFactor(scale);
        return scale;
      });
      handle("chooseGame", async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog(window, {
          title: "Choose the Kenshi game folder",
          properties: ["openDirectory"],
          defaultPath: store.gamePath || app.getPath("home"),
        });
        return canceled ? null : store.configure(filePaths[0]);
      });
      handle("import", async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog(window, {
          title: "Import a mod list",
          properties: ["openFile"],
          filters: [{ name: "Mod lists", extensions: ["json", "cfg", "txt"] }],
        });
        if (canceled) return null;
        if ((await fs.stat(filePaths[0])).size > 5 * 1024 * 1024)
          throw new Error("List is too large.");
        return importList(await fs.readFile(filePaths[0], "utf8"));
      });
      handle("export", async (data) => {
        const draft = normalizeDraft(data.draft);
        const rich = data.format === "json";
        const { canceled, filePath } = await dialog.showSaveDialog(window, {
          title: "Export mod list",
          defaultPath: rich ? "kenshi-mod-list.json" : "mods.cfg",
          filters: [
            {
              name: rich
                ? "Portable mod list (includes rules)"
                : "Kenshi enabled load order",
              extensions: rich ? ["json"] : ["cfg", "txt"],
            },
          ],
        });
        if (canceled) return null;
        const content = rich
          ? JSON.stringify(
              {
                schema: "kenshi-mod-list",
                version: 1,
                name: data.name || "Exported list",
                draft,
              },
              null,
              2,
            )
          : draft.entries
              .filter((e) => e.enabled)
              .map((e) => e.name)
              .join("\n") + "\n";
        await atomicWrite(filePath, content);
        return filePath;
      });
      handle("openFolder", async (id) => {
        const mod = store.mods.find((m) => m.id === id);
        if (!mod) throw new Error("Mod not installed.");
        shell.showItemInFolder(mod.path);
      });
      handle("workshop", async (id) => {
        const mod = store.mods.find((m) => m.id === id);
        if (!mod?.workshopId) throw new Error("No Workshop link.");
        await shell.openExternal(
          `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshopId}`,
        );
      });
      handle("openBackups", () =>
        shell.openPath(path.join(store.root, "backups")),
      );
      handle("launch", () => shell.openExternal("steam://rungameid/233860"));
      await window.loadFile(path.join(here, "../dist/index.html"));
      app.on("window-all-closed", () => app.quit());
    })
    .catch((error) => {
      console.error(error);
      app.quit();
    });
}
