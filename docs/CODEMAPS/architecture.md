<!-- Generated: 2026-04-18 | Files scanned: 4 | Token estimate: ~400 -->

# Architecture — Explainable VSCode Extension

## Project Type
Single VSCode extension (TypeScript). Hackathon project — education track.

## Status
**Boilerplate only.** Core feature logic not yet implemented.

## Extension Lifecycle
```
activate(context) → register commands/views/providers → subscribe disposables
deactivate()      → cleanup
```

## Entry Points
```
explainable/src/extension.ts   activate() / deactivate()  [27 lines]
explainable/out/extension.js   compiled output (gitignored)
```

## Planned Feature Architecture (from product spec)
```
User Action
  ├── Highlight code → right-click context menu → "Explain"
  ├── Right-click file → "Explain"
  └── Activity bar icon → session history panel

Command Handler
  ├── Read selected text / file path from active editor
  ├── Detect code construct type (loop, lambda, class, file, etc.)
  ├── Call AI API → generate explanation + scaffold snippet
  └── Open WebviewPanel (split view)
       ├── Left pane: text explanation (HTML/Markdown)
       └── Right pane: sandbox editor (Monaco or CodeMirror)

Session Storage
  ├── Write session to local storage (ExtensionContext.globalState or workspaceState)
  └── Activity bar TreeView → list all saved sessions
```

## Build Pipeline
```
src/*.ts → tsc (Node16 / ES2022) → out/*.js
npm run compile   one-shot build
npm run watch     incremental watch
npm run pretest   compile + lint
```

## Test Runner
Mocha via `@vscode/test-cli` + `@vscode/test-electron`
`src/test/extension.test.ts` — sample stub only
