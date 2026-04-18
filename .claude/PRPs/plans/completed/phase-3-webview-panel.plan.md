# Plan: Phase 3 — WebviewPanel UI

## Summary
Create `src/panels/ExplainPanel.ts` — a VS Code WebviewPanel with a split layout: left pane shows the Gemini explanation, right pane shows an editable scaffold textarea + Run button + output area. Replace the two TODO Phase 3 comments in `extension.ts` with real `ExplainPanel.createOrShow()` calls. The Run button sends a message to the extension host; Phase 4 wires in the actual runner — this phase stubs that handler.

## User Story
As a CS student, I want a split panel to open showing what my code does on the left and a runnable bare example on the right, so I can read the explanation and immediately experiment without leaving VS Code.

## Problem → Solution
`vscode.window.showInformationMessage('Explainable: Explanation ready!')` (stub) → A real WebviewPanel opens beside the editor with explanation text on the left and an editable, runnable scaffold on the right.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/explainable-vscode-extension.prd.md`
- **PRD Phase**: Phase 3 — WebviewPanel UI
- **Estimated Files**: 2 (1 created, 1 updated)

---

## UX Design

### Before
```
Student highlights code → right-click → "Explain this"
→ Info toast: "Explainable: Explanation ready!" (nothing else happens)
```

### After
```
Student highlights code → right-click → "Explain this"
→ Toast: "Explaining... ⏳"
→ WebviewPanel opens in split (beside editor):

┌──────────────────────┬──────────────────────┐
│ 💡 What this does    │ ▶ Try it yourself     │
│──────────────────────│──────────────────────│
│                      │  [textarea with       │
│  [Plain-English      │   scaffold code]      │
│   explanation,       │                       │
│   ~150 words]        │  [Run ▶ button]       │
│                      │                       │
│                      │  Output:              │
│                      │  [stdout/stderr pre]  │
└──────────────────────┴──────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| After Gemini responds | Info toast only | WebviewPanel opens split | `vscode.ViewColumn.Beside` |
| Run button | Does not exist | Sends code to extension host | Phase 4 wires actual execution |
| Multiple "Explain" triggers | Each shows toast | Reuses same panel, replaces content | `currentPanel` singleton |
| Panel title | N/A | `"Explainable: {language}"` | e.g. "Explainable: python" |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `explainable/src/extension.ts` | 52-57, 72-77 | Two TODO Phase 3 lines — exact insertion points and available variables |
| P0 | `explainable/src/ai/gemini.ts` | 3-6 | `GeminiResult` interface shape (`explanation`, `scaffold`) |
| P0 | `explainable/src/views/SessionTreeProvider.ts` | 3-9 | `SessionItem` interface — panel must call `sessionProvider.addSession()` |
| P1 | `explainable/src/extension.ts` | 5-21 | `activate(context)` signature — `context` is `vscode.ExtensionContext` |

## External Documentation
| Topic | Key Takeaway |
|---|---|
| WebviewPanel | `vscode.window.createWebviewPanel(viewType, title, column, options)` — `enableScripts: true` required for JS in webview |
| CSP nonce | Generate with `crypto.randomBytes(16).toString('base64')` in extension host; pass into HTML; use as `nonce-{value}` in CSP and `nonce="{value}"` on `<script>` tag |
| postMessage (host→webview) | `panel.webview.postMessage({ type: '...', ...data })` |
| postMessage (webview→host) | `panel.webview.onDidReceiveMessage(msg => ...)` |
| VS Code CSS variables | `var(--vscode-editor-background)`, `var(--vscode-button-background)`, etc. — use these so the panel respects the user's theme |
| `acquireVsCodeApi()` | Must be called once in webview JS; `const vscode = acquireVsCodeApi()` |

---

## Patterns to Mirror

### WEBVIEW_SINGLETON
```typescript
// Standard VS Code singleton panel pattern (new to this codebase — establish here)
export class ExplainPanel {
  private static currentPanel: ExplainPanel | undefined;

  static createOrShow(/* args */): void {
    if (ExplainPanel.currentPanel) {
      ExplainPanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside);
      ExplainPanel.currentPanel._update(result, language, sessionProvider);
      return;
    }
    const panel = vscode.window.createWebviewPanel(/* ... */);
    ExplainPanel.currentPanel = new ExplainPanel(panel, context, sessionProvider);
    ExplainPanel.currentPanel._update(result, language, sessionProvider);
  }
}
```

