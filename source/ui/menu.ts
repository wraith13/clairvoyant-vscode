import * as vscode from 'vscode';

import * as Profiler from "../lib/profiler";
import * as Locale from "../lib/locale";
import * as File from "../lib/file";

import * as Clairvoyant from "../clairvoyant";
import * as Selection from "../textEditor/selection";
import * as Highlight from "../textEditor/highlight";
import * as Scan from "../scan";

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

interface CommandMenuItem extends vscode.QuickPickItem
{
    command: () => Promise<void>;
    preview?: Selection.ShowTokenCoreEntry;
    token?: string;
}
interface CommandMenuOptions extends vscode.QuickPickOptions
{
    document?: vscode.TextDocument;
    token?: string;
}
const makeEmptyList = (): CommandMenuItem[] => [];
export const cache: { [key: string]: CommandMenuItem[]} = { };
export const reload = () =>
{
    Clairvoyant.outputLine("verbose", `Menu.reload() is called.`);
    Object.keys(cache).forEach(i => delete cache[i]);
    Object.keys(previewCache).forEach(i => delete previewCache[i]);
};
export const removeCache = (key: string) =>
{
    Clairvoyant.outputLine("verbose", `Menu.removeCache("${key}") is called.`);
    Object.keys(cache).filter(i => i.startsWith(key)).forEach(i => delete cache[i]);
    return key;
};
export const getCacheOrMake = (key: string, itemMaker: () => CommandMenuItem[]) =>
{
    if (!cache[key])
    {
        cache[key] = itemMaker();
    }
    return cache[key];
};

export module Show
{
    interface Entry
    {
        makeItemList: () => CommandMenuItem[];
        options?: CommandMenuOptions;
    }
    const menuStack: Entry[] = [];

    const show = async (entry: Entry) =>
    {
        // Highlight.Preview.* 周りの処理の影響を受けないように事前にメニューアイテムを取得
        const items = await Clairvoyant.busy.do
        (
            () => Profiler.profile
            (
                "Menu.Show.show.entry.makeItemList",
                entry.makeItemList
            )
        );

        const options = entry.options || { };
        const selectionEntry = Selection.getEntry();
        Highlight.Preview.backup();
        if (undefined !== options.document)
        {
            await selectionEntry.showTextDocumentWithBackupSelection(options.document);
        }
        if (undefined !== options.token)
        {
            Highlight.Preview.showToken(options.token);
        }
        options.onDidSelectItem = (select: CommandMenuItem) =>
        {
            if (select.preview)
            {
                selectionEntry.previewSelection(select.preview);
            }
            if (undefined === options.token)
            {
                Highlight.Preview.showToken(select.token);
            }
            Highlight.Preview.showSelection(select.preview);
        };
        const select = await vscode.window.showQuickPick(items, options);
        if (select)
        {
            if (select.preview)
            {
                Highlight.Preview.commit();
            }
            else
            {
                if (undefined !== options.document)
                {
                    await selectionEntry.rollbackSelection();
                }
                Highlight.Preview.rollback();
            }
            await select.command();
        }
        else
        {
            if (undefined !== options.document)
            {
                await selectionEntry.rollbackSelection();
            }
            Highlight.Preview.rollback();
        }
    };

