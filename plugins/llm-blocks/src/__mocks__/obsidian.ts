/**
 * Minimal Obsidian API stubs for unit testing.
 */

export class Events {
	private _handlers = new Map<string, Array<(...args: unknown[]) => void>>();

	on(event: string, callback: (...args: unknown[]) => void): void {
		if (!this._handlers.has(event)) this._handlers.set(event, []);
		this._handlers.get(event)!.push(callback);
	}

	off(event: string, callback: (...args: unknown[]) => void): void {
		const handlers = this._handlers.get(event);
		if (!handlers) return;
		const idx = handlers.indexOf(callback);
		if (idx >= 0) handlers.splice(idx, 1);
	}

	trigger(event: string, ...args: unknown[]): void {
		for (const handler of this._handlers.get(event) ?? []) {
			handler(...args);
		}
	}
}

export class Component {
	load(): void {}
	unload(): void {}
}

export class MarkdownRenderChild extends Component {
	containerEl: HTMLElement;
	constructor(containerEl: HTMLElement) {
		super();
		this.containerEl = containerEl;
	}
}

export class Notice {
	constructor(public message: string) {}
}

export const MarkdownRenderer = {
	render: vi.fn(),
};