### ERROR_HANDLING
```typescript
// SOURCE: src/extension.ts:56-60
} catch (err) {
  vscode.window.showErrorMessage(
    `Explainable: ${err instanceof Error ? err.message : 'Unknown error'}`
  );
}
```

### SESSION_ADD
```typescript
// SOURCE: src/views/SessionTreeProvider.ts:30-33
// Call this after panel opens successfully:
sessionProvider.addSession({
  label: `${language} — ${new Date().toLocaleTimeString()}`,
  timestamp: Date.now(),
  explanation: result.explanation,
  scaffold: result.scaffold,
  language,
});
```

### MESSAGE_BRIDGE
```typescript
// Extension host receives from webview:
this._panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
  if (msg.type === 'run') {
    // TODO Phase 4: const output = await runCode(msg.code, msg.language);
    this._panel.webview.postMessage({ type: 'output', stdout: '[run not yet implemented]', stderr: '' });
  }
}, undefined, this._disposables);
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `explainable/src/panels/ExplainPanel.ts` | CREATE | WebviewPanel host class |
| `explainable/src/extension.ts` | UPDATE | Replace 2× TODO Phase 3 comments with `ExplainPanel.createOrShow(...)` |

## NOT Building
- Monaco Editor — using `<textarea>` per PRD decision
- Syntax highlighting in the textarea — out of scope
- Phase 4 code execution — stub the run handler with `[run not yet implemented]`
- Separate HTML/CSS files — embed everything in the template string (simpler, no asset loading issues)
- Session history click-to-reopen — Phase 5

---

## Step-by-Step Tasks

### Task 1: Create src/panels/ directory and ExplainPanel.ts
- **ACTION**: Create `explainable/src/panels/ExplainPanel.ts` with the full panel class
- **IMPLEMENT**: Write this complete file:

```typescript
import * as vscode from 'vscode';
import { GeminiResult } from '../ai/gemini';
import { SessionItem, SessionTreeProvider } from '../views/SessionTreeProvider';

interface WebviewMessage {
  type: 'run';
  code: string;
  language: string;
}

interface RunOutput {
  type: 'output';
  stdout: string;
  stderr: string;
}

