export const VIEW_TYPE_CODEX_MOUNTER = "codex-mounter-view";

export type HelperState =
  | "idle"
  | "starting"
  | "ready"
  | "mounting"
  | "mounted"
  | "stopped"
  | "error";

export interface PluginSettings {
  codexExecutablePath: string;
  launchArguments: string;
  attachTimeoutMs: number;
  reuseExistingTab: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  codexExecutablePath: "",
  launchArguments: "",
  attachTimeoutMs: 15000,
  reuseExistingTab: true,
};

export interface HelperReadyMessage {
  ready: boolean;
  port: number;
  version?: string;
}

export interface StageBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HelperStatusSnapshot {
  state: HelperState;
  port: number | null;
  baseUrl: string | null;
  version: string | null;
  pid: number | null;
  mounted: boolean;
  lastError: string | null;
  logs: string[];
}

export type HelperStatusListener = (snapshot: HelperStatusSnapshot) => void;

export interface MountResponse {
  pid: number;
  mounted: boolean;
}

export interface HelperStatusResponse {
  state: string;
  pid: number;
  mounted: boolean;
  lastError?: string;
}
