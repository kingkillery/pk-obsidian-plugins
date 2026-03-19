#!/usr/bin/env node

import http from "node:http";

import {
  discoverVaults,
  indexAllVaults,
  route,
  scanRoot,
  searchIndex,
  statePath
} from "../apps/index-service/src/server.js";

const args = process.argv.slice(2);
const command = args[0] || "help";

function getFlagValue(flag) {
  const index = args.indexOf(flag);
  return index !== -1 ? args[index + 1] : undefined;
}

function printHelp() {
  console.log(
    [
      "pk-qmd",
      "",
      "Commands:",
      "  pk-qmd discover",
      "  pk-qmd index",
      "  pk-qmd search <query> [--top-k N] [--vault PATH]",
      "  pk-qmd serve [--port N]",
      "  pk-qmd status",
      "",
      `Default scan root: ${scanRoot}`,
      `Index state path: ${statePath}`
    ].join("\n")
  );
}

async function main() {
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "discover") {
    const vaults = await discoverVaults();
    console.log(JSON.stringify({ ok: true, rootPath: scanRoot, vaults }, null, 2));
    return;
  }

  if (command === "index") {
    const result = await indexAllVaults();
    console.log(
      JSON.stringify(
        {
          ok: true,
          job: result.job,
          storagePath: statePath,
          vaults: result.state.vaults
        },
        null,
        2
      )
    );
    return;
  }

  if (command === "search") {
    const topK = getFlagValue("--top-k");
    const vaultPath = getFlagValue("--vault");
    const query = args
      .slice(1)
      .filter((value, index, all) => {
        const current = all[index];
        const previous = all[index - 1];
        return current !== "--top-k" && current !== "--vault" && previous !== "--top-k" && previous !== "--vault";
      })
      .join(" ")
      .trim();

    const result = await searchIndex({
      query,
      topK: topK ? Number(topK) : undefined,
      vaultPath
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "serve") {
    const port = Number(getFlagValue("--port") || process.env.PORT || 4317);
    const server = http.createServer(route);
    server.listen(port, () => {
      console.log(`pk-qmd listening on http://localhost:${port}`);
    });
    return;
  }

  if (command === "status") {
    console.log(
      JSON.stringify(
        {
          ok: true,
          rootPath: scanRoot,
          statePath
        },
        null,
        2
      )
    );
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
