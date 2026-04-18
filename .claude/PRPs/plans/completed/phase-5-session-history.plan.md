# Plan: Phase 5 — Session History

## Summary
Wire the existing `SessionTreeProvider` (already fully implemented) to a real `openSession` command so clicking a sidebar entry reopens its panel. The main work is two small changes: populate `SessionStore.ts` as the canonical type file, and implement the `openSession` TODO stub in `extension.ts`.

## User Story
As a CS student, I want to click a past session in the activity bar sidebar and have the explanation panel reopen, so I can revisit explanations without re-running them.

## Problem → Solution
Sidebar already populates on each Explain action (Phase 3 wired this), but clicking an entry does nothing → Implement `openSession` command to call `ExplainPanel.createOrShow` with the stored session data, passing `addToHistory = false` to avoid adding a duplicate entry.

## Metadata
- **Complexity**: Small
- **Source PRD**: `.claude/PRPs/prds/explainable-vscode-extension.prd.md`
- **PRD Phase**: Phase 5 — Session History
- **Estimated Files**: 3 touched (1 created, 2 updated)

---

## UX Design

### Before
```
┌─ Activity Bar ──────────────┐
│ 🗂 SESSIONS                 │
│  python — 10:03:24 AM       │  ← click does nothing
│  javascript — 10:05:11 AM   │
└─────────────────────────────┘
```

### After
```
┌─ Activity Bar ──────────────┐
│ 🗂 SESSIONS                 │
│  python — 10:03:24 AM       │  ← click reopens panel
│  javascript — 10:05:11 AM   │
└─────────────────────────────┘
         ↓ opens →
┌─ Explainable: python ───────┐
│ 💡 What this does  │ ▶ Try  │
│ [explanation text] │ [code] │
└─────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Click session in sidebar | No-op | Reopens ExplainPanel with stored explanation + scaffold | Does NOT add duplicate to sidebar |
| Sidebar entry count | Grows on each Explain | Same — reopen does not add new entry | `addToHistory = false` flag |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `explainable/src/extension.ts` | 100–114 | `openSession` stub to implement; subscriptions pattern |
| P0 | `explainable/src/panels/ExplainPanel.ts` | 46–79 | `createOrShow` signature — adding optional `addToHistory` param |
| P0 | `explainable/src/views/SessionTreeProvider.ts` | 1–22 | `SessionItem` interface definition; `SessionTreeItem` wires up command with session argument |
| P1 | `explainable/src/extension.ts` | 27–64 | `explainSelection` command — pattern to mirror for `openSession` |
| P1 | `explainable/src/ai/gemini.ts` | 1–6 | Named export interface pattern — mirror for `SessionStore.ts` |
| P2 | `explainable/tsconfig.json` | all | `module: "Node16"` — must use `import` not `require` |

---

## Patterns to Mirror

### NAMED_EXPORT_REEXPORT
```typescript
// SOURCE: src/ai/gemini.ts:1-6 (interface at top, named export)
export interface GeminiResult {
  explanation: string;
  scaffold: string;
}
```
Mirror: `SessionStore.ts` re-exports `SessionItem` from `SessionTreeProvider` as the canonical type location.

### COMMAND_HANDLER
```typescript
// SOURCE: src/extension.ts:35-64
const explainSelection = vscode.commands.registerCommand(
  'explainable.explainSelection',
  async () => {
    // ...
  }
);
```
The `openSession` command is already registered at line 100. Only the callback body needs to be filled in.

### CREATEORSHOW_CALL
```typescript
// SOURCE: src/extension.ts:57
ExplainPanel.createOrShow(context, result, language, sessionProvider);
```
Reopen uses the same call but passes `false` as the 5th arg to skip saving.

### LOGGING_PATTERN
```typescript
// SOURCE: src/extension.ts:56
console.log('[Explainable] Gemini result:', result);
```
Use `console.log('[Explainable] openSession:', session.label)` in the command handler.

### OPTIONAL_PARAM_DEFAULT
```typescript
// SOURCE: tsconfig.json — strict: true
// TypeScript strict mode is on; optional params must have explicit defaults
static createOrShow(
  context: vscode.ExtensionContext,
  result: GeminiResult,
  language: string,
  sessionProvider: SessionTreeProvider,
  addToHistory = true,   // ← default true preserves existing callers
): void { ... }
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `explainable/src/sessions/SessionStore.ts` | CREATE (populate) | File exists but is empty; needs to re-export `SessionItem` as canonical type |
| `explainable/src/panels/ExplainPanel.ts` | UPDATE | Add `addToHistory = true` optional param to `createOrShow`; guard `addSession` call |
| `explainable/src/extension.ts` | UPDATE | Implement `openSession` command body (lines 100–104 TODO) |

## NOT Building
- A separate in-memory array in `SessionStore.ts` — `SessionTreeProvider` already owns the array; duplicating it creates two sources of truth
- Persistence across VS Code restarts — PRD explicitly says "Won't"
- Session deletion / clear UI — out of scope for Phase 5
- Renaming or deduplication of sessions with identical labels — out of scope

---

## Step-by-Step Tasks

### Task 1: Populate `SessionStore.ts` — canonical type re-export
- **ACTION**: Add content to the empty `src/sessions/SessionStore.ts`
- **IMPLEMENT**:
  ```typescript
  export type { SessionItem } from '../views/SessionTreeProvider';
  ```
- **MIRROR**: NAMED_EXPORT_REEXPORT, NODE16_IMPORTS
- **IMPORTS**: None beyond the re-export itself
- **GOTCHA**: `module: "Node16"` requires `export type { ... }` syntax for type-only re-exports under `isolatedModules`-compatible settings. Use `export type` not plain `export`.
- **VALIDATE**: `tsc -p ./` passes with no errors after adding this line

