import * as vscode from 'vscode';
import * as Profiler from "./lib/profiler";
import * as Locale from "./lib/locale";
import * as File from "./lib/file";
import * as Clairvoyant from "./clairvoyant";

const regExpExecToArray = (regexp: RegExp, text: string) => Profiler.profile
(
    `regExpExecToArray(/${regexp.source}/${regexp.flags})`,
    () =>
    {
        const result: RegExpExecArray[] = [];
        while(true)
        {
            const match = regexp.exec(text);
            if (null === match)
            {
                break;
            }
            result.push(match);
        }
        return result;
    }
);

const toUri = (uri: vscode.Uri | string) => "string" === typeof(uri) ? vscode.Uri.parse(uri): uri;
const getDocument = (uri: vscode.Uri | string) => vscode.workspace.textDocuments.filter(document => document.uri.toString() === uri.toString())[0];
const getOrOpenDocument = async (uri: vscode.Uri | string) => documentMap[uri.toString()] || getDocument(uri) || await vscode.workspace.openTextDocument(toUri(uri));

const getFiles = async (folder: vscode.Uri): Promise<vscode.Uri[]> =>
{
    try
    {
        Clairvoyant.outputChannel.appendLine(`scan ${folder.toString()}`);
        const rawFiles = (await vscode.workspace.fs.readDirectory(folder)).filter(i => !Clairvoyant.startsWithDot(i[0]));
        const folders = rawFiles.filter(i => vscode.FileType.Directory === i[1]).map(i => i[0]).filter(i => Clairvoyant.excludeDirectories.get("").indexOf(i) < 0);
        const files = rawFiles.filter(i => vscode.FileType.File === i[1]).map(i => i[0]).filter(i => !Clairvoyant.isExcludeFile(i));
        return files.map(i => vscode.Uri.parse(folder.toString() +"/" +i))
        .concat
        (
            (await Promise.all(folders.map(i => getFiles(vscode.Uri.parse(folder.toString() +"/" +i)))))
                .reduce((a, b) => a.concat(b), [])
        );
    }
    catch(error)
    {
        Clairvoyant.outputChannel.appendLine(`${folder.toString()}: ${JSON.stringify(error)}`);
        return [];
    }
};

export const documentTokenEntryMap: { [uri: string]: { [token: string]: number[] } } = { };
export const tokenDocumentEntryMap: { [token: string]: string[] } = { };
export const documentFileMap: { [uri: string]: string } = { };
export const tokenCountMap: { [token: string]: number } = { };
export const documentMap: { [uri: string]: vscode.TextDocument } = { };
export let isMaxFilesNoticed = false;

export const reload = () =>
{
    Object.keys(documentTokenEntryMap).forEach(i => delete documentTokenEntryMap[i]);
    Object.keys(tokenDocumentEntryMap).forEach(i => delete tokenDocumentEntryMap[i]);
    Object.keys(documentFileMap).forEach(i => delete documentFileMap[i]);
    Object.keys(tokenCountMap).forEach(i => delete tokenCountMap[i]);
    Object.keys(documentMap).forEach(i => delete documentMap[i]);
    isMaxFilesNoticed = false;
};

