import * as vscode from 'vscode';
export const extractDirectoryAndWorkspace = (path : string) : string =>
{
    const dir = extractDirectory(path);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(dir));
    return workspaceFolder && path.startsWith(workspaceFolder.uri.toString()) ?
        (
            vscode.workspace.workspaceFolders && 2 <= vscode.workspace.workspaceFolders.length ?
                `${workspaceFolder.name}: ${dir.substring(workspaceFolder.uri.toString().length)}`:
                `${dir.substring(workspaceFolder.uri.toString().length)}`
        ):
        dir;
};
export const extractDirectory = (path : string) : string => path.substr(0, path.length -extractFileName(path).length);
export const extractFileName = (path : string) : string => path.split('\\').reverse()[0].split('/').reverse()[0];
export const makeDigest = (text : string) : string => text.replace(/\s+/g, " ").substr(0, 128);
export const makeDescription = (document: vscode.TextDocument) => document.uri.toString().startsWith("untitled:") ?
    makeDigest(document.getText()):
    extractDirectoryAndWorkspace(document.uri.toString());
export const extractRelativePath = (path : string) : string =>
{
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(path));
    return workspaceFolder && path.startsWith(workspaceFolder.uri.toString()) ? path.substring(workspaceFolder.uri.toString().length): path;
};
