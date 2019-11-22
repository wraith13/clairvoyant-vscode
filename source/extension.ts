import * as vscode from 'vscode';

import * as Profiler from "./lib/profiler";
import * as Config from "./lib/config";
import * as Locale from "./lib/locale";
import * as Busy from "./lib/busy";

//
//  utilities
//

const roundCenti = (value : number) : number => Math.round(value *100) /100;
const percentToDisplayString = (value : number, locales?: string | string[]) : string =>`${roundCenti(value).toLocaleString(locales, { style: "percent" })}`;

const simpleComparer = <valueT>(a: valueT, b: valueT) =>
    a < b ? -1:
    b < a ? 1:
    0;

const makeComparer = <objectT, valueT>(getValue: (object: objectT) => valueT) => (a: objectT, b: objectT) => simpleComparer(getValue(a), getValue(b));
const stringComparer = (a: string, b: string) =>
    a.toLowerCase() < b.toLowerCase() ? -1:
    b.toLowerCase() < a.toLowerCase() ? 1:
    simpleComparer(a, b);
const mergeComparer = <valueT>(comparerList: ((a: valueT, b: valueT) => number)[]) => (a: valueT, b: valueT) =>
{
    let result = 0;
    for(let i = 0; i < comparerList.length && 0 === result; ++i)
    {
        result = comparerList[i](a, b);
    }
    return result;
};

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

const extractRelativePath = (path : string) : string =>
{
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(path));
    return workspaceFolder && path.startsWith(workspaceFolder.uri.toString()) ? path.substring(workspaceFolder.uri.toString().length): path;
};
const extractDirectory = (path : string) : string => path.substr(0, path.length -extractFileName(path).length);
const extractDirectoryAndWorkspace = (path : string) : string =>
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
const extractFileName = (path : string) : string => path.split('\\').reverse()[0].split('/').reverse()[0];
const digest = (text : string) : string => text.replace(/\s+/g, " ").substr(0, 128);

//
//  Clairvoyant
//

export module Clairvoyant
{
    const applicationKey = Config.applicationKey;
    let context: vscode.ExtensionContext;

    let eyeLabel: vscode.StatusBarItem;

    const busy = new Busy.Entry(() => updateStatusBarItems());
    
    const autoScanModeObject = Object.freeze
    ({
        "none":
        {
            onInit: () => { },
            enabled: false,
        },
        "open documents":
        {
            onInit: () => scanOpenDocuments(),
            enabled: true,
        },
        "workspace":
        {
            onInit: () => scanWorkspace(),
            enabled: true,
        },
    });
    const textEditorRevealTypeObject = Object.freeze
    ({
        "AtTop": vscode.TextEditorRevealType.AtTop,
        "Default": vscode.TextEditorRevealType.Default,
        "InCenter": vscode.TextEditorRevealType.InCenter,
        "InCenterIfOutsideViewport": vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    });

    const autoScanMode = new Config.MapEntry("autoScanMode", autoScanModeObject);
    const maxFiles = new Config.Entry<number>("maxFiles");
    const showStatusBarItems = new Config.Entry<boolean>("showStatusBarItems");
    const textEditorRevealType = new Config.MapEntry("textEditorRevealType", textEditorRevealTypeObject);
    const isExcludeStartsWidhDot = new Config.Entry<boolean>("isExcludeStartsWidhDot");
    const excludeDirectories = new Config.Entry("excludeDirectories", Config.stringArrayValidator);
    const excludeExtentions = new Config.Entry("excludeExtentions", Config.stringArrayValidator);

    const outputChannel = vscode.window.createOutputChannel("Clairvoyant");
    
    const createStatusBarItem =
    (
        properties :
        {
            alignment ? : vscode.StatusBarAlignment,
            text ? : string,
            command ? : string,
            tooltip ? : string
        }
    )
    : vscode.StatusBarItem =>
    {
        const result = vscode.window.createStatusBarItem(properties.alignment);
        if (undefined !== properties.text)
        {
            result.text = properties.text;
        }
        if (undefined !== properties.command)
        {
            result.command = properties.command;
        }
        if (undefined !== properties.tooltip)
        {
            result.tooltip = properties.tooltip;
        }
        return result;
    };

