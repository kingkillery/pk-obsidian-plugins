import { requestUrl } from "obsidian";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";

import type {
  HelperReadyMessage,
  HelperState,
  HelperStatusListener,
  HelperStatusResponse,
  HelperStatusSnapshot,
  MountResponse,
  PluginSettings,
  StageBounds,
} from "./types";

const START_TIMEOUT_MS = 15000;
const STOP_TIMEOUT_MS = 3000;
const MAX_LOG_LINES = 250;

export interface BackendManagerOptions {
  pluginDir: string;
  getSettings: () => PluginSettings;
}

export class BackendManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private state: HelperState = "idle";
  private port: number | null = null;
  private version: string | null = null;
  private pid: number | null = null;
  private mounted = false;
  private lastError: string | null = null;
  private logs: string[] = [];
  private listeners = new Set<HelperStatusListener>();
  private startPromise: Promise<HelperStatusSnapshot> | null = null;
  private stdoutBuffer = "";
  private readyResolve: ((value: HelperReadyMessage) => void) | null = null;
  private readyReject: ((reason?: unknown) => void) | null = null;
  private readyTimer: number | null = null;

  constructor(private readonly options: BackendManagerOptions) {}

  subscribe(listener: HelperStatusListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): HelperStatusSnapshot {
    return {
      state: this.state,
      port: this.port,
      baseUrl: this.getBaseUrl(),
      version: this.version,
      pid: this.pid,
      mounted: this.mounted,
      lastError: this.lastError,
      logs: [...this.logs],
    };
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  getBaseUrl(): string | null {
    return this.port ? `http://127.0.0.1:${this.port}` : null;
  }

  async start(): Promise<HelperStatusSnapshot> {
    if (this.child && (this.state === "ready" || this.state === "mounted")) {
      return this.getSnapshot();
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async mount(bounds: StageBounds): Promise<HelperStatusSnapshot> {
    const settings = this.options.getSettings();
    const executablePath = settings.codexExecutablePath.trim();
    if (!executablePath) {
      throw new Error("Set the Codex executable path in the plugin settings.");
    }

    await this.start();
    this.setState("mounting", null);

    const response = await this.requestJson<MountResponse>("/mount", {
      executablePath,
      launchArgs: splitLaunchArguments(settings.launchArguments),
      bounds,
      attachTimeoutMs: settings.attachTimeoutMs,
    });

    this.pid = response.pid;
    this.mounted = response.mounted;
    this.setState("mounted", null);
    return this.refreshStatus();
  }

  async updateBounds(bounds: StageBounds): Promise<void> {
    if (!this.child || !this.mounted) {
      return;
    }

    await this.requestJson("/bounds", { bounds });
  }

  async unmount(): Promise<HelperStatusSnapshot> {
    if (!this.child || !this.port) {
      this.mounted = false;
      this.pid = null;
      this.setState("stopped", null);
      return this.getSnapshot();
    }

    try {
      await this.requestJson("/unmount", {});
    } catch (error) {
      this.appendLog("system", `Unmount request failed: ${error instanceof Error ? error.message : String(error)}.`);
      this.resetRuntime();
      this.setState("stopped", null);
      return this.getSnapshot();
    }

    this.mounted = false;
    this.pid = null;
    this.setState("ready", null);
    return this.refreshStatus();
  }

  async stop(): Promise<void> {
    if (!this.child) {
      this.resetRuntime();
      this.setState("stopped", null);
      return;
    }

    this.clearReadyWaiter();

    try {
      if (this.port) {
        await this.requestJson("/shutdown", {});
      }
    } catch {
      // Ignore shutdown errors and fall back to killing the helper.
    }

    const child = this.child;
    await new Promise<void>((resolve) => {
      let settled = false;

      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        child.removeListener("exit", onExit);
        resolve();
      };

      const onExit = () => finish();
      const timer = window.setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Ignore.
        }
        finish();
      }, STOP_TIMEOUT_MS);

      child.once("exit", onExit);

      try {
        child.kill("SIGTERM");
      } catch {
        finish();
      }
    });

    this.child = null;
    this.resetRuntime();
    this.setState("stopped", null);
  }

  async refreshStatus(): Promise<HelperStatusSnapshot> {
    if (!this.child || !this.port) {
      return this.getSnapshot();
    }

    const response = await this.requestJson<HelperStatusResponse>("/status", undefined, "GET");
    this.pid = response.pid > 0 ? response.pid : null;
    this.mounted = response.mounted;
    this.lastError = response.lastError ?? null;

    if (!this.mounted && this.state === "mounted") {
      this.setState("ready", this.lastError);
    } else {
      this.notify();
    }

    return this.getSnapshot();
  }

  private async startInternal(): Promise<HelperStatusSnapshot> {
    const executablePath = this.resolveHelperExecutablePath();
    this.appendLog("system", `Starting helper: ${executablePath}`);
    this.resetRuntime();
    this.setState("starting", null);

    const child = spawn(executablePath, [], {
      cwd: this.options.pluginDir,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.child = child;

    child.stdout.on("data", (chunk: Buffer | string) => {
      this.handleStdoutChunk(chunk.toString());
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      this.appendLog("stderr", chunk.toString());
    });

    child.once("error", (error) => {
      this.fail(error.message);
    });

    child.once("exit", (code, signal) => {
      this.appendLog("system", `Helper exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`);
      this.child = null;
      this.resetRuntime();
      if (this.readyReject) {
        this.readyReject(new Error("Helper exited before ready."));
      } else {
        this.setState("stopped", this.lastError);
      }
    });

    const ready = await this.waitForReady();
    this.port = ready.port;
    this.version = ready.version ?? null;
    this.setState("ready", null);
    return this.refreshStatus();
  }

  private resolveHelperExecutablePath(): string {
    const executableName = process.platform === "win32" ? "codex-mounter.exe" : "codex-mounter";
    return join(this.options.pluginDir, "bin", executableName);
  }

  private waitForReady(): Promise<HelperReadyMessage> {
    return new Promise<HelperReadyMessage>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.readyTimer = window.setTimeout(() => {
        reject(new Error(`Timed out waiting for helper after ${START_TIMEOUT_MS}ms.`));
      }, START_TIMEOUT_MS);
    })
      .then((message) => {
        this.clearReadyWaiter();
        return message;
      })
      .catch((error) => {
        this.clearReadyWaiter();
        this.fail(error instanceof Error ? error.message : String(error));
        throw error;
      });
  }

  private handleStdoutChunk(chunk: string): void {
    this.stdoutBuffer += chunk;

    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

      if (line) {
        this.appendLog("stdout", line);
        this.maybeResolveReady(line);
      }

      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  private maybeResolveReady(line: string): void {
    if (!this.readyResolve) {
      return;
    }

    try {
      const parsed = JSON.parse(line) as Partial<HelperReadyMessage>;
      if (parsed.ready === true && typeof parsed.port === "number") {
        this.readyResolve({
          ready: true,
          port: parsed.port,
          version: typeof parsed.version === "string" ? parsed.version : undefined,
        });
      }
    } catch {
      // Ignore non-ready stdout lines.
    }
  }

  private clearReadyWaiter(): void {
    if (this.readyTimer !== null) {
      window.clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }

    this.readyResolve = null;
    this.readyReject = null;
  }

  private async requestJson<T = Record<string, unknown>>(
    path: string,
    body?: Record<string, unknown>,
    method: "GET" | "POST" = "POST",
  ): Promise<T> {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      throw new Error("Helper is not running.");
    }

    const response = await requestUrl({
      url: `${baseUrl}${path}`,
      method,
      body: body ? JSON.stringify(body) : undefined,
      contentType: "application/json",
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      const text = response.text || `Request failed with status ${response.status}.`;
      this.fail(text);
      throw new Error(text);
    }

    if (!response.text) {
      return {} as T;
    }

    return JSON.parse(response.text) as T;
  }

  private resetRuntime(): void {
    this.port = null;
    this.version = null;
    this.pid = null;
    this.mounted = false;
  }

  private fail(message: string): void {
    this.resetRuntime();
    this.setState("error", message);
  }

  private setState(state: HelperState, lastError: string | null): void {
    this.state = state;
    this.lastError = lastError;
    this.notify();
  }

  private appendLog(channel: "stdout" | "stderr" | "system", value: string): void {
    const lines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `[${channel}] ${line}`);

    if (!lines.length) {
      return;
    }

    this.logs.push(...lines);
    if (this.logs.length > MAX_LOG_LINES) {
      this.logs = this.logs.slice(this.logs.length - MAX_LOG_LINES);
    }
    this.notify();
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

function splitLaunchArguments(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const matches = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((part) => part.replace(/^"(.*)"$/, "$1"));
}
