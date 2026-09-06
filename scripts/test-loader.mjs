// Shared TypeScript loader for regression tests; no extra runtime dependencies.
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = pathToFileURL(`${root}/src/`).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    let base;
    if (specifier.startsWith("@/")) base = resolve(root, "src", specifier.slice(2));
    else if (specifier.startsWith(".") && context.parentURL?.startsWith(sourceRoot)) base = fileURLToPath(new URL(specifier, context.parentURL));
    if (base) {
      const path = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((p) => existsSync(p) && /\.tsx?$/.test(p));
      if (path) return nextResolve(pathToFileURL(path).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot) && /\.tsx?$/.test(url)) {
      const source = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      }).outputText;
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

