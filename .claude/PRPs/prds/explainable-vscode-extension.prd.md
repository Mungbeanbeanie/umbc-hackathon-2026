# Explainable — VSCode Extension

*Generated: 2026-04-18 | Status: DRAFT*

---

## Problem Statement

CS students at every level increasingly receive working code from AI tools without understanding what it does or why it works. When they submit, they can pass an assignment but fail the next exam, interview, or real-world task. The gap between "AI wrote it" and "I understand it" is widening, and no existing tool lives inside the IDE where the student actually encounters the code.

## Evidence

- Anecdotal: Widespread student use of ChatGPT/Copilot for assignments without reading the output (hackathon motivation)
- Observable behavior: Students copy-paste AI output verbatim, rename variables, and submit — never engaging with the logic
- Assumption: Students want to understand their code but the friction of looking it up externally (MDN, Stack Overflow, docs) is too high — needs validation through user observation

## Proposed Solution

A VSCode extension that intercepts the "I don't understand this" moment inside the editor itself. When a student highlights code or right-clicks a file, a split-panel appears: the left shows a plain-English contextual explanation pitched one level above what the student already knows; the right shows a runnable bare scaffold of the same concept so they can experiment immediately. Sessions persist only for the current VS Code window lifetime, so there's no account friction.

## Key Hypothesis

We believe providing an in-editor contextual explanation + runnable sandbox will help CS students at all levels understand the AI-generated code in front of them, so they can answer "what does this do and why" without leaving VS Code. We'll know we're right when a student can explain what their highlighted code does immediately after using the extension (qualitative demo test at hackathon).

## What We're NOT Building

- **Cross-session persistence** — sessions clear when VS Code closes; no database, no account, no sync
- **Custom Monaco editor** — use a `<textarea>` or VS Code's terminal for the sandbox; full Monaco is too much scope
- **Cloud execution** — code runs via the user's local runtime (Python, Node, Java); no server-side sandboxing
- **Uncommonly used languages** — scope to Python, JavaScript, TypeScript, Java, HTML, JSON only
- **Multi-file / project-wide refactoring** — explanation is scoped to the selection or single file, not the whole repo

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Demo works end-to-end | 1 working demo by deadline | Manual test: highlight → explain → run |
| Explanation quality | Judges understand it immediately | Hackathon judge feedback |
| Latency | < 5s from selection to panel open | Stopwatch during demo |

## Open Questions

- [ ] Does Gemini API require CORS headers in a WebviewPanel? (need to proxy through extension host)
- [ ] Java scaffold execution: does the demo machine have JDK? (safe fallback: skip Java execution, show compile hint)
- [ ] HTML: "run" means open in webview iframe — is that sufficient for demo?

---

## Users & Context

**Primary User**
- **Who**: CS student at any level (intro through senior), using VS Code, working with AI-generated code they don't fully understand
- **Current behavior**: They see unfamiliar code, either ignore it, ask AI to explain it (getting another wall of text), or Google it and context-switch out of the editor
- **Trigger**: They highlight a piece of code or right-click a file and feel the "I don't know what this does" friction
- **Success state**: They close the panel having run a tiny version of the concept themselves and can explain it in their own words

