# Plan: Phase 4 — Code Execution

## Summary
Create `src/execution/runner.ts` that takes a code string and language identifier, writes a temp file to `os.tmpdir()`, spawns the appropriate local runtime via `child_process.spawn`, captures stdout/stderr, cleans up the temp file, and returns a structured result. Phase 3 (WebviewPanel) calls this module when the webview posts a "run" message.

## User Story
As a CS student, I want to click "Run" in the scaffold pane and see the output immediately, so I can experiment with the concept without leaving VS Code.

## Problem → Solution
Scaffold code sits in a `<textarea>` with no way to execute it → Extension host writes code to a temp file, spawns the right runtime, captures output, and sends it back to the webview to display.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/explainable-vscode-extension.prd.md`
- **PRD Phase**: Phase 4 — Code Execution
- **Estimated Files**: 1 created (`src/execution/runner.ts`); Phase 3 wires it in when handling `postMessage`

---

## UX Design

### Before
```
┌──────────────────────────────────┐
│  [scaffold textarea]             │
│  print("Hello, world!")          │
│                                  │
│  [Run] ← clicks button           │
│  (nothing happens)               │
└──────────────────────────────────┘
```

### After
```
┌──────────────────────────────────┐
│  [scaffold textarea]             │
│  print("Hello, world!")          │
│                                  │
│  [Run]   Running...              │
│  ─────────────────               │
│  Hello, world!                   │
│  (exit 0)                        │
└──────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Run button | No-op | Sends `{type:'run', code, language}` postMessage to extension host | Phase 3 wires the button; Phase 4 handles the message |
| Output area | Hidden / empty | Shows stdout, then stderr (if any), then exit code | Green for exit 0, red for non-zero |
| Unsupported language | N/A | Shows "Language not supported for execution" message | Java, unknown langs |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `explainable/src/extension.ts` | all | Understand where `runCode()` will be called from (Phase 3 panel message handler) |
| P0 | `explainable/src/ai/gemini.ts` | 1-6 | Interface export pattern — mirror this for `RunResult` |
| P1 | `explainable/src/views/SessionTreeProvider.ts` | 1-9 | Named export + interface-at-top pattern |
| P1 | `explainable/tsconfig.json` | all | `module: "Node16"` — must use `import` not `require`; `target: ES2022` |
| P2 | `explainable/package.json` | 69-76 | Build is `tsc -p ./` → `out/`; no bundler |

## External Documentation

| Topic | Key Takeaway |
|---|---|
| `child_process.spawn` (Node.js) | Returns `ChildProcess`; listen `.stdout.on('data')`, `.stderr.on('data')`, `.on('close', (code) => ...)` |
| `fs/promises` (Node16 import) | `import * as fs from 'fs/promises'` → `fs.writeFile()`, `fs.unlink()` |
| `os.tmpdir()` | Returns platform temp dir (e.g. `/tmp` on Mac/Linux, `C:\Users\...\AppData\Local\Temp` on Windows) |
| Spawn timeout | No built-in timeout — set `setTimeout` and call `process.kill()` if exceeded; clear timeout in close handler |
| `npx ts-node` | Works if `ts-node` is globally installed or in project; it's not guaranteed — fall through to showing a compile hint for TypeScript |

---

## Patterns to Mirror

### NAMED_EXPORT_INTERFACE
```typescript
// SOURCE: src/ai/gemini.ts:3-6
export interface GeminiResult {
  explanation: string;
  scaffold: string;
}
```
Define `RunResult` interface at top of file and export it.

### NAMED_ASYNC_FUNCTION_EXPORT
```typescript
// SOURCE: src/ai/gemini.ts:56-75
export async function explainCode(
  code: string,
  language: string,
  fileContext: string,
  apiKey: string
): Promise<GeminiResult> {
  // ...
}
```
Mirror: `export async function runCode(code: string, language: string): Promise<RunResult>`

### ERROR_HANDLING
```typescript
// SOURCE: src/extension.ts:59-62
} catch (err) {
  vscode.window.showErrorMessage(
    `Explainable: ${err instanceof Error ? err.message : 'Unknown error'}`
  );
}
```
Inside runner, propagate errors by resolving (not rejecting) with `error` field in `RunResult`. Caller (Phase 3 panel) surfaces to user.

