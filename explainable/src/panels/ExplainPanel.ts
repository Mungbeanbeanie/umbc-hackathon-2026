import * as path from 'path';
import * as vscode from 'vscode';
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
    body {
      display: flex; align-items: center; justify-content: center;
      height: 100vh;
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
      ExplainPanel.currentPanel._update(result, label, language);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'explainablePanel',
        `Explainable: ${label}`,
        column,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      ExplainPanel.currentPanel = new ExplainPanel(panel);
      ExplainPanel.currentPanel._update(result, label, language);
    }

    if (addToHistory) {
      sessionProvider.addSession({
        label,
        timestamp: Date.now(),
        explanation: result.explanation,
        scaffold: result.scaffold,
        language,
      });
    }
  }

  private _update(result: GeminiResult, label: string, language: string): void {
    this._panel.title = `Explainable: ${label}`;
    this._panel.webview.html = this._getHtml(result, label, language);
  }

  private _getHtml(result: GeminiResult, label: string, language: string): string {
    const nonce = getNonce();
    const explanation = escapeHtml(result.explanation);
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

    body {
      display: flex;
      flex-direction: column;
      height: 100vh;
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
    }

    #explanation {
      flex: 1;
      overflow-y: auto;
      line-height: 1.65;
      white-space: pre-wrap;
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
    }

    #runBtn:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }

    #runBtn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .output-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.6;
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
      <div id="explanation">${explanation}</div>
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

    const runBtn = document.getElementById('runBtn');
    const scaffoldEl = document.getElementById('scaffold');
    const outputEl = document.getElementById('output');
    const exitCodeEl = document.getElementById('exit-code');

    runBtn.addEventListener('click', () => {
      runBtn.disabled = true;
      runBtn.textContent = 'Running...';
      outputEl.textContent = '';
      outputEl.className = '';
      exitCodeEl.textContent = '';
      exitCodeEl.className = '';
      vscode.postMessage({ type: 'run', code: scaffoldEl.value, language });
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
        outputEl.className = r.exitCode !== 0 ? 'has-error' : '';
        exitCodeEl.textContent = 'exit ' + r.exitCode;
        exitCodeEl.className = r.exitCode === 0 ? '' : 'fail';
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

