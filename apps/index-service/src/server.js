import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cosineSimilarity,
  createGeminiEmbeddingClient,
  geminiEmbeddingDefaults
} from "../../../packages/embeddings/src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const port = Number(process.env.PORT || 4317);
const scanRoot = path.resolve(process.env.OBSIDIAN_VAULT_SCAN_ROOT || repoRoot);
const dataRoot = path.resolve(
  process.env.INDEX_SERVICE_DATA_DIR ||
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".local"), "pk-qmd-obsidian", "index-service")
);
const statePath = path.join(dataRoot, "index-state.json");
const maxFileBytes = Number(process.env.MAX_EMBED_FILE_BYTES || 512 * 1024);
const maxChunkChars = Number(process.env.MAX_EMBED_CHUNK_CHARS || 1400);
const chunkOverlapChars = Number(process.env.EMBED_CHUNK_OVERLAP_CHARS || 180);
const configuredEmbeddingModel = process.env.GEMINI_EMBED_MODEL || geminiEmbeddingDefaults.model;
const configuredOutputDimensionality = Number.isFinite(Number(process.env.GEMINI_OUTPUT_DIMENSIONALITY))
  ? Number(process.env.GEMINI_OUTPUT_DIMENSIONALITY)
  : geminiEmbeddingDefaults.outputDimensionality;
const maxSearchResults = 50;
const indexableExtensions = new Set([".canvas", ".markdown", ".md", ".txt"]);
const ignoredDirectoryNames = new Set([
  ".git",
  ".obsidian",
  ".quartz-cache",
  ".trash",
  "node_modules"
]);

let lastState = null;
let lastJob = null;

function nowIso() {
  return new Date().toISOString();
}