export const scanDocument = async (document: vscode.TextDocument, force: boolean = false) => await Clairvoyant.busy.do
(
    () =>
    Profiler.profile
    (
        "scanDocument",
        () =>
        {
            const uri = document.uri.toString();
            const old = documentTokenEntryMap[uri];
            if ((!force && old) || !Clairvoyant.isTargetProtocol(uri))
            {
                console.log(`scanDocument SKIP: ${uri}`);
            }
            else
            {
                if (!documentFileMap[uri] && Clairvoyant.maxFiles.get("") <= Object.keys(documentMap).length)
                {
                    if (!isMaxFilesNoticed)
                    {
                        isMaxFilesNoticed = true;
                        vscode.window.showWarningMessage(Locale.map("Max Files Error"));
                        Clairvoyant.outputChannel.appendLine(`Max Files Error!!!`);
                    }
                }
                else
                {
                    Clairvoyant.outputChannel.appendLine(`scan document: ${uri}`);
                    documentMap[uri] = document;
                    documentFileMap[uri] = File.extractFileName(uri);
                    const text = Profiler.profile("scanDocument.document.getText", () => document.getText());
                    const hits = Profiler.profile
                    (
                        "scanDocument.scan",
                        () => regExpExecToArray
                        (
                            /\w+/gm,
                            text
                        )
                        .map
                        (
                            match =>
                            ({
                                token: match[0],
                                index: match.index,
                            })
                        )
                    );
                    const map: { [key: string]: number[] } = { };
                    Profiler.profile
                    (
                        "scanDocument.summary",
                        () =>
                        {
                            hits.forEach
                            (
                                hit =>
                                {
                                    const key = Clairvoyant.encodeToken(hit.token);
                                    if (!map[key])
                                    {
                                        map[key] = [];
                                    }
                                    map[key].push(hit.index);
                                }
                            );
                        }
                    );
                    Profiler.profile
                    (
                        "scanDocument.register",
                        () =>
                        {
                            documentTokenEntryMap[uri] = map;
                            const oldTokens = old ? Object.keys(old): [];
                            const newTokens = Object.keys(map);
                            oldTokens.filter(i => newTokens.indexOf(i) < 0).forEach
                            (
                                i =>
                                {
                                    tokenDocumentEntryMap[i].splice(tokenDocumentEntryMap[i].indexOf(uri), 1);
                                    if (tokenDocumentEntryMap[i].length <= 0)
                                    {
                                        delete tokenDocumentEntryMap[i];
                                    }
                                }
                            );
                            newTokens.filter(i => oldTokens.indexOf(i) < 0).forEach
                            (
                                i =>
                                {
                                    if (!tokenDocumentEntryMap[i])
                                    {
                                        tokenDocumentEntryMap[i] = [];
                                    }
                                    tokenDocumentEntryMap[i].push(uri);
                                }
                            );
                            oldTokens.forEach(i => tokenCountMap[i] -= old[i].length);
                            newTokens.forEach
                            (
                                i =>
                                {
                                    if (!tokenCountMap[i])
                                    {
                                        tokenCountMap[i] = 0;
                                    }
                                    tokenCountMap[i] += map[i].length;
                                }
                            );
                        }
                    );
                }
            }
        }
    )
);
export const detachDocument = async (document: vscode.TextDocument) => await Clairvoyant.busy.do
(
    () =>
    Profiler.profile
    (
        "detachDocument",
        () =>
        {
            const uri = document.uri.toString();
            Clairvoyant.outputChannel.appendLine(`detach document: ${uri}`);
            const old = documentTokenEntryMap[uri];
            const oldTokens = old ? Object.keys(old): [];
            oldTokens.forEach
            (
                i =>
                {
                    tokenDocumentEntryMap[i].splice(tokenDocumentEntryMap[i].indexOf(uri), 1);
                    if (tokenDocumentEntryMap[i].length <= 0)
                    {
                        delete tokenDocumentEntryMap[i];
                    }
                }
            );
            oldTokens.forEach(i => tokenCountMap[i] -= old[i].length);
            delete documentTokenEntryMap[uri];
            delete documentFileMap[uri];
            delete documentMap[uri];
        }
    )
);
export const scanOpenDocuments = async () => await Clairvoyant.busy.doAsync
(
    async () =>
    {
        await Promise.all
        (
            vscode.window.visibleTextEditors
                .filter(i => Clairvoyant.isTargetProtocol(i.document.uri.toString()))
                .map(async (i) => await scanDocument(i.document))
        );
    }
);
export const scanWorkspace = async () => await Clairvoyant.busy.doAsync
(
    async () =>
    {
        Clairvoyant.outputChannel.appendLine(`begin scan workspace`);
        await scanOpenDocuments();
        if (vscode.workspace.workspaceFolders)
        {
            const files = (await Promise.all(vscode.workspace.workspaceFolders.map(i => getFiles(i.uri))))
                .reduce((a, b) => a.concat(b), []);
            if
            (
                Clairvoyant.maxFiles.get("") <= Object.keys(documentMap)
                    .concat(files.map(i => i.toString()))
                    .filter((i, index, self) => index === self.indexOf(i))
                    .length
            )
            {
                vscode.window.showWarningMessage(Locale.map("Max Files Error"));
                Clairvoyant.outputChannel.appendLine(`Max Files Error!!!`);
            }
            else
            {
                await Promise.all
                (
                    files.map
                    (
                        async (i) =>
                        {
                            try
                            {
                                Clairvoyant.outputChannel.appendLine(`open document: ${i}`);
                                await scanDocument(await getOrOpenDocument(i));
                            }
                            catch(error)
                            {
                                Clairvoyant.outputChannel.appendLine(`error: ${JSON.stringify(error)}`);
                            }
                        }
                    )
                );
            }
            Clairvoyant.outputChannel.appendLine(`scan workspace complete!`);
        }
    }
);
