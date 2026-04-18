# Plan: Phase 6 — Polish & Demo

## Summary
Two targeted improvements for a smooth demo: (1) the panel opens **immediately** with a CSS spinner when the user clicks "Explain this", so there's no blank wait while Gemini fetches; (2) the plain `showInformationMessage` is replaced with `vscode.window.withProgress` for a proper progress notification. Together these eliminate the biggest visible rough edges.

## User Story
As a judge watching a demo, I want the extension to feel responsive the moment I trigger an explanation, so I'm not staring at a frozen editor for 3-5 seconds.

## Problem → Solution
User selects "Explain this" → 3-5s of nothing → panel appears → `showInformationMessage` toast disappears silently  →  
User selects "Explain this" → panel opens **instantly** with spinner → progress notification visible → panel updates with real content

## Metadata
- **Complexity**: Small
- **Source PRD**: `.claude/PRPs/prds/explainable-vscode-extension.prd.md`
- **PRD Phase**: Phase 6 — Polish & Demo
- **Estimated Files**: 2 updated

---

## UX Design

### Before
```
User: right-click → "Explain this"
  ↓ [3-5 second blank wait]
  ↓ toast: "Explainable: Explaining... ⏳"  (disappears after 5s)
  ↓ panel appears with content
```

### After
```
User: right-click → "Explain this"
  ↓ [instant] panel opens with:
      ┌──────────────────────────────────┐
      │         ⟳  Explaining python...  │
      └──────────────────────────────────┘
  ↓ [concurrent] progress spinner notification at bottom-right
  ↓ [3-5s later] panel updates with real explanation + scaffold
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Panel open timing | After Gemini returns (~3-5s) | Immediately on command invoke | `openLoading()` called synchronously |
| Loading feedback | `showInformationMessage` toast | CSS spinner in panel + `withProgress` notification | Both appear simultaneously |
| Panel content | Appears complete | Transitions from spinner → content | `createOrShow` re-uses existing panel via `reveal` |
| Error during fetch | Error toast, panel never opens | Error toast, panel stays on spinner | Acceptable for hackathon |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `explainable/src/panels/ExplainPanel.ts` | 33–68 | `createOrShow` logic to understand how `openLoading` must integrate |
| P0 | `explainable/src/panels/ExplainPanel.ts` | 75–107 | `_getHtml` structure — loading HTML must use same CSP nonce pattern |
| P0 | `explainable/src/extension.ts` | 35–64 | `explainSelection` handler — primary target for restructuring |
| P0 | `explainable/src/extension.ts` | 66–90 | `explainFile` handler — same restructuring pattern |
| P1 | `explainable/src/panels/ExplainPanel.ts` | 290–306 | `getNonce()` and `escapeHtml()` — already module-level, usable from static methods |

## External Documentation
No external research needed — uses established VS Code API patterns only.

`vscode.window.withProgress` key facts (from VS Code API):
- `location: vscode.ProgressLocation.Notification` → shows spinner in bottom-right notification
- `cancellable: false` → no cancel button
- `progress.report({ message: string })` → sets the notification text
- The notification auto-dismisses when the returned Promise resolves

---

## Patterns to Mirror

### STATIC_METHOD_PATTERN
```typescript
// SOURCE: src/panels/ExplainPanel.ts:33-40
static createOrShow(
  context: vscode.ExtensionContext,
  result: GeminiResult,
  language: string,
  sessionProvider: SessionTreeProvider,
  addToHistory = true,
): void {
  void context;
  const column = vscode.ViewColumn.Beside;
```
Mirror: `openLoading` is a static method with the same signature shape (context + language). Use `void context` for the unused `context` param.

### PANEL_CREATE_PATTERN
```typescript
// SOURCE: src/panels/ExplainPanel.ts:45-57
if (ExplainPanel.currentPanel) {
  ExplainPanel.currentPanel._panel.reveal(column);
  ExplainPanel.currentPanel._update(result, language);
} else {
  const panel = vscode.window.createWebviewPanel(
    'explainablePanel',
    `Explainable: ${language}`,
    column,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  ExplainPanel.currentPanel = new ExplainPanel(panel);
  ExplainPanel.currentPanel._update(result, language);
}
```
`openLoading` mirrors this exact pattern but sets loading HTML instead of calling `_update`.

### CSP_NONCE_PATTERN
```typescript
// SOURCE: src/panels/ExplainPanel.ts:84-88
const nonce = getNonce();
return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src 'unsafe-inline';
             script-src 'nonce-${nonce}';">
```
Loading HTML must include the same CSP header. Uses `getNonce()` (module-level function, accessible from static methods in same file).

### WITH_PROGRESS_PATTERN
```typescript
// New pattern — VS Code API
await vscode.window.withProgress(
  {
    location: vscode.ProgressLocation.Notification,
    title: 'Explainable',
    cancellable: false,
  },
  async (progress) => {
    progress.report({ message: 'Explaining...' });
    // ... async work ...
  }
);
```

### ERROR_HANDLING
```typescript
// SOURCE: src/extension.ts:58-62
} catch (err) {
  vscode.window.showErrorMessage(
    `Explainable: ${err instanceof Error ? err.message : 'Unknown error'}`
  );
}
```
Keep this exact pattern inside the `withProgress` callback.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `explainable/src/panels/ExplainPanel.ts` | UPDATE | Add `static openLoading()` + `private static _loadingHtml()` |
| `explainable/src/extension.ts` | UPDATE | Add `openLoading` call + wrap async work in `withProgress` for both `explainSelection` and `explainFile` |

## NOT Building
- Extension marketplace PNG icon — the activity bar SVG icon already works locally; `"icon"` field is marketplace-only and has no effect during F5 demo
- Error state HTML in the panel when Gemini fails — the error toast is sufficient for demo; the panel remaining on the loading spinner is acceptable
- Cancellable progress — `cancellable: false`; cancellation would require aborting the Gemini request which is out of scope

---

## Step-by-Step Tasks

### Task 1: Add `_loadingHtml()` and `openLoading()` to `ExplainPanel`

- **ACTION**: Add two static methods to `ExplainPanel` class in `src/panels/ExplainPanel.ts`, before `_update`
- **IMPLEMENT**:
  ```typescript
  static openLoading(context: vscode.ExtensionContext, language: string): void {
    void context;
    const column = vscode.ViewColumn.Beside;
    if (ExplainPanel.currentPanel) {
      ExplainPanel.currentPanel._panel.reveal(column);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'explainablePanel',
        `Explainable: ${language}`,
        column,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      ExplainPanel.currentPanel = new ExplainPanel(panel);
    }
    ExplainPanel.currentPanel._panel.title = `Explainable: ${language}`;
    ExplainPanel.currentPanel._panel.webview.html = ExplainPanel._loadingHtml(language);
  }

  private static _loadingHtml(language: string): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        font-family: var(--vscode-font-family, sans-serif);
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
      }
      .loading { display: flex; flex-direction: column; align-items: center; gap: 14px; opacity: 0.7; }
      .spinner {
        width: 28px; height: 28px;
        border: 2px solid var(--vscode-panel-border, #444);
        border-top-color: var(--vscode-focusBorder, #007fd4);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      p { font-size: 13px; margin: 0; }
    </style>
  </head>
  <body>
    <div class="loading">
      <div class="spinner"></div>
      <p>Explaining ${escapeHtml(language)} code&hellip;</p>
    </div>
  </body>
  </html>`;
  }
  ```
- **MIRROR**: STATIC_METHOD_PATTERN, PANEL_CREATE_PATTERN, CSP_NONCE_PATTERN
- **IMPORTS**: None — `getNonce()` and `escapeHtml()` are already in the same file (module-level functions at bottom of file)
- **GOTCHA**: `_loadingHtml` is `private static` — the `private` keyword is valid on static methods in TypeScript. Do NOT call it from outside the class.
- **GOTCHA**: The panel webview HTML must always have a valid CSP `meta` tag or VS Code will refuse to render it. The nonce is required even though this HTML has no scripts.
- **VALIDATE**: `tsc -p ./` passes. With F5, triggering "Explain this" shows the spinner panel before AI responds.

### Task 2: Refactor `explainSelection` in `extension.ts`

- **ACTION**: Replace `showInformationMessage` with `openLoading` + `withProgress` in the `explainSelection` handler
- **IMPLEMENT**: Replace lines 52–63 in `extension.ts`:
  ```typescript
  ExplainPanel.openLoading(context, language);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Explainable', cancellable: false },
    async (progress) => {
      progress.report({ message: `Explaining ${language} code...` });
      try {
        const apiKey = await getApiKey(context);
        const result = await explainCode(selectedText, language, fileContext, apiKey);
        console.log('[Explainable] Gemini result:', result);
        ExplainPanel.createOrShow(context, result, language, sessionProvider);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Explainable: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }
  );
  ```
- **MIRROR**: WITH_PROGRESS_PATTERN, ERROR_HANDLING
- **IMPORTS**: `vscode.ProgressLocation` is on the `vscode` namespace already imported
- **GOTCHA**: `openLoading` must be called BEFORE `withProgress` — it's synchronous and opens the panel immediately. `withProgress` is async and runs the Gemini fetch inside its callback.
- **GOTCHA**: `ExplainPanel.createOrShow` inside `withProgress` finds `currentPanel` already set (by `openLoading`) and just calls `_panel.reveal()` + `_update()` — this is the correct fast-path.
- **VALIDATE**: Panel opens immediately on "Explain this"; notification spinner appears; panel content updates ~3-5s later. `tsc` passes.

### Task 3: Refactor `explainFile` in `extension.ts`

- **ACTION**: Apply the same `openLoading` + `withProgress` pattern to the `explainFile` handler
- **IMPLEMENT**: Replace lines 78–89 in `extension.ts`:
  ```typescript
  ExplainPanel.openLoading(context, language);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Explainable', cancellable: false },
    async (progress) => {
      progress.report({ message: `Explaining ${language} file...` });
      try {
        const apiKey = await getApiKey(context);
        const result = await explainCode(fileContent, language, fileContent, apiKey);
        console.log('[Explainable] Gemini result:', result);
        ExplainPanel.createOrShow(context, result, language, sessionProvider);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Explainable: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }
  );
  ```
- **MIRROR**: WITH_PROGRESS_PATTERN, ERROR_HANDLING
- **IMPORTS**: None beyond what Task 2 already uses
- **GOTCHA**: Same as Task 2. `openLoading` before `withProgress`, error stays as toast.
- **VALIDATE**: Right-clicking a file in Explorer → "Explain this file" also shows the immediate spinner panel.

---

## Testing Strategy

### Manual Smoke Tests

| Test | Steps | Expected | Edge Case? |
|---|---|---|---|
| Python end-to-end | Open `.py`, highlight code, Explain this | Spinner → explanation + scaffold; Run prints output | No |
| JavaScript end-to-end | Open `.js`, highlight code, Explain this | Spinner → explanation + scaffold; Run prints output | No |
| File explain | Right-click `.py` in Explorer → Explain this file | Spinner → full file explanation | No |
| Session reopen | Explain twice → click first sidebar entry | Panel updates to first session's content | No |
| Invalid API key | Reset key, enter wrong key, Explain | Error toast: "API_KEY_INVALID" or similar | Yes |
| No selection | Click Explain without highlighting | "No text selected" warning (unchanged) | No |
| Loading visible | Explain on slow network | Spinner visible for full duration of Gemini fetch | Yes |

### Edge Cases Checklist
- [ ] Trigger Explain twice quickly — second `openLoading` reveals existing panel; no duplicate panel created
- [ ] Explain on a file with very long content — spinner shows, no crash
- [ ] Close panel mid-fetch — `createOrShow` after panel close creates a new panel (existing behavior, no regression)

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
- [ ] `F5` opens extension dev host
- [ ] Highlight Python code → right-click → "Explain this" → panel opens **immediately** with spinner
- [ ] 3-5s later panel fills with explanation + scaffold
- [ ] Progress notification visible at bottom-right while fetching
- [ ] Click Run → output appears in panel
- [ ] Sidebar shows new session entry
- [ ] Click session entry → panel updates (no duplicate added)
- [ ] Repeat with JavaScript

---

## Acceptance Criteria
- [ ] Panel opens with CSS spinner immediately on "Explain this" (before Gemini returns)
- [ ] `withProgress` notification visible while fetching
- [ ] Panel updates with real content when Gemini returns
- [ ] `openSession` still works (no regression — `createOrShow` behavior unchanged)
- [ ] `tsc` and `eslint` pass clean

## Completion Checklist
- [ ] `ExplainPanel.openLoading()` static method added
- [ ] `ExplainPanel._loadingHtml()` private static method added
- [ ] `explainSelection` uses `openLoading` + `withProgress`
- [ ] `explainFile` uses `openLoading` + `withProgress`
- [ ] `showInformationMessage('Explaining...')` removed from both handlers
- [ ] No new imports needed (`vscode.ProgressLocation` is on the existing `vscode` import)
- [ ] `tsc` clean
- [ ] `eslint` clean

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `withProgress` callback swallows errors | L | Silent failures during demo | Error handling inside callback preserved via try/catch + `showErrorMessage` |
| Double panel on rapid re-trigger | L | Two panels open | `openLoading` checks `currentPanel` first — existing panel is revealed, not duplicated |
| CSP error on loading HTML | L | Blank panel instead of spinner | Loading HTML includes same CSP nonce pattern as `_getHtml` |
| `_loadingHtml` nonce mismatch | L | CSP violation | `getNonce()` called inside `_loadingHtml` — fresh nonce per render |

## Notes
- Extension marketplace PNG icon (`"icon"` field in `package.json`) is explicitly out of scope — it has zero visual effect during local F5 demo. The activity bar SVG (`viewsContainers[].icon`) already renders correctly.
- The loading panel stays visible on error (no cleanup). This is acceptable for a hackathon demo — the error toast tells the user what happened, and they can trigger Explain again to get a fresh panel.
- `vscode.ProgressLocation.Notification` renders as a spinner notification in the bottom-right corner. It auto-dismisses when the `withProgress` callback's promise resolves (success or error).