### LOGGING_PATTERN
```typescript
// SOURCE: src/extension.ts:55
console.log('[Explainable] Gemini result:', result);
```
Use `console.log('[Explainable] runner:', ...)` for debug output.

### NODE16_IMPORTS
```typescript
// SOURCE: src/ai/gemini.ts:1
import { GoogleGenerativeAI } from '@google/generative-ai';
// SOURCE: src/extension.ts:1
import * as vscode from 'vscode';
```
Use ES module `import` syntax throughout. For Node built-ins use `import * as os from 'os'` etc.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `explainable/src/execution/runner.ts` | CREATE | Core deliverable of Phase 4 |

> Phase 3 (ExplainPanel.ts) will `import { runCode } from '../execution/runner'` and call it when handling the webview's `run` postMessage. Phase 4 does NOT touch `extension.ts` or `ExplainPanel.ts` — those belong to Phase 3.

## NOT Building
- The webview HTML/JS Run button itself — that's Phase 3 (ExplainPanel)
- The postMessage bridge wiring — that's Phase 3
- Java execution — PRD explicitly says "Won't: Code execution for Java"
- Cloud/sandboxed execution — local runtime only
- TypeScript execution via ts-node — gracefully degrade to "show compile hint" (ts-node not guaranteed on demo machine)
- HTML "execution" — that's a webview iframe concern in Phase 3, not runner.ts
- Runtime PATH detection at extension load — show a clear error in `RunResult.error` instead

---

## Step-by-Step Tasks

### Task 1: Create `src/execution/runner.ts` — interfaces and language map
- **ACTION**: Create the file with `RunResult` interface and the language-to-runtime mapping
- **IMPLEMENT**:
  ```typescript
  import * as os from 'os';
  import * as path from 'path';
  import * as fs from 'fs/promises';
  import { spawn } from 'child_process';

  export interface RunResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    error?: string;
  }

  const TIMEOUT_MS = 10_000;

  type LangConfig =
    | { kind: 'spawn'; cmd: string; args: (file: string) => string[]; ext: string }
    | { kind: 'json' }
    | { kind: 'unsupported'; reason: string };

  const LANG_MAP: Record<string, LangConfig> = {
    python: { kind: 'spawn', cmd: 'python3', args: f => [f], ext: '.py' },
    python3: { kind: 'spawn', cmd: 'python3', args: f => [f], ext: '.py' },
    javascript: { kind: 'spawn', cmd: 'node', args: f => [f], ext: '.js' },
    typescript: { kind: 'unsupported', reason: 'TypeScript: run with `npx ts-node <file>.ts`' },
    java: { kind: 'unsupported', reason: 'Java: run with `javac <file>.java && java <ClassName>`' },
    json: { kind: 'json' },
    html: { kind: 'unsupported', reason: 'HTML: open in a browser or use the VS Code Live Preview extension.' },
  };
  ```
- **MIRROR**: NODE16_IMPORTS, NAMED_EXPORT_INTERFACE
- **IMPORTS**: `os`, `path`, `fs/promises`, `child_process` — all Node built-ins, no new npm deps
- **GOTCHA**: `module: "Node16"` in tsconfig means you MUST use `import` syntax, not `require()`. Node built-ins are available via `import * as os from 'os'`.
- **VALIDATE**: `tsc -p ./` passes with no errors on this file in isolation

### Task 2: Implement `runCode()` — dispatch on language config kind
- **ACTION**: Add the exported `runCode` function with early-exit branches for non-spawn cases
- **IMPLEMENT**:
  ```typescript
  export async function runCode(code: string, language: string): Promise<RunResult> {
    const config = LANG_MAP[language.toLowerCase()];

    if (!config) {
      return {
        stdout: '',
        stderr: '',
        exitCode: 1,
        error: `Language "${language}" is not supported for execution in Explainable.`,
      };
    }

    if (config.kind === 'unsupported') {
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        error: config.reason,
      };
    }

    if (config.kind === 'json') {
      try {
        const pretty = JSON.stringify(JSON.parse(code), null, 2);
        return { stdout: pretty, stderr: '', exitCode: 0 };
      } catch (e) {
        return {
          stdout: '',
          stderr: e instanceof Error ? e.message : 'Invalid JSON',
          exitCode: 1,
        };
      }
    }

    return spawnProcess(code, config);
  }
  ```
