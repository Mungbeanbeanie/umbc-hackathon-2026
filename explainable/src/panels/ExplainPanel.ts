import * as path from 'path';
import * as vscode from 'vscode';
import { GeminiResult } from '../ai/gemini';
import { SessionTreeProvider } from '../views/SessionTreeProvider';
import { escapeHtml, getNonce } from '../utils/htmlUtils';
import { startRun, RunHandle } from '../execution/runner';

// ── Link resolution ──────────────────────────────────────────────────────────

function escapeRegexStr(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DEFINITION_PATTERNS = [
  (s: string) => new RegExp(`^\\s*class\\s+${escapeRegexStr(s)}\\b`),
  (s: string) => new RegExp(`^\\s*def\\s+${escapeRegexStr(s)}\\s*\\(`),
  (s: string) => new RegExp(`^\\s*(export\\s+)?(default\\s+)?(abstract\\s+)?(class|interface|enum)\\s+${escapeRegexStr(s)}\\b`),
  (s: string) => new RegExp(`^\\s*(export\\s+)?(async\\s+)?function\\s+${escapeRegexStr(s)}\\b`),
  (s: string) => new RegExp(`^\\s*(export\\s+)?(const|let|var)\\s+${escapeRegexStr(s)}\\s*=`),
  (s: string) => new RegExp(`^\\s*(public|private|protected|static|final).*\\s+${escapeRegexStr(s)}\\s*\\(`),
];

async function findSymbolInFiles(symbol: string, files: vscode.Uri[]): Promise<{ uri: string; line: number } | null> {
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
    } catch { /* skip */ }
  }
  return null;
}

async function resolveSymbolLinks(explanation: string): Promise<Record<string, { uri: string; line: number }>> {
  const refs = new Set<string>();
  const re = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(explanation)) !== null) {
    const tok = m[1].trim();
    if (tok && !tok.includes(' ') && !tok.includes('\n')) { refs.add(tok); }
  }
  if (refs.size === 0) { return {}; }

  const sourceFiles = await vscode.workspace.findFiles(
    '**/*.{py,ts,js,tsx,jsx,java,go,rs,cpp,c,cs,rb,swift,kt,php}',
    '**/node_modules/**', 300,
  );

  const byFullName = new Map<string, vscode.Uri>();
  const byNameNoExt = new Map<string, vscode.Uri>();
  for (const uri of sourceFiles) {
    const base = path.basename(uri.fsPath);
    byFullName.set(base, uri);
    byNameNoExt.set(base.replace(/\.[^.]+$/, ''), uri);
  }

  const links: Record<string, { uri: string; line: number }> = {};
  for (const ref of refs) {
    const exact = byFullName.get(ref);
    if (exact) { links[ref] = { uri: exact.toString(), line: 0 }; continue; }
    const mod = byNameNoExt.get(ref);
    if (mod) { links[ref] = { uri: mod.toString(), line: 0 }; continue; }
    const found = await findSymbolInFiles(ref, sourceFiles);
    if (found) { links[ref] = found; }
  }
  return links;
}

