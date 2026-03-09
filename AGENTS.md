# Obsidian Plugins

This workspace contains multiple Obsidian plugin projects. For active UI work, prefer the design context below unless a plugin-specific document overrides it.

## Design Context

### Users
Primary users are Obsidian power users working inside their notes, not in a separate web app mindset. They are usually trying to generate, refine, or rewrite content quickly while staying oriented inside the current note and preserving confidence about what will change.

Most interactions happen in narrow plugin panes, code blocks, settings tabs, or modal canvases. Interfaces must work well in constrained widths without hiding primary actions or obscuring note context.

### Brand Personality
Calm, precise, trustworthy.

The interface should feel like a capable native Obsidian tool rather than a flashy assistant shell. It should reduce hesitation, make state obvious, and avoid surprising edits.

### Aesthetic Direction
Stay close to Obsidian's visual language and theme tokens. Favor compact, low-noise controls, clear state badges, and small amounts of emphasis reserved for primary actions and risky states.

This should not look like:
- a generic chat app
- a SaaS admin dashboard
- a glossy AI control panel full of competing settings

Support both light and dark themes through existing Obsidian variables. Optimize for clarity, keyboard flow, and readability over decoration.

Motion should be minimal and purposeful. Prefer subtle affordances like disabled states, inline status, and progressive disclosure over animated “assistant” behaviors.

### Design Principles
1. Preview before apply. Generated output should be staged and inspectable before it mutates user notes unless the user has explicitly opted into live application.
2. Bound context must be explicit. If a tool is acting on a note, selection, or file, show that target clearly and never imply live tracking when the binding is static.
3. Distill the decision surface. Collapse transport, provider, model, and auth complexity into the fewest controls possible for the common path, with advanced detail revealed only when needed.
4. Cache and state must match user intent. If users switch runtime or target, the UI must not silently reuse stale output that makes the interface feel inconsistent or dishonest.
5. Use native restraint. Prefer Obsidian theme variables, simple hierarchy, and concise copy over ornamental UI patterns or standalone-product styling.
6. Optimize for narrow surfaces. Plugin sidebars, code block headers, and modal controls should degrade gracefully in limited width without clipping labels or hiding essential actions.
7. Keyboard-first where reasonable. Preserve fast note editing by supporting Enter, modifier-based submit, focus continuity, and low-friction text input patterns.
