import * as vscode from 'vscode';

import * as Profiler from "../lib/profiler";
import * as Locale from "../lib/locale";
import * as File from "../lib/file";

import * as Clairvoyant from "../clairvoyant";
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
}
const makeEmptyList = (): CommandMenuItem[] => [];
export const cache: { [key: string]: CommandMenuItem[]} = { };
export const reload = () =>
{
    Object.keys(cache).forEach(i => delete cache[i]);
    Object.keys(previewCache).forEach(i => delete previewCache[i]);
};
export const removeCache = (key: string) =>
{
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
        options?: vscode.QuickPickOptions;
    }
    const menuStack: Entry[] = [];

    const show = async (entry: Entry) =>
    {
        const select = await vscode.window.showQuickPick
        (
            await Clairvoyant.busy.do
            (
                () => Profiler.profile
                (
                    "Menu.Show.show.entry.makeItemList",
                    entry.makeItemList
                )
            ),
            entry.options
        );
        if (select)
        {
            await select.command();
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
                            label: `$(reply) ${Locale.map("clairvoyant.backMenu.title")}`,
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
const makeSelection = (document: vscode.TextDocument, index: number, token: string) => Profiler.profile
(
    "makeSelection",
    () => new vscode.Selection(document.positionAt(index), document.positionAt(index +token.length))
);
const previewCache: { [uri: string] : { [line: number]: string } } = { };
export const removePreviewCache = (uri: string) =>
{
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
    entry: Clairvoyant.ShowTokenCoreEntry,
    command: () => Promise<void> = async () => Clairvoyant.showToken(entry)
) => Profiler.profile
(
    "makeGoCommandMenuItem",
    () =>
    ({

        label: `$(rocket) ${Locale.map(label)} line:${entry.selection.anchor.line +1} row:${entry.selection.anchor.character +1}` +
        (
            entry.selection.anchor.line === entry.selection.active.line ?
                `-${entry.selection.active.character +1}`:
                ` - line:${entry.selection.active.line +1} row:${entry.selection.active.character +1}`
        ),
        description: File.extractRelativePath(entry.document.uri.toString()),
        detail: makePreview(entry.document, entry.selection.anchor),
        command: async () =>
        {
            await command();
            if (Clairvoyant.goWithReopenMenu.get(entry.document.languageId))
            {
                Show.update();
            }
        },
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
                        selection: makeSelection(Scan.documentMap[uri], index, token)
                    }
                )
            )
        )
    )
);
const makeSightTokenCoreMenu = (token: string): CommandMenuItem[] =>
([
    {
        label: `$(clippy) ${Locale.map("Copy \"${token}\" to clipboard").replace("${token}", token)}`,
        command: async () => Clairvoyant.copyToken(token),
    },
    {
        label: `$(clippy) ${Locale.map("Paste \"${token}\" to text editor").replace("${token}", token)}`,
        command: async () => Clairvoyant.pasteToken(token),
    },
]);
const makeSightTokenMenu = (token: string): CommandMenuItem[] => getCacheOrMake
(
    `filelist.${token}`,
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
                            options: { matchOnDetail: true },
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
    `${uri}.makeSightFileRootMenu:${getRootMenuOrder()}`,
    () => Profiler.profile
    (
        "makeSightFileRootMenu",
        () => makeEmptyList().concat
        (
            [
                "token" === getRootMenuOrder() ?
                    {
                        label: `$(list-ordered) ${Locale.map("Sort by count")}`,
                        command: async () =>
                        {
                            setRootMenuOrder("count");
                            await Show.update();
                        },
                    }:
                    {
                        label: `$(list-ordered) ${Locale.map("Sort by token")}`,
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
                    command: async () => await Show.forward
                    ({
                        makeItemList: () => makeSightFileTokenMenu
                        (
                            uri,
                            Clairvoyant.decodeToken(entry[0]),
                            entry[1]
                        ),
                        options: { matchOnDetail: true },
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
const makeHistoryMenu = (): CommandMenuItem[] =>
{
    const result: CommandMenuItem[] = [];
    if (0 < Clairvoyant.showTokenUndoBuffer.length)
    {
        const entry = Clairvoyant.showTokenUndoBuffer[Clairvoyant.showTokenUndoBuffer.length -1];
        if (entry.undo)
        {
            result.push
            (
                makeGoCommandMenuItem
                (
                    "clairvoyant.back.title",
                    entry.undo,
                    Clairvoyant.showTokenUndo
                )
            );
        }
    }
    if (0 < Clairvoyant.showTokenRedoBuffer.length)
    {
        result.push
        (
            makeGoCommandMenuItem
            (
                "clairvoyant.forward.title",
                Clairvoyant.showTokenRedoBuffer[Clairvoyant.showTokenRedoBuffer.length -1].redo,
                Clairvoyant.showTokenRedo
            )
        );
    }
    return result;
};
const makeStaticMenuItem = (octicon: string, label: Locale.KeyType, command: string): CommandMenuItem =>
({
    label: octicon +" " +Locale.map(label),
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
export const makeSightRootMenu = (): CommandMenuItem[] => getCacheOrMake
(
    `root.full`,
    () =>Profiler.profile
    (
        "makeSightRootMenu",
        () => makeEmptyList().concat
        (
            makeHistoryMenu(),
            getCacheOrMake
            (
                `root.${getRootMenuOrder()}`,
                () => makeEmptyList().concat
                (
                    [
                        "token" === getRootMenuOrder() ?
                            {
                                label: `$(list-ordered) ${Locale.map("Sort by count")}`,
                                command: async () =>
                                {
                                    setRootMenuOrder("count");
                                    await Show.update();
                                },
                            }:
                            {
                                label: `$(list-ordered) ${Locale.map("Sort by token")}`,
                                command: async () =>
                                {
                                    setRootMenuOrder("token");
                                    await Show.update();
                                },
                            },
                        {
                            label: `$(list-ordered) ${Locale.map("Show by file")}`,
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
                                command: async () => await Show.forward
                                ({
                                    makeItemList: () => makeSightTokenMenu(entry[0]),
                                    options: { matchOnDescription: true },
                                })
                            })
                        )
                    )
                )
            )
        )
    )
);