- **MIRROR**: ERROR_HANDLING (resolve with error field, don't reject/throw)
- **GOTCHA**: Do NOT throw from `runCode` — always return a `RunResult`. Phase 3's message handler will check `result.error` and display it.
- **VALIDATE**: Manual call with `language: 'java'` returns `{ exitCode: 0, error: 'Java: run with...' }`

### Task 3: Implement `spawnProcess()` — temp file write + child_process.spawn
- **ACTION**: Write the core execution logic as a private async function
- **IMPLEMENT**:
  ```typescript
  async function spawnProcess(
    code: string,
    config: Extract<LangConfig, { kind: 'spawn' }>
  ): Promise<RunResult> {
    const tmpFile = path.join(os.tmpdir(), `explainable_${Date.now()}${config.ext}`);

    try {
      await fs.writeFile(tmpFile, code, 'utf8');
    } catch (e) {
      return {
        stdout: '',
        stderr: '',
        exitCode: 1,
        error: `Could not write temp file: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    return new Promise<RunResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = spawn(config.cmd, config.args(tmpFile), {
        env: { ...process.env },
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, TIMEOUT_MS);

      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      child.on('close', async (code) => {
        clearTimeout(timer);
        try { await fs.unlink(tmpFile); } catch { /* ignore cleanup errors */ }

        console.log('[Explainable] runner: exit', code, { stdout, stderr });

        if (timedOut) {
          resolve({
            stdout,
            stderr,
            exitCode: code ?? 1,
            error: `Execution timed out after ${TIMEOUT_MS / 1000}s`,
          });
          return;
        }

        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });

      child.on('error', async (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        try { await fs.unlink(tmpFile); } catch { /* ignore */ }

        // Fallback: retry with 'python' if 'python3' was not found
        if (err.code === 'ENOENT' && config.cmd === 'python3') {
          resolve(spawnProcess(code, { ...config, cmd: 'python' }));
          return;
        }

        resolve({
          stdout: '',
          stderr: '',
          exitCode: 1,
          error: `Could not start "${config.cmd}": ${err.message}. Is it installed and on your PATH?`,
        });
      });
    });
  }
  ```
- **MIRROR**: LOGGING_PATTERN, ERROR_HANDLING (resolve not reject)
- **IMPORTS**: All already imported in Task 1
- **GOTCHA**: `child.stdout` / `child.stderr` are `null` when `stdio` is not `'pipe'`. `spawn()` defaults to `'pipe'` for stdio — do NOT pass `stdio: 'inherit'` or you'll lose the streams.
- **GOTCHA**: `child.on('error')` fires when the binary is not found (ENOENT). Without this handler the error is unhandled and crashes the extension host.
- **GOTCHA**: The `code` argument to `close` is `number | null` — use `code ?? 1` as fallback.
- **GOTCHA**: Temp file cleanup is wrapped in `try/catch` — the file may already be gone if the process deleted it. Never let cleanup errors surface.
- **VALIDATE**: `runCode('print("hello")', 'python')` returns `{ stdout: 'hello\n', stderr: '', exitCode: 0 }`

---

## Integration Contract for Phase 3

Phase 3 (ExplainPanel.ts) will call `runCode` when it receives a `{ type: 'run', code: string, language: string }` postMessage from the webview. The call and result relay looks like:

```typescript
// Inside ExplainPanel message handler (Phase 3 writes this):
import { runCode } from '../execution/runner';

