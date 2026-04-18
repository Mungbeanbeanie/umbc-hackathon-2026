import * as vscode from 'vscode';
import { SessionTreeProvider } from './views/SessionTreeProvider';

export function activate(context: vscode.ExtensionContext) {
  const sessionProvider = new SessionTreeProvider();

  const treeView = vscode.window.createTreeView('explainableSessions', {
    treeDataProvider: sessionProvider,
    showCollapseAll: false,
  });

  const explainSelection = vscode.commands.registerCommand(
    'explainable.explainSelection',
    () => {
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
      // TODO Phase 2: pass (selectedText, language, fileContext) to Gemini
      // TODO Phase 3: open ExplainPanel with result
      vscode.window.showInformationMessage(
        `[Stub] Explaining ${language} selection (${selectedText.length} chars)`
      );
      // TODO Phase 5: sessionProvider.addSession({ label, timestamp, explanation, scaffold, language })
      console.log('explainSelection called', { language, chars: selectedText.length, fileContext: fileContext.length });
    }
  );

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
      // TODO Phase 2: pass (filePath, fileContent, language) to Gemini
      // TODO Phase 3: open ExplainPanel with result
      vscode.window.showInformationMessage(`[Stub] Explaining file: ${filePath}`);
      console.log('explainFile called', { filePath, language, chars: fileContent.length });
    }
  );

  const openSession = vscode.commands.registerCommand(
    'explainable.openSession',
    () => {
      // TODO Phase 5: re-open ExplainPanel for the clicked session
    }
  );

  context.subscriptions.push(
    treeView,
    explainSelection,
    explainFile,
    openSession,
    sessionProvider['_onDidChangeTreeData'],
  );
}

export function deactivate() {}