    export const initialize = (aContext: vscode.ExtensionContext): void =>
    {
        context = aContext;
        context.subscriptions.push
        (
            //  コマンドの登録
            vscode.commands.registerCommand
            (
                `${applicationKey}.scanDocument`, async () =>
                {
                    const activeTextEditor = vscode.window.activeTextEditor;
                    if (activeTextEditor)
                    {
                        await scanDocument(activeTextEditor.document, true);
                    }
                }
            ),
            vscode.commands.registerCommand(`${applicationKey}.scanOpenDocuments`, scanOpenDocuments),
            vscode.commands.registerCommand(`${applicationKey}.scanWorkspace`, scanWorkspace),
            vscode.commands.registerCommand(`${applicationKey}.sight`, sight),
            vscode.commands.registerCommand(`${applicationKey}.back`, showTokenUndo),
            vscode.commands.registerCommand(`${applicationKey}.forward`, showTokenRedo),
            vscode.commands.registerCommand(`${applicationKey}.reload`, reload),
            vscode.commands.registerCommand(`${applicationKey}.reportStatistics`, reportStatistics),
            vscode.commands.registerCommand(`${applicationKey}.reportProfile`, reportProfile),

            //  ステータスバーアイコンの登録
            eyeLabel = createStatusBarItem
            ({
                alignment: vscode.StatusBarAlignment.Right,
                text: "$(eye)",
                command: `${applicationKey}.sight`,
                tooltip: Locale.string("%clairvoyant.sight.title%")
            }),

            //  イベントリスナーの登録
            vscode.workspace.onDidChangeConfiguration(onDidChangeConfiguration),
            vscode.workspace.onDidChangeWorkspaceFolders(reload),
            vscode.workspace.onDidChangeTextDocument
            (
                event =>
                {
                    if (autoScanMode.get(event.document.languageId).enabled && (!isExcludeDocument(event.document)))
                    {
                        scanDocument(event.document, true);
                    }
                }
            ),
            vscode.workspace.onDidCloseTextDocument
            (
                async (document) =>
                {
                    if (documentTokenEntryMap[document.uri.toString()])
                    {
                        try
                        {
                            await vscode.workspace.fs.stat(document.uri);
                        }
                        catch(error)
                        {
                            console.log(`vscode.workspace.onDidCloseTextDocument: ${error}`); // 一応ログにエラーを吐いておく
                            detachDocument(document);
                        }
                    }
                }
            ),
            vscode.window.onDidChangeActiveTextEditor
            (
                textEditor =>
                {
                    if (textEditor && autoScanMode.get(textEditor.document.languageId).enabled && !isExcludeDocument(textEditor.document))
                    {
                        scanDocument(textEditor.document);
                    }
                }
            ),
        );

        reload();
    };

    const isExcludeFile = (filePath: string) => excludeExtentions.get("").some(i => filePath.toLowerCase().endsWith(i.toLowerCase()));
    const startsWithDot = (path: string) => isExcludeStartsWidhDot.get("") && path.startsWith(".");
    const isExcludeDocument = (document: vscode.TextDocument) => !documentTokenEntryMap[document.uri.toString()] &&
    (
        extractRelativePath(document.uri.toString()).split("/").some(i => 0 <= excludeDirectories.get("").indexOf(i) || startsWithDot(i)) ||
        isExcludeFile(document.uri.toString())
    );

    const toUri = (uri: vscode.Uri | string) => "string" === typeof(uri) ? vscode.Uri.parse(uri): uri;
    const getDocument = (uri: vscode.Uri | string) => vscode.workspace.textDocuments.filter(document => document.uri.toString() === uri.toString())[0];
    const getOrOpenDocument = async (uri: vscode.Uri | string) => documentMap[uri.toString()] || getDocument(uri) || await vscode.workspace.openTextDocument(toUri(uri));

    const documentTokenEntryMap: { [uri: string]: { [token: string]: number[] } } = { };
    const tokenDocumentEntryMap: { [token: string]: string[] } = { };
    const documentFileMap: { [uri: string]: string } = { };
    const tokenCountMap: { [token: string]: number } = { };
    const documentMap: { [uri: string]: vscode.TextDocument } = { };
    let isMaxFilesNoticed = false;

    const encodeToken = (token: string) => `@${token}`;
    const decodeToken = (token: string) => token.substring(1);

