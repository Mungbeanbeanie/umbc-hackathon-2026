<!-- Generated: 2026-04-18 | Files scanned: 4 | Token estimate: ~250 -->

# Dependencies — Explainable VSCode Extension

## Runtime
| Package | Role | Status |
|---------|------|--------|
| vscode (peer) | Extension host API, WebviewPanel, TreeView, commands | In use |
| AI SDK (TBD) | Generate explanations + scaffolds | Not yet added |

## Dev Dependencies
| Package | Role |
|---------|------|
| typescript ^5.9.3 | Compiler |
| @types/vscode ^1.116.0 | VS Code API types |
| @types/node ^22.19.17 | Node.js types |
| eslint ^9.39.3 | Linting |
| typescript-eslint ^8.56.1 | ESLint TS rules |
| @types/mocha ^10.0.10 | Test types |
| @vscode/test-cli ^0.0.12 | Test runner CLI |
| @vscode/test-electron ^2.5.2 | Electron test host |

## VS Code API Surface Used (planned)
```
vscode.commands.registerCommand          context menu + palette commands
vscode.window.createWebviewPanel         split explanation/sandbox panel
vscode.window.createTreeView             session history sidebar
vscode.workspace.openTextDocument        read file content for context
vscode.window.activeTextEditor.selection read highlighted code
ExtensionContext.globalState             persist sessions locally
```

## External Services (TBD)
- AI provider for explanation + scaffold generation (Claude API / OpenAI)
- Vercel Sandbox (optional) for running sandbox code server-side

## Engine Constraint
`vscode >= 1.116.0` (set in package.json)