    export const update = async () => await show(menuStack[menuStack.length -1]);
    const push = async (entry: Entry) =>
    {
        menuStack.push(entry);
        await update();
    };
    const pop = async () =>
    {
        menuStack.pop();
        await update();
    };
    export const root = async (entry: Entry) =>
    {
        menuStack.splice(0, 0);
        await push(entry);
    };
    export const forward = async (entry: Entry) => await push
    (
        Profiler.profile
        (
            "Menu.Show.forward",
            () =>
            ({
                makeItemList: () => Profiler.profile
                (
                    "Menu.Show.forward.addBackMenuItem",
                    () => makeEmptyList().concat
                    (
                        {
                            label: `$(reply) ${Locale.typeableMap("clairvoyant.backMenu.title")}`,
                            command: async () => await pop(),
                        },
                        entry.makeItemList(),
                    )
                ),
                options: entry.options,
            })
        )
    );
}
const previewCache: { [uri: string] : { [line: number]: string } } = { };
export const removePreviewCache = (uri: string) =>
{
    Clairvoyant.outputLine("verbose", `Menu.removePreviewCache("${uri}") is called.`);
    delete previewCache[uri];
    return uri;
};
const makePreview = (document: vscode.TextDocument, anchor: vscode.Position) => Profiler.profile
(
    "makePreview",
    () =>
    {
        if (!previewCache[document.uri.toString()])
        {
            previewCache[document.uri.toString()] = { };
        }
        if (!previewCache[document.uri.toString()][anchor.line])
        {
            const line = document.getText(new vscode.Range(anchor.line, 0, anchor.line +1, 0)).substr(0, 128);
            previewCache[document.uri.toString()][anchor.line] = line.trim().replace(/\s+/gm, " ");
        }
        return previewCache[document.uri.toString()][anchor.line];
    }
);
const makeGoCommandMenuItem =
(
    label: Locale.KeyType,
    entry: Selection.ShowTokenCoreEntry,
    command?: () => Promise<void>
) => Profiler.profile
(
    "makeGoCommandMenuItem",
    () =>
    ({

        label: `$(rocket) ${Locale.typeableMap(label)} line:${entry.selection.anchor.line +1} row:${entry.selection.anchor.character +1}` +
        (
            entry.selection.anchor.line === entry.selection.active.line ?
                `-${entry.selection.active.character +1}`:
                ` - line:${entry.selection.active.line +1} row:${entry.selection.active.character +1}`
        ),
        description: File.extractRelativePath(entry.document.uri.toString()),
        detail: makePreview(entry.document, entry.selection.anchor),
        command: command ? command: (async () => Selection.getEntry().showToken(entry)),
        preview: command ? undefined: entry,
    })
);
const makeSightShowMenu = (uri: string, token: string, hits: number[]): CommandMenuItem[] => getCacheOrMake
(
    `${uri}.makeSightShowMenu:${token}`,
    () => Profiler.profile
    (
        "makeSightShowMenu",
        () => makeEmptyList().concat
        (
            hits.map
            (
                index => makeGoCommandMenuItem
                (
                    "clairvoyant.goto.title",
                    {
                        document: Scan.documentMap[uri],
                        selection: Selection.make(Scan.documentMap[uri], index, token)
                    }
                )
            )
        )
    )
);
const makeSightTokenCoreMenu = (token: string): CommandMenuItem[] =>
([
    {
        label: `$(clippy) ${Locale.typeableMap("Copy \"${token}\" to clipboard").replace(/\$\{token\}/g, token)}`,
        command: async () => Clairvoyant.copyToken(token),
    },
    {
        label: `$(clippy) ${Locale.typeableMap("Paste \"${token}\" to text editor").replace(/\$\{token\}/g, token)}`,
        command: async () => Clairvoyant.pasteToken(token),
    },
    Highlight.isHighlighted(token) ?
    {
        label: `$(trashcan) ${Locale.typeableMap("Remove highlight for \"${token}\"").replace(/\$\{token\}/g, token)}`,
        command: async () => Highlight.remove(token),
    }:
    {
        label: `$(light-bulb) ${Locale.typeableMap("Add highlight for \"${token}\"").replace(/\$\{token\}/g, token)}`,
        command: async () => Highlight.add(token),
    },
]);
const makeSightTokenMenu = (token: string): CommandMenuItem[] => getCacheOrMake
(
    `filelist.${Clairvoyant.decodeToken(token)}`,
    () => Profiler.profile
    (
        "makeSightTokenMenu",
        () => makeEmptyList().concat
        (
            makeSightTokenCoreMenu(Clairvoyant.decodeToken(token)),
            (
                Scan.tokenDocumentEntryMap[token].map(i => ({ uri:i, hits: Scan.documentTokenEntryMap[i][token] }))
                .sort(mergeComparer([makeComparer(entry => -entry.hits.length), makeComparer(entry => entry.uri)]))
                .map
                (
                    entry =>
                    ({
                        label: `$(file-text) ${File.extractFileName(entry.uri)}`,
                        description: entry.uri.startsWith("untitled:") ?
                            File.makeDigest(Scan.documentMap[entry.uri].getText()):
                            File.extractDirectoryAndWorkspace(entry.uri),
                            detail: `count: ${entry.hits.length}`,
                        command: async () => await Show.forward
                        ({
                            makeItemList: () => makeEmptyList().concat
                            (
                                makeSightShowMenu
                                (
                                    entry.uri,
                                    Clairvoyant.decodeToken(token),
                                    entry.hits
                                )
                            ),
                            options:
                            {
                                matchOnDetail: true,
                                document: Scan.documentMap[entry.uri],
                                token: Clairvoyant.decodeToken(token),
                            },
                        })
                    })
                )
            )
        )
    )
);
const makeSightFileTokenMenu = (uri: string, token: string, indices: number[]): CommandMenuItem[] => Profiler.profile
(
    "makeSightFileTokenMenu",
    () => makeEmptyList().concat
    (
        makeSightTokenCoreMenu(token),
        makeSightShowMenu
        (
            uri,
            token,
            indices
        )
    )
);
const makeSightFileRootMenu = (uri: string, entries: { [key: string]: number[] }): CommandMenuItem[] => getCacheOrMake
(
    `file.${uri}.makeSightFileRootMenu:${getRootMenuOrder()}`,
    () => Profiler.profile
    (
        "makeSightFileRootMenu",
        () => makeEmptyList().concat
        (
            [
                "token" === getRootMenuOrder() ?
                    {
                        label: `$(list-ordered) ${Locale.typeableMap("Sort by count")}`,
                        command: async () =>
                        {
                            setRootMenuOrder("count");
                            await Show.update();
                        },
                    }:
                    {
                        label: `$(list-ordered) ${Locale.typeableMap("Sort by token")}`,
                        command: async () =>
                        {
                            setRootMenuOrder("token");
                            await Show.update();
                        },
                    },
            ],
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
                    label: `$(tag) "${Clairvoyant.decodeToken(entry[0])}"`,
                    description: undefined,
                    detail: `count: ${entry[1].length}`,
                    token: Clairvoyant.decodeToken(entry[0]),
                    command: async () => await Show.forward
                    ({
                        makeItemList: () => makeSightFileTokenMenu
                        (
                            uri,
                            Clairvoyant.decodeToken(entry[0]),
                            entry[1]
                        ),
                        options:
                        {
                            matchOnDetail: true,
                            document: Scan.documentMap[uri],
                            token: Clairvoyant.decodeToken(entry[0]),
                        },
                    }),
                })
            )
        )
    )
);
const makeSightFileListMenu = (): CommandMenuItem[] => getCacheOrMake
(
    "filelist",
    () => Profiler.profile
    (
        "makeSightFileListMenu",
        () => makeEmptyList().concat
        (
            Object.entries(Scan.documentTokenEntryMap)
                .sort(mergeComparer([makeComparer(entry => File.extractDirectoryAndWorkspace(entry[0])), makeComparer(entry => entry[0])]))
                .map
                (
                    entry =>
                    ({
                        label: `$(file-text) ${File.extractFileName(entry[0])}`,
                        description: entry[0].startsWith("untitled:") ?
                            File.makeDigest(Scan.documentMap[entry[0]].getText()):
                            File.extractDirectoryAndWorkspace(entry[0]),
                        command: async () => await Show.forward
                        ({
                            makeItemList: () => makeSightFileRootMenu(entry[0], entry[1]),
                        })
                    })
                )
        )
    )
);
const getRootMenuOrder = () => Clairvoyant.context.globalState.get<string>("clairvoyant.rootMenuOrder", "token");
const setRootMenuOrder = (order: string) =>
{
    Clairvoyant.context.globalState.update("clairvoyant.rootMenuOrder", order);
    removeCache(`root.full`);
};
const makeQuickMenu = (): CommandMenuItem[] =>
{
    const result: CommandMenuItem[] = [];
    const activeTextEditor = vscode.window.activeTextEditor;
    if (undefined !== activeTextEditor)
    {
        const token = Scan.getToken(activeTextEditor);
        if (undefined !== token)
        {
            result.push
            (
                {
                    label: `$(rocket) ${Locale.typeableMap("clairvoyant.nextToken.title")}`,
                    description: `$(tag) ${token}`,
                    command: async () => await vscode.commands.executeCommand("clairvoyant.nextToken"),
                },
                {
                    label: `$(rocket) ${Locale.typeableMap("clairvoyant.previousToken.title")}`,
                    description: `$(tag) ${token}`,
                    command: async () => await vscode.commands.executeCommand("clairvoyant.previousToken"),
                }
            );
        }
    }
    return result;
};