    interface ShowTokenCoreEntry
    {
        document: vscode.TextDocument;
        selection: vscode.Selection;
    }
    interface ShowTokenDoEntry
    {
        redo: ShowTokenCoreEntry;
        undo: ShowTokenCoreEntry | null;
    }
    const showTokenUndoBuffer: ShowTokenDoEntry[] = [];
    const showTokenRedoBuffer: ShowTokenDoEntry[] = [];
    const showSelection = async (entry: { document: vscode.TextDocument, selection: vscode.Selection }) =>
    {
        const textEditor = await vscode.window.showTextDocument(entry.document);
        textEditor.selection = entry.selection;
        textEditor.revealRange(entry.selection, textEditorRevealType.get(entry.document.languageId));
    };
    const makeShowTokenCoreEntry = () =>
    {
        let result: ShowTokenCoreEntry | null = null;
        const activeTextEditor = vscode.window.activeTextEditor;
        if (activeTextEditor)
        {
            result =
            {
                document: activeTextEditor.document,
                selection: activeTextEditor.selection,
            };
        }
        return result;
    };
    const showToken = async (entry: { document: vscode.TextDocument, selection: vscode.Selection }) =>
    {
        showTokenUndoBuffer.push
        ({
            redo: entry,
            undo: makeShowTokenCoreEntry(),
        });
        showSelection(entry);
        showTokenRedoBuffer.splice(0, 0);
    };
    const showTokenUndo = async () =>
    {
        const entry = showTokenUndoBuffer.pop();
        if (entry)
        {
            if (entry.undo)
            {
                showSelection(entry.undo);
            }
            showTokenRedoBuffer.push(entry);
        }
    };
    const showTokenRedo = async () =>
    {
        const entry = showTokenRedoBuffer.pop();
        if (entry)
        {
            entry.undo = makeShowTokenCoreEntry() || entry.undo;
            showSelection(entry.redo);
            showTokenUndoBuffer.push(entry);
        }
    };

    const copyToken = async (text: string) => await vscode.env.clipboard.writeText(text);
    const pasteToken = async (text: string) =>
    {
        const textEditor = vscode.window.activeTextEditor;
        if (textEditor)
        {
            await textEditor.edit
            (
                editBuilder =>
                {
                    editBuilder.delete(textEditor.selection);
                    editBuilder.insert
                    (
                        textEditor.selection.anchor.compareTo(textEditor.selection.active) <= 0 ?
                            textEditor.selection.anchor:
                            textEditor.selection.active,
                        text
                    );
                }
            );
        }
    };

    const reload = () =>
    {
        Object.keys(documentTokenEntryMap).forEach(i => delete documentTokenEntryMap[i]);
        Object.keys(tokenDocumentEntryMap).forEach(i => delete tokenDocumentEntryMap[i]);
        Object.keys(documentFileMap).forEach(i => delete documentFileMap[i]);
        Object.keys(tokenCountMap).forEach(i => delete tokenCountMap[i]);
        Object.keys(documentMap).forEach(i => delete documentMap[i]);
        showTokenUndoBuffer.splice(0, 0);
        showTokenRedoBuffer.splice(0, 0);
        Profiler.start();
        isMaxFilesNoticed = false;
        onDidChangeConfiguration();
    };
    const onDidChangeConfiguration = () =>
    {
        const old =
        {
            autoScanMode: autoScanMode.getCache(""),
            maxFiles: maxFiles.getCache(""),
            isExcludeStartsWidhDot: isExcludeStartsWidhDot.getCache(""),
            excludeDirectories: excludeDirectories.getCache(""),
            excludeExtentions: excludeExtentions.getCache(""),
        };
        [
            autoScanMode,
            maxFiles,
            showStatusBarItems,
            textEditorRevealType,
            isExcludeStartsWidhDot,
            excludeDirectories,
            excludeExtentions,
        ]
        .forEach(i => i.clear());
        updateStatusBarItems();
        if
        (
            old.autoScanMode !== autoScanMode.get("") ||
            old.maxFiles !== maxFiles.get("") ||
            old.isExcludeStartsWidhDot !== isExcludeStartsWidhDot.get("") ||
            JSON.stringify(old.excludeDirectories) !== JSON.stringify(excludeDirectories.get("")) ||
            JSON.stringify(old.excludeExtentions) !== JSON.stringify(excludeExtentions.get(""))
        )
        {
            autoScanMode.get("").onInit();
        }
    };

