import * as path from 'path';
import * as vscode from 'vscode';
import hljs from 'highlight.js';
import { GeminiResult } from '../ai/gemini';
import { SessionTreeProvider } from '../views/SessionTreeProvider';
import { escapeHtml, getNonce } from '../utils/htmlUtils';
import { startRun, RunHandle } from '../execution/runner';

interface WebviewMessage {
  type: 'run';
  code: string;
  language: string;
}

function isRunMessage(msg: unknown): msg is WebviewMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as Record<string, unknown>)['type'] === 'run' &&
    typeof (msg as Record<string, unknown>)['code'] === 'string' &&
    typeof (msg as Record<string, unknown>)['language'] === 'string'
  );
}

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
      ExplainPanel.currentPanel._panel.webview.postMessage({ type: 'loading', language });
    } else {
      const panel = vscode.window.createWebviewPanel(
        'explainablePanel',
        `Explainable: ${language}`,
        column,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      ExplainPanel.currentPanel = new ExplainPanel(panel);
      ExplainPanel.currentPanel._panel.webview.html = ExplainPanel._shellHtml();
    }
    ExplainPanel.currentPanel._panel.title = `Explainable: ${language}`;
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
      ExplainPanel.currentPanel._update(result, label, language);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'explainablePanel',
        `Explainable: ${label}`,
        column,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      ExplainPanel.currentPanel = new ExplainPanel(panel);
      ExplainPanel.currentPanel._panel.webview.html = ExplainPanel._shellHtml();
      ExplainPanel.currentPanel._update(result, label, language);
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

  private _update(result: GeminiResult, label: string, language: string): void {
    this._panel.title = `Explainable: ${label}`;
    this._panel.webview.postMessage({
      type: 'update',
      label,
      explanation: result.explanation,
      scaffold: result.scaffold,
      runnable: result.runnable ?? '',
      language,
    });
  }

  private static _shellHtml(): string {
    const nonce = getNonce();
    const explanation = escapeHtml(result.explanation);

    const hljsLangAlias: Record<string, string> = {
      python3: 'python',
      javascriptreact: 'javascript',
      typescriptreact: 'typescript',
      shellscript: 'bash',
      'objective-c': 'objectivec',
    };
    const hljsLang = hljsLangAlias[language] ?? language;
    let highlightedScaffold: string;
    try {
      if (hljs.getLanguage(hljsLang)) {
        // ignoreIllegals: true prevents abort on partial/LLM-generated scaffolds
        highlightedScaffold = hljs.highlight(result.scaffold, { language: hljsLang, ignoreIllegals: true }).value;
      } else {
        highlightedScaffold = hljs.highlightAuto(result.scaffold).value;
      }
    } catch {
      highlightedScaffold = escapeHtml(result.scaffold);
    }

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
      display: flex;
      flex-direction: column;
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }

    /* Loading state */
    #loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      gap: 14px;
      opacity: 0.7;
    }
    .spinner {
      width: 28px; height: 28px;
      border: 2px solid var(--vscode-panel-border, #444);
      border-top-color: var(--vscode-focusBorder, #007fd4);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    #loading p { font-size: 13px; }

    /* Content state */
    #content { display: none; flex-direction: column; flex: 1; overflow: hidden; }

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

    .pane + .pane { border-left: 1px solid var(--vscode-panel-border, #444); }

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

    .code-block {
      flex: 1;
      overflow: auto;
      background: var(--vscode-input-background, #1e1e1e);
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      border-radius: 4px;
      padding: 10px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      line-height: 1.5;
      margin: 0;
    }

    .code-block code {
      font-family: inherit;
      font-size: inherit;
      color: #abb2bf;
    }

    /* One Dark theme for highlight.js tokens */
    .hljs-keyword, .hljs-selector-tag, .hljs-tag { color: #c678dd; font-weight: bold; }
    .hljs-string, .hljs-attr, .hljs-template-tag { color: #98c379; }
    .hljs-comment, .hljs-quote { color: #5c6370; font-style: italic; }
    .hljs-number, .hljs-literal, .hljs-type { color: #d19a66; }
    .hljs-title, .hljs-section, .hljs-name { color: #61afef; }
    .hljs-class .hljs-title, .hljs-title.class_ { color: #e5c07b; }
    .hljs-built_in, .hljs-builtin-name { color: #56b6c2; }
    .hljs-variable, .hljs-template-variable { color: #e06c75; }
    .hljs-params { color: #abb2bf; }
    .hljs-operator, .hljs-punctuation { color: #abb2bf; }
    .hljs-meta, .hljs-meta .hljs-keyword { color: #e06c75; }
    .hljs-property { color: #e06c75; }
    .hljs-regexp { color: #98c379; }
    .hljs-symbol, .hljs-bullet { color: #d19a66; }
    .hljs-link { color: #61afef; text-decoration: underline; }

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
    #runBtn:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
    #runBtn:disabled { opacity: 0.5; cursor: not-allowed; }

    .output-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.6;
      flex-shrink: 0;
    }

    #exit-code { font-size: 11px; margin-top: 2px; color: var(--vscode-descriptionForeground); flex-shrink: 0; }
    #exit-code.fail { color: var(--vscode-terminal-ansiRed, #f48771); }
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
    #output.has-error { color: var(--vscode-terminal-ansiRed, #f48771); }
  </style>
</head>
<body>
  <div id="loading">
    <div class="spinner"></div>
    <p id="loading-text">Analyzing code&hellip;</p>
  </div>
  <div id="content">
    <header id="header"></header>
    <div class="split">
      <div class="pane">
        <div class="pane-title">&#x1F4A1; What this does</div>
        <div id="explanation"></div>
      </div>
      <div class="pane">
        <div class="pane-title">&#x25B6; Try it yourself</div>
        <textarea id="scaffold" spellcheck="false"></textarea>
        <pre class="code-block"><code>${highlightedScaffold}</code></pre>
        <button id="runBtn">&#x25B6; Run</button>
        <div class="output-label">Output</div>
        <pre id="output">Press Run to see output&hellip;</pre>
        <div id="exit-code"></div>
      </div>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    let runnableCode = '';
    let currentLanguage = '';

    const loadingEl  = document.getElementById('loading');
    const loadingTxt = document.getElementById('loading-text');
    const contentEl  = document.getElementById('content');
    const headerEl   = document.getElementById('header');
    const explanationEl = document.getElementById('explanation');
    const scaffoldEl = document.getElementById('scaffold');
    const runBtn     = document.getElementById('runBtn');
    const outputEl   = document.getElementById('output');
    const exitCodeEl = document.getElementById('exit-code');

    window.addEventListener('message', event => {
      const msg = event.data;

      if (msg.type === 'loading') {
        contentEl.style.display  = 'none';
        loadingEl.style.display  = 'flex';
        loadingTxt.textContent   = 'Analyzing ' + msg.language + ' code\u2026';
        outputEl.textContent     = 'Press Run to see output\u2026';
        outputEl.className       = '';
        exitCodeEl.textContent   = '';
        exitCodeEl.className     = '';
        return;
      }

      if (msg.type === 'update') {
        headerEl.textContent      = 'Explainable \u2014 ' + msg.label;
        explanationEl.textContent = msg.explanation;
        scaffoldEl.value          = msg.scaffold;
        runnableCode              = msg.runnable || '';
        currentLanguage           = msg.language;
        runBtn.disabled           = false;
        runBtn.innerHTML          = '&#x25B6; Run';
        outputEl.textContent      = 'Press Run to see output\u2026';
        outputEl.className        = '';
        exitCodeEl.textContent    = '';
        exitCodeEl.className      = '';
        loadingEl.style.display   = 'none';
        contentEl.style.display   = 'flex';
        contentEl.style.flexDirection = 'column';
        contentEl.style.flex      = '1';
        contentEl.style.overflow  = 'hidden';
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

    runBtn.addEventListener('click', () => {
      if (!runnableCode) { return; }
      runBtn.disabled      = true;
      runBtn.textContent   = 'Running...';
      outputEl.textContent = '';
      outputEl.className   = '';
      exitCodeEl.textContent = '';
      exitCodeEl.className   = '';
      vscode.postMessage({ type: 'run', code: runnableCode, language: currentLanguage });
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