panel.webview.onDidReceiveMessage(async (msg) => {
  if (msg.type === 'run') {
    const result = await runCode(msg.code, msg.language);
    panel.webview.postMessage({ type: 'runResult', result });
  }
});
```

The webview JS (Phase 3) then renders `result.stdout`, `result.stderr`, `result.error`, and `result.exitCode`. Phase 4 does NOT write this wiring — only the `runCode` function and its types.

---

## Testing Strategy

### Manual Smoke Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Python happy path | `print("hello")`, `python` | `{ stdout: 'hello\n', exitCode: 0 }` | No |
| JS happy path | `console.log(42)`, `javascript` | `{ stdout: '42\n', exitCode: 0 }` | No |
| Python runtime error | `print(undefined_var)`, `python` | `{ stderr: 'NameError...', exitCode: 1 }` | No |
| Invalid JSON | `{bad json}`, `json` | `{ stderr: 'SyntaxError...', exitCode: 1 }` | No |
| Valid JSON | `{"a":1}`, `json` | `{ stdout: '{\n  "a": 1\n}', exitCode: 0 }` | No |
| Java | any code, `java` | `{ error: 'Java: run with...', exitCode: 0 }` | No |
| Unknown lang | any code, `ruby` | `{ error: 'Language "ruby" is not supported...', exitCode: 1 }` | No |
| Timeout | `while True: pass`, `python` | `{ error: 'Execution timed out...', exitCode: 1 }` after 10s | Yes |
| python3 not found | any py code | retries with `python`; if also absent shows PATH error | Yes |

### Edge Cases Checklist
- [ ] Empty code string (writes empty file; Python/JS exit 0 — acceptable)
- [ ] Code with Unicode characters (file written as UTF-8)
- [ ] Very large stdout (all chunks concatenated; no truncation in runner)
- [ ] Process writes to stderr but exits 0 (both fields captured correctly)
- [ ] `python3` not on PATH (fallback to `python`)
- [ ] Neither python3 nor python on PATH (`error` field set)
- [ ] Execution timeout (SIGTERM sent; `error` field set)

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
- [ ] `runCode('print("hello")', 'python')` → `{ stdout: 'hello\n', exitCode: 0 }`
- [ ] `runCode('console.log(1)', 'javascript')` → `{ stdout: '1\n', exitCode: 0 }`
- [ ] `runCode('any', 'java')` → `{ error: 'Java: run with...', exitCode: 0 }`
- [ ] `runCode('{"key":"value"}', 'json')` → `{ stdout: '{\n  "key": "value"\n}', exitCode: 0 }`
- [ ] `runCode('while True: pass', 'python')` → after 10s: `{ error: 'Execution timed out...' }`

---

## Acceptance Criteria
- [ ] `src/execution/runner.ts` created and compiles clean
- [ ] `runCode('print("hello")', 'python')` returns `{ stdout: 'hello\n', exitCode: 0 }`
- [ ] `runCode('console.log(1)', 'javascript')` returns `{ stdout: '1\n', exitCode: 0 }`
- [ ] `runCode('any', 'java')` returns `{ error: 'Java: ...', exitCode: 0 }` (no crash)
- [ ] `runCode('{"a":1}', 'json')` returns pretty-printed JSON in `stdout`
- [ ] 10-second timeout resolves with `error` field (not a hung promise)
- [ ] Temp files cleaned up after execution
- [ ] `tsc` and `eslint` pass clean

## Completion Checklist
- [ ] `src/execution/` directory created
- [ ] `src/execution/runner.ts` created
- [ ] `RunResult` interface exported
- [ ] `runCode()` function exported
- [ ] All 4 language path branches: spawn, json, unsupported, unknown
- [ ] `python3`→`python` fallback in `error` handler
- [ ] Timeout (SIGTERM after 10s) implemented
- [ ] Temp file cleanup in both `close` and `error` handlers (try/catch)
- [ ] No `require()` calls — Node16 module format uses `import`
- [ ] `tsc` and `eslint` clean

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `python3` not on PATH on demo machine | M | Python scaffold won't run | Fallback to `python` in error handler |
| `node` not on PATH | L | JS scaffold won't run | `error` field with helpful message |
| Child process hangs (infinite loop) | M | Panel freezes | 10s SIGTERM timeout |
| Temp file write fails | L | Error shown to user | Caught and returned as `error` field |
| TypeScript strict: `fs/promises` import type error | L | Compile error | Use `import { writeFile, unlink } from 'fs/promises'` named imports |

## Notes
- Phase 3 and Phase 4 are independent. Phase 4 ships `runner.ts` with a clean exported API; Phase 3 imports it. Neither needs the other to compile.
- `RunResult.error` vs `stderr`: `error` = "couldn't run at all" (no binary, timeout, write failure). `stderr` = "ran but code itself errored" (exception, syntax error). Phase 3 should display both distinctly.
- Temp files are named `explainable_<timestamp><ext>` — OS cleans tmpdir periodically; we also unlink immediately after execution.
- Java is explicitly out of scope per the PRD "Won't" list. The unsupported message guides the student to compile manually.
