import esbuild from "esbuild";
import process from "node:process";

const production = process.argv.includes("production");

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  platform: "node",
  target: "es2020",
  sourcemap: production ? false : "inline",
  sourcesContent: !production,
  treeShaking: true,
  outfile: "main.js",
  logLevel: "info",
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
