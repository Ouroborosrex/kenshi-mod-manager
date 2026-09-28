import { execFileSync } from "node:child_process";
import fs from "node:fs";
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
let commit = "unknown";
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  if (process.env.CI) throw new Error("Release builds require a Git checkout.");
}
fs.writeFileSync(
  "electron/build-info.json",
  JSON.stringify({ version: pkg.version, commit }, null, 2) + "\n",
);
console.log(`Kenshi Mod Manager v${pkg.version} (${commit.slice(0, 7)})`);