function stableId(prefix, ...parts) {
  const hash = crypto.createHash("sha256");
  hash.update(prefix);
  for (const part of parts) {
    hash.update("\0");
    hash.update(String(part));
  }
  return `${prefix}_${hash.digest("hex").slice(0, 20)}`;
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function isLikelyNestedPluginVault(targetPath) {
  const marker = `${path.sep}.obsidian${path.sep}plugins${path.sep}`;
  return targetPath.includes(marker);
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDataDir() {
  await fs.mkdir(dataRoot, { recursive: true });
}

async function loadState() {
  if (lastState) {
    return lastState;
  }

  try {
    const content = await fs.readFile(statePath, "utf8");
    lastState = JSON.parse(content);
    return lastState;
  } catch {
    return null;
  }
}

async function saveState(state) {
  await ensureDataDir();
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  lastState = state;
}

function normalizeVaultName(vaultPath) {
  return path.basename(vaultPath);
}

async function discoverVaults(rootPath = scanRoot) {
  const discovered = [];
  const seen = new Set();

  async function walk(currentPath) {
    let entries;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    const hasVaultMarker = entries.some((entry) => entry.isDirectory() && entry.name === ".obsidian");
    if (hasVaultMarker && !isLikelyNestedPluginVault(currentPath) && !seen.has(currentPath)) {
      seen.add(currentPath);
      discovered.push({
        name: normalizeVaultName(currentPath),
        path: currentPath
      });
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (ignoredDirectoryNames.has(entry.name)) {
        continue;
      }

      const childPath = path.join(currentPath, entry.name);
      if (isLikelyNestedPluginVault(childPath)) {
        continue;
      }

      await walk(childPath);
    }
  }

  await walk(rootPath);
  return discovered.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectVaultDocuments(vault) {
  const documents = [];

  async function walk(currentPath) {
    let entries;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (ignoredDirectoryNames.has(entry.name)) {
          continue;
        }

        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!indexableExtensions.has(extension)) {
        continue;
      }

      const stats = await fs.stat(absolutePath);
      if (stats.size > maxFileBytes) {
        continue;
      }

      const content = await fs.readFile(absolutePath, "utf8");
      if (!content.trim()) {
        continue;
      }

      documents.push({
        absolutePath,
        content,
        contentHash: sha256(content),
        extension,
        modifiedAt: stats.mtime.toISOString(),
        relativePath: path.relative(vault.path, absolutePath).replaceAll("\\", "/"),
        sizeBytes: stats.size,
        vaultName: vault.name,
        vaultPath: vault.path
      });
    }
  }

  await walk(vault.path);
  return documents.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function chunkText(content) {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks = [];
  let buffer = "";

  const pushBuffer = () => {
    const trimmed = buffer.trim();
    if (trimmed) {
      chunks.push(trimmed);
    }
    buffer = "";
  };

  for (const paragraph of paragraphs) {
    const next = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (next.length <= maxChunkChars) {
      buffer = next;
      continue;
    }

    pushBuffer();

    if (paragraph.length <= maxChunkChars) {
      buffer = paragraph;
      continue;
    }

    let cursor = 0;
    while (cursor < paragraph.length) {
      const end = Math.min(paragraph.length, cursor + maxChunkChars);
      chunks.push(paragraph.slice(cursor, end).trim());
      if (end === paragraph.length) {
        break;
      }
      cursor = Math.max(end - chunkOverlapChars, cursor + 1);
    }
  }

  pushBuffer();
  return chunks;
}

function buildSegmentTitle(document) {
  return `${document.vaultName} :: ${document.relativePath}`;
}

function buildIndexPayload(vaults, documents, previousSegmentsById) {
  const nextDocuments = [];
  const nextSegments = [];
  const segmentsNeedingEmbeddings = [];

  for (const vault of vaults) {
    const vaultDocuments = documents.filter((document) => document.vaultPath === vault.path);

    for (const document of vaultDocuments) {
      const documentId = stableId("doc", document.vaultPath, document.relativePath);
      const chunks = chunkText(document.content);
      const segmentIds = [];

      for (const [ordinal, text] of chunks.entries()) {
        const segmentId = stableId("seg", documentId, document.contentHash, ordinal, text);
        const previous = previousSegmentsById.get(segmentId);
        segmentIds.push(segmentId);

        const segment = {
          id: segmentId,
          documentId,
          ordinal,
          text,
          vector: previous?.vector ?? null,
          title: buildSegmentTitle(document),
          vaultName: document.vaultName,
          vaultPath: document.vaultPath,
          relativePath: document.relativePath
        };

        if (!segment.vector) {
          segmentsNeedingEmbeddings.push(segment);
        }

        nextSegments.push(segment);
      }

      nextDocuments.push({
        id: documentId,
        contentHash: document.contentHash,
        extension: document.extension,
        modifiedAt: document.modifiedAt,
        relativePath: document.relativePath,
        segmentIds,
        sizeBytes: document.sizeBytes,
        title: path.basename(document.relativePath, document.extension),
        vaultName: document.vaultName,
        vaultPath: document.vaultPath
      });
    }
  }

  return { nextDocuments, nextSegments, segmentsNeedingEmbeddings };
}

async function embedSegments(segments, options = {}) {
  if (!segments.length) {
    return { embeddedCount: 0, model: options.model || geminiEmbeddingDefaults.model };
  }

  const client = createGeminiEmbeddingClient(options);
  const vectors = await client.embedDocuments(
    segments.map((segment) => ({
      text: segment.text,
      title: segment.title
    }))
  );

  for (const [index, vector] of vectors.entries()) {
    segments[index].vector = vector;
  }

  return {
    embeddedCount: vectors.length,
    model: client.model,
    outputDimensionality: client.outputDimensionality
  };
}

async function indexAllVaults(options = {}) {
  const startedAt = nowIso();
  const vaults = await discoverVaults(options.rootPath || scanRoot);
  const documentsByVault = await Promise.all(vaults.map((vault) => collectVaultDocuments(vault)));
  const documents = documentsByVault.flat();
  const previousState = await loadState();
  const previousSegmentsById = new Map((previousState?.segments || []).map((segment) => [segment.id, segment]));
  const { nextDocuments, nextSegments, segmentsNeedingEmbeddings } = buildIndexPayload(
    vaults,
    documents,
    previousSegmentsById
  );

  const embeddingSummary = await embedSegments(segmentsNeedingEmbeddings, {
    batchSize: options.batchSize,
    model: options.model || configuredEmbeddingModel,
    outputDimensionality: options.outputDimensionality || configuredOutputDimensionality
  });
  const state = {
    generatedAt: nowIso(),
    rootPath: options.rootPath || scanRoot,
    storage: {
      dataRoot,
      statePath
    },
    embedding: {
      batchSize: options.batchSize || geminiEmbeddingDefaults.batchSize,
      model: embeddingSummary.model,
      outputDimensionality:
        embeddingSummary.outputDimensionality || options.outputDimensionality || configuredOutputDimensionality
    },
    vaults: vaults.map((vault) => ({
      ...vault,
      documentCount: nextDocuments.filter((document) => document.vaultPath === vault.path).length,
      segmentCount: nextSegments.filter((segment) => segment.vaultPath === vault.path).length
    })),
    documents: nextDocuments,
    segments: nextSegments
  };

  await saveState(state);
  lastJob = {
    finishedAt: state.generatedAt,
    startedAt,
    status: "completed",
    summary: {
      documentCount: state.documents.length,
      embeddedCount: embeddingSummary.embeddedCount,
      reusedEmbeddingCount: nextSegments.length - embeddingSummary.embeddedCount,
      segmentCount: state.segments.length,
      vaultCount: state.vaults.length
    }
  };

  return { state, job: lastJob };
}

async function searchIndex(body = {}) {
  const query = String(body.query || "").trim();
  if (!query) {
    throw new Error("Search query is required.");
  }

  const state = await loadState();
  if (!state?.segments?.length) {
    throw new Error("No index is available. Run /index/all first.");
  }

  const client = createGeminiEmbeddingClient({
    batchSize: state.embedding?.batchSize,
    model: body.model || state.embedding?.model,
    outputDimensionality: body.outputDimensionality || state.embedding?.outputDimensionality
  });
  const queryVector = await client.embedQuery(query);
  const topK = Math.min(Number(body.topK || 10), maxSearchResults);
  const vaultFilter = body.vaultPath ? path.resolve(body.vaultPath) : null;

  const scored = state.segments
    .filter((segment) => Array.isArray(segment.vector) && segment.vector.length)
    .filter((segment) => (vaultFilter ? segment.vaultPath === vaultFilter : true))
    .map((segment) => ({
      ...segment,
      score: cosineSimilarity(queryVector, segment.vector)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);

  return {
    model: client.model,
    query,
    results: scored.map((segment) => ({
      documentId: segment.documentId,
      ordinal: segment.ordinal,
      path: path.join(segment.vaultPath, segment.relativePath),
      relativePath: segment.relativePath,
      score: Number(segment.score.toFixed(6)),
      snippet: segment.text.slice(0, 280),
      vaultName: segment.vaultName,
      vaultPath: segment.vaultPath
    }))
  };
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

function summarizeState(state) {
  const jobs = lastJob
    ? [lastJob]
    : state?.generatedAt
      ? [
          {
            finishedAt: state.generatedAt,
            startedAt: state.generatedAt,
            status: "loaded_from_disk",
            summary: {
              documentCount: state.documents?.length || 0,
              embeddedCount: state.segments?.length || 0,
              reusedEmbeddingCount: 0,
              segmentCount: state.segments?.length || 0,
              vaultCount: state.vaults?.length || 0
            }
          }
        ]
      : [];

  return {
    collections: ["segments_text"],
    embedding: state?.embedding || {
      model: configuredEmbeddingModel,
      outputDimensionality: configuredOutputDimensionality
    },
    jobs,
    storage: {
      metadata: "json",
      statePath,
      vector: "json"
    },
    vaults: state?.vaults || []
  };
}

async function route(req, res) {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "index-service",
        rootPath: scanRoot,
        storagePath: statePath
      });
    }

    if (req.method === "GET" && req.url === "/vaults/discover") {
      const vaults = await discoverVaults();
      return sendJson(res, 200, {
        ok: true,
        rootPath: scanRoot,
        vaults
      });
    }

    if (req.method === "GET" && req.url === "/index/status") {
      const state = await loadState();
      return sendJson(res, 200, {
        ok: true,
        ...summarizeState(state)
      });
    }

    if (req.method === "POST" && req.url === "/index/all") {
      const body = await readJsonBody(req);
      const result = await indexAllVaults(body);
      return sendJson(res, 200, {
        ok: true,
        job: result.job,
        ...summarizeState(result.state)
      });
    }

    if (req.method === "POST" && req.url === "/search") {
      const body = await readJsonBody(req);
      const result = await searchIndex(body);
      return sendJson(res, 200, {
        ok: true,
        ...result
      });
    }

    return sendJson(res, 404, { ok: false, error: "not_found", path: req.url });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function runCli() {
  if (process.argv.includes("--discover-vaults")) {
    const vaults = await discoverVaults();
    console.log(JSON.stringify({ rootPath: scanRoot, vaults }, null, 2));
    return true;
  }

  if (process.argv.includes("--index-all")) {
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
    return true;
  }

  return false;
}

const handledByCli = await runCli();

if (!handledByCli) {
  const server = http.createServer(route);
  server.listen(port, () => {
    console.log(`index-service listening on http://localhost:${port}`);
  });
}
