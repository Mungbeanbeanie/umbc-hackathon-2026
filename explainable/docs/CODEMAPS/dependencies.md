<!-- Generated: 2026-04-18 | Files scanned: 8 | Token estimate: ~250 -->
# Dependencies

## Runtime
| Package | Version | Purpose |
|---------|---------|---------|
| `vscode` | peer ^1.116.0 | VS Code extension API (provided by host) |
| `@google/generative-ai` | ^0.24.1 | Gemini API client |

## Dev / Build
| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.9.3 | Compiler |
| `@types/vscode` | ^1.116.0 | VS Code type definitions |
| `@types/node` | ^22.19.17 | Node type definitions |
| `eslint` | ^9.39.3 | Linting |
| `typescript-eslint` | ^8.56.1 | TypeScript ESLint rules |
| `@vscode/test-cli` | ^0.0.11 | Test runner CLI |
| `@vscode/test-electron` | ^2.5.2 | Electron test host |
| `@types/mocha` | ^10.0.10 | Test type definitions |

## External Services
- **Gemini API** — model `gemini-2.5-flash`; called from extension host via `@google/generative-ai`
- API key stored in VS Code secret storage (`context.secrets`); prompted on first use

## Node Built-ins Used
- `crypto` — `randomBytes` for CSP nonces
- `child_process` — `spawn` for code execution
- `fs/promises` — temp file I/O
- `os` — `os.tmpdir()` for temp file location
- `path` — path joining
