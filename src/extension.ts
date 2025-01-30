import * as vscode from 'vscode';
import { AutoContextEditorProvider } from './autoContextEditor';

export function activate(context: vscode.ExtensionContext) {
    // Register the custom editor provider
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            'auto-context-compiler.editor',
            new AutoContextEditorProvider(context),
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: false
            }
        )
    );

    // Register the command to open the compiler
    context.subscriptions.push(
        vscode.commands.registerCommand('auto-context-compiler.openCompiler', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('Please open a workspace first');
                return;
            }

            const newFile = vscode.Uri.joinPath(workspaceFolder.uri, 'new.autocontext');
            try {
                await vscode.workspace.fs.stat(newFile);
            } catch {
                // File doesn't exist, create it
                await vscode.workspace.fs.writeFile(newFile, new Uint8Array());
            }
            
            const document = await vscode.workspace.openTextDocument(newFile);
            await vscode.window.showTextDocument(document, { preview: false });
        })
    );
}

export function deactivate() {}
