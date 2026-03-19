import builtins from "builtin-modules";
import esbuild from "esbuild";
import process from "process";

const isProduction = process.argv[2] === "production";

esbuild
  .build({
    entryPoints: ["src/main.ts"],
    bundle: true,
    outfile: "main.js",
    format: "cjs",
    target: "es2020",
    minify: isProduction,
    sourcemap: isProduction ? false : "inline",
    logLevel: "info",
    external: [
      "obsidian",
      "electron",
      "@codemirror/autocomplete",
      "@codemirror/collab",
      "@codemirror/commands",
      "@codemirror/language",
      "@codemirror/lint",
      "@codemirror/search",
      "@codemirror/state",
      "@codemirror/view",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/lr",
      ...builtins
    ]
  })
  .catch(() => process.exit(1));