### Task 2: Add `addToHistory` param to `ExplainPanel.createOrShow`
- **ACTION**: Add an optional fifth parameter `addToHistory = true` to `createOrShow`; guard the `sessionProvider.addSession(...)` block with it
- **IMPLEMENT**: In `src/panels/ExplainPanel.ts`, change the method signature and guard:
  ```typescript
  static createOrShow(
    context: vscode.ExtensionContext,
    result: GeminiResult,
    language: string,
    sessionProvider: SessionTreeProvider,
    addToHistory = true,
  ): void {
    void context;
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
      ExplainPanel.currentPanel = new ExplainPanel(panel);
      ExplainPanel.currentPanel._update(result, language);
    }

    if (addToHistory) {
      sessionProvider.addSession({
        label: `${language} — ${new Date().toLocaleTimeString()}`,
        timestamp: Date.now(),
        explanation: result.explanation,
        scaffold: result.scaffold,
        language,
      });
    }
  }
  ```
- **MIRROR**: OPTIONAL_PARAM_DEFAULT
- **GOTCHA**: The two existing callers in `extension.ts` (lines 57 and 82) omit the 5th arg — they default to `true` and keep existing behavior. Do NOT change those call sites.
- **VALIDATE**: Both `explainSelection` and `explainFile` still add sessions after this change. `tsc` passes.

### Task 3: Implement `openSession` command in `extension.ts`
- **ACTION**: Replace the TODO stub at lines 100–104 with a real implementation
- **IMPLEMENT**:
  ```typescript
  const openSession = vscode.commands.registerCommand(
    'explainable.openSession',
    (session: SessionItem) => {
      console.log('[Explainable] openSession:', session.label);
      ExplainPanel.createOrShow(
        context,
        { explanation: session.explanation, scaffold: session.scaffold },
        session.language,
        sessionProvider,
        false,
      );
    }
  );
  ```
- **MIRROR**: COMMAND_HANDLER, CREATEORSHOW_CALL, LOGGING_PATTERN
- **IMPORTS**: `SessionItem` is already importable from `'./views/SessionTreeProvider'` (where it's defined). Add it to the existing import on line 4:
  ```typescript
  import { SessionTreeProvider, SessionItem } from './views/SessionTreeProvider';
  ```
- **GOTCHA**: The `session` argument arrives typed as `unknown` at runtime — TypeScript will trust the annotation but the value comes from `SessionTreeItem.command.arguments[0]` (set in `SessionTreeProvider.ts:18-19`). This is correct; no runtime cast needed.
- **GOTCHA**: `openSession` is already in `context.subscriptions.push(...)` at line 113 — do NOT add it again.
- **VALIDATE**: After implementation, clicking a sidebar entry opens the panel with that session's content. Sidebar entry count does not increase.

---

## Testing Strategy

### Manual Smoke Tests

| Test | Steps | Expected | Edge Case? |
|---|---|---|---|
| Session saves on explain | Run Explain Selection | Sidebar shows new entry with language + time | No |
| Click session reopens panel | Click any sidebar entry | Panel opens with correct explanation + scaffold | No |
| Reopen does not duplicate | Click same entry twice | Sidebar count unchanged | Yes |
| Multiple sessions | Run Explain 3 times | Sidebar shows 3 entries, newest first | No |
| Reopen preserves content | Explain → click session | Explanation and scaffold match original | No |

### Edge Cases Checklist
- [ ] Click session when no panel is open → panel opens fresh
- [ ] Click session when panel is already open → panel reveals and updates with clicked session's content
- [ ] Sidebar with 0 sessions (fresh start) → no entries, no crash
- [ ] Very long explanation text → panel scrolls correctly

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
- [ ] `F5` to launch extension development host
- [ ] Open any `.py` file, highlight code, right-click → "Explain this"
- [ ] Sidebar shows 1 entry
- [ ] Run Explain on a different file → sidebar shows 2 entries
- [ ] Click first entry → panel updates to show first session's content
- [ ] Sidebar still shows 2 entries (no duplicate added)

---

## Acceptance Criteria
- [ ] `SessionStore.ts` is non-empty and compiles clean
- [ ] Clicking a sidebar session opens the panel with correct content
- [ ] Reopening a session does NOT add a duplicate to the sidebar
- [ ] Existing `explainSelection` and `explainFile` commands still add sessions normally
- [ ] `tsc` and `eslint` pass clean

## Completion Checklist
- [ ] `SessionStore.ts` re-exports `SessionItem`
- [ ] `ExplainPanel.createOrShow` has `addToHistory = true` default param
- [ ] `addSession` call is guarded by `if (addToHistory)`
- [ ] `openSession` command body implemented
- [ ] `SessionItem` imported in `extension.ts`
- [ ] No new `context.subscriptions.push` for `openSession` (already there)
- [ ] `tsc` clean
- [ ] `eslint` clean

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `session` arg typed as `unknown` at runtime | L | Panel opens with undefined content | Confirmed safe: `SessionTreeItem` sets `arguments: [session]` correctly |
| Existing callers break from new param | L | Sessions stop saving | Default `= true` preserves all existing call sites |
| Panel shows stale content on reopen | L | Confusing UX | `_update()` always re-renders the webview HTML |

## Notes
- `SessionTreeProvider` already fully owns the in-memory array — `SessionStore.ts` does not duplicate it. The file is the canonical type export only.
- Phase 3 already wired `sessionProvider.addSession()` — the sidebar is already working. Phase 5 is purely the "click to reopen" feature.
- `deactivate()` in `extension.ts` is a no-op — the `sessionProvider` instance is garbage collected when the extension host shuts down, which clears sessions implicitly (PRD requirement: no persistence across restarts).
