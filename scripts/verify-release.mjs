import { execFileSync } from "node:child_process";
import fs from "node:fs";
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const tag = process.env.RELEASE_TAG;
if (tag !== `v${pkg.version}`)
  throw new Error(`Release tag must be v${pkg.version}; received ${tag}`);
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const tagged = execFileSync("git", ["rev-parse", `${tag}^{commit}`], {
  encoding: "utf8",
}).trim();
if (head !== tagged) throw new Error("Checkout does not match release tag.");
console.log(`Releasing ${tag} from ${head}`);
