import * as vscode from 'vscode';
import { GeminiResult } from '../ai/gemini';
import { runCode } from '../execution/runner';
import { SessionTreeProvider } from '../views/SessionTreeProvider';

interface WebviewMessage {
  type: 'run';
  code: string;
  language: string;
}

interface RunOutput {
  type: 'output';
  stdout: string;
  stderr: string;
}

export class ExplainPanel {
  private static currentPanel: ExplainPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;
    this._panel.onDidDispose(() => this._dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (msg: WebviewMessage) => {
        if (msg.type === 'run') {
          // TODO Phase 4: replace stub with real runner
          // import { runCode } from '../execution/runner';
          // const output = await runCode(msg.code, msg.language);
          // this._panel.webview.postMessage({ type: 'output', ...output });
          const response: RunOutput = {
            type: 'output',
            stdout: '[Code execution coming in Phase 4]',
            stderr: '',
          };
          this._panel.webview.postMessage(response);
        }
      },
      undefined,
      this._disposables,
    );
  }

  static createOrShow(
    context: vscode.ExtensionContext,
    result: GeminiResult,
    language: string,
    sessionProvider: SessionTreeProvider,
  ): void {
    void context;
    const column = vscode.ViewColumn.Beside;

    if (ExplainPanel.currentPanel) {
      ExplainPanel.currentPanel._panel.reveal(column);
      ExplainPanel.currentPanel._update(result, language);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'explainablePanel',
        `Explainable: ${language}`,
        column,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      );
      ExplainPanel.currentPanel = new ExplainPanel(panel);
      ExplainPanel.currentPanel._update(result, language);
    }

    sessionProvider.addSession({
      label: `${language} — ${new Date().toLocaleTimeString()}`,
      timestamp: Date.now(),
      explanation: result.explanation,
      scaffold: result.scaffold,
      language,
    });
  }

  private _update(result: GeminiResult, language: string): void {
    this._panel.title = `Explainable: ${language}`;
    this._panel.webview.html = this._getHtml(result, language);
  }

  private _getHtml(result: GeminiResult, language: string): string {
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
  <header>Explainable &mdash; ${escapeHtml(language)}</header>
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
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const language = ${JSON.stringify(language)};

    document.getElementById('runBtn').addEventListener('click', () => {
      const code = document.getElementById('scaffold').value;
      const btn = document.getElementById('runBtn');
      btn.disabled = true;
      btn.textContent = 'Running...';
      document.getElementById('output').textContent = '';
      vscode.postMessage({ type: 'run', code, language });
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'output') {
        const out = document.getElementById('output');
        const btn = document.getElementById('runBtn');
        out.textContent = msg.stdout + (msg.stderr ? '\\nSTDERR:\\n' + msg.stderr : '');
        btn.disabled = false;
        btn.textContent = '&#x25B6; Run';
      }
    });
  </script>
</body>
</html>`;
  }

  private _dispose(): void {
    ExplainPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
