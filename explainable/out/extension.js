"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const SessionTreeProvider_1 = require("./views/SessionTreeProvider");
function activate(context) {
    const sessionProvider = new SessionTreeProvider_1.SessionTreeProvider();
    const treeView = vscode.window.createTreeView('explainableSessions', {
        treeDataProvider: sessionProvider,
        showCollapseAll: false,
    });
    const explainSelection = vscode.commands.registerCommand('explainable.explainSelection', () => {
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
        vscode.window.showInformationMessage(`[Stub] Explaining ${language} selection (${selectedText.length} chars)`);
        // TODO Phase 5: sessionProvider.addSession({ label, timestamp, explanation, scaffold, language })
        console.log('explainSelection called', { language, chars: selectedText.length, fileContext: fileContext.length });
    });
    const explainFile = vscode.commands.registerCommand('explainable.explainFile', async (uri) => {
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
    });
    const openSession = vscode.commands.registerCommand('explainable.openSession', () => {
        // TODO Phase 5: re-open ExplainPanel for the clicked session
    });
    context.subscriptions.push(treeView, explainSelection, explainFile, openSession, sessionProvider['_onDidChangeTreeData']);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map