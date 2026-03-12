/**
 * Minimal Obsidian API stubs for unit testing.
 */
export class Events {}
export class Component {}
export class MarkdownRenderChild extends Component {
	containerEl: HTMLElement;
	constructor(containerEl: HTMLElement) {
		super();
		this.containerEl = containerEl;
	}
}
export class TFile {
	path = "";
	basename = "";
	extension = "";
}
export class Notice {
	constructor(public message: string) {}
}
