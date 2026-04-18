# Plan: Phase 2 — AI Integration

## Summary
Install the Gemini SDK, create `src/ai/gemini.ts` with a single `explainCode()` function that returns a structured `{ explanation, scaffold }` object, add a `geminiApiKey` VS Code setting, and update both command handlers in `extension.ts` to call Gemini and log the result. The panel (Phase 3) plugs in at the TODO comments left in extension.ts.

## User Story
As the extension, I want to send selected code + file context to Gemini and receive a plain-English explanation and a minimal runnable scaffold, so Phase 3 can render them in the split panel.

## Problem → Solution
Commands fire stubs with `console.log` → Commands call `explainCode()`, log real Gemini output, show "Explanation ready" info message.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/explainable-vscode-extension.prd.md`
- **PRD Phase**: Phase 2 — AI Integration
- **Estimated Files**: 3 (1 created, 2 updated)

---

## UX Design

Internal change — no user-facing UX transformation beyond replacing the "[Stub]" info message with "Explaining... ⏳" while loading and "Explanation ready!" on success.

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| "Explain this" fires | Shows "[Stub] Explaining..." instantly | Shows "Explaining... ⏳", then "Explanation ready!" | Async Gemini call |
| Error case | Never errors | Shows VS Code error notification | API key missing / network failure |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `explainable/src/extension.ts` | all | Both TODO Phase 2 comments are the exact insertion points |
| P0 | `explainable/src/views/SessionTreeProvider.ts` | 1-9 | `SessionItem` interface — `explanation` and `scaffold` fields match Gemini output shape |
| P1 | `explainable/package.json` | 1-20 | `contributes` block to extend with `configuration` section |

## External Documentation

| Topic | Key Takeaway |
|---|---|
| `@google/generative-ai` SDK | `new GoogleGenerativeAI(key)` → `.getGenerativeModel({ model })` → `.generateContent(prompt)` → `.response.text()` |
| Gemini model name | Use `"gemini-2.0-flash"` — fastest, sufficient for structured text output |
| Structured output strategy | Ask for JSON in the prompt; parse with `JSON.parse()` after stripping markdown fences |

---

## Patterns to Mirror

### ASYNC_COMMAND_PATTERN
```typescript
// SOURCE: src/extension.ts:36-47 (explainFile is already async)
const explainFile = vscode.commands.registerCommand(
  'explainable.explainFile',
  async (uri: vscode.Uri) => {
    // ...
  }
);
```
Make `explainSelection` async the same way.

### ERROR_HANDLING
```typescript
// SOURCE: src/extension.ts (guard pattern used throughout)
if (!editor) {
  vscode.window.showWarningMessage('No active editor.');
  return;
}
```
For Gemini errors: wrap the call in try/catch, surface via `vscode.window.showErrorMessage()`.

### TYPE_EXPORT_PATTERN
```typescript
// SOURCE: src/views/SessionTreeProvider.ts:3-9
export interface SessionItem {
  label: string;
  timestamp: number;
  explanation: string;
  scaffold: string;
  language: string;
}
```
Export types from their home file; import them where needed.

### CONFIG_READ_PATTERN
```typescript
// Standard VS Code config read (new to this codebase — establish here)
const apiKey = vscode.workspace
  .getConfiguration('explainable')
  .get<string>('geminiApiKey') ?? '';
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `explainable/package.json` | UPDATE | Add `contributes.configuration` for `geminiApiKey` setting |
| `explainable/src/ai/gemini.ts` | CREATE | Gemini client + prompt logic |
| `explainable/src/extension.ts` | UPDATE | Replace TODO Phase 2 stubs with real Gemini calls |

## NOT Building
- WebviewPanel rendering (Phase 3)
- Code execution (Phase 4)
- Session storage (Phase 5)
- Streaming response — use single `generateContent()` call, simpler
- Retry logic — hackathon scope, single attempt is fine

---

## Step-by-Step Tasks

### Task 1: Install Gemini SDK
- **ACTION**: Add `@google/generative-ai` as a runtime dependency
- **IMPLEMENT**: Run in `explainable/` directory:
  ```bash
  npm install @google/generative-ai
  ```
- **GOTCHA**: Must be `dependencies`, NOT `devDependencies` — the extension bundles and ships this package. VSCode extensions that use `devDependencies` for runtime packages will fail when installed from VSIX.
- **VALIDATE**: `"@google/generative-ai"` appears in `dependencies` block of `package.json` (not `devDependencies`)

### Task 2: Add geminiApiKey setting to package.json
- **ACTION**: Add a `configuration` block to `contributes` in `package.json`
- **IMPLEMENT**: Inside the `"contributes"` object, add this key alongside `commands`, `menus`, `viewsContainers`, `views`:
  ```json
  "configuration": {
    "title": "Explainable",
    "properties": {
      "explainable.geminiApiKey": {
        "type": "string",
        "default": "",
        "markdownDescription": "Your [Gemini API key](https://aistudio.google.com/app/apikey) for code explanations."
      }
    }
  }
  ```
