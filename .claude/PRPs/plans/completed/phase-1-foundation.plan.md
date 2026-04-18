# Plan: Phase 1 — Foundation

## Summary
Wire up the VSCode extension skeleton so "Explain this" appears in the editor right-click menu, "Explain this file" appears in the Explorer context menu, and an activity bar icon opens a sidebar with a session list. All command handlers are stubs that print to the output channel — no AI, no panel, just the plumbing.

## User Story
As a CS student, I want to right-click highlighted code and see "Explain this" so that I can trigger the explanation flow from inside the editor without leaving my workflow.

## Problem → Solution
Single placeholder `helloWorld` command with no context menu registration → Two named commands registered in the correct menu contribution points, an activity bar container, and a tree view ready to receive session data.

## Metadata
- **Complexity**: Small
- **Source PRD**: `.claude/PRPs/prds/explainable-vscode-extension.prd.md`
- **PRD Phase**: Phase 1 — Foundation
- **Estimated Files**: 4 (2 modified, 2 created)

---

## UX Design

### Before
```
Right-click in editor  →  (no Explainable option)
Right-click file       →  (no Explainable option)
Activity bar           →  (no Explainable icon)
```

### After
```
Right-click on selected code  →  "Explain this"        →  stub fires
Right-click file in Explorer  →  "Explain this file"   →  stub fires
Activity bar                  →  💡 Explainable icon   →  sidebar opens
Sidebar                       →  "Sessions" tree view  →  (empty list)
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Editor context menu | No extension items | "Explain this" (only when text selected) | `when: editorHasSelection` |
| Explorer context menu | No extension items | "Explain this file" | `when: !explorerResourceIsFolder` |
| Activity bar | Nothing | Explainable icon | SVG icon at `resources/icon.svg` |
| Sidebar | N/A | Empty "Sessions" TreeView | Populated in Phase 5 |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `explainable/src/extension.ts` | 1-27 | Only existing code; pattern for `activate()` and `context.subscriptions.push()` |
| P0 | `explainable/package.json` | 1-40 | `contributes` structure to extend; engine version |

## External Documentation
| Topic | Source | Key Takeaway |
|---|---|---|
| Context menu `when` clauses | VSCode docs | `editorHasSelection` for editor selection; `!explorerResourceIsFolder` for files |
| viewsContainers | VSCode docs | icon must be a path to an SVG file relative to extension root |
| TreeDataProvider | VSCode docs | Implement `getTreeItem()` and `getChildren()` interface |

---

## Patterns to Mirror

### ACTIVATION_PATTERN
```typescript
// SOURCE: src/extension.ts:7-24
export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('explainable.helloWorld', () => {
    vscode.window.showInformationMessage('Hello World from Explainable!');
  });
  context.subscriptions.push(disposable);
}
```
Follow this: every `registerCommand` result is pushed to `context.subscriptions`.

### COMMAND_ID_CONVENTION
All command IDs use the `explainable.` namespace prefix, camelCase suffix:
- `explainable.helloWorld` (existing)
- `explainable.explainSelection` (new)
- `explainable.explainFile` (new)

### TREE_DATA_PROVIDER_PATTERN
```typescript
// Minimal TreeDataProvider stub (no SOURCE — new pattern for this project)
class SessionTreeProvider implements vscode.TreeDataProvider<SessionItem> {
  getTreeItem(element: SessionItem): vscode.TreeItem {
    return element;
  }
  getChildren(element?: SessionItem): SessionItem[] {
    return element ? [] : [];
  }
}
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `explainable/package.json` | UPDATE | Add commands, menus, viewsContainers, views, activationEvents |
| `explainable/src/extension.ts` | UPDATE | Register new commands + TreeDataProvider; remove helloWorld stub |
| `explainable/src/views/SessionTreeProvider.ts` | CREATE | Stub TreeDataProvider for the sidebar |
| `explainable/resources/icon.svg` | CREATE | Activity bar icon (required by viewsContainers) |

## NOT Building
- Actual explanation logic (Phase 2)
- WebviewPanel (Phase 3)
- Code execution (Phase 4)
- Populated session list (Phase 5)
- Real icon design (use simple SVG for now)

---

## Step-by-Step Tasks

