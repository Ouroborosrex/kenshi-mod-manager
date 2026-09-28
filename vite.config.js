import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
const build = JSON.parse(
  fs.readFileSync(
    new URL("./electron/build-info.json", import.meta.url),
    "utf8",
  ),
);
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(build.version),
    __APP_COMMIT__: JSON.stringify(build.commit),
  },
  build: { target: "es2022" },
});
