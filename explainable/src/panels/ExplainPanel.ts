import * as path from 'path';
import * as vscode from 'vscode';
import { GeminiResult } from '../ai/gemini';
import { SessionTreeProvider } from '../views/SessionTreeProvider';
import { escapeHtml, getNonce } from '../utils/htmlUtils';
import { startRun, RunHandle } from '../execution/runner';

// ── Link resolution helpers ──────────────────────────────────────────────────

function escapeRegexStr(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Definition patterns for common languages */
const DEFINITION_PATTERNS = [
  (s: string) => new RegExp(`^\\s*class\\s+${escapeRegexStr(s)}\\b`),
  (s: string) => new RegExp(`^\\s*def\\s+${escapeRegexStr(s)}\\s*\\(`),
  (s: string) => new RegExp(`^\\s*(export\\s+)?(default\\s+)?(abstract\\s+)?(class|interface|enum)\\s+${escapeRegexStr(s)}\\b`),
  (s: string) => new RegExp(`^\\s*(export\\s+)?(async\\s+)?function\\s+${escapeRegexStr(s)}\\b`),
  (s: string) => new RegExp(`^\\s*(export\\s+)?(const|let|var)\\s+${escapeRegexStr(s)}\\s*=`),
  (s: string) => new RegExp(`^\\s*(public|private|protected|static|final).*\\s+${escapeRegexStr(s)}\\s*\\(`),
];

async function findSymbolInFiles(
  symbol: string,
  files: vscode.Uri[],
): Promise<{ uri: string; line: number } | null> {
  const patterns = DEFINITION_PATTERNS.map(fn => fn(symbol));
  for (const uri of files) {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const lines = Buffer.from(bytes).toString('utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (patterns.some(p => p.test(lines[i]))) {
          return { uri: uri.toString(), line: i };
        }
      }
    } catch { /* unreadable file — skip */ }
  }
  return null;
}

async function resolveSymbolLinks(
  explanation: string,
): Promise<Record<string, { uri: string; line: number }>> {
  // Extract every backtick-wrapped single-word token from the explanation
  const refs = new Set<string>();
  const re = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(explanation)) !== null) {
    const tok = m[1].trim();
    if (tok && !tok.includes(' ') && !tok.includes('\n')) {
      refs.add(tok);
    }
  }
  if (refs.size === 0) { return {}; }

  const sourceFiles = await vscode.workspace.findFiles(
    '**/*.{py,ts,js,tsx,jsx,java,go,rs,cpp,c,cs,rb,swift,kt,php}',
    '**/node_modules/**',
    300,
  );

  // Build lookup maps: full basename and basename-without-extension
  const byFullName = new Map<string, vscode.Uri>();
  const byNameNoExt = new Map<string, vscode.Uri>();
  for (const uri of sourceFiles) {
    const base = path.basename(uri.fsPath);
    byFullName.set(base, uri);
    byNameNoExt.set(base.replace(/\.[^.]+$/, ''), uri);
  }

  const links: Record<string, { uri: string; line: number }> = {};

  for (const ref of refs) {
    // 1. Exact filename match (e.g. `game.py`)
    const exactFile = byFullName.get(ref);
    if (exactFile) {
      links[ref] = { uri: exactFile.toString(), line: 0 };
      continue;
    }
    // 2. Module/file match without extension (e.g. `game` → game.py)
    const moduleFile = byNameNoExt.get(ref);
    if (moduleFile) {
      links[ref] = { uri: moduleFile.toString(), line: 0 };
      continue;
    }
    // 3. Symbol definition search across source files
    const found = await findSymbolInFiles(ref, sourceFiles);
    if (found) {
      links[ref] = found;
    }
  }

  return links;
}

/**
 * Converts the explanation plain text into safe HTML.
 * Backtick-wrapped tokens that resolved to a workspace location become
 * clickable <a> tags; unresolved ones become <code> spans.
 */