const makeHistoryMenu = (): CommandMenuItem[] =>
{
    const result: CommandMenuItem[] = [];
    const selectionEntry = Selection.getEntry();
    if (0 < selectionEntry.showTokenUndoBuffer.length)
    {
        const entry = selectionEntry.showTokenUndoBuffer[selectionEntry.showTokenUndoBuffer.length -1];
        if (entry.undo)
        {
            result.push
            (
                makeGoCommandMenuItem
                (
                    "clairvoyant.back.title",
                    entry.undo,
                    selectionEntry.showTokenUndo
                )
            );
        }
    }
    if (0 < selectionEntry.showTokenRedoBuffer.length)
    {
        result.push
        (
            makeGoCommandMenuItem
            (
                "clairvoyant.forward.title",
                selectionEntry.showTokenRedoBuffer[selectionEntry.showTokenRedoBuffer.length -1].redo,
                selectionEntry.showTokenRedo
            )
        );
    }
    return result;
};
const makeHighlightTokensMenu = (highlights: string[]): CommandMenuItem[] =>
([
    {
        label: `$(trashcan) ${Locale.typeableMap("Clear all highlights")}`,
        //description: highlights.map(token => `$(tag) "${token}"`).join(", "),
        command: async () => Highlight.reload(),
    }
] as CommandMenuItem[])
.concat
(
    Profiler.profile
    (
        "makeHighlightTokensMenu.core",
        () =>
        Profiler.profile
        (
            "makeHighlightTokensMenu.sort",
            () =>
            Object.entries(Scan.tokenDocumentEntryMap)
            .filter(entry => 0 <= highlights.indexOf(Clairvoyant.decodeToken(entry[0])))
            .sort
            (
                "token" === getRootMenuOrder() ?
                    (a, b) => stringComparer(a[0], b[0]):
                    mergeComparer
                    ([
                        makeComparer((entry: [string, string[]]) => -Scan.tokenCountMap[entry[0]]),
                        (a, b) => stringComparer(a[0], b[0])
                    ])
            )
        )
        .map
        (
            entry =>
            ({
                label: `$(tag) "${Clairvoyant.decodeToken(entry[0])}"`,
                description: undefined,
                detail: entry[1].map
                    (
                        i =>
                        ({
                            uri: i,
                            file: Scan.documentFileMap[i],
                            hits: Scan.documentTokenEntryMap[i][entry[0]].length
                        })
                    )
                    .sort(mergeComparer([makeComparer(d => -d.hits), makeComparer(d => d.uri)]))
                    .map(d => `$(file-text) ${d.file}(${d.hits})`)
                    .join(", "),
                token: Clairvoyant.decodeToken(entry[0]),
                command: async () => await Show.forward
                ({
                    makeItemList: () => makeSightTokenMenu(entry[0]),
                    options:
                    {
                        matchOnDescription: true,
                        token: Clairvoyant.decodeToken(entry[0]),
                    },
                })
            })
        )
    )
);
const makeHighlightRootMenu = (): CommandMenuItem[] =>
{
    const highlights = Highlight.getHighlight().concat([]).reverse();
    return highlights.length <= 0 ?
        []:
        [{
            label: `$(light-bulb) ${Locale.typeableMap("Highlight tokens")}`,
            description: highlights.map(token => `$(tag) "${token}"`).join(", "),
            command: async () => await Show.forward
            ({
                makeItemList: () => makeHighlightTokensMenu(highlights),
                options:
                {
                    matchOnDescription: true,
                },
            })
        }];
};
const makeStaticMenuItem = (octicon: string, label: Locale.KeyType, command: string): CommandMenuItem =>
({
    label: octicon +" " +Locale.typeableMap(label),
    command: async () => await vscode.commands.executeCommand(command),
});
export const makeStaticMenu = (): CommandMenuItem[] =>
[
    makeStaticMenuItem("$(telescope)", "clairvoyant.scanDocument.title", "clairvoyant.scanDocument"),
    makeStaticMenuItem("$(telescope)", "clairvoyant.scanOpenDocuments.title", "clairvoyant.scanOpenDocuments"),
    makeStaticMenuItem("$(telescope)", "clairvoyant.scanWorkspace.title", "clairvoyant.scanWorkspace"),
    makeStaticMenuItem("$(info)", "clairvoyant.reportStatistics.title", "clairvoyant.reportStatistics"),
    makeStaticMenuItem("$(dashboard)", "clairvoyant.reportProfile.title", "clairvoyant.reportProfile"),
];
export const makeSightRootMenu = (): CommandMenuItem[] => Profiler.profile
(
    "makeSightRootMenu",
    () => makeEmptyList().concat
    (
        makeHistoryMenu(),
        makeQuickMenu(),
        makeHighlightRootMenu(),
        getCacheOrMake
        (
            `root.${getRootMenuOrder()}`,
            () => makeEmptyList().concat
            (
                [
                    "token" === getRootMenuOrder() ?
                        {
                            label: `$(list-ordered) ${Locale.typeableMap("Sort by count")}`,
                            command: async () =>
                            {
                                setRootMenuOrder("count");
                                await Show.update();
                            },
                        }:
                        {
                            label: `$(list-ordered) ${Locale.typeableMap("Sort by token")}`,
                            command: async () =>
                            {
                                setRootMenuOrder("token");
                                await Show.update();
                            },
                        },
                    {
                        label: `$(list-ordered) ${Locale.typeableMap("Show by file")}`,
                        command: async () => await Show.forward
                        ({
                            makeItemList: makeSightFileListMenu,
                            options: { matchOnDescription: true },
                        })
                    },
                ],
                makeStaticMenu(),
                Profiler.profile
                (
                    "makeSightRootMenu.core",
                    () =>
                    Profiler.profile
                    (
                        "makeSightRootMenu.sort",
                        () =>
                        Object.entries(Scan.tokenDocumentEntryMap)
                        .sort
                        (
                            "token" === getRootMenuOrder() ?
                                (a, b) => stringComparer(a[0], b[0]):
                                mergeComparer
                                ([
                                    makeComparer((entry: [string, string[]]) => -Scan.tokenCountMap[entry[0]]),
                                    (a, b) => stringComparer(a[0], b[0])
                                ])
                        )
                    )
                    .map
                    (
                        entry =>
                        ({
                            label: `$(tag) "${Clairvoyant.decodeToken(entry[0])}"`,
                            description: undefined,
                            detail: entry[1].map
                                (
                                    i =>
                                    ({
                                        uri: i,
                                        file: Scan.documentFileMap[i],
                                        hits: Scan.documentTokenEntryMap[i][entry[0]].length
                                    })
                                )
                                .sort(mergeComparer([makeComparer(d => -d.hits), makeComparer(d => d.uri)]))
                                .map(d => `$(file-text) ${d.file}(${d.hits})`)
                                .join(", "),
                            token: Clairvoyant.decodeToken(entry[0]),
                            command: async () => await Show.forward
                            ({
                                makeItemList: () => makeSightTokenMenu(entry[0]),
                                options:
                                {
                                    matchOnDescription: true,
                                    token: Clairvoyant.decodeToken(entry[0]),
                                },
                            })
                        })
                    )
                )
            )
        )
    )
);