    const reportStatistics = async () => await busy.do
    (
        () => Profiler.profile
        (
            "reportStatistics",
            () =>
            {
                outputChannel.show();
                outputChannel.appendLine(`files: ${Object.keys(documentTokenEntryMap).length.toLocaleString()}`);
                outputChannel.appendLine(`unique tokens: ${Object.keys(tokenDocumentEntryMap).length.toLocaleString()}`);
                outputChannel.appendLine(`total tokens: ${Object.values(tokenCountMap).reduce((a, b) => a +b, 0).toLocaleString()}`);
            }
        )
    );

    const reportProfile = async () => await busy.do
    (
        () => Profiler.profile
        (
            "reportProfile",
            () =>
            {
                outputChannel.show();
                if (Profiler.getIsProfiling())
                {
                    outputChannel.appendLine(`${Locale.string("📊 Profile Report")} - ${new Date()}`);
                    const overall = Profiler.getOverall();
                    const total = Profiler.getReport().map(i => i.ticks).reduce((p, c) => p +c);
                    outputChannel.appendLine(Locale.string("⚖ Overview"));
                    outputChannel.appendLine(`- Overall: ${overall.toLocaleString()}ms ( ${percentToDisplayString(1)} )`);
                    outputChannel.appendLine(`- Busy: ${total.toLocaleString()}ms ( ${percentToDisplayString(total / overall)} )`);
                    outputChannel.appendLine(Locale.string("🔬 Busy Details"));
                    outputChannel.appendLine(`- Total: ${total.toLocaleString()}ms ( ${percentToDisplayString(1)} )`);
                    Profiler.getReport().forEach(i => outputChannel.appendLine(`- ${i.name}: ${i.ticks.toLocaleString()}ms ( ${percentToDisplayString(i.ticks / total)} )`));
                    outputChannel.appendLine("");
                }
                else
                {
                    outputChannel.appendLine(Locale.string("🚫 Profile has not been started."));
                }
            }
        )
    );

    //
    //  Scan
    //

