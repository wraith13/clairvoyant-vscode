import * as vscode from 'vscode';

import * as Profiler from "./lib/profiler";
import * as Config from "./lib/config";
import * as Locale from "./lib/locale";
import * as Busy from "./lib/busy";
import * as File from "./lib/file"
;
import * as Menu from "./ui/menu";
import * as StatusBar from "./ui/statusbar";

import * as Scan from "./scan";

const roundCenti = (value : number) : number => Math.round(value *100) /100;
const percentToDisplayString = (value : number, locales?: string | string[]) : string =>`${roundCenti(value).toLocaleString(locales, { style: "percent" })}`;

const applicationKey = Config.applicationKey;
export let context: vscode.ExtensionContext;

export const busy = new Busy.Entry(() => StatusBar.update());

const autoScanModeObject = Object.freeze
({
    "none":
    {
        onInit: () => StatusBar.update(),
        enabled: false,
    },
    "open documents":
    {
        onInit: () => Scan.scanOpenDocuments(),
        enabled: true,
    },
    "workspace":
    {
        onInit: () => Scan.scanWorkspace(),
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

export const autoScanMode = new Config.MapEntry("autoScanMode", autoScanModeObject);
export const maxFiles = new Config.Entry<number>("maxFiles");
export const showStatusBarItems = new Config.Entry<boolean>("showStatusBarItems");
export const textEditorRevealType = new Config.MapEntry("textEditorRevealType", textEditorRevealTypeObject);
export const isExcludeStartsWidhDot = new Config.Entry<boolean>("isExcludeStartsWidhDot");
export const excludeDirectories = new Config.Entry("excludeDirectories", Config.stringArrayValidator);
export const excludeExtentions = new Config.Entry("excludeExtentions", Config.stringArrayValidator);
export const targetProtocols = new Config.Entry("targetProtocols", Config.stringArrayValidator);

export const outputChannel = vscode.window.createOutputChannel("Clairvoyant");

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
                    await Scan.scanDocument(activeTextEditor.document, true);
                }
            }
        ),
        vscode.commands.registerCommand(`${applicationKey}.scanOpenDocuments`, Scan.scanOpenDocuments),
        vscode.commands.registerCommand(`${applicationKey}.scanWorkspace`, Scan.scanWorkspace),
        vscode.commands.registerCommand(`${applicationKey}.sight`, sight),
        vscode.commands.registerCommand(`${applicationKey}.back`, showTokenUndo),
        vscode.commands.registerCommand(`${applicationKey}.forward`, showTokenRedo),
        vscode.commands.registerCommand(`${applicationKey}.reload`, reload),
        vscode.commands.registerCommand(`${applicationKey}.reportStatistics`, reportStatistics),
        vscode.commands.registerCommand(`${applicationKey}.reportProfile`, reportProfile),

        //  ステータスバーアイコンの登録
        StatusBar.make(),

        //  イベントリスナーの登録
        vscode.workspace.onDidChangeConfiguration(onDidChangeConfiguration),
        vscode.workspace.onDidChangeWorkspaceFolders(reload),
        vscode.workspace.onDidChangeTextDocument
        (
            event =>
            {
                if (autoScanMode.get(event.document.languageId).enabled && (!isExcludeDocument(event.document)))
                {
                    Scan.scanDocument(event.document, true);
                }
            }
        ),
        vscode.workspace.onDidCloseTextDocument
        (
            async (document) =>
            {
                if (Scan.documentTokenEntryMap[document.uri.toString()])
                {
                    try
                    {
                        await vscode.workspace.fs.stat(document.uri);
                    }
                    catch(error)
                    {
                        console.log(`vscode.workspace.onDidCloseTextDocument: ${error}`); // 一応ログにエラーを吐いておく
                        Scan.detachDocument(document);
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
                    Scan.scanDocument(textEditor.document);
                }
            }
        ),
    );

    reload();
};

export const isTargetProtocol = (uri: string) => targetProtocols.get("").some(i => uri.startsWith(i));
export const isExcludeFile = (filePath: string) => excludeExtentions.get("").some(i => filePath.toLowerCase().endsWith(i.toLowerCase()));
export const startsWithDot = (path: string) => isExcludeStartsWidhDot.get("") && path.startsWith(".");
export const isExcludeDocument = (document: vscode.TextDocument) =>
    !Scan.documentTokenEntryMap[document.uri.toString()] &&
    (
        !isTargetProtocol(document.uri.toString()) ||
        File.extractRelativePath(document.uri.toString()).split("/").some(i => 0 <= excludeDirectories.get("").indexOf(i) || startsWithDot(i)) ||
        isExcludeFile(document.uri.toString())
    );

