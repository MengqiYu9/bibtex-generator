import * as vscode from 'vscode';
import axios from 'axios';

export function activate(context: vscode.ExtensionContext) {
    let currentFileName: string | undefined = undefined;

    let disposable = vscode.commands.registerCommand('bibtex-generator.openBibWindow', async () => {
        const inputBox = vscode.window.createInputBox();
        inputBox.placeholder = '输入 /file 更新文件名，或输入论文标题/DOI';
        inputBox.prompt = '指令示例: /file refs.bib 或 Attention is All You Need 或 10.48550/arXiv.1706.03762';

        inputBox.onDidAccept(async () => {
            const input = inputBox.value.trim();
            if (!input) {
                vscode.window.showErrorMessage('输入不能为空！');
                return;
            }

            try {
                if (input.startsWith('/file')) {
                    const fileName = input.replace('/file', '').trim();
                    if (fileName) {
                        currentFileName = fileName;
                        vscode.window.showInformationMessage(`文件名已更新为: ${currentFileName}`);
                    } else {
                        vscode.window.showErrorMessage('请提供文件名！');
                    }
                } else {
                    let bibtex: string | null = null;
                    if (input.startsWith('10.')) {
                        bibtex = await fetchBibTeXFromDOI(input);
                    } else {
                        const doi = await fetchDOIFromTitle(input);
                        if (doi) {
                            bibtex = await fetchBibTeXFromDOI(doi);
                        }
                    }

                    if (!bibtex) {
                        vscode.window.showErrorMessage('无法获取 BibTeX！');
                        return;
                    }

                    if (currentFileName) {
                        const workspaceFolders = vscode.workspace.workspaceFolders;
                        if (!workspaceFolders) {
                            vscode.window.showErrorMessage('请先打开一个工作区！');
                            return;
                        }
                        const filePath = `${workspaceFolders[0].uri.fsPath}/${currentFileName}`;
                        appendToBibFile(filePath, bibtex);
                        vscode.window.showInformationMessage(`BibTeX 已写入 ${filePath}`);
                    } else {
                        vscode.window.showInformationMessage(`BibTeX:\n${bibtex}`);
                    }
                }
            } catch (error: unknown) { // 修改为 unknown
                if (error instanceof Error) {
                    vscode.window.showErrorMessage(`错误: ${error.message}`);
                } else {
                    vscode.window.showErrorMessage(`未知错误: ${String(error)}`);
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

function appendToBibFile(filePath: string, content: string) {
    const fs = require('fs');
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content + '\n');
    } else {
        fs.appendFileSync(filePath, '\n' + content + '\n');
    }
}