    const scanDocument = async (document: vscode.TextDocument, force: boolean = false) => await busy.do
    (
        () =>
        Profiler.profile
        (
            "scanDocument",
            () =>
            {
                const uri = document.uri.toString();
                const textEditor = vscode.window.visibleTextEditors.filter(i => i.document.uri.toString() === uri)[0];
                const old = documentTokenEntryMap[uri];
                if ((!force && old) || (textEditor && !textEditor.viewColumn))
                {
                    console.log(`scanDocument SKIP: ${uri}`);
                }
                else
                {
                    if (!documentFileMap[uri] && maxFiles.get("") <= Object.keys(documentMap).length)
                    {
                        if (!isMaxFilesNoticed)
                        {
                            isMaxFilesNoticed = true;
                            vscode.window.showWarningMessage(Locale.string("Max Files Error"));
                            outputChannel.appendLine(`Max Files Error!!!`);
                        }
                    }
                    else
                    {
                        outputChannel.appendLine(`scan document: ${uri}`);
                        documentMap[uri] = document;
                        documentFileMap[uri] = extractFileName(uri);
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
                                        const key = encodeToken(hit.token);
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
    const detachDocument = async (document: vscode.TextDocument) => await busy.do
    (
        () =>
        Profiler.profile
        (
            "detachDocument",
            () =>
            {
                const uri = document.uri.toString();
                outputChannel.appendLine(`detach document: ${uri}`);
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
    const scanOpenDocuments = async () => await busy.doAsync
    (
        async () =>
        {
            await Promise.all
            (
                vscode.window.visibleTextEditors
                    .filter(i => i.viewColumn)
                    .map(async (i) => await scanDocument(i.document))
            );
        }
    );
    const getFiles = async (folder: vscode.Uri): Promise<vscode.Uri[]> =>
    {
        try
        {
            outputChannel.appendLine(`scan ${folder.toString()}`);
            const rawFiles = (await vscode.workspace.fs.readDirectory(folder)).filter(i => !startsWithDot(i[0]));
            const folders = rawFiles.filter(i => vscode.FileType.Directory === i[1]).map(i => i[0]).filter(i => excludeDirectories.get("").indexOf(i) < 0);
            const files = rawFiles.filter(i => vscode.FileType.File === i[1]).map(i => i[0]).filter(i => !isExcludeFile(i));
            return files.map(i => vscode.Uri.parse(folder.toString() +"/" +i))
            .concat
            (
                (await Promise.all(folders.map(i => getFiles(vscode.Uri.parse(folder.toString() +"/" +i)))))
                    .reduce((a, b) => a.concat(b), [])
            );
        }
        catch(error)
        {
            outputChannel.appendLine(`${folder.toString()}: ${JSON.stringify(error)}`);
            return [];
        }
    };
    const scanWorkspace = async () => await busy.doAsync
    (
        async () =>
        {
            outputChannel.appendLine(`begin scan workspace`);
            await scanOpenDocuments();
            if (vscode.workspace.workspaceFolders)
            {
                const files = (await Promise.all(vscode.workspace.workspaceFolders.map(i => getFiles(i.uri))))
                    .reduce((a, b) => a.concat(b), []);
                if
                (
                    maxFiles.get("") <= Object.keys(documentMap)
                        .concat(files.map(i => i.toString()))
                        .filter((i, index, self) => index === self.indexOf(i))
                        .length
                )
                {
                    vscode.window.showWarningMessage(Locale.string("Max Files Error"));
                    outputChannel.appendLine(`Max Files Error!!!`);
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
                                    outputChannel.appendLine(`open document: ${i}`);
                                    await scanDocument(await getOrOpenDocument(i));
                                }
                                catch(error)
                                {
                                    outputChannel.appendLine(`error: ${JSON.stringify(error)}`);
                                }
                            }
                        )
                    );
                }
                outputChannel.appendLine(`scan workspace complete!`);
            }
        }
    );

    //
    //  Menu
    //

    interface CommandMenuItem extends vscode.QuickPickItem
    {
        command: () => Promise<void>;
    }
    const showMenu = async (items: CommandMenuItem[], options?: vscode.QuickPickOptions) =>
    {
        const select = await vscode.window.showQuickPick(items, options);
        if (select)
        {
            await select.command();
        }
    };
    const makeSelection = (document: vscode.TextDocument, index: number, token: string) => Profiler.profile
    (
        "makeSelection",
        () => new vscode.Selection(document.positionAt(index), document.positionAt(index +token.length))
    );
    const makePreview = (document: vscode.TextDocument, anchor: vscode.Position) => Profiler.profile
    (
        "makePreview",
        () =>
        {
            const line = document.getText(new vscode.Range(anchor.line, 0, anchor.line +1, 0)).substr(0, 128);
            return line.trim().replace(/\s+/gm, " ");
        }
    );
    const makeGoCommandMenuItem = (label: string, entry: ShowTokenCoreEntry, command: () => Promise<void> = async () => showToken(entry)) => Profiler.profile
    (
        "makeGoCommandMenuItem",
        () =>
        ({

            label: `$(rocket) ${Locale.string(label)} line:${entry.selection.anchor.line +1} row:${entry.selection.anchor.character +1}` +
            (
                entry.selection.anchor.line === entry.selection.active.line ?
                    `-${entry.selection.active.character +1}`:
                    ` - line:${entry.selection.active.line +1} row:${entry.selection.active.character +1}`
            ),
            description: extractRelativePath(entry.document.uri.toString()),
            detail: makePreview(entry.document, entry.selection.anchor),
            command,
        })
    );
    const makeSightShowMenu = (uri: string, token: string, hits: number[]): CommandMenuItem[] => Profiler.profile
    (
        "makeSightShowMenu",
        () => hits.map
        (
            index => makeGoCommandMenuItem
            (
                "clairvoyant.goto.title",
                {
                    document: documentMap[uri],
                    selection: makeSelection(documentMap[uri], index, token)
                }
            )
        )
    );
    const makeSightTokenCoreMenu = (token: string): CommandMenuItem[] =>
    ([
        {
            label: `$(clippy) ${Locale.string("Copy \"${token}\" to clipboard").replace("${token}", token)}`,
            command: async () => copyToken(token),
        },
        {
            label: `$(clippy) ${Locale.string("Paste \"${token}\" to text editor").replace("${token}", token)}`,
            command: async () => pasteToken(token),
        },
    ]);
    const makeSightTokenMenu = (token: string): CommandMenuItem[] => Profiler.profile
    (
        "makeSightTokenMenu",
        () => makeSightTokenCoreMenu(decodeToken(token)).concat
        (
            tokenDocumentEntryMap[token].map(i => ({ uri:i, hits: documentTokenEntryMap[i][token] }))
            .sort(mergeComparer([makeComparer(entry => -entry.hits.length), makeComparer(entry => entry.uri)]))
            .map
            (
                entry =>
                ({
                    label: `$(file-text) ${extractFileName(entry.uri)}`,
                    description: entry.uri.startsWith("untitled:") ?
                        digest(documentMap[entry.uri].getText()):
                        extractDirectoryAndWorkspace(entry.uri),
                        detail: `count: ${entry.hits.length}`,
                    command: async () =>await showMenu(await busy.do(() => makeSightShowMenu(entry.uri, decodeToken(token), entry.hits)), { matchOnDetail: true })
                })
            )
        )
    );
    const makeSightFileTokenMenu = (uri: string, token: string, indices: number[]): CommandMenuItem[] => Profiler.profile
    (
        "makeSightFileTokenMenu",
        () => makeSightTokenCoreMenu(token).concat(makeSightShowMenu(uri, token, indices))
    );
    const makeSightFileRootMenu = (uri: string, entries: { [key: string]: number[] }): CommandMenuItem[] => Profiler.profile
    (
        "makeSightFileRootMenu",
        () =>
        ([
            "token" === getRootMenuOrder() ?
                {
                    label: `$(list-ordered) ${Locale.string("Sort by count")}`,
                    command: async () =>
                    {
                        context.globalState.update("clairvoyant.rootMenuOrder", "count");
                        await showMenu(await busy.do(() => makeSightFileRootMenu(uri, entries)));
                    },
                }:
                {
                    label: `$(list-ordered) ${Locale.string("Sort by token")}`,
                    command: async () =>
                    {
                        context.globalState.update("clairvoyant.rootMenuOrder", "token");
                        await showMenu(await busy.do(() => makeSightFileRootMenu(uri, entries)));
                    },
                },
        ])
        .concat
        (
            Object.entries(entries).sort
            (
                "token" === getRootMenuOrder() ?
                    (a, b) => stringComparer(a[0], b[0]):
                    mergeComparer
                    ([
                        makeComparer(entry => -entry[1].length),
                        (a, b) => stringComparer(a[0], b[0])
                    ])
            )
            .map
            (
                entry =>
                ({
                    label: `$(tag) "${decodeToken(entry[0])}"`,
                    description: undefined,
                    detail: `count: ${entry[1].length}`,
                    command: async () => await showMenu(await busy.do(() => makeSightFileTokenMenu(uri, decodeToken(entry[0]), entry[1])), { matchOnDetail: true })
                })
            )
        )
    );
    const makeSightFileListMenu = (): CommandMenuItem[] => Profiler.profile
    (
        "makeSightFileListMenu",
        () => Object.entries(documentTokenEntryMap)
        .sort(makeComparer(entry => entry[0]))
        .map
        (
            entry =>
            ({
                label: `$(file-text) ${extractFileName(entry[0])}`,
                description: entry[0].startsWith("untitled:") ?
                    digest(documentMap[entry[0]].getText()):
                    extractDirectoryAndWorkspace(entry[0]),
                command: async () =>await showMenu(await busy.do(() => makeSightFileRootMenu(entry[0], entry[1])))
            })
        )
    );
    const getRootMenuOrder = () => context.globalState.get<string>("clairvoyant.rootMenuOrder", "token");
    const makeHistoryMenu = (): CommandMenuItem[] =>
    {
        const result: CommandMenuItem[] = [];
        if (0 < showTokenUndoBuffer.length)
        {
            const entry = showTokenUndoBuffer[showTokenUndoBuffer.length -1];
            if (entry.undo)
            {
                result.push
                (
                    makeGoCommandMenuItem
                    (
                        "clairvoyant.back.title",
                        entry.undo,
                        showTokenUndo
                    )
                );
            }
        }
        if (0 < showTokenRedoBuffer.length)
        {
            result.push
            (
                makeGoCommandMenuItem
                (
                    "clairvoyant.forward.title",
                    showTokenRedoBuffer[showTokenRedoBuffer.length -1].redo,
                    showTokenRedo
                )
            );
        }
        return result;
    };
    const staticMenu: CommandMenuItem[] =
    [
        {
            label: `$(telescope) ${Locale.string("clairvoyant.scanDocument.title")}`,
            command: async () => await vscode.commands.executeCommand(`${applicationKey}.scanDocument`),
        },
        {
            label: `$(telescope) ${Locale.string("clairvoyant.scanOpenDocuments.title")}`,
            command: scanOpenDocuments,
        },
        {
            label: `$(telescope) ${Locale.string("clairvoyant.scanWorkspace.title")}`,
            command: scanWorkspace,
        },
        {
            label: `$(info) ${Locale.string("clairvoyant.reportStatistics.title")}`,
            command: reportStatistics,
        },
        {
            label: `$(dashboard) ${Locale.string("clairvoyant.reportProfile.title")}`,
            command: reportProfile,
        },
    ];
    const makeSightRootMenu = (tokenDocumentEntryMap: { [token: string]: string[] }): CommandMenuItem[] => Profiler.profile
    (
        "makeSightRootMenu",
        () =>
        makeHistoryMenu()
        .concat
        ([
            "token" === getRootMenuOrder() ?
                {
                    label: `$(list-ordered) ${Locale.string("Sort by count")}`,
                    command: async () =>
                    {
                        context.globalState.update("clairvoyant.rootMenuOrder", "count");
                        await showMenu(await busy.do(() => makeSightRootMenu(tokenDocumentEntryMap)));
                    },
                }:
                {
                    label: `$(list-ordered) ${Locale.string("Sort by token")}`,
                    command: async () =>
                    {
                        context.globalState.update("clairvoyant.rootMenuOrder", "token");
                        await showMenu(await busy.do(() => makeSightRootMenu(tokenDocumentEntryMap)));
                    },
                },
            {
                label: `$(list-ordered) ${Locale.string("Show by file")}`,
                command: async () =>
                {
                    await showMenu(await busy.do(makeSightFileListMenu), { matchOnDescription: true });
                },
            },
        ])
        .concat(staticMenu)
        .concat
        (
            Profiler.profile
            (
                "makeSightRootMenu.core",
                () =>
                Profiler.profile
                (
                    "makeSightRootMenu.sort",
                    () =>
                    Object.entries(tokenDocumentEntryMap)
                    .sort
                    (
                        "token" === getRootMenuOrder() ?
                            (a, b) => stringComparer(a[0], b[0]):
                            mergeComparer
                            ([
                                makeComparer((entry: [string, string[]]) => -tokenCountMap[entry[0]]),
                                (a, b) => stringComparer(a[0], b[0])
                            ])
                    )
                )
                .map
                (
                    entry =>
                    ({
                        label: `$(tag) "${decodeToken(entry[0])}"`,
                        description: undefined,
                        detail: entry[1].map
                            (
                                i =>
                                ({
                                    uri:i,
                                    file:documentFileMap[i],
                                    hits:documentTokenEntryMap[i][entry[0]].length
                                })
                            )
                            .sort(mergeComparer([makeComparer(d => -d.hits), makeComparer(d => d.uri)]))
                            .map(d => `$(file-text) ${d.file}(${d.hits})`)
                            .join(", "),
                        command: async () => await showMenu(await busy.do(() => makeSightTokenMenu(entry[0])), { matchOnDescription: true })
                    })
                )
            )
        )
    );

    const sight = async () =>
    {
        if (Object.keys(tokenDocumentEntryMap).length <= 0)
        {
            await showMenu(staticMenu);
        }
        else
        {
            await showMenu(await busy.do(() => makeSightRootMenu(tokenDocumentEntryMap)));
        }
    };

    //
    //  Status Bar Items
    //

    export const updateStatusBarItems = () : void => Profiler.profile
    (
        "updateStatusBarItems",
        () =>
        {
            if (showStatusBarItems.get(""))
            {
                if (busy.isBusy())
                {
                    eyeLabel.text = "$(sync~spin)";
                    eyeLabel.tooltip = `Clairvoyant: ${Locale.string("clairvoyant.sight.busy")}`;
                }
                else
                {
                    eyeLabel.text = "$(eye)";
                    eyeLabel.tooltip = `Clairvoyant: ${Locale.string("clairvoyant.sight.title")}`;
                }
                eyeLabel.show();
            }
            else
            {
                eyeLabel.hide();
            }
        }
    );
}

export function activate(context: vscode.ExtensionContext): void
{
    Clairvoyant.initialize(context);
}
export function deactivate(): void
{
}
