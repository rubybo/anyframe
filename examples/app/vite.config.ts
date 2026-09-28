import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { anyframe } from "../../src/vite.ts";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [anyframe()],
  resolve: {
    alias: {
      anyframe: path.resolve(root, "../../src/index.ts"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 43123,
    strictPort: true,
    fs: {
      allow: [path.resolve(root, "../..")],
    },
  },
});
