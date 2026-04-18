<!-- Generated: 2026-04-18 | Files scanned: 8 | Token estimate: ~400 -->
# Frontend (VS Code Extension UI)

## Views
```
Activity Bar → explainable-sidebar
  └── Sessions tree view (explainableSessions)
        └── SessionTreeItem[] (label + time description, click → openSession command)

WebviewPanel (explainablePanel) — opens beside active editor
  ├── Loading state: CSS spinner while Gemini API call is in flight
  └── Result state: split pane
        ├── Left: plain-English explanation (pre-wrap text)
        └── Right: editable <textarea> scaffold + Run button + output <pre>
```

## Components
| File | Role |
|------|------|
| `src/views/SessionTreeProvider.ts` | TreeDataProvider; holds in-memory session list (max 50) |
| `src/panels/ExplainPanel.ts` | Singleton WebviewPanel; loading spinner; split-pane result; run bridge |
| `src/extension.ts` | Wires commands, creates TreeView, manages subscriptions |
| `src/utils/htmlUtils.ts` | `escapeHtml` for XSS prevention; `getNonce` for CSP |

## State
- `SessionTreeProvider.sessions: SessionItem[]` — in-memory, capped at 50, lost on extension reload
- Mutated via `addSession()` / `clearSessions()`; view refreshed via `EventEmitter`
- `ExplainPanel._disposed: boolean` — guards postMessage after panel close
- `ExplainPanel._activeRun: RunHandle | null` — tracks in-flight child process; killed on dispose

## Message Bridge (webview ↔ extension host)
| Direction | Type | Payload |
|-----------|------|---------|
| webview → host | `run` | `{ code: string, language: string }` |
| host → webview | `runResult` | `{ result: RunResult }` |

WebviewMessage shape is validated at runtime before `startRun` is called.

## CSP
```
default-src 'none';
style-src 'unsafe-inline';
script-src 'nonce-{crypto.randomBytes(16).toString("base64")}';
```
All user content is passed through `escapeHtml` before injection into HTML.
