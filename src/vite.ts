import type { Plugin } from "vite";
import { compile } from "./compiler/compile.ts";

/** Vite plugin: compile `*.frame` files and reload the page on change. */
export function anyframe(): Plugin {
  return {
    name: "anyframe",
    enforce: "pre",
    async transform(code, id) {
      const filename = id.split("?", 1)[0] ?? id;
      if (!filename.endsWith(".frame")) return null;
      return {
        code: await compile(code, filename),
        map: { mappings: "" },
      };
    },
    handleHotUpdate(context) {
      if (!context.file.endsWith(".frame")) return;
      context.server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
