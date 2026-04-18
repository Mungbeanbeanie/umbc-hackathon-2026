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
const gemini_1 = require("./ai/gemini");
const SessionTreeProvider_1 = require("./views/SessionTreeProvider");
const SECRET_KEY = 'explainable.geminiApiKey';
async function getApiKey(context) {
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
function activate(context) {
    const sessionProvider = new SessionTreeProvider_1.SessionTreeProvider();
    const treeView = vscode.window.createTreeView('explainableSessions', {
        treeDataProvider: sessionProvider,
        showCollapseAll: false,
    });
    const explainSelection = vscode.commands.registerCommand('explainable.explainSelection', async () => {
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
        vscode.window.showInformationMessage('Explainable: Explaining... ⏳');
        try {
            const apiKey = await getApiKey(context);
            const result = await (0, gemini_1.explainCode)(selectedText, language, fileContext, apiKey);
            console.log('[Explainable] Gemini result:', result);
            // TODO Phase 3: ExplainPanel.createOrShow(context, result, language, sessionProvider);
            vscode.window.showInformationMessage('Explainable: Explanation ready!');
        }
        catch (err) {
            vscode.window.showErrorMessage(`Explainable: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
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
        vscode.window.showInformationMessage('Explainable: Explaining... ⏳');
        try {
            const apiKey = await getApiKey(context);
            const result = await (0, gemini_1.explainCode)(fileContent, language, fileContent, apiKey);
            console.log('[Explainable] Gemini result:', result);
            // TODO Phase 3: ExplainPanel.createOrShow(context, result, language, sessionProvider);
            vscode.window.showInformationMessage('Explainable: Explanation ready!');
        }
        catch (err) {
            vscode.window.showErrorMessage(`Explainable: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    });
    const resetApiKey = vscode.commands.registerCommand('explainable.resetApiKey', async () => {
        await context.secrets.delete(SECRET_KEY);
        vscode.window.showInformationMessage('Explainable: API key cleared. You\'ll be prompted on next use.');
    });
    const openSession = vscode.commands.registerCommand('explainable.openSession', () => {
        // TODO Phase 5: re-open ExplainPanel for the clicked session
    });
    context.subscriptions.push(treeView, explainSelection, explainFile, resetApiKey, openSession, sessionProvider['_onDidChangeTreeData']);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map