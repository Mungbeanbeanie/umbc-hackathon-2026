<!-- Generated: 2026-04-18 | Files scanned: 4 | Token estimate: ~250 -->
# Frontend (VS Code Extension UI)

## Views
```
Activity Bar → explainable-sidebar
  └── Sessions tree view (explainableSessions)
        └── SessionTreeItem[] (label + time description, click → openSession)
```

## Components
| File | Role |
|------|------|
| `src/views/SessionTreeProvider.ts` | TreeDataProvider; holds in-memory session list |
| `src/extension.ts` | Wires commands, creates TreeView |

## State
- `SessionTreeProvider.sessions: SessionItem[]` — in-memory, lost on extension reload
- Mutated via `addSession()` / `clearSessions()`; view refreshed via EventEmitter

## Planned UI (TODOs in extension.ts)
- Phase 2: pass selection/file content to Gemini
- Phase 3: `ExplainPanel` webview (not yet created)
- Phase 5: persist sessions and restore on click
