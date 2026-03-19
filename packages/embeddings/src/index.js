const DEFAULT_MODEL = "models/gemini-embedding-001";
const DEFAULT_OUTPUT_DIMENSIONALITY = 768;
const DEFAULT_BATCH_SIZE = 32;
const EMBEDDINGS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";

function normalizeModel(model = DEFAULT_MODEL) {
  return model.startsWith("models/") ? model : `models/${model}`;
}

function requireApiKey(explicitApiKey) {
  const apiKey =
    explicitApiKey ??
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_API_KEY ??
    "";

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY or GOOGLE_API_KEY for Gemini embeddings.");
  }

  return apiKey;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toContent(text) {
  return {
    parts: [{ text }]
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Gemini returned non-JSON response (${response.status}): ${text}`);
  }
}

export class GeminiEmbeddingClient {
  constructor(options = {}) {
    this.apiKey = requireApiKey(options.apiKey);
    this.model = normalizeModel(options.model);
    this.outputDimensionality =
      Number.isInteger(options.outputDimensionality) && options.outputDimensionality > 0
        ? options.outputDimensionality
        : DEFAULT_OUTPUT_DIMENSIONALITY;
    this.batchSize =
      Number.isInteger(options.batchSize) && options.batchSize > 0
        ? options.batchSize
        : DEFAULT_BATCH_SIZE;
  }

  async embedDocuments(items) {
    return this.#embedMany(items, "RETRIEVAL_DOCUMENT");
  }

  async embedQueries(items) {
    return this.#embedMany(items, "RETRIEVAL_QUERY");
  }

  async embedQuery(text) {
    const [embedding] = await this.embedQueries([{ text }]);
    return embedding;
  }

  async #embedMany(items, taskType) {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    const batches = chunk(items, this.batchSize);
    const embeddings = [];

    for (const batch of batches) {
      const payload = {
        requests: batch.map((item) => ({
          model: this.model,
          content: toContent(item.text),
          taskType,
          outputDimensionality: this.outputDimensionality,
          ...(item.title ? { title: item.title } : {})
        }))
      };

      const response = await fetch(`${EMBEDDINGS_ENDPOINT}/${this.model}:batchEmbedContents`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey
        },
        body: JSON.stringify(payload)
      });

      const body = await parseJsonResponse(response);
      if (!response.ok) {
        const detail = body?.error?.message ?? JSON.stringify(body);
        throw new Error(`Gemini embeddings request failed (${response.status}): ${detail}`);
      }

      for (const result of body.embeddings ?? []) {
        embeddings.push(result?.values ?? []);
      }
    }

    return embeddings;
  }
}

export function createGeminiEmbeddingClient(options = {}) {
  return new GeminiEmbeddingClient(options);
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length === 0) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (!leftMagnitude || !rightMagnitude) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export const geminiEmbeddingDefaults = {
  batchSize: DEFAULT_BATCH_SIZE,
  model: DEFAULT_MODEL,
  outputDimensionality: DEFAULT_OUTPUT_DIMENSIONALITY
};
