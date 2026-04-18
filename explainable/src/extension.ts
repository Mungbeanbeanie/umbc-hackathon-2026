import * as vscode from 'vscode';
import { explainCode } from './ai/gemini';
import { ExplainPanel } from './panels/ExplainPanel';
import { SessionTreeProvider, SessionItem } from './views/SessionTreeProvider';
const SECRET_KEY = 'explainable.geminiApiKey';

async function getApiKey(context: vscode.ExtensionContext): Promise<string> {
  const stored = await context.secrets.get(SECRET_KEY);
  if (stored) {
    return stored;
  }
  const entered = await vscode.window.showInputBox({
    title: 'Explainable — Gemini API Key',
    prompt: 'Enter your Gemini API key. Get one free at aistudio.google.com/app/apikey',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'AIza...',
  });
  if (!entered) {
    throw new Error('API key required. Run "Explainable: Reset API Key" to enter it later.');
  }
  await context.secrets.store(SECRET_KEY, entered);
  return entered;
}

export function activate(context: vscode.ExtensionContext) {
  const sessionProvider = new SessionTreeProvider();

  const treeView = vscode.window.createTreeView('explainableSessions', {
    treeDataProvider: sessionProvider,
    showCollapseAll: false,
  });

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

      ExplainPanel.openLoading(context, language);
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Explainable', cancellable: false },
        async (progress) => {
          progress.report({ message: `Explaining ${language} code...` });
          try {
            const apiKey = await getApiKey(context);
            const result = await explainCode(selectedText, language, fileContext, apiKey);
            ExplainPanel.createOrShow(context, result, language, sessionProvider);
          } catch (err) {
            vscode.window.showErrorMessage(
              `Explainable: ${err instanceof Error ? err.message : 'Unknown error'}`
            );
          }
        }
      );
    }
  );

  const explainFile = vscode.commands.registerCommand(
    'explainable.explainFile',
    async (uri: vscode.Uri) => {
      const resolvedUri = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!resolvedUri) {
        vscode.window.showWarningMessage('No file selected.');
        return;
      }
      if (!vscode.workspace.getWorkspaceFolder(resolvedUri)) {
        vscode.window.showWarningMessage('Explainable: File must be inside an open workspace folder.');
        return;
      }
      const document = await vscode.workspace.openTextDocument(resolvedUri);
      const language = document.languageId;
      const fileContent = document.getText();

      ExplainPanel.openLoading(context, language);
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Explainable', cancellable: false },
        async (progress) => {
          progress.report({ message: `Explaining ${language} file...` });
          try {
            const apiKey = await getApiKey(context);
            const result = await explainCode(fileContent, language, fileContent, apiKey);
            ExplainPanel.createOrShow(context, result, language, sessionProvider);
          } catch (err) {
            vscode.window.showErrorMessage(
              `Explainable: ${err instanceof Error ? err.message : 'Unknown error'}`
            );
          }
        }
      );
    }
  );

  const resetApiKey = vscode.commands.registerCommand(
    'explainable.resetApiKey',
    async () => {
      await context.secrets.delete(SECRET_KEY);
      vscode.window.showInformationMessage('Explainable: API key cleared. You\'ll be prompted on next use.');
    }
  );

  const openSession = vscode.commands.registerCommand(
    'explainable.openSession',
    (session: SessionItem) => {
      ExplainPanel.createOrShow(
        context,
        { title: session.label, explanation: session.explanation, scaffold: session.scaffold, runnable: session.runnable },
        session.language,
        sessionProvider,
        '',
        false,
      );
    }
  );

  context.subscriptions.push(
    treeView,
    explainSelection,
    explainFile,
    resetApiKey,
    openSession,
    { dispose: () => sessionProvider.dispose() },
  );
}

export function deactivate() {}
