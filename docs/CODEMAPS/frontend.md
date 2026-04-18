<!-- Generated: 2026-04-18 | Files scanned: 4 | Token estimate: ~300 -->

# Frontend — Explainable VSCode Extension

## UI Surface Map
```
Activity Bar
  └── Explainable icon → sidebar view
        └── TreeView: Session History
              ├── Session 1 (timestamp + code snippet preview)
              ├── Session 2
              └── ...

Editor Context Menu
  └── "Explain this" (on text selection or file right-click)

WebviewPanel (split view, opened per session)
  ├── Left pane  — ExplanationView
  │     • Rendered Markdown / HTML
  │     • Plain-English explanation of selected construct
  │     • Contextual: explains at highest construct level (loop > line)
  └── Right pane — SandboxView
        • Editable code editor (Monaco or CodeMirror embed)
        • Scaffold of selected construct type (bare loop, bare lambda, etc.)
        • Run button (optional: Vercel Sandbox or node subprocess)
```

## Planned Component Files (not yet created)
```
src/panels/ExplainPanel.ts      WebviewPanel host, message bridge
src/views/SessionTreeProvider.ts  TreeDataProvider for activity bar
src/webview/explanation.html    Left pane template
src/webview/sandbox.html        Right pane template (Monaco embed)
```

## State Flow
```
User selects code
  → extension reads selection + surrounding file context
  → ExplainPanel.create() opens WebviewPanel
  → postMessage({ type: 'explain', code, context })
  → webview renders explanation + scaffold
  → session serialized → ExtensionContext.globalState
  → SessionTreeProvider.refresh()
```

## Status
No UI components implemented yet — all planned.
