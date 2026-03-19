export interface InsForgeSettings {
  apiBaseUrl: string;
  dashboardUrl: string;
  apiToken: string;
  knowledgeBaseFolder: string;
  defaultLogLimit: number;
}

export const DEFAULT_SETTINGS: InsForgeSettings = {
  apiBaseUrl: "http://localhost:7130",
  dashboardUrl: "http://localhost:7130",
  apiToken: "",
  knowledgeBaseFolder: "InsForge Knowledge",
  defaultLogLimit: 50
};

export interface InsForgeContext {
  title: string;
  filePath: string | null;
  noteContent: string;
  selection: string;
  capturedAt: string;
  source: "note" | "selection";
}

export interface DocListItem {
  type: string;
  filename: string;
  endpoint: string;
}

export interface DocContent {
  type: string;
  content: string;
}

export interface LogSource {
  id: string;
  name: string;
  token: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  eventMessage?: string;
  body?: unknown;
  source?: string;
}

export interface SourceLogsResponse {
  logs: LogEntry[];
  total: number;
}

export interface FunctionRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  code: string;
  status: "draft" | "active" | "error";
  createdAt: string;
  updatedAt: string;
  deployedAt: string | null;
}

export interface FunctionDraft {
  name: string;
  slug: string;
  description: string;
  code: string;
  status: "draft" | "active";
}

export interface FunctionsListResponse {
  functions: FunctionRecord[];
  runtime: {
    status: "running" | "unavailable";
  };
  deploymentUrl?: string | null;
}

export interface FunctionMutationResponse {
  success: true;
  function: FunctionRecord;
  deployment?: {
    id: string;
    status: "success" | "failed";
    url: string | null;
    buildLogs?: string[];
  } | null;
}
