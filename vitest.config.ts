import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { anyframe } from "./src/vite.ts";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [anyframe()],
  resolve: {
    alias: {
      anyframe: path.resolve(root, "src/index.ts"),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
  },
});