### Task 1: Create the activity bar SVG icon
- **ACTION**: Create `explainable/resources/icon.svg`
- **IMPLEMENT**: Write this exact SVG (info/lightbulb icon, monochrome, 24×24):
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
</svg>
```
- **GOTCHA**: Path must be relative to the extension root in package.json, i.e., `"icon": "resources/icon.svg"` — NOT a URL, NOT absolute
- **VALIDATE**: File exists at `explainable/resources/icon.svg`

### Task 2: Update package.json contributions
- **ACTION**: Replace the entire `contributes` block and add `activationEvents`
- **IMPLEMENT**: Use this exact JSON (replace existing `contributes` key):
```json
"activationEvents": [
  "onStartupFinished"
],
"contributes": {
  "commands": [
    {
      "command": "explainable.explainSelection",
      "title": "Explain this",
      "category": "Explainable"
    },
    {
      "command": "explainable.explainFile",
      "title": "Explain this file",
      "category": "Explainable"
    }
  ],
  "menus": {
    "editor/context": [
      {
        "command": "explainable.explainSelection",
        "when": "editorHasSelection",
        "group": "navigation"
      }
    ],
    "explorer/context": [
      {
        "command": "explainable.explainFile",
        "when": "!explorerResourceIsFolder",
        "group": "navigation"
      }
    ]
  },
  "viewsContainers": {
    "activitybar": [
      {
        "id": "explainable-sidebar",
        "title": "Explainable",
        "icon": "resources/icon.svg"
      }
    ]
  },
  "views": {
    "explainable-sidebar": [
      {
        "id": "explainableSessions",
        "name": "Sessions"
      }
    ]
  }
}
```
- **GOTCHA**: The `views` key must match the `id` in `viewsContainers` exactly (`"explainable-sidebar"`). Mismatch = sidebar never appears.
- **GOTCHA**: `activationEvents: ["onStartupFinished"]` ensures the extension loads immediately on startup rather than waiting for a command. Required so the sidebar TreeView appears before any command is run.
- **VALIDATE**: `npm run compile` passes with no errors; open extension in Run & Debug and confirm no JSON parse errors in Extension Host output

### Task 3: Create SessionTreeProvider stub
- **ACTION**: Create `explainable/src/views/SessionTreeProvider.ts`
- **IMPLEMENT**:
```typescript
import * as vscode from 'vscode';

export interface SessionItem {
  label: string;
  timestamp: number;
}

export class SessionTreeItem extends vscode.TreeItem {
  constructor(public readonly session: SessionItem) {
    super(session.label, vscode.TreeItemCollapsibleState.None);
    this.description = new Date(session.timestamp).toLocaleTimeString();
    this.tooltip = session.label;
  }
}

export class SessionTreeProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private sessions: SessionItem[] = [];

  addSession(item: SessionItem): void {
    this.sessions.unshift(item);
    this._onDidChangeTreeData.fire();
  }

  clearSessions(): void {
    this.sessions = [];
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SessionTreeItem): SessionTreeItem[] {
    if (element) {
      return [];
    }
    return this.sessions.map(s => new SessionTreeItem(s));
  }
}
```
- **MIRROR**: TREE_DATA_PROVIDER_PATTERN above
- **GOTCHA**: `EventEmitter` must be disposed — it's added to `context.subscriptions` in extension.ts (Task 4)
- **VALIDATE**: `npm run compile` with no type errors on this file

### Task 4: Rewrite extension.ts
- **ACTION**: Replace the entire file with the new implementation
- **IMPLEMENT**:
```typescript
import * as vscode from 'vscode';
import { SessionTreeProvider } from './views/SessionTreeProvider';

export function activate(context: vscode.ExtensionContext) {
  const sessionProvider = new SessionTreeProvider();

  const treeView = vscode.window.createTreeView('explainableSessions', {
    treeDataProvider: sessionProvider,
    showCollapseAll: false,
  });

  const explainSelection = vscode.commands.registerCommand(
    'explainable.explainSelection',
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor.');
        return;
      }
      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showWarningMessage('No text selected. Highlight code first.');
        return;
      }
      const selectedText = editor.document.getText(selection);
      const language = editor.document.languageId;
      // TODO Phase 2: pass (selectedText, language, fileContext) to Gemini
      // TODO Phase 3: open ExplainPanel with result
      vscode.window.showInformationMessage(
        `[Stub] Explaining ${language} selection (${selectedText.length} chars)`
      );
    }
  );

  const explainFile = vscode.commands.registerCommand(
    'explainable.explainFile',
    (uri: vscode.Uri) => {
      const filePath = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
      if (!filePath) {
        vscode.window.showWarningMessage('No file selected.');
        return;
      }
      // TODO Phase 2: pass (filePath, fileContent) to Gemini
      // TODO Phase 3: open ExplainPanel with result
      vscode.window.showInformationMessage(`[Stub] Explaining file: ${filePath}`);
    }
  );

  context.subscriptions.push(
    treeView,
    explainSelection,
    explainFile,
    sessionProvider['_onDidChangeTreeData']
  );
}

