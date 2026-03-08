import { ItemView, Notice, WorkspaceLeaf } from "obsidian";

import type CodexMounterPlugin from "./main";
import type { HelperStatusSnapshot, StageBounds } from "./types";
import { VIEW_TYPE_CODEX_MOUNTER } from "./types";

const BOUNDS_SYNC_DEBOUNCE_MS = 100;

export class CodexMounterView extends ItemView {
  private statusEl!: HTMLDivElement;
  private shellEl!: HTMLDivElement;
  private overlayTitleEl!: HTMLHeadingElement;
  private overlayBodyEl!: HTMLParagraphElement;
  private stageEl!: HTMLDivElement;
  private mountButtonEl!: HTMLButtonElement;
  private unmountButtonEl!: HTMLButtonElement;
  private unsubscribe: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private boundsTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: CodexMounterPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_CODEX_MOUNTER;
  }

  getDisplayText(): string {
    return "Codex";
  }

  async onOpen(): Promise<void> {
    this.renderShell();
    this.unsubscribe = this.plugin.backendManager.subscribe((snapshot) => {
      this.applySnapshot(snapshot);
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.queueBoundsSync();
    });
    this.resizeObserver.observe(this.contentEl);

    window.addEventListener("resize", this.onWindowResize);
    this.registerEvent(this.app.workspace.on("layout-change", this.queueBoundsSync));
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener("resize", this.onWindowResize);

    if (this.boundsTimer !== null) {
      window.clearTimeout(this.boundsTimer);
      this.boundsTimer = null;
    }

    try {
      await this.plugin.backendManager.unmount();
    } catch {
      // Ignore close-time cleanup errors.
    }
  }

  async mountCodex(): Promise<void> {
    const bounds = this.getStageBounds();
    await this.plugin.backendManager.mount(bounds);
    this.queueBoundsSync();
  }

  async unmountCodex(): Promise<void> {
    await this.plugin.backendManager.unmount();
  }

  private renderShell(): void {
    this.contentEl.empty();
    this.contentEl.addClass("codex-mounter-root");

    const toolbarEl = this.contentEl.createDiv({ cls: "codex-mounter-toolbar" });
    this.statusEl = toolbarEl.createDiv({ cls: "codex-mounter-status", text: "Idle" });
    const actionsEl = toolbarEl.createDiv({ cls: "codex-mounter-actions" });

    this.mountButtonEl = actionsEl.createEl("button", { text: "Mount" });
    this.mountButtonEl.onclick = async () => {
      try {
        await this.mountCodex();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    };

    this.unmountButtonEl = actionsEl.createEl("button", { text: "Close Codex" });
    this.unmountButtonEl.onclick = async () => {
      try {
        await this.unmountCodex();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    };

    const copyLogsButton = actionsEl.createEl("button", { text: "Copy logs" });
    copyLogsButton.onclick = async () => {
      await navigator.clipboard.writeText(this.plugin.backendManager.getLogs().join("\n"));
      new Notice("Copied Codex helper logs.");
    };

    this.shellEl = this.contentEl.createDiv({ cls: "codex-mounter-shell" });
    this.stageEl = this.shellEl.createDiv({ cls: "codex-mounter-stage" });
    const overlayEl = this.shellEl.createDiv({ cls: "codex-mounter-overlay" });
    this.overlayTitleEl = overlayEl.createEl("h3", { text: "Codex is not mounted" });
    this.overlayBodyEl = overlayEl.createEl("p", {
      text: "Set the Codex executable path, then mount a dedicated Codex window into this tab.",
    });
  }

  private applySnapshot(snapshot: HelperStatusSnapshot): void {
    this.statusEl.setText(this.getStatusLabel(snapshot));
    this.shellEl.toggleClass("is-mounted", snapshot.mounted);
    this.mountButtonEl.disabled = snapshot.state === "mounting" || snapshot.mounted;
    this.unmountButtonEl.disabled = !snapshot.mounted;

    if (snapshot.mounted) {
      this.overlayTitleEl.setText("Codex mounted");
      this.overlayBodyEl.setText(
        `Codex is running inside this tab${snapshot.pid ? ` (pid ${snapshot.pid})` : ""}. Closing this view will close that Codex process.`,
      );
      return;
    }

    switch (snapshot.state) {
      case "mounting":
        this.overlayTitleEl.setText("Mounting Codex");
        this.overlayBodyEl.setText("Launching Codex and attaching its window to this tab.");
        break;
      case "error":
        this.overlayTitleEl.setText("Mount failed");
        this.overlayBodyEl.setText(snapshot.lastError ?? "The Codex helper reported an error.");
        break;
      case "ready":
        this.overlayTitleEl.setText("Ready to mount");
        this.overlayBodyEl.setText("The helper is ready. Press Mount to launch Codex into this tab.");
        break;
      default:
        this.overlayTitleEl.setText("Codex is not mounted");
        this.overlayBodyEl.setText(
          "This tab is just the container. Mount starts a dedicated Codex app process and places it here.",
        );
        break;
    }
  }

  private getStatusLabel(snapshot: HelperStatusSnapshot): string {
    switch (snapshot.state) {
      case "starting":
        return "Starting helper";
      case "ready":
        return "Ready";
      case "mounting":
        return "Mounting";
      case "mounted":
        return `Mounted${snapshot.pid ? ` · ${snapshot.pid}` : ""}`;
      case "error":
        return "Error";
      case "stopped":
        return "Stopped";
      default:
        return "Idle";
    }
  }

  private readonly queueBoundsSync = () => {
    if (this.boundsTimer !== null) {
      window.clearTimeout(this.boundsTimer);
    }

    this.boundsTimer = window.setTimeout(async () => {
      this.boundsTimer = null;
      try {
        await this.plugin.backendManager.updateBounds(this.getStageBounds());
      } catch {
        // Ignore transient resize failures; helper status will show hard failures.
      }
    }, BOUNDS_SYNC_DEBOUNCE_MS);
  };

  private readonly onWindowResize = () => {
    this.queueBoundsSync();
  };

  private getStageBounds(): StageBounds {
    const rect = this.stageEl.getBoundingClientRect();
    const frameX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
    const frameY = Math.max(0, window.outerHeight - window.innerHeight - frameX);

    return {
      x: Math.round(window.screenX + frameX + rect.left),
      y: Math.round(window.screenY + frameY + rect.top),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
  }
}