**Job to Be Done**
When I'm staring at code I didn't write (or don't remember writing), I want a contextual explanation + something I can run myself, so I can actually understand the concept rather than just pretending I do.

**Non-Users**
- Senior engineers — they don't need scaffolded explanations
- Students using other IDEs — out of scope (VS Code only)
- Non-English speakers — no localization planned

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | Highlight code → right-click → "Explain this" | Primary activation path |
| Must | Split WebviewPanel: left = explanation, right = editable scaffold | Core UX |
| Must | Gemini API: contextual explanation at highest construct level | Core value |
| Must | Gemini API: appropriate scaffold for construct type | Core value |
| Must | Run scaffold code via temp file + local runtime | Differentiator vs just reading |
| Must | Activity bar icon → session list (in-memory, current window only) | Navigation |
| Should | Right-click on file in Explorer → "Explain this file" | Secondary activation |
| Should | Language auto-detection via VS Code `languageId` | Quality |
| Should | Stdout/stderr shown in sandbox pane | Feedback loop |
| Could | Activity bar icon (custom icon) | Polish |
| Could | Copy scaffold button | Convenience |
| Won't | Code execution for Java (JDK not guaranteed on demo machine) | Risk |
| Won't | Persist sessions across VS Code restarts | Out of scope |

### MVP Scope

1. Selection → context menu "Explain this" → WebviewPanel opens
2. Gemini API call: code + surrounding context + language → explanation + scaffold
3. Left pane: rendered explanation (HTML)
4. Right pane: editable textarea + "Run" button
5. Run: write scaffold to temp file → spawn child process → display output in pane
6. Session saved to in-memory array → shown in activity bar sidebar list
7. Clicking a session in sidebar reopens that panel

### User Flow (Critical Path)

```
1. Student opens a file with unfamiliar code
2. Highlights a snippet (or right-clicks file)
3. Selects "Explain this" from context menu
4. WebviewPanel opens split:
   Left:  "This is a for loop. Loops repeat a block of code..."
   Right: [editable textarea with bare loop scaffold + Run button]
5. Student edits the scaffold, clicks Run
6. Output appears below: "Hello 0", "Hello 1", "Hello 2"
7. Student understands; session auto-saved to sidebar
8. Sidebar shows: "for loop — main.py — 2 min ago"
```

---

## Technical Approach

**Feasibility**: HIGH (for MVP scope) — VSCode extension APIs are well-documented, Gemini API is fast, temp file execution is straightforward for Python/JS

**Architecture Notes**

```
Extension Host (Node.js)
  ├── commands/explainSelection.ts   — reads editor selection + file context
  ├── commands/explainFile.ts        — reads full file + workspace structure
  ├── panels/ExplainPanel.ts         — creates/manages WebviewPanel
  ├── ai/gemini.ts                   — Gemini API client (@google/generative-ai)
  ├── execution/runner.ts            — writes temp file, spawns child process
  ├── session/SessionStore.ts        — in-memory array, cleared on deactivate
  └── views/SessionTreeProvider.ts   — TreeDataProvider for activity bar

WebviewPanel (HTML/JS, sandboxed)
  ├── Left pane: innerHTML from AI explanation (sanitized)
  └── Right pane: <textarea> (scaffold) + Run button
        → postMessage to extension host → runner.ts → postMessage back with output
```

**Gemini API Prompt Strategy**

Prompt includes:
1. The selected code
2. The file's full content (for context, truncated to 4000 chars if large)
3. The detected language (`document.languageId`)
4. The construct type hint (VS Code can detect via AST — or let Gemini infer)
5. Instruction: explain at highest construct level, assume beginner CS knowledge
6. Instruction: generate a minimal bare scaffold (< 20 lines) of the same construct type with TODO comments

**Execution Strategy by Language**

| Language | Runtime | Command |
|----------|---------|---------|
| Python | `python3` or `python` | `python3 {tempfile}.py` |
| JavaScript | Node.js | `node {tempfile}.js` |
| TypeScript | ts-node or tsc+node | `npx ts-node {tempfile}.ts` |
| Java | JDK (may not exist) | Warn user; show compile command |
| HTML | WebviewPanel iframe | Load file as srcdoc in webview |
| JSON | Built-in | Pretty-print + validate |

Temp files written to `os.tmpdir()`, cleaned up after execution.

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Gemini API latency > 5s | M | Show loading spinner; use gemini-2.0-flash |
| Student's runtime not on PATH | M | Detect at extension load; show helpful error |
| WebviewPanel CSP blocks Gemini fetch | H | All API calls go through extension host, not webview JS |
| Java/TS not executable on demo machine | M | Graceful fallback: show "Run with `javac ...`" instructions |
| Gemini explanation too verbose | M | Prompt-engineer a "max 150 words" constraint |

---

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | Foundation | package.json contributions, command registration, context menu, activity bar view container | complete | - | - | `.claude/PRPs/plans/completed/phase-1-foundation.plan.md` |
| 2 | AI Integration | Gemini API client, prompt engineering, explanation + scaffold response parsing | complete | - | 1 | `.claude/PRPs/plans/completed/phase-2-ai-integration.plan.md` |
| 3 | WebviewPanel UI | Split panel HTML/CSS/JS, explanation rendering, scaffold textarea, message bridge | pending | with 4 | 2 | - |
| 4 | Code Execution | Temp file writer, child process runner, stdout/stderr capture, per-language routing | in-progress | with 3 | 2 | `.claude/PRPs/plans/phase-4-code-execution.plan.md` |
| 3 | WebviewPanel UI | Split panel HTML/CSS/JS, explanation rendering, scaffold textarea, message bridge | in-progress | with 4 | 2 | `.claude/PRPs/plans/phase-3-webview-panel.plan.md` |
| 4 | Code Execution | Temp file writer, child process runner, stdout/stderr capture, per-language routing | pending | with 3 | 2 | - |
| 5 | Session History | In-memory SessionStore, TreeDataProvider, sidebar panel, click-to-reopen | complete | - | 3, 4 | `.claude/PRPs/plans/completed/phase-5-session-history.plan.md` |
| 6 | Polish & Demo | Loading states, error handling, extension icon, end-to-end smoke test | complete | - | 5 | `.claude/PRPs/plans/completed/phase-6-polish-demo.plan.md` |

### Phase Details

**Phase 1: Foundation** (~45 min)
- **Goal**: Extension activates, commands appear in context menu and command palette
- **Scope**: `package.json` (commands, menus, viewsContainers, views), `extension.ts` (register commands), stub handlers
- **Success signal**: Right-click on selection shows "Explain this"; activity bar icon appears

**Phase 2: AI Integration** (~1.5h)
- **Goal**: Given selected code + file context + language, Gemini returns structured explanation + scaffold
- **Scope**: Install `@google/generative-ai`, write `src/ai/gemini.ts`, define prompt template, parse response
- **Success signal**: `console.log` of explanation + scaffold for a Python `for` loop

**Phase 3: WebviewPanel UI** (~1.5h)
- **Goal**: Split panel opens with explanation on left, editable scaffold on right
- **Scope**: `src/panels/ExplainPanel.ts`, webview HTML template, CSS split layout, postMessage bridge
- **Success signal**: Panel opens with real Gemini content rendered correctly

**Phase 4: Code Execution** (~1.5h)
- **Goal**: "Run" button executes the scaffold and shows output
- **Scope**: `src/execution/runner.ts`, temp file I/O, `child_process.spawn`, language routing
- **Success signal**: Python `print("hello")` scaffold runs and shows output in panel

**Phase 5: Session History** (~45 min)
- **Goal**: Activity bar shows list of sessions; clicking reopens the panel
- **Scope**: `src/session/SessionStore.ts` (in-memory), `src/views/SessionTreeProvider.ts`
- **Success signal**: After 3 "Explain" actions, sidebar shows 3 entries; clicking one restores the panel

**Phase 6: Polish & Demo** (~30 min)
- **Goal**: Smooth demo experience
- **Scope**: Loading spinner, error messages, extension icon (128x128 PNG), smoke test all languages
- **Success signal**: Full demo flow works without errors for Python + JavaScript

### Parallelism Notes

Phases 3 and 4 can run in parallel once Phase 2 is done — the WebviewPanel UI and the code execution engine are independent; they meet at the "Run" button handler. With two developers, assign one to each.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Session persistence | In-memory only (window lifetime) | globalState, SQLite | Zero setup friction; stated requirement |
| Code editor in sandbox | `<textarea>` | Monaco Editor embed | Monaco is ~2h to wire up correctly; `<textarea>` ships in 15 min |
| AI provider | Gemini API (`@google/generative-ai`) | Claude API, OpenAI | Team has Gemini key |
| API call location | Extension host (Node) not webview | Webview fetch | WebviewPanel CSP blocks external fetches by default |
| Temp file location | `os.tmpdir()` | workspace `.tmp/` | tmpdir is guaranteed writable, no workspace pollution |
| Gemini model | `gemini-2.0-flash` | gemini-1.5-pro | Speed over quality for hackathon; flash is fast enough |

---

## Research Summary

**Market Context**
- **GitHub Copilot Chat** explains code but doesn't provide interactive sandboxes or construct-aware scaffolding
- **Quokka.js** gives live execution feedback but no AI explanation layer
- **Mintlify Doc Writer** generates docs, not learner-facing explanations
- **ChatGPT sidebar extensions** explain code but force a context switch out of the editor and don't provide runnable scaffolds
- Gap: nothing combines contextual explanation + runnable scaffold + session history in a single in-editor panel

**Technical Context**
- Existing codebase: VSCode extension boilerplate only (`src/extension.ts`, 27 lines, single placeholder command)
- No existing AI integration, no WebviewPanel, no TreeView
- Build: `tsc` → `out/`, Node16 module format — compatible with `child_process` for execution
- Key files to create: `src/ai/gemini.ts`, `src/panels/ExplainPanel.ts`, `src/execution/runner.ts`, `src/session/SessionStore.ts`, `src/views/SessionTreeProvider.ts`
