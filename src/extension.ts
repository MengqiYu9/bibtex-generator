import * as vscode from 'vscode';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs/promises';

export function activate(context: vscode.ExtensionContext) {
    let currentFileName: string | undefined = undefined;

    let disposable = vscode.commands.registerCommand('bibtex-generator.openBibWindow', async () => {
        const inputBox = vscode.window.createInputBox();
        inputBox.placeholder = 'Type /file to set filename, or enter paper title(s)/DOI(s)';
        inputBox.prompt = 'Example: /file refs.bib OR Attention is All You Need OR 10.48550/arXiv.1706.03762 OR multiple titles separated by ";" or "；"';

        inputBox.onDidAccept(async () => {
            const input = inputBox.value.trim();
            if (!input) {
                vscode.window.showErrorMessage('Input cannot be empty!');
                return;
            }

            try {
                if (input.startsWith('/file')) {
                    const fileName = input.replace('/file', '').trim();
                    if (fileName) {
                        const safeFileName = path.basename(fileName);
                        currentFileName = safeFileName;
                        vscode.window.showInformationMessage(`Filename set to: ${currentFileName}`);
                    } else {
                        vscode.window.showErrorMessage('Please provide a valid filename!');
                    }
                } else {
                    const entries: string[] = input.split(/[；;]/).map(i => i.trim()).filter(Boolean);
                    const bibtexResults: string[] = [];

                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Fetching BibTeX entries...',
                        cancellable: true
                    }, async (progress, token) => {
                        for (let i = 0; i < entries.length; i++) {
                            if (token.isCancellationRequested) {
                                vscode.window.showWarningMessage('Operation cancelled by user.');
                                break;
                            }

                            const entry = entries[i];
                            progress.report({
                                message: `(${i + 1}/${entries.length}) ${entry}`,
                                increment: (100 / entries.length)
                            });

                            let bibtex: string | null = null;
                            let sourceTitle = entry;

                            if (entry.startsWith('10.')) {
                                bibtex = await fetchBibTeXFromDOI(entry);
                            } else {
                                const doi = await fetchDOIFromTitle(entry);
                                if (doi) {
                                    bibtex = await fetchBibTeXFromDOI(doi);
                                }
                            }

                            if (!bibtex) {
                                vscode.window.showWarningMessage(`Failed to get BibTeX for: ${sourceTitle}`);
                                continue;
                            }

                            bibtexResults.push(bibtex);

                            const citationKey = extractBibKey(bibtex);
                            const title = extractBibTitle(bibtex);
                            vscode.window.showInformationMessage(`@${citationKey} → ${title}`);
                        }
                    });

                    if (bibtexResults.length === 0) {
                        vscode.window.showErrorMessage('No valid BibTeX entries found.');
                        return;
                    }

                    if (currentFileName) {
                        const workspaceFolders = vscode.workspace.workspaceFolders;
                        if (!workspaceFolders) {
                            vscode.window.showErrorMessage('Please open a workspace first.');
                            return;
                        }
                        const filePath = `${workspaceFolders[0].uri.fsPath}/${currentFileName}`;
                        await appendToBibFileAsync(filePath, bibtexResults.join('\n\n'));

                        const openButton = 'Open File';
                        const selection = await vscode.window.showInformationMessage(`BibTeX entries written to ${filePath}`, openButton);
                        if (selection === openButton) {
                            const doc = await vscode.workspace.openTextDocument(filePath);
                            const editor = await vscode.window.showTextDocument(doc);
                            const lastLine = doc.lineCount - 1;
                            editor.revealRange(new vscode.Range(lastLine, 0, lastLine, 0));
                            editor.selection = new vscode.Selection(lastLine, 0, lastLine, 0);
                        }
                    } else {
                        vscode.window.showInformationMessage(`BibTeX:\n${bibtexResults.join('\n\n')}`);
                    }
                }
            } catch (error: unknown) {
                if (error instanceof Error) {
                    vscode.window.showErrorMessage(`Error: ${error.message}`);
                } else {
                    vscode.window.showErrorMessage(`Unknown error: ${String(error)}`);
                }
            }

            inputBox.value = '';
        });

        inputBox.onDidHide(() => inputBox.dispose());
        inputBox.show();
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}

async function fetchDOIFromTitle(title: string): Promise<string | null> {
    const url = `https://api.crossref.org/works?query.title=${encodeURIComponent(title)}&rows=1`;
    const response = await axios.get(url, {
        headers: { 'User-Agent': 'VSCode-BibTeX-Generator/1.0' }
    });

    const items = response.data.message.items;
    if (items.length > 0) {
        return items[0].DOI;
    }
    return null;
}

async function fetchBibTeXFromDOI(doi: string): Promise<string | null> {
    const url = `https://doi.org/${doi}`;
    const response = await axios.get(url, {
        headers: {
            'Accept': 'application/x-bibtex',
            'User-Agent': 'VSCode-BibTeX-Generator/1.0'
        }
    });

    return response.data;
}

async function appendToBibFileAsync(filePath: string, content: string) {
    try {
        await fs.access(filePath).catch(() => fs.writeFile(filePath, content + '\n'));
        await fs.appendFile(filePath, '\n' + content + '\n');
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to write file: ${(err as Error).message}`);
    }
}

function extractBibKey(bibtex: string): string {
    const match = bibtex.match(/^@\w+\{([^,]+),/);
    return match ? match[1] : 'unknown';
}

function extractBibTitle(bibtex: string): string {
    const match = bibtex.match(/title\s*=\s*[\{\"]([^\}\"]+)[\}\"]/i);
    return match ? match[1] : 'Unknown Title';
}
