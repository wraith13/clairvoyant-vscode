import * as vscode from 'vscode';
import * as Profiler from "../lib/profiler";
import * as Locale from "../lib/locale";
import * as Busy from "../lib/busy";
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
export const show = async (items: CommandMenuItem[], options?: vscode.QuickPickOptions) =>
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
const makeGoCommandMenuItem = (label: string, entry: Clairvoyant.ShowTokenCoreEntry, command: () => Promise<void> = async () => Clairvoyant.showToken(entry)) => Profiler.profile
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
        description: File.extractRelativePath(entry.document.uri.toString()),
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
                document: Scan.documentMap[uri],
                selection: makeSelection(Scan.documentMap[uri], index, token)
            }
        )
    )
);
const makeSightTokenCoreMenu = (token: string): CommandMenuItem[] =>
([
    {
        label: `$(clippy) ${Locale.string("Copy \"${token}\" to clipboard").replace("${token}", token)}`,
        command: async () => Clairvoyant.copyToken(token),
    },
    {
        label: `$(clippy) ${Locale.string("Paste \"${token}\" to text editor").replace("${token}", token)}`,
        command: async () => Clairvoyant.pasteToken(token),
    },
]);
const makeSightTokenMenu = (busy: Busy.Entry, token: string): CommandMenuItem[] => Profiler.profile
(
    "makeSightTokenMenu",
    () => makeSightTokenCoreMenu(Clairvoyant.decodeToken(token)).concat
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
                command: async () =>await show(await busy.do(() => makeSightShowMenu(entry.uri, Clairvoyant.decodeToken(token), entry.hits)), { matchOnDetail: true })
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
                    Clairvoyant.context.globalState.update("clairvoyant.rootMenuOrder", "count");
                    await show(await Clairvoyant.busy.do(() => makeSightFileRootMenu(uri, entries)));
                },
            }:
            {
                label: `$(list-ordered) ${Locale.string("Sort by token")}`,
                command: async () =>
                {
                    Clairvoyant.context.globalState.update("clairvoyant.rootMenuOrder", "token");
                    await show(await Clairvoyant.busy.do(() => makeSightFileRootMenu(uri, entries)));
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
                label: `$(tag) "${Clairvoyant.decodeToken(entry[0])}"`,
                description: undefined,
                detail: `count: ${entry[1].length}`,
                command: async () => await show(await Clairvoyant.busy.do(() => makeSightFileTokenMenu(uri, Clairvoyant.decodeToken(entry[0]), entry[1])), { matchOnDetail: true })
            })
        )
    )
);
const makeSightFileListMenu = (): CommandMenuItem[] => Profiler.profile
(
    "makeSightFileListMenu",
    () => Object.entries(Scan.documentTokenEntryMap)
    .sort(makeComparer(entry => entry[0]))
    .map
    (
        entry =>
        ({
            label: `$(file-text) ${File.extractFileName(entry[0])}`,
            description: entry[0].startsWith("untitled:") ?
                File.makeDigest(Scan.documentMap[entry[0]].getText()):
                File.extractDirectoryAndWorkspace(entry[0]),
            command: async () =>await show(await Clairvoyant.busy.do(() => makeSightFileRootMenu(entry[0], entry[1])))
        })
    )
);
const getRootMenuOrder = () => Clairvoyant.context.globalState.get<string>("clairvoyant.rootMenuOrder", "token");
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
export const staticMenu: CommandMenuItem[] =
[
    {
        label: `$(telescope) ${Locale.string("clairvoyant.scanDocument.title")}`,
        command: async () => await vscode.commands.executeCommand(`clairvoyant.scanDocument`),
    },
    {
        label: `$(telescope) ${Locale.string("clairvoyant.scanOpenDocuments.title")}`,
        command: Scan.scanOpenDocuments,
    },
    {
        label: `$(telescope) ${Locale.string("clairvoyant.scanWorkspace.title")}`,
        command: Scan.scanWorkspace,
    },
    {
        label: `$(info) ${Locale.string("clairvoyant.reportStatistics.title")}`,
        command: Clairvoyant.reportStatistics,
    },
    {
        label: `$(dashboard) ${Locale.string("clairvoyant.reportProfile.title")}`,
        command: Clairvoyant.reportProfile,
    },
];
export const makeSightRootMenu = (): CommandMenuItem[] => Profiler.profile
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
                    Clairvoyant.context.globalState.update("clairvoyant.rootMenuOrder", "count");
                    await show(await Clairvoyant.busy.do(() => makeSightRootMenu()));
                },
            }:
            {
                label: `$(list-ordered) ${Locale.string("Sort by token")}`,
                command: async () =>
                {
                    Clairvoyant.context.globalState.update("clairvoyant.rootMenuOrder", "token");
                    await show(await Clairvoyant.busy.do(() => makeSightRootMenu()));
                },
            },
        {
            label: `$(list-ordered) ${Locale.string("Show by file")}`,
            command: async () =>
            {
                await show(await Clairvoyant.busy.do(() => makeSightFileListMenu()), { matchOnDescription: true });
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
                    command: async () => await show(await Clairvoyant.busy.do(() => makeSightTokenMenu(Clairvoyant.busy, entry[0])), { matchOnDescription: true })
                })
            )
        )
    )
);
