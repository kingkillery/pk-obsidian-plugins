import { requestUrl, type RequestUrlResponse } from "obsidian";

import type {
  DocContent,
  DocListItem,
  FunctionDraft,
  FunctionMutationResponse,
  FunctionRecord,
  FunctionsListResponse,
  LogEntry,
  LogSource,
  SourceLogsResponse
} from "./types";

export interface ClientConfig {
  apiBaseUrl: string;
  apiToken: string;
}

export class InsForgeApiClient {
  constructor(private readonly config: ClientConfig) {}

  async healthCheck(): Promise<{
    status?: string;
    version?: string;
    service?: string;
  }> {
    return this.request("/api/health");
  }

  async listDocs(): Promise<DocListItem[]> {
    return this.request("/api/docs");
  }

  async getDocByEndpoint(endpoint: string): Promise<DocContent> {
    return this.request(endpoint);
  }

  async getLogSources(): Promise<LogSource[]> {
    return this.request("/api/logs/sources");
  }

  async getLogsBySource(source: string, limit: number): Promise<SourceLogsResponse> {
    return this.request(`/api/logs/${encodeURIComponent(source)}?limit=${limit}`);
  }

  async searchLogs(query: string, source: string | null, limit: number): Promise<LogEntry[]> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (source) {
      params.set("source", source);
    }
    return this.request(`/api/logs/search?${params.toString()}`);
  }

  async listFunctions(): Promise<FunctionsListResponse> {
    return this.request("/api/functions");
  }

  async getFunction(slug: string): Promise<FunctionRecord> {
    return this.request(`/api/functions/${encodeURIComponent(slug)}`);
  }

  async createFunction(draft: FunctionDraft): Promise<FunctionMutationResponse> {
    return this.request("/api/functions", {
      method: "POST",
      body: {
        name: draft.name,
        slug: draft.slug,
        description: draft.description || undefined,
        code: draft.code,
        status: draft.status
      }
    });
  }

  async updateFunction(slug: string, draft: FunctionDraft): Promise<FunctionMutationResponse> {
    return this.request(`/api/functions/${encodeURIComponent(slug)}`, {
      method: "PUT",
      body: {
        name: draft.name,
        description: draft.description || undefined,
        code: draft.code,
        status: draft.status
      }
    });
  }

  private async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
    } = {}
  ): Promise<T> {
    const response = await requestUrl({
      url: this.buildUrl(path),
      method: options.method ?? "GET",
      headers: this.getHeaders(),
      contentType: options.body ? "application/json" : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      throw: false
    });

    if (response.status >= 400) {
      throw new Error(this.getErrorMessage(response));
    }

    return response.json as T;
  }

  private buildUrl(path: string): string {
    return new URL(path, this.config.apiBaseUrl).toString();
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const token = this.config.apiToken.trim();

    if (!token) {
      return headers;
    }

    headers.Authorization = `Bearer ${token}`;
    if (token.startsWith("ik_")) {
      headers["x-api-key"] = token;
    }

    return headers;
  }

  private getErrorMessage(response: RequestUrlResponse): string {
    const fallback = `HTTP ${response.status}`;

    if (!response.text) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(response.text) as { error?: string; message?: string };
      return parsed.message ?? parsed.error ?? fallback;
    } catch {
      return response.text;
    }
  }
}