function buildExplanationHtml(
  text: string,
  links: Record<string, { uri: string; line: number }>,
): string {
  // Split on backtick-wrapped tokens (capturing group keeps them in the array)
  const parts = text.split(/(`[^`]+`)/);
  return parts
    .map((part, i) => {
      if (i % 2 === 0) {
        // Plain text — HTML-escape it (newlines preserved by white-space: pre-wrap)
        return part
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }
      // Backtick-wrapped token (odd indices)
      const ref = part.slice(1, -1);
      const safeRef = ref
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const link = links[ref];
      if (link) {
        return `<a href="#" data-uri="${escapeHtml(link.uri)}" data-line="${link.line}">${safeRef}</a>`;
      }
      return `<code>${safeRef}</code>`;
    })
    .join('');
}

// ── Message type guards ──────────────────────────────────────────────────────

interface RunMessage    { type: 'run';      code: string; language: string; }
interface OpenFileMsg   { type: 'openFile'; uri: string;  line: number; }

function isRunMessage(msg: unknown): msg is RunMessage {
  return (
    typeof msg === 'object' && msg !== null &&
    (msg as Record<string, unknown>)['type'] === 'run' &&
    typeof (msg as Record<string, unknown>)['code'] === 'string' &&
    typeof (msg as Record<string, unknown>)['language'] === 'string'
  );
}

function isOpenFileMsg(msg: unknown): msg is OpenFileMsg {
  return (
    typeof msg === 'object' && msg !== null &&
    (msg as Record<string, unknown>)['type'] === 'openFile' &&
    typeof (msg as Record<string, unknown>)['uri'] === 'string'
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

//fix full runnable code support and allow user to change params
export class ExplainPanel {
  private static currentPanel: ExplainPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _disposed = false;
  private _activeRun: RunHandle | null = null;

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;
    this._panel.onDidDispose(() => this._dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (msg: unknown) => {
        if (isOpenFileMsg(msg)) {
          try {
            const uri = vscode.Uri.parse(msg.uri);
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc, { preview: false });
            if (typeof msg.line === 'number' && msg.line > 0) {
              const pos = new vscode.Position(msg.line, 0);
              editor.selection = new vscode.Selection(pos, pos);
              editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            }
          } catch {
            vscode.window.showErrorMessage('Explainable: Could not open file.');
          }
          return;
        }

        if (!isRunMessage(msg)) { return; }
        if (this._activeRun) { return; }
        const handle = startRun(msg.code, msg.language);
        this._activeRun = handle;
        try {
          const result = await handle.result;
          if (!this._disposed) {
            this._panel.webview.postMessage({ type: 'runResult', result });
          }
        } catch (err) {
          if (!this._disposed) {
            this._panel.webview.postMessage({
              type: 'runResult',
              result: { stdout: '', stderr: '', exitCode: 1, error: err instanceof Error ? err.message : 'Unknown error' },
            });
          }
        } finally {
          this._activeRun = null;
        }
      },
      undefined,
      this._disposables,
    );
  }

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
    html, body { height: 100%; margin: 0; }
    body {
      display: flex; align-items: center; justify-content: center;
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

  static createOrShow(
    _context: vscode.ExtensionContext,
    result: GeminiResult,
    language: string,
    sessionProvider: SessionTreeProvider,
    fileName = '',
    addToHistory = true,
  ): void {
    const column = vscode.ViewColumn.Beside;
    const label = fileName
      ? `${path.basename(fileName)} — ${result.title}`
      : result.title;

    if (ExplainPanel.currentPanel) {
      ExplainPanel.currentPanel._panel.reveal(column);
      void ExplainPanel.currentPanel._update(result, label, language);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'explainablePanel',
        `Explainable: ${label}`,
        column,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      ExplainPanel.currentPanel = new ExplainPanel(panel);
      void ExplainPanel.currentPanel._update(result, label, language);
    }

    if (addToHistory) {
      sessionProvider.addSession({
        label,
        timestamp: Date.now(),
        explanation: result.explanation,
        scaffold: result.scaffold,
        runnable: result.runnable,
        language,
      });
    }
  }

  private async _update(result: GeminiResult, label: string, language: string): Promise<void> {
    this._panel.title = `Explainable: ${label}`;
    const links = await resolveSymbolLinks(result.explanation);
    if (!this._disposed) {
      const explanationHtml = buildExplanationHtml(result.explanation, links);
      this._panel.webview.html = this._getHtml(result, label, language, result.runnable ?? '', explanationHtml);
    }
  }

  private _getHtml(result: GeminiResult, label: string, language: string, runnable: string, explanationHtml: string): string {
    const nonce = getNonce();
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
    html, body { height: 100%; }
    body {
      display: flex;
      flex-direction: column;
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
      flex-shrink: 0;
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
      flex-shrink: 0;
    }

    #explanation {
      flex: 1;
      overflow-y: auto;
      line-height: 1.65;
      white-space: pre-wrap;
    }

    #explanation code {
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--vscode-textCodeBlock-background, rgba(255,255,255,0.08));
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 0.92em;
    }

    #explanation a {
      color: var(--vscode-textLink-foreground, #4daafc);
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--vscode-textCodeBlock-background, rgba(255,255,255,0.08));
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 0.92em;
      text-decoration: underline;
      cursor: pointer;
    }

    #explanation a:hover {
      color: var(--vscode-textLink-activeForeground, #6fc3ff);
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
      flex-shrink: 0;
    }

    #runBtn:hover    { background: var(--vscode-button-hoverBackground, #1177bb); }
    #runBtn:disabled { opacity: 0.5; cursor: not-allowed; }

    .output-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.6;
      flex-shrink: 0;
    }

    #exit-code { font-size: 11px; margin-top: 2px; color: var(--vscode-descriptionForeground); }
    #exit-code.fail { color: var(--vscode-terminal-ansiRed, #f48771); }
    #output.has-error { color: var(--vscode-terminal-ansiRed, #f48771); }
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
  <header>Explainable &mdash; ${escapeHtml(label)}</header>
  <div class="split">
    <div class="pane">
      <div class="pane-title">&#x1F4A1; What this does</div>
      <div id="explanation">${explanationHtml}</div>
    </div>
    <div class="pane">
      <div class="pane-title">&#x25B6; Try it yourself</div>
      <textarea id="scaffold" spellcheck="false">${scaffold}</textarea>
      <button id="runBtn">&#x25B6; Run</button>
      <div class="output-label">Output</div>
      <pre id="output">Press Run to see output...</pre>
      <div id="exit-code"></div>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const language = ${JSON.stringify(language)};
    const runnableCode = ${JSON.stringify(runnable)};

    const runBtn    = document.getElementById('runBtn');
    const outputEl  = document.getElementById('output');
    const exitCodeEl = document.getElementById('exit-code');

    // Clickable file/symbol links
    document.getElementById('explanation').addEventListener('click', e => {
      const a = e.target.closest('a[data-uri]');
      if (!a) { return; }
      e.preventDefault();
      vscode.postMessage({
        type: 'openFile',
        uri: a.dataset.uri,
        line: parseInt(a.dataset.line || '0', 10),
      });
    });

    runBtn.addEventListener('click', () => {
      runBtn.disabled = true;
      runBtn.textContent = 'Running...';
      outputEl.textContent = '';
      outputEl.className = '';
      exitCodeEl.textContent = '';
      exitCodeEl.className = '';
      vscode.postMessage({ type: 'run', code: runnableCode, language });
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type !== 'runResult') { return; }
      const r = msg.result;
      runBtn.disabled = false;
      runBtn.innerHTML = '&#x25B6; Run';
      if (r.error) {
        outputEl.textContent = r.error;
        outputEl.className = 'has-error';
        exitCodeEl.textContent = '';
      } else {
        const parts = [];
        if (r.stdout) { parts.push(r.stdout); }
        if (r.stderr) { parts.push('--- stderr ---\\n' + r.stderr); }
        outputEl.textContent = parts.join('\\n') || '(no output)';
        outputEl.className   = r.exitCode !== 0 ? 'has-error' : '';
        exitCodeEl.textContent = 'exit ' + r.exitCode;
        exitCodeEl.className   = r.exitCode === 0 ? '' : 'fail';
      }
    });
  </script>
</body>
</html>`;
  }

  private _dispose(): void {
    this._disposed = true;
    this._activeRun?.kill();
    this._activeRun = null;
    ExplainPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}