function buildExplanationHtml(text: string, links: Record<string, { uri: string; line: number }>): string {
  const parts = text.split(/(`[^`]+`)/);
  return parts.map((part, i) => {
    if (i % 2 === 0) {
      return part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    const ref = part.slice(1, -1);
    const safe = ref.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const link = links[ref];
    if (link) {
      return `<a href="#" data-uri="${escapeHtml(link.uri)}" data-line="${link.line}">${safe}</a>`;
    }
    return `<code>${safe}</code>`;
  }).join('');
}

// ── Message guards ───────────────────────────────────────────────────────────

interface RunMessage   { type: 'run';      code: string; language: string; }
interface OpenFileMsg  { type: 'openFile'; uri: string;  line: number; }

function isRunMessage(msg: unknown): msg is RunMessage {
  return typeof msg === 'object' && msg !== null &&
    (msg as Record<string, unknown>)['type'] === 'run' &&
    typeof (msg as Record<string, unknown>)['code'] === 'string' &&
    typeof (msg as Record<string, unknown>)['language'] === 'string';
}

function isOpenFileMsg(msg: unknown): msg is OpenFileMsg {
  return typeof msg === 'object' && msg !== null &&
    (msg as Record<string, unknown>)['type'] === 'openFile' &&
    typeof (msg as Record<string, unknown>)['uri'] === 'string';
}

// ── Panel ────────────────────────────────────────────────────────────────────

export class ExplainPanel {
  private static currentPanel: ExplainPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _disposed = false;
  private _activeRun: RunHandle | null = null;
  private _pendingMsg: unknown = null;
  private _lastMsg: unknown = null;

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;
    this._panel.onDidDispose(() => this._dispose(), null, this._disposables);

    this._panel.onDidChangeViewState(e => {
      if (e.webviewPanel.visible && this._lastMsg) {
        this._panel.webview.postMessage(this._lastMsg);
      }
    }, null, this._disposables);

    this._panel.webview.onDidReceiveMessage(async (msg: unknown) => {
      const type = (msg as Record<string, unknown>)['type'];

      if (type === 'ready') {
        if (this._pendingMsg) {
          this._panel.webview.postMessage(this._pendingMsg);
          this._lastMsg = this._pendingMsg;
          this._pendingMsg = null;
        }
        return;
      }

      if (type === 'requestRefresh') {
        if (this._lastMsg) { this._panel.webview.postMessage(this._lastMsg); }
        return;
      }

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
    }, undefined, this._disposables);
  }

  /** Called before the API request starts. Shows spinner; creates panel if needed. */
  static openLoading(context: vscode.ExtensionContext, language: string): void {
    void context;
    const column = vscode.ViewColumn.Beside;
    const loadingMsg = { type: 'loading', language };

    if (ExplainPanel.currentPanel) {
      const ep = ExplainPanel.currentPanel;
      ep._panel.reveal(column);
      ep._pendingMsg = loadingMsg;
      ep._panel.webview.postMessage(loadingMsg);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'explainablePanel', `Explainable: ${language}`, column,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      const ep = new ExplainPanel(panel);
      ep._pendingMsg = loadingMsg;
      ep._panel.webview.html = ExplainPanel._shellHtml();
      ExplainPanel.currentPanel = ep;
    }

    ExplainPanel.currentPanel._panel.title = `Explainable: ${language}`;
  }

  /** Clears the spinner and shows an error message. */
  static showError(message: string): void {
    if (!ExplainPanel.currentPanel) { return; }
    const ep = ExplainPanel.currentPanel;
    const msg = { type: 'error', message };
    ep._pendingMsg = msg;
    ep._lastMsg = msg;
    ep._panel.webview.postMessage(msg);
  }

  /** Called once the API result is ready. Updates content via postMessage — no HTML replacement. */
  static createOrShow(
    _context: vscode.ExtensionContext,
    result: GeminiResult,
    language: string,
    sessionProvider: SessionTreeProvider,
    fileName = '',
    addToHistory = true,
  ): void {
    const column = vscode.ViewColumn.Beside;
    const label = fileName ? `${path.basename(fileName)} — ${result.title}` : result.title;

    if (ExplainPanel.currentPanel) {
      ExplainPanel.currentPanel._panel.reveal(column);
      void ExplainPanel.currentPanel._update(result, label, language);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'explainablePanel', `Explainable: ${label}`, column,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      const ep = new ExplainPanel(panel);
      ep._panel.webview.html = ExplainPanel._shellHtml();
      ExplainPanel.currentPanel = ep;
      void ep._update(result, label, language);
    }

    if (addToHistory) {
      sessionProvider.addSession({
        label, timestamp: Date.now(),
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
    if (this._disposed) { return; }
    const msg = {
      type: 'update',
      label,
      explanation: result.explanation,
      explanationHtml: buildExplanationHtml(result.explanation, links),
      scaffold: result.scaffold,
      runnable: result.runnable ?? '',
      language,
    };
    this._pendingMsg = msg;
    this._lastMsg = msg;
    this._panel.webview.postMessage(msg);
  }

  /** Shell HTML — set exactly once per panel lifetime. All content arrives via postMessage. */
  private static _shellHtml(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Explainable</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body {
      display: flex; flex-direction: column;
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #d4d4d4);
    }

    /* ── Loading ─────────────────── */
    #loading {
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      flex: 1; gap: 14px; opacity: 0.7;
    }
    .spinner {
      width: 28px; height: 28px;
      border: 3px solid var(--vscode-panel-border, #555);
      border-top-color: var(--vscode-focusBorder, #007fd4);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    #loading p { font-size: 13px; }

    /* ── Content ─────────────────── */
    #content { display: none; flex-direction: column; flex: 1; overflow: hidden; }

    header {
      padding: 10px 16px;
      border-bottom: 1px solid var(--vscode-panel-border, #444);
      font-weight: 600; font-size: 14px;
      letter-spacing: 0.03em; opacity: 0.85;
      flex-shrink: 0;
      display: flex; align-items: center; justify-content: space-between;
    }
    #refreshBtn {
      font-size: 11px; font-weight: 600;
      background: none; border: 1px solid var(--vscode-panel-border, #555);
      color: inherit; cursor: pointer; border-radius: 3px;
      padding: 2px 8px; opacity: 0.6; letter-spacing: 0.04em;
    }
    #refreshBtn:hover { opacity: 1; }

    .split { display: flex; flex: 1; overflow: hidden; }

    .pane {
      flex: 1; min-width: 0;
      display: flex; flex-direction: column;
      overflow: hidden; padding: 16px; gap: 10px;
    }
    .pane + .pane { border-left: 1px solid var(--vscode-panel-border, #444); }

    .pane-title {
      font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em;
      opacity: 0.6; flex-shrink: 0;
      display: flex; align-items: center; justify-content: space-between;
    }

    /* ── Explanation ─────────────── */
    #explanation {
      flex: 1; overflow-y: auto;
      line-height: 1.65; white-space: pre-wrap;
    }
    #explanation code {
      font-family: var(--vscode-editor-font-family, monospace);
      background: rgba(255,255,255,0.08);
      padding: 1px 4px; border-radius: 3px; font-size: 0.92em;
    }
    #explanation a {
      color: var(--vscode-textLink-foreground, #4daafc);
      font-family: var(--vscode-editor-font-family, monospace);
      background: rgba(255,255,255,0.08);
      padding: 1px 4px; border-radius: 3px; font-size: 0.92em;
      text-decoration: underline; cursor: pointer;
    }
    #explanation a:hover { color: var(--vscode-textLink-activeForeground, #6fc3ff); }

    /* ── Scaffold editor ─────────── */
    #scaffold {
      flex: 1; min-height: 80px;
      resize: none;
      background: var(--vscode-input-background, #2d2d2d);
      color: var(--vscode-input-foreground, #d4d4d4);
      border: 1px solid var(--vscode-focusBorder, #007fd4);
      border-radius: 4px; padding: 10px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      line-height: 1.5; tab-size: 4;
      cursor: text; pointer-events: auto; user-select: text;
    }
    #scaffold:focus {
      outline: none;
      box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007fd4);
    }

    #resetBtn {
      font-size: 10px; font-weight: 600; opacity: 0.5;
      background: none; border: none; color: inherit;
      cursor: pointer; padding: 0;
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    #resetBtn:hover { opacity: 1; }

    /* ── Run button ──────────────── */
    #runBtn {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 14px;
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
      border: none; border-radius: 3px; cursor: pointer;
      font-size: 13px; font-weight: 500;
      align-self: flex-start; flex-shrink: 0;
    }
    #runBtn:hover    { background: var(--vscode-button-hoverBackground, #1177bb); }
    #runBtn:disabled { opacity: 0.5; cursor: not-allowed; }

    .output-label {
      font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em;
      opacity: 0.6; flex-shrink: 0;
    }
    #exit-code { font-size: 11px; color: var(--vscode-descriptionForeground); flex-shrink: 0; }
    #exit-code.fail { color: var(--vscode-terminal-ansiRed, #f48771); }
    #output {
      flex: 0 0 120px; overflow-y: auto;
      background: var(--vscode-terminal-background, #111);
      color: var(--vscode-terminal-foreground, #ccc);
      border: 1px solid var(--vscode-panel-border, #444);
      border-radius: 4px; padding: 8px 10px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px; white-space: pre-wrap;
    }
    #output.has-error { color: var(--vscode-terminal-ansiRed, #f48771); }
  </style>
</head>
<body>
  <!-- Loading state (shown first) -->
  <div id="loading">
    <div class="spinner"></div>
    <p id="loading-msg">Analyzing code&hellip;</p>
  </div>

  <!-- Error state -->
  <div id="error-state" style="display:none; flex-direction:column; align-items:center; justify-content:center; flex:1; gap:10px; padding:24px; opacity:0.85;">
    <div style="font-size:20px;">&#x26A0;</div>
    <div id="error-msg" style="text-align:center; color:var(--vscode-terminal-ansiRed,#f48771);"></div>
  </div>

  <!-- Content state (hidden until update message) -->
  <div id="content">
    <header>
      <span id="header"></span>
      <button id="refreshBtn" title="Reload content">&#x21BB; Refresh</button>
    </header>
    <div class="split">
      <div class="pane">
        <div class="pane-title">&#x1F4A1; What this does</div>
        <div id="explanation"></div>
      </div>
      <div class="pane">
        <div class="pane-title">
          <span>&#x270F; Edit &amp; Run</span>
          <button id="resetBtn" title="Restore original">Reset</button>
        </div>
        <textarea id="scaffold" spellcheck="false"></textarea>
        <button id="runBtn">&#x25B6; Run</button>
        <div class="output-label">Output</div>
        <pre id="output">Press Run to see output&hellip;</pre>
        <div id="exit-code"></div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const loadingEl   = document.getElementById('loading');
    const loadingMsg  = document.getElementById('loading-msg');
    const errorStateEl = document.getElementById('error-state');
    const errorMsgEl   = document.getElementById('error-msg');
    const contentEl   = document.getElementById('content');
    const headerEl    = document.getElementById('header');
    const explanationEl = document.getElementById('explanation');
    const scaffoldEl  = document.getElementById('scaffold');
    const resetBtn    = document.getElementById('resetBtn');
    const refreshBtn  = document.getElementById('refreshBtn');
    const runBtn      = document.getElementById('runBtn');
    const outputEl    = document.getElementById('output');
    const exitCodeEl  = document.getElementById('exit-code');

    // Signal readiness so extension can deliver queued messages
    vscode.postMessage({ type: 'ready' });

    let runnableCode = '';
    let currentLang  = '';
    let originalScaffold = '';

    // ── Scaffold editing ──────────────────────────────────────────────────────
    scaffoldEl.addEventListener('keydown', e => {
      if (e.key !== 'Tab') { return; }
      e.preventDefault();
      const s = scaffoldEl.selectionStart, end = scaffoldEl.selectionEnd;
      scaffoldEl.value = scaffoldEl.value.slice(0, s) + '    ' + scaffoldEl.value.slice(end);
      scaffoldEl.selectionStart = scaffoldEl.selectionEnd = s + 4;
    });

    resetBtn.addEventListener('click', () => { scaffoldEl.value = originalScaffold; });
    refreshBtn.addEventListener('click', () => { vscode.postMessage({ type: 'requestRefresh' }); });

    // ── Clickable links in explanation ────────────────────────────────────────
    explanationEl.addEventListener('click', e => {
      const a = e.target.closest('a[data-uri]');
      if (!a) { return; }
      e.preventDefault();
      vscode.postMessage({ type: 'openFile', uri: a.dataset.uri, line: parseInt(a.dataset.line || '0', 10) });
    });

    // ── Run ───────────────────────────────────────────────────────────────────
    runBtn.addEventListener('click', () => {
      runBtn.disabled = true;
      runBtn.textContent = 'Running...';
      outputEl.textContent = '';
      outputEl.className = '';
      exitCodeEl.textContent = '';
      exitCodeEl.className = '';
      const combined = runnableCode.replace('{{SCAFFOLD}}', scaffoldEl.value);
      vscode.postMessage({ type: 'run', code: combined, language: currentLang });
    });

    // ── Message handler ───────────────────────────────────────────────────────
    window.addEventListener('message', event => {
      const msg = event.data;

      if (msg.type === 'loading') {
        loadingMsg.textContent = 'Analyzing ' + (msg.language || '') + ' code\u2026';
        contentEl.style.display = 'none';
        errorStateEl.style.display = 'none';
        loadingEl.style.display = 'flex';
        return;
      }

      if (msg.type === 'error') {
        loadingEl.style.display = 'none';
        contentEl.style.display = 'none';
        errorMsgEl.textContent = msg.message || 'An error occurred.';
        errorStateEl.style.display = 'flex';
        return;
      }

      if (msg.type === 'update') {
        headerEl.textContent     = 'Explainable \u2014 ' + msg.label;
        explanationEl.innerHTML  = msg.explanationHtml || '';
        scaffoldEl.value         = msg.scaffold || '';
        originalScaffold         = msg.scaffold || '';
        runnableCode             = msg.runnable || '';
        currentLang              = msg.language || '';
        runBtn.disabled          = false;
        runBtn.innerHTML         = '&#x25B6; Run';
        outputEl.textContent     = 'Press Run to see output\u2026';
        outputEl.className       = '';
        exitCodeEl.textContent   = '';
        exitCodeEl.className     = '';
        loadingEl.style.display  = 'none';
        contentEl.style.display  = 'flex';
        contentEl.style.flex     = '1';
        contentEl.style.overflow = 'hidden';
        contentEl.style.flexDirection = 'column';
        scaffoldEl.focus();
        return;
      }

      if (msg.type === 'runResult') {
        const r = msg.result;
        runBtn.disabled  = false;
        runBtn.innerHTML = '&#x25B6; Run';
        if (r.error) {
          outputEl.textContent = r.error;
          outputEl.className   = 'has-error';
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
    for (const d of this._disposables) { d.dispose(); }
    this._disposables = [];
  }
}
