import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { XMLParser } from "fast-xml-parser";
import { BASE, key } from "./order.mjs";

export function parseHeader(data) {
  let cursor = 0;
  const uint = () => {
    if (cursor + 4 > data.length) throw new Error("Truncated mod header");
    const n = data.readUInt32LE(cursor);
    cursor += 4;
    return n;
  };
  const string = () => {
    const length = uint();
    if (length > 1024 * 1024 || cursor + length > data.length)
      throw new Error("Invalid mod header string");
    const s = new TextDecoder("utf-8", { fatal: true }).decode(
      data.subarray(cursor, cursor + length),
    );
    cursor += length;
    return s;
  };
  const format = uint();
  if (![16, 17].includes(format))
    throw new Error(`Unsupported mod header format ${format}`);
  const headerValue = uint();
  const version = format === 17 ? uint() : headerValue;
  const author = string(),
    description = string();
  const names = (value) => [
    ...new Set(
      value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && !BASE.has(key(s))),
    ),
  ];
  return {
    format,
    version,
    author,
    description,
    dependencies: names(string()),
    references: names(string()),
  };
}
async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
export function steamRoots({
  platform = process.platform,
  home = os.homedir(),
  env = process.env,
  registryPath,
} = {}) {
  if (platform === "win32")
    return [
      ...new Set(
        [
          registryPath,
          path.win32.join(
            env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
            "Steam",
          ),
          path.win32.join(env.ProgramFiles || "C:\\Program Files", "Steam"),
        ].filter(Boolean),
      ),
    ];
  return [
    path.join(env.XDG_DATA_HOME || path.join(home, ".local/share"), "Steam"),
    path.join(home, ".steam/steam"),
    path.join(home, ".var/app/com.valvesoftware.Steam/.local/share/Steam"),
  ];
}
export async function discoverGame({ roots } = {}) {
  if (!roots) {
    let registryPath;
    if (process.platform === "win32") {
      try {
        const { stdout } = await promisify(execFile)(
          "reg",
          ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"],
          { timeout: 3000, windowsHide: true },
        );
        registryPath = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i)?.[1].trim();
      } catch {
        /* Standard install paths and manual selection remain available. */
      }
    }
    roots = steamRoots({ registryPath });
  }
  const libraries = new Set(roots);
  for (const root of roots) {
    try {
      const vdf = await fs.readFile(
        path.join(root, "steamapps/libraryfolders.vdf"),
        "utf8",
      );
      for (const match of vdf.matchAll(/"path"\s+"([^"]+)"/g))
        libraries.add(match[1].replace(/\\\\/g, "\\"));
    } catch {
      /* Optional Steam root. */
    }
  }
  for (const root of libraries) {
    const game = path.join(root, "steamapps/common/Kenshi");
    if (await exists(path.join(game, "data/mods.cfg"))) return game;
  }
  return null;
}
export async function scanLibrary(gamePath) {
  const roots = [
    {
      folder: path.resolve(gamePath, "../../workshop/content/233860"),
      source: "Workshop",
    },
    { folder: path.join(gamePath, "mods"), source: "Local" },
  ];
  // Support case-sensitive non-Steam installs without duplicating a same-directory alias.
  try {
    const local = (await fs.readdir(gamePath)).find(
      (n) => n.toLowerCase() === "mods",
    );
    if (local) roots[1].folder = path.join(gamePath, local);
  } catch {
    /* Validation occurs on config read. */
  }
  const found = new Map(),
    warnings = [];
  for (const { folder, source } of roots) {
    let dirs;
    try {
      dirs = await fs.readdir(folder, { withFileTypes: true });
    } catch (error) {
      warnings.push(`${source} folder unavailable: ${folder} (${error.code})`);
      continue;
    }
    for (const dir of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!dir.isDirectory() && !dir.isSymbolicLink()) continue;
      const directory = path.join(folder, dir.name);
      let files;
      try {
        files = await fs.readdir(directory);
      } catch {
        warnings.push(`Could not read ${directory}`);
        continue;
      }
      let title = "";
      const info = files.find((n) => n.toLowerCase().endsWith(".info"));
      if (info)
        try {
          const stat = await fs.stat(path.join(directory, info));
          if (stat.size < 1024 * 1024) {
            const parsed = new XMLParser().parse(
              await fs.readFile(path.join(directory, info), "utf8"),
            );
            const root = Object.values(parsed).find(
              (v) => v && typeof v === "object",
            );
            title = typeof root?.title === "string" ? root.title : "";
          }
        } catch {
          /* Binary header still provides core metadata. */
        }
      for (const file of files
        .filter((n) => n.toLowerCase().endsWith(".mod"))
        .sort()) {
        const filePath = path.join(directory, file);
        const id = key(file);
        const mod = {
          id,
          name: file,
          title,
          source,
          path: filePath,
          workshopId:
            source === "Workshop" && /^\d+$/.test(dir.name) ? dir.name : null,
          dependencies: [],
          references: [],
          description: "",
          author: "",
          duplicates: [],
        };
        let handle;
        try {
          handle = await fs.open(filePath, "r");
          const stat = await handle.stat();
          const buffer = Buffer.alloc(Math.min(stat.size, 1024 * 1024));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          Object.assign(mod, parseHeader(buffer.subarray(0, bytesRead)), {
            size: stat.size,
          });
        } catch (error) {
          mod.error = `Metadata unavailable: ${error.message}`;
        } finally {
          await handle?.close();
        }
        const existing = found.get(id);
        if (existing)
          mod.duplicates = [
            ...existing.duplicates,
            { path: existing.path, source: existing.source },
          ];
        found.set(id, mod);
      }
    }
  }
  return {
    mods: [...found.values()].sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
  };
}