- **GOTCHA**: The property name must be `"explainable.geminiApiKey"` — the `explainable.` prefix is mandatory for VS Code to scope it to this extension.
- **VALIDATE**: After compile + F5, open VS Code Settings and search "Explainable" — the API key field appears

### Task 3: Create src/ai/gemini.ts
- **ACTION**: Create the Gemini client module
- **IMPLEMENT**: Write this file exactly:
  ```typescript
  import { GoogleGenerativeAI } from '@google/generative-ai';

  export interface GeminiResult {
    explanation: string;
    scaffold: string;
  }

  const MODEL = 'gemini-2.0-flash';

  const SYSTEM_PROMPT = `You are a patient CS tutor helping students understand code they did not write.
  You must respond ONLY with valid JSON — no markdown, no prose outside the JSON object.
  The JSON must have exactly two keys: "explanation" and "scaffold".`;

  function buildPrompt(code: string, language: string, fileContext: string): string {
    const contextSnippet = fileContext.slice(0, 3000);
    return `Language: ${language}

  SELECTED CODE:
  \`\`\`${language}
  ${code}
  \`\`\`

  SURROUNDING FILE CONTEXT (for reference only):
  \`\`\`${language}
  ${contextSnippet}
  \`\`\`

  Instructions:
  1. "explanation": Explain what the SELECTED CODE does in plain English. Focus on the highest-level construct present (if it is a loop, explain the loop; if it is a class, explain the class; if it is a function call, explain what it does in context). Assume the student knows variables, functions, and basic data types but may not know this specific pattern. Maximum 150 words. Be concrete — mention the actual variable names and values from the code.
  2. "scaffold": Write a minimal bare-bones ${language} example of the SAME construct type. Do NOT copy the original code. Use generic names (items, result, callback, etc.). Add short TODO comments showing where the student should put their own logic. Maximum 20 lines.

  Respond with ONLY this JSON (no markdown fences, no extra keys):
  {"explanation": "...", "scaffold": "..."}`;
  }

  function parseResult(raw: string): GeminiResult {
    // Strip markdown fences if Gemini wraps in ```json ... ```
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    try {
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      if (typeof parsed.explanation !== 'string' || typeof parsed.scaffold !== 'string') {
        throw new Error('Missing explanation or scaffold field');
      }
      return { explanation: parsed.explanation, scaffold: parsed.scaffold };
    } catch {
      // Fallback: return raw text as explanation, empty scaffold
      return { explanation: raw, scaffold: `# Could not generate scaffold\n# Raw response above\n` };
    }
  }

  export async function explainCode(
    code: string,
    language: string,
    fileContext: string,
    apiKey: string
  ): Promise<GeminiResult> {
    if (!apiKey) {
      throw new Error('Gemini API key not set. Go to Settings → search "Explainable" → enter your API key.');
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: SYSTEM_PROMPT,
    });
    const result = await model.generateContent(buildPrompt(code, language, fileContext));
    const raw = result.response.text();
    return parseResult(raw);
  }
  ```
- **IMPORTS**: `import { GoogleGenerativeAI } from '@google/generative-ai';`
- **GOTCHA**: `systemInstruction` is supported in `getGenerativeModel()` options in `@google/generative-ai` v0.21+. If you get a type error, move the system prompt into the user prompt instead (prepend `SYSTEM_PROMPT + '\n\n' + buildPrompt(...)`).
- **GOTCHA**: `result.response.text()` can throw if Gemini returns a safety block. The catch in `parseResult` won't help here — wrap the whole `generateContent` call in try/catch in extension.ts (Task 4).
- **VALIDATE**: `./node_modules/.bin/tsc -p ./` passes with no errors

### Task 4: Update extension.ts — wire in Gemini calls
- **ACTION**: Replace both TODO Phase 2 comment blocks in the command handlers
- **IMPLEMENT**:

  In `explainSelection`, change the command handler to async and replace the stub block:
  ```typescript
  const explainSelection = vscode.commands.registerCommand(
    'explainable.explainSelection',
    async () => {
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
      const fileContext = editor.document.getText();

      const apiKey = vscode.workspace
        .getConfiguration('explainable')
        .get<string>('geminiApiKey') ?? '';

      vscode.window.showInformationMessage('Explainable: Explaining... ⏳');
      try {
        const result = await explainCode(selectedText, language, fileContext, apiKey);
        console.log('[Explainable] Gemini result:', result);
        // TODO Phase 3: ExplainPanel.createOrShow(context, result, language, sessionProvider);
        vscode.window.showInformationMessage('Explainable: Explanation ready!');
      } catch (err) {
        vscode.window.showErrorMessage(
          `Explainable: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }
  );
  ```

  In `explainFile`, replace its stub block:
  ```typescript
  const explainFile = vscode.commands.registerCommand(
    'explainable.explainFile',
    async (uri: vscode.Uri) => {
      const filePath = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
      if (!filePath) {
        vscode.window.showWarningMessage('No file selected.');
        return;
      }
      const document = await vscode.workspace.openTextDocument(filePath);
      const language = document.languageId;
      const fileContent = document.getText();

      const apiKey = vscode.workspace
        .getConfiguration('explainable')
        .get<string>('geminiApiKey') ?? '';

      vscode.window.showInformationMessage('Explainable: Explaining... ⏳');
      try {
        const result = await explainCode(fileContent, language, fileContent, apiKey);
        console.log('[Explainable] Gemini result:', result);
        // TODO Phase 3: ExplainPanel.createOrShow(context, result, language, sessionProvider);
        vscode.window.showInformationMessage('Explainable: Explanation ready!');
      } catch (err) {
        vscode.window.showErrorMessage(
          `Explainable: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }
  );
  ```

  Add import at top of `extension.ts`:
  ```typescript
  import { explainCode } from './ai/gemini';
  ```

- **MIRROR**: ASYNC_COMMAND_PATTERN, ERROR_HANDLING, CONFIG_READ_PATTERN
- **GOTCHA**: The `context` variable from `activate(context)` is needed in Phase 3's TODO comment — keep it in scope, don't rename it.
- **VALIDATE**: `./node_modules/.bin/tsc -p ./` passes. Then F5 → select Python code → "Explain this" → see "Explaining... ⏳" → then "Explanation ready!" → check Output panel / Dev Tools console for the Gemini JSON.

---

## Testing Strategy

### Manual Smoke Test (primary validation for hackathon)

| Test | Steps | Expected |
|---|---|---|
| Happy path | Set API key in settings, highlight `for i in range(10): print(i)`, click "Explain this" | "Explaining..." then "Explanation ready!" in ~2-4s; JSON logged to console |
| No API key | Leave API key blank, click "Explain this" | Error notification: "Gemini API key not set..." |
| Network failure | Use invalid API key | Error notification with Gemini's error message |
| File explain | Right-click a `.py` file → "Explain this file" | Same flow, explanation covers file-level concept |

### Edge Cases Checklist
- [ ] Empty selection (already guarded in Phase 1 — verify still works)
- [ ] Very long file context (truncated to 3000 chars in `buildPrompt`)
- [ ] Gemini returns markdown-fenced JSON — `parseResult` strips fences
- [ ] Gemini returns non-JSON — `parseResult` fallback returns raw text

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
- [ ] `npm install @google/generative-ai` completed; package appears in `dependencies` (not `devDependencies`)
- [ ] Settings → search "Explainable" → API key field visible
- [ ] Set real Gemini API key in settings
- [ ] Select a Python `for` loop → "Explain this" → console shows `{ explanation: "...", scaffold: "..." }`
- [ ] `tsc` clean after all changes

---

## Acceptance Criteria
- [ ] `@google/generative-ai` in `dependencies`
- [ ] `explainable.geminiApiKey` setting visible in VS Code Settings UI
- [ ] `src/ai/gemini.ts` created with `explainCode()` export
- [ ] Both command handlers call `explainCode()` and log the result
- [ ] Missing API key shows a helpful error message
- [ ] `tsc` and `eslint` both pass clean

## Completion Checklist
- [ ] `npm install` done in `explainable/` directory
- [ ] `package.json` has `configuration` in `contributes` AND `@google/generative-ai` in `dependencies`
- [ ] `src/ai/` directory created
- [ ] `src/ai/gemini.ts` created
- [ ] `extension.ts` imports `explainCode` from `./ai/gemini`
- [ ] Both command stubs replaced with real async Gemini calls
- [ ] TODO Phase 3 comments preserved for next phase

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `systemInstruction` type error in older SDK version | M | Won't compile | Move system prompt inline (prepend to user prompt string) |
| Gemini rate-limits during demo | L | Demo fails | Use `gemini-2.0-flash` (generous free tier) |
| Response not valid JSON | M | Explanation blank | `parseResult` fallback returns raw text — still usable |
| API key stored in settings is visible in plain text | L | Security note | Acceptable for hackathon demo; note to judges it would use secret storage in production |

## Notes
- The `explainFile` command passes `fileContent` as both the "code" and "fileContext" arguments — this is intentional. For a file-level explanation, the whole file is both the subject and the context.
- Partner working on Phase 4 (code execution) does NOT need to touch `gemini.ts` — the output shape `{ explanation, scaffold }` is all they need to know, and it's already in `SessionItem` interface.
- Phase 3 plugs in at the `// TODO Phase 3: ExplainPanel.createOrShow(...)` comment lines. Pass `(context, result, language, sessionProvider)` — Phase 3 will define that function signature.
