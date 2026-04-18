<!-- Generated: 2026-04-18 | Files scanned: 4 | Token estimate: ~300 -->
# Architecture

## Project Type
VS Code Extension — single-package TypeScript project targeting VS Code ^1.116.0

## Entry Point
`src/extension.ts` → `activate()` / `deactivate()`

## High-Level Flow
```
User action (right-click / context menu)
  → VS Code command dispatch
  → extension.ts command handler
  → [Phase 2: Gemini API call — not yet implemented]
  → [Phase 3: ExplainPanel webview — not yet implemented]
  → SessionTreeProvider.addSession()
  → Activity Bar sidebar tree refreshes
```

## Extension Surfaces
| Surface | ID | Source |
|---------|----|--------|
| Activity bar container | `explainable-sidebar` | package.json |
| Tree view (Sessions) | `explainableSessions` | SessionTreeProvider |
| Context menu (editor) | `explainable.explainSelection` | when: editorHasSelection |
| Context menu (explorer) | `explainable.explainFile` | when: !explorerResourceIsFolder |

## Build
`tsc -p ./` → `out/extension.js` (CommonJS, VS Code host)
