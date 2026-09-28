import { transform } from "esbuild";
import { generateModule, splitScript } from "./codegen.ts";
import { parseFrame } from "./parse.ts";

/** Compile a `.frame` component to a JavaScript module. */
export async function compile(source: string, filename = "Component.frame"): Promise<string> {
  const parsed = parseFrame(source, filename);
  let script = parsed.script;
  if (script.trim()) {
    const result = await transform(script, {
      loader: "ts",
      format: "esm",
      target: "es2022",
      sourcefile: filename,
      // Component imports are only referenced from the template, which esbuild never sees.
      tsconfigRaw: {
        compilerOptions: {
          preserveValueImports: true,
        },
      },
    });
    script = result.code.replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "");
  }
  return generateModule({
    template: parsed.template,
    script: splitScript(script, filename),
    css: parsed.css,
    filename,
    source: parsed.source,
  });
}
