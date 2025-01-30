import * as vscode from 'vscode';
import { getNonce } from './util';
import * as fs from 'fs';
import * as path from 'path';

export class AutoContextEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'auto-context-compiler.editor';

    constructor(
        private readonly context: vscode.ExtensionContext
    ) {}

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview')
            ]
        };

        webviewPanel.webview.html = await this.getHtmlForWebview(webviewPanel.webview);

        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'getFileCompletion':
                    const completions = await this.getFileCompletions(message.query);
                    webviewPanel.webview.postMessage({ 
                        type: 'completions',
                        items: completions
                    });
                    break;
                case 'getFileContent':
                    const items = await this.getFileContent(message.path);
                    webviewPanel.webview.postMessage({
                        type: 'fileContent',
                        items: items
                    });
                    break;
            }
        });

        // Update webview when the document changes
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                webviewPanel.webview.postMessage({
                    type: 'update',
                    // TODO: items: this.getFileContent(document.uri.toString())
                });
            }
        });

        const disposables: vscode.Disposable[] = [];
    
        // Watch for changes to *any* file in the workspace
        const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
        disposables.push(
            fileWatcher.onDidChange(uri => this.onWorkspaceFileChanged(uri, document, webviewPanel)),
            fileWatcher.onDidCreate(uri => this.onWorkspaceFileChanged(uri, document, webviewPanel)),
            fileWatcher.onDidDelete(uri => this.onWorkspaceFileChanged(uri, document, webviewPanel))
        );
    
        webviewPanel.onDidDispose(() => {
            // Clean up our listeners
            changeDocumentSubscription.dispose();
            disposables.forEach(d => d.dispose());
        });
    }

    private onWorkspaceFileChanged(
      uri: vscode.Uri,
      document: vscode.TextDocument,
      webviewPanel: vscode.WebviewPanel
    ) {
        // TODO: check if the changed file is actually relevant, 

        webviewPanel.webview.postMessage({
            type: 'update',
            // TODO: items: this.getFileContent(document.uri.toString())
        });
    }

    private async getFileCompletions(query: string): Promise<string[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder || !query) {
            return [];
        }

        const files = await vscode.workspace.findFiles('**/*');
        const relativePaths = files.map(file => vscode.workspace.asRelativePath(file));
        
        // Add folder paths
        const folderSet = new Set<string>();
        relativePaths.forEach(path => {
            const parts = path.split('/');
            let current = '';
            for (let i = 0; i < parts.length - 1; i++) {
                current += (i > 0 ? '/' : '') + parts[i];
                folderSet.add(current);
            }
        });
        
        const allPaths = [...relativePaths, ...Array.from(folderSet)];
        return allPaths.filter(path => path.toLowerCase().includes(query.toLowerCase()));
    }

    private async getFileContent(path: string): Promise<{ path: string, content: string }[]> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return [];
            }

            const results: { path: string, content: string }[] = [];
            const fullPath = vscode.Uri.joinPath(workspaceFolder.uri, path);
            const stat = await vscode.workspace.fs.stat(fullPath);
            
            if (stat.type === vscode.FileType.Directory) {
                // For directories, get all files recursively
                const files = await vscode.workspace.findFiles(new vscode.RelativePattern(fullPath, '**/*'));
                
                for (const file of files) {
                    const relativePath = vscode.workspace.asRelativePath(file);
                    const content = await this.readFileContent(file);
                    results.push({
                        path: relativePath,
                        content
                    });
                }
            } else {
                // For single files
                const content = await this.readFileContent(fullPath);
                results.push({
                    path: path,
                    content: content
                });
            }

            return results;
        } catch (error) {
            console.error('Error reading file:', error);
            return [];
        }
    }

    private async readFileContent(uri: vscode.Uri): Promise<string> {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            return document.getText();
        } catch (error) {
            console.error('Error reading file content:', error);
            return '';
        }
    }

    private async getHtmlForWebview(webview: vscode.Webview): Promise<string> {
        const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'editor.html');
        const jsPath = vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'editor.js');
        
        const htmlContent = (await fs.promises.readFile(htmlPath.fsPath)).toString();
        const jsContent = (await fs.promises.readFile(jsPath.fsPath)).toString();
        
        const nonce = getNonce();
        
        // Insert the script tag just before the closing body tag
        return htmlContent.replace('</body>', `
            <script nonce="${nonce}">
                ${jsContent}
            </script>
            </body>
        `);
    }
}
