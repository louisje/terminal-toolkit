# Agent instructions

## Development workflow

Read and follow [docs/development-workflow.md](docs/development-workflow.md). Before starting or resuming work, inspect NOTE.md, relevant ROADMAP.md entries, design documents, and Git status. Keep documentation synchronized with implementation and verification; prune obsolete notes and leave actionable handoff information.

## Build and test

```bash
npm install
npm run build
npm run dev
npm test
npm run lint
npm run lint:fix
```

See [architecture](docs/architecture.md) for component responsibilities and [documentation index](docs/index.md) for technical references.

## Code conventions


- ES Modules with `.js` extensions in imports (NodeNext module resolution)
- Zod for runtime validation of tool arguments
- Tools return `{ content: [{ type: "text", text: string }], isError?: boolean }` (except `takeScreenshot` png format which returns `{ type: "image", data: string, mimeType: string }`)
- Key sequences are in `src/utils/keys.ts` (ANSI escape codes)
- Recording format is asciicast v2 (compatible with `asciinema play`)
- Socket path is resolved via `resolveSocketPath()` in `src/utils/platform.ts`; can be overridden with `TERMINAL_TOOLKIT_SOCKET` env var
- Terminal default dimensions resolved via `getDefaultCols()`/`getDefaultRows()` in `src/utils/platform.ts`; can be overridden with `TERMINAL_TOOLKIT_COLS`/`TERMINAL_TOOLKIT_ROWS` env vars
- Recording output directory defaults to `~/.local/state/terminal-toolkit/recordings`; can be overridden with `TERMINAL_TOOLKIT_RECORD_DIR` env var