export class ExplainPanel {
  private static currentPanel: ExplainPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
  ) {
    this._panel = panel;
    this._context = context;

    this._panel.onDidDispose(() => this._dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (msg: WebviewMessage) => {
        if (msg.type === 'run') {
          // TODO Phase 4: replace stub with real runner
          // const output = await runCode(msg.code, msg.language);
          const response: RunOutput = {
            type: 'output',
            stdout: '[Code execution coming in Phase 4]',
            stderr: '',
          };
          this._panel.webview.postMessage(response);
        }
      },
      undefined,
      this._disposables,
    );
  }

  static createOrShow(
    context: vscode.ExtensionContext,
    result: GeminiResult,
    language: string,
    sessionProvider: SessionTreeProvider,
  ): void {
    const column = vscode.ViewColumn.Beside;

    if (ExplainPanel.currentPanel) {
      ExplainPanel.currentPanel._panel.reveal(column);
      ExplainPanel.currentPanel._update(result, language);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'explainablePanel',
        `Explainable: ${language}`,
        column,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      );
      ExplainPanel.currentPanel = new ExplainPanel(panel, context);
      ExplainPanel.currentPanel._update(result, language);
    }

    sessionProvider.addSession({
      label: `${language} — ${new Date().toLocaleTimeString()}`,
      timestamp: Date.now(),
      explanation: result.explanation,
      scaffold: result.scaffold,
      language,
    });
  }

  private _update(result: GeminiResult, language: string): void {
    this._panel.title = `Explainable: ${language}`;
    this._panel.webview.html = this._getHtml(result, language);
  }

  private _getHtml(result: GeminiResult, language: string): string {
    const nonce = getNonce();
    const explanation = escapeHtml(result.explanation);
    const scaffold = escapeHtml(result.scaffold);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src 'unsafe-inline';
             script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Explainable</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      display: flex;
      flex-direction: column;
      height: 100vh;
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }

    header {
      padding: 10px 16px;
      border-bottom: 1px solid var(--vscode-panel-border, #444);
      font-weight: 600;
      font-size: 14px;
      letter-spacing: 0.03em;
      opacity: 0.85;
    }

    .split {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      padding: 16px;
      gap: 10px;
    }

    .pane + .pane {
      border-left: 1px solid var(--vscode-panel-border, #444);
    }

    .pane-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.6;
    }

    #explanation {
      flex: 1;
      overflow-y: auto;
      line-height: 1.65;
      white-space: pre-wrap;
    }

    #scaffold {
      flex: 1;
      resize: none;
      background: var(--vscode-input-background, #1e1e1e);
      color: var(--vscode-input-foreground, #d4d4d4);
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      border-radius: 4px;
      padding: 10px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      line-height: 1.5;
    }

    #scaffold:focus {
      outline: none;
      border-color: var(--vscode-focusBorder, #007fd4);
    }

    #runBtn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      align-self: flex-start;
    }

    #runBtn:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }

    #runBtn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .output-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.6;
    }

    #output {
      flex: 0 0 120px;
      overflow-y: auto;
      background: var(--vscode-terminal-background, #1a1a1a);
      color: var(--vscode-terminal-foreground, #cccccc);
      border: 1px solid var(--vscode-panel-border, #444);
      border-radius: 4px;
      padding: 8px 10px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <header>Explainable &mdash; ${escapeHtml(language)}</header>
  <div class="split">
    <div class="pane">
      <div class="pane-title">💡 What this does</div>
      <div id="explanation">${explanation}</div>
    </div>
    <div class="pane">
      <div class="pane-title">▶ Try it yourself</div>
      <textarea id="scaffold" spellcheck="false">${scaffold}</textarea>
      <button id="runBtn">▶ Run</button>
      <div class="output-label">Output</div>
      <pre id="output">Press Run to see output...</pre>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const language = ${JSON.stringify(language)};

    document.getElementById('runBtn').addEventListener('click', () => {
      const code = document.getElementById('scaffold').value;
      const btn = document.getElementById('runBtn');
      btn.disabled = true;
      btn.textContent = 'Running...';
      document.getElementById('output').textContent = '';
      vscode.postMessage({ type: 'run', code, language });
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'output') {
        const out = document.getElementById('output');
        const btn = document.getElementById('runBtn');
        out.textContent = msg.stdout + (msg.stderr ? '\\nSTDERR:\\n' + msg.stderr : '');
        btn.disabled = false;
        btn.textContent = '▶ Run';
      }
    });
  </script>
</body>
</html>`;
  }

  private _dispose(): void {
    ExplainPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

- **MIRROR**: WEBVIEW_SINGLETON, SESSION_ADD, MESSAGE_BRIDGE
- **IMPORTS**: `vscode`, `GeminiResult` from `../ai/gemini`, `SessionItem`, `SessionTreeProvider` from `../views/SessionTreeProvider`
- **GOTCHA**: `enableScripts: true` is required in webview options or no JS runs. Without it the Run button is dead.
- **GOTCHA**: `retainContextWhenHidden: true` prevents the panel from resetting when the user clicks away. Costs memory but essential for usability.
- **GOTCHA**: The `escapeHtml()` call is mandatory — `result.explanation` and `result.scaffold` come from Gemini and could contain `<`, `>`, `&`. Without escaping, the HTML breaks or creates XSS.
- **GOTCHA**: `acquireVsCodeApi()` must be called exactly once. It's already global in the webview script — do not call it again.
- **VALIDATE**: `./node_modules/.bin/tsc -p ./` passes with zero errors

### Task 2: Update extension.ts — replace both TODO Phase 3 comments
- **ACTION**: Import `ExplainPanel` and replace the 2 TODO lines
- **IMPLEMENT**:

  Add import at the top of `extension.ts` (after existing imports):
  ```typescript
  import { ExplainPanel } from './panels/ExplainPanel';
  ```

  In `explainSelection` handler, replace:
  ```typescript
  // TODO Phase 3: ExplainPanel.createOrShow(context, result, language, sessionProvider);
  vscode.window.showInformationMessage('Explainable: Explanation ready!');
  ```
  with:
  ```typescript
  ExplainPanel.createOrShow(context, result, language, sessionProvider);
  ```

  In `explainFile` handler, replace:
  ```typescript
  // TODO Phase 3: ExplainPanel.createOrShow(context, result, language, sessionProvider);
  vscode.window.showInformationMessage('Explainable: Explanation ready!');
  ```
  with:
  ```typescript
  ExplainPanel.createOrShow(context, result, language, sessionProvider);
  ```

- **MIRROR**: WEBVIEW_SINGLETON (the static method is called from outside the class)
- **GOTCHA**: The `vscode.window.showInformationMessage('Explainable: Explanation ready!')` lines are removed — `ExplainPanel.createOrShow` replaces both the panel opening AND the success notification in one call.
- **VALIDATE**: `./node_modules/.bin/tsc -p ./` passes; F5 → select code → "Explain this" → panel opens split beside editor

---

## Testing Strategy

### Manual Tests

| Test | Steps | Expected |
|---|---|---|
| Panel opens | Select code → "Explain this" → wait for Gemini | Panel opens beside editor, explanation on left |
| Scaffold populated | Same as above | Right pane shows editable code scaffold |
| Run button (stub) | Click "▶ Run" | Output shows "[Code execution coming in Phase 4]" |
| Reuse panel | Trigger "Explain this" twice | Same panel updates, doesn't open second window |
| Panel title | Open panel | Title reads "Explainable: python" (or detected language) |
| Session saved | Open panel | Activity bar Sessions list shows new entry |

### Edge Cases Checklist
- [ ] Explanation contains `<`, `>`, or `&` — `escapeHtml` handles it
- [ ] Scaffold contains backticks or quotes — `escapeHtml` handles it
- [ ] User closes panel then triggers again — new panel opens cleanly
- [ ] Multiple rapid "Explain this" triggers — last result wins, panel reused

---

## Validation Commands

### Static Analysis
```bash
cd explainable && ./node_modules/.bin/tsc -p ./
```
EXPECT: Zero type errors

### Lint
```bash
cd explainable && ./node_modules/.bin/eslint src
```
EXPECT: Zero errors

### Manual Validation
- [ ] F5 launches Extension Development Host
- [ ] Select Python code → right-click → "Explain this" → panel opens split
- [ ] Left pane shows explanation text (not "[object Object]" or blank)
- [ ] Right pane shows editable textarea with scaffold code
- [ ] "▶ Run" button visible; clicking shows stub output
- [ ] Triggering explain again reuses the same panel (not a new window)
- [ ] Sessions sidebar shows a new entry after explain

---

## Acceptance Criteria
- [ ] `src/panels/ExplainPanel.ts` created
- [ ] `ExplainPanel.createOrShow()` called in both command handlers
- [ ] Panel opens in `vscode.ViewColumn.Beside`
- [ ] Left pane renders explanation text
- [ ] Right pane has editable textarea with scaffold
- [ ] Run button sends message and shows stub response
- [ ] `sessionProvider.addSession()` called on each explain
- [ ] `tsc` and `eslint` both pass clean

## Completion Checklist
- [ ] `src/panels/` directory created
- [ ] `ExplainPanel.ts` written in full
- [ ] Import added to `extension.ts`
- [ ] Both TODO Phase 3 lines replaced (search for "TODO Phase 3" — should find zero)
- [ ] `escapeHtml()` used on all Gemini-sourced strings injected into HTML
- [ ] `enableScripts: true` in webview options
- [ ] `retainContextWhenHidden: true` in webview options

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| CSP blocks inline script | M | Run button dead | Use nonce on `<script>` tag; nonce matches CSP header |
| `escapeHtml` omitted | M | HTML breaks on backticks | Apply to both `explanation` and `scaffold` |
| Panel not beside editor | L | Poor UX | Use `vscode.ViewColumn.Beside`, not `Active` |
| `acquireVsCodeApi()` called twice | L | Runtime error | Only one call in the `<script>` block |

## Notes
- Phase 4 wires in by replacing the stub inside `onDidReceiveMessage` in `ExplainPanel.ts`: replace the comment block with `const output = await runCode(msg.code, msg.language)` and post the real result back.
- The `TODO Phase 4` comment in `ExplainPanel.ts` is the exact handoff point — Phase 4 implementer only needs to touch that one spot.
- `SessionItem` is already populated with `explanation` and `scaffold` — Phase 5 can reopen a past session by calling `ExplainPanel.createOrShow` with the stored `SessionItem` data.