export const encodeToken = (token: string) => `@${token}`;
export const decodeToken = (token: string) => token.substring(1);

export interface ShowTokenCoreEntry
{
    document: vscode.TextDocument;
    selection: vscode.Selection;
}
export interface ShowTokenDoEntry
{
    redo: ShowTokenCoreEntry;
    undo: ShowTokenCoreEntry | null;
}
export const showTokenUndoBuffer: ShowTokenDoEntry[] = [];
export const showTokenRedoBuffer: ShowTokenDoEntry[] = [];
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
export const showToken = async (entry: { document: vscode.TextDocument, selection: vscode.Selection }) =>
{
    showTokenUndoBuffer.push
    ({
        redo: entry,
        undo: makeShowTokenCoreEntry(),
    });
    showSelection(entry);
    showTokenRedoBuffer.splice(0, 0);
};
export const showTokenUndo = async () =>
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
export const showTokenRedo = async () =>
{
    const entry = showTokenRedoBuffer.pop();
    if (entry)
    {
        entry.undo = makeShowTokenCoreEntry() || entry.undo;
        showSelection(entry.redo);
        showTokenUndoBuffer.push(entry);
    }
};

export const copyToken = async (text: string) => await vscode.env.clipboard.writeText(text);
export const pasteToken = async (text: string) =>
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

export const reload = () =>
{
    outputChannel.appendLine(Locale.map("♻️ Reload Clairvoyant!"));
    Scan.reload();
    showTokenUndoBuffer.splice(0, 0);
    showTokenRedoBuffer.splice(0, 0);
    Profiler.start();
    autoScanMode.get("").onInit();
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
        targetProtocols: targetProtocols.getCache(""),
    };
    [
        autoScanMode,
        maxFiles,
        showStatusBarItems,
        textEditorRevealType,
        isExcludeStartsWidhDot,
        excludeDirectories,
        excludeExtentions,
        targetProtocols,
    ]
    .forEach(i => i.clear());
    StatusBar.update();
    if
    (
        old.autoScanMode !== autoScanMode.get("") ||
        old.maxFiles !== maxFiles.get("") ||
        old.isExcludeStartsWidhDot !== isExcludeStartsWidhDot.get("") ||
        JSON.stringify(old.excludeDirectories) !== JSON.stringify(excludeDirectories.get("")) ||
        JSON.stringify(old.excludeExtentions) !== JSON.stringify(excludeExtentions.get("")) ||
        JSON.stringify(old.targetProtocols) !== JSON.stringify(targetProtocols.get(""))
    )
    {
        autoScanMode.get("").onInit();
    }
};

export const reportStatistics = async () => await busy.do
(
    () => Profiler.profile
    (
        "reportStatistics",
        () =>
        {
            outputChannel.show();
            outputChannel.appendLine(`files: ${Object.keys(Scan.documentTokenEntryMap).length.toLocaleString()}`);
            outputChannel.appendLine(`unique tokens: ${Object.keys(Scan.tokenDocumentEntryMap).length.toLocaleString()}`);
            outputChannel.appendLine(`total tokens: ${Object.values(Scan.tokenCountMap).reduce((a, b) => a +b, 0).toLocaleString()}`);
        }
    )
);

export const reportProfile = async () => await busy.do
(
    () => Profiler.profile
    (
        "reportProfile",
        () =>
        {
            outputChannel.show();
            if (Profiler.getIsProfiling())
            {
                outputChannel.appendLine(`${Locale.map("📊 Profile Report")} - ${new Date()}`);
                const overall = Profiler.getOverall();
                const total = Profiler.getReport().map(i => i.ticks).reduce((p, c) => p +c);
                outputChannel.appendLine(Locale.map("⚖ Overview"));
                outputChannel.appendLine(`- Overall: ${overall.toLocaleString()}ms ( ${percentToDisplayString(1)} )`);
                outputChannel.appendLine(`- Busy: ${total.toLocaleString()}ms ( ${percentToDisplayString(total / overall)} )`);
                outputChannel.appendLine(Locale.map("🔬 Busy Details"));
                outputChannel.appendLine(`- Total: ${total.toLocaleString()}ms ( ${percentToDisplayString(1)} )`);
                Profiler.getReport().forEach(i => outputChannel.appendLine(`- ${i.name}: ${i.ticks.toLocaleString()}ms ( ${percentToDisplayString(i.ticks / total)} )`));
                outputChannel.appendLine("");
            }
            else
            {
                outputChannel.appendLine(Locale.map("🚫 Profile has not been started."));
            }
        }
    )
);

export const sight = async () => await Menu.show
(
    Object.keys(Scan.tokenDocumentEntryMap).length <= 0 ?
        Menu.makeStaticMenu:
        Menu.makeSightRootMenu
);