export function deactivate() {}
```
- **MIRROR**: ACTIVATION_PATTERN above
- **GOTCHA**: The `explainFile` command receives a `vscode.Uri` as its first argument when triggered from the Explorer context menu. Always default-guard with `uri?.fsPath`.
- **GOTCHA**: `'explainableSessions'` string in `createTreeView` must exactly match the view `id` in `package.json`. Copy-paste, don't type.
- **VALIDATE**: `npm run compile` passes; open Run & Debug, right-click selected text → "Explain this" → info message appears; activity bar icon is visible

---

## Testing Strategy

### Manual Tests (no unit tests needed for stub phase)

| Test | Steps | Expected |
|---|---|---|
| Context menu appears | Open any file, select text, right-click | "Explain this" visible in menu |
| Context menu hidden when no selection | Open file, click (no selection), right-click | "Explain this" NOT in menu |
| File context menu | Right-click a file in Explorer | "Explain this file" visible |
| File context menu hidden on folder | Right-click a folder in Explorer | "Explain this file" NOT visible |
| Activity bar icon | Look at activity bar | Explainable icon visible |
| Sidebar opens | Click Explainable icon | "Sessions" panel opens (empty) |
| Stub message — selection | Select code → "Explain this" | Info message with char count |
| Stub message — file | Right-click file → "Explain this file" | Info message with file path |

### Edge Cases Checklist
- [ ] No editor open: `explainSelection` shows warning, not crash
- [ ] Command palette: both commands findable via `Explainable: Explain this`

---

## Validation Commands

### Static Analysis
```bash
cd explainable && npm run compile
```
EXPECT: Zero TypeScript errors, zero lint errors

### Start Extension
Open VS Code, press `F5` (or Run > Start Debugging with `Extension Development Host` launch config).
EXPECT: Extension host launches, new VS Code window opens

### Manual Validation
- [ ] Right-click selected text → "Explain this" in menu
- [ ] Right-click with no selection → "Explain this" NOT in menu
- [ ] Right-click file → "Explain this file" in menu
- [ ] Right-click folder → "Explain this file" NOT in menu
- [ ] Activity bar shows Explainable icon
- [ ] Clicking icon opens "Sessions" panel (empty)
- [ ] `npm run compile` exits with code 0

---

## Acceptance Criteria
- [ ] `npm run compile` passes
- [ ] Editor context menu shows "Explain this" only when text selected
- [ ] Explorer context menu shows "Explain this file" only on files
- [ ] Activity bar icon visible and opens sidebar
- [ ] Sidebar "Sessions" panel renders (empty)
- [ ] Both stub commands fire without crashing

## Completion Checklist
- [ ] `resources/icon.svg` created
- [ ] `package.json` updated with all 4 contribution blocks (commands, menus, viewsContainers, views)
- [ ] `src/views/SessionTreeProvider.ts` created with EventEmitter pattern
- [ ] `src/extension.ts` updated: imports SessionTreeProvider, registers both commands + treeView
- [ ] No `helloWorld` references remain anywhere
- [ ] `npm run compile` clean

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `viewsContainers` id mismatch | M | Sidebar never appears | Copy-paste the id; don't retype |
| Icon SVG path wrong | M | Activity bar shows broken icon | Use `"resources/icon.svg"` relative to root |
| `activationEvents` missing | L | TreeView doesn't load until command runs | Use `"onStartupFinished"` |

## Notes
- The `SessionTreeProvider` is built with `addSession()` and `clearSessions()` already defined so Phase 5 can just call those methods without touching this file again.
- The `explainSelection` and `explainFile` command bodies have TODO comments marking exactly where Phase 2 and Phase 3 will plug in — this reduces merge conflicts when building in parallel.
- Do NOT add `"explainable.helloWorld"` back to `package.json` — remove it completely.
