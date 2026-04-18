<!-- Generated: 2026-04-18 | Files scanned: 8 | Token estimate: ~500 -->
# Architecture

## Project Type
VS Code Extension — single-package TypeScript project targeting VS Code ^1.116.0

## Entry Point
`src/extension.ts` → `activate()` / `deactivate()`

## High-Level Flow
```
User action (right-click / Explorer context menu)
  → VS Code command dispatch
  → extension.ts command handler
      → ExplainPanel.openLoading()        ← immediate spinner
      → vscode.window.withProgress()      ← progress notification
          → getApiKey()                   ← secrets storage prompt/retrieve
          → explainCode() [ai/gemini.ts]  ← Gemini API call
          → ExplainPanel.createOrShow()   ← renders result
              → SessionTreeProvider.addSession()
```

```
User clicks "Run" in ExplainPanel webview
  → webview postMessage { type: 'run', code, language }
  → ExplainPanel onDidReceiveMessage
      → startRun() [execution/runner.ts]  ← spawns child process
      → await handle.result
      → webview postMessage { type: 'runResult', result }
```

## Module Map
| File | Role |
|------|------|
| `src/extension.ts` | Activate, register commands, wire subscriptions |
| `src/ai/gemini.ts` | Gemini API client; prompt building; JSON response parsing |
| `src/panels/ExplainPanel.ts` | Singleton WebviewPanel; split-pane HTML; run bridge |
| `src/execution/runner.ts` | Temp-file writer; child process spawner; RunHandle |
| `src/views/SessionTreeProvider.ts` | In-memory session list; TreeDataProvider |
| `src/sessions/SessionStore.ts` | Re-exports SessionItem type from SessionTreeProvider |
| `src/utils/htmlUtils.ts` | `escapeHtml`, `getNonce` (crypto-secure) |

## Extension Surfaces
| Surface | ID | Source |
|---------|----|--------|
| Activity bar container | `explainable-sidebar` | package.json |
| Tree view (Sessions) | `explainableSessions` | SessionTreeProvider |
| Context menu (editor) | `explainable.explainSelection` | when: editorHasSelection |
| Context menu (explorer) | `explainable.explainFile` | when: !explorerResourceIsFolder |
| WebviewPanel | `explainablePanel` | ExplainPanel (singleton) |

## Security Boundaries
- All Gemini API calls happen in the extension host (Node.js), never in the webview
- Webview CSP: `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-{random}'`
- Nonce generated with `crypto.randomBytes(16).toString('base64')`
- Child process env is whitelisted to `{ PATH, HOME, LANG }` only
- `explainFile` only opens URIs inside an open workspace folder

## Build
`tsc -p ./` → `out/extension.js` (CommonJS, VS Code host)
