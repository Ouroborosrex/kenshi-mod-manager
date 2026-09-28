import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Store } from "../core/store.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apps = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"),
  "applications",
);
await fs.mkdir(apps, { recursive: true });
await fs.writeFile(
  path.join(apps, "kenshi-mod-manager.desktop"),
  `[Desktop Entry]\nType=Application\nName=Kenshi Mod Manager\nComment=Manage Kenshi load orders, saved lists, and patch sorting\nExec="${root}/launch.sh"\nPath=${root}\nIcon=${root}/assets/icon.svg\nTerminal=false\nCategories=Game;Utility;\nStartupNotify=true\n`,
);
const userData = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
  "kenshi-mod-manager",
);
const store = new Store(userData);
const snapshot = await store.init();
if (snapshot.draft && !snapshot.profiles.length) {
  const saved = await store.saveProfile({
    name: `Original load order — ${new Date().toISOString().slice(0, 10)}`,
    draft: snapshot.draft,
  });
  await store.saveSession({
    draft: snapshot.draft,
    fingerprint: snapshot.fingerprint,
    activeProfile: saved.profile.id,
  });
}
console.log("Desktop entry installed. Data:", userData);
console.log(
  "Game:",
  snapshot.gamePath,
  "Enabled:",
  snapshot.gameEntries?.length,
);
