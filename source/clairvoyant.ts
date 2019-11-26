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

const outputChannelVolumeObject = Object.freeze
({
    "silent": (level: string) => 0 <= ["silent"].indexOf(level),
    "regular": (level: string) => 0 <= ["silent", "regular"].indexOf(level),
    "verbose": (level: string) => 0 <= ["silent", "regular", "verbose"].indexOf(level),
});

export const autoScanMode = new Config.MapEntry("autoScanMode", autoScanModeObject);
export const maxFiles = new Config.Entry<number>("maxFiles");
export const showStatusBarItems = new Config.Entry<boolean>("showStatusBarItems");
export const textEditorRevealType = new Config.MapEntry("textEditorRevealType", textEditorRevealTypeObject);
export const isExcludeStartsWidhDot = new Config.Entry<boolean>("isExcludeStartsWidhDot");
export const excludeDirectories = new Config.Entry("excludeDirectories", Config.stringArrayValidator);
export const excludeExtentions = new Config.Entry("excludeExtentions", Config.stringArrayValidator);
export const targetProtocols = new Config.Entry("targetProtocols", Config.stringArrayValidator);
const outputChannelVolume = new Config.MapEntry("outputChannelVolume", outputChannelVolumeObject);
const outputChannel = vscode.window.createOutputChannel("Clairvoyant");
let muteOutput = false;
export const showOutput = () => outputChannel.show();
export const output = (level: keyof typeof outputChannelVolumeObject, text: string) =>
{
    if (outputChannelVolume.get("")(level))
    {
        if (muteOutput)
        {
            console.log(text);
        }
        else
        {
            outputChannel.append(text);
        }
    }
};
export const outputLine = (level: keyof typeof outputChannelVolumeObject, text: string) =>
{
    if (outputChannelVolume.get("")(level))
    {
        if (muteOutput)
        {
            console.log(text);
        }
        else
        {
            outputChannel.appendLine(text);
        }
    }
};

export const initialize = (aContext: vscode.ExtensionContext): void =>
{
    outputLine("verbose", "Clairvoyant.initialize() is called.");
    context = aContext;
    context.subscriptions.push
    (
        //  コマンドの登録
        vscode.commands.registerCommand
        (
            `${applicationKey}.scanDocument`, async () =>
            {
                outputLine("verbose", `"${applicationKey}.scanDocument" is called.`);
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
                try
                {
                    //  OuputChannel に対するイベント処理中に OuputChannel に書き出すと無限ループになってしまうのでミュートする
                    muteOutput = event.document.uri.toString().startsWith("output:");

                    outputLine("verbose", `onDidChangeTextDocument("${event.document.uri.toString()}") is called.`);
                    if (autoScanMode.get(event.document.languageId).enabled && (!isExcludeDocument(event.document)))
                    {
                        Scan.scanDocument(event.document, true);
                    }
                }
                finally
                {
                    muteOutput = false;
                }
            }
        ),
        vscode.workspace.onDidCloseTextDocument
        (
            async (document) =>
            {
                outputLine("verbose", `onDidCloseTextDocument("${document.uri.toString()}") is called.`);
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
                outputLine("verbose", `onDidChangeActiveTextEditor("${textEditor ? textEditor.document.uri.toString(): "undefined"}") is called.`);
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
const revealSelection = (textEditor: vscode.TextEditor, selection: vscode.Selection) =>
{
    textEditor.selection = selection;
    textEditor.revealRange(selection, textEditorRevealType.get(textEditor.document.languageId));
};
const showSelection = async (entry: { document: vscode.TextDocument, selection: vscode.Selection }) =>
{
    revealSelection(await vscode.window.showTextDocument(entry.document), entry.selection);
};
const getPreviewTextEditor = (document: vscode.TextDocument) =>
{
    const uri = document.uri.toString();
    const activeTextEditor = vscode.window.activeTextEditor;
    if (activeTextEditor && activeTextEditor.document.uri.toString() === uri)
    {
        return activeTextEditor;
    }
    else
    {
        return vscode.window.visibleTextEditors.filter(i => i.document.uri.toString() === uri)[0];
    }
};
export const previewSelection = (entry: { document: vscode.TextDocument, selection: vscode.Selection }) =>
{
    const textEditor = getPreviewTextEditor(entry.document);
    if (textEditor)
    {
        revealSelection(textEditor, entry.selection);
    }
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
let groundBackupSelectionEntry: ShowTokenCoreEntry | null = null;
let targetBackupSelectionEntry: ShowTokenCoreEntry | null = null;
export const showTextDocumentWithBackupSelection = async (document: vscode.TextDocument) =>
{
    groundBackupSelectionEntry = makeShowTokenCoreEntry();
    if (groundBackupSelectionEntry && groundBackupSelectionEntry.document.uri.toString() === document.uri.toString())
    {
        targetBackupSelectionEntry = null;
    }
    else
    {
        await vscode.window.showTextDocument(document);
        targetBackupSelectionEntry = makeShowTokenCoreEntry();
    }
};
export const rollbackSelection = () =>
{
    if (targetBackupSelectionEntry)
    {
        previewSelection(targetBackupSelectionEntry);
        targetBackupSelectionEntry = null;
    }
    if (groundBackupSelectionEntry)
    {
        showSelection(groundBackupSelectionEntry);
        groundBackupSelectionEntry = null;
    }
};
export const showToken = async (entry: { document: vscode.TextDocument, selection: vscode.Selection }) =>
{
    outputLine("verbose", `showToken() is called.`);
    showTokenUndoBuffer.push
    ({
        redo: entry,
        undo: groundBackupSelectionEntry || makeShowTokenCoreEntry(),
    });
    showSelection(entry);
    showTokenRedoBuffer.splice(0, 0);
    onUpdateHistory();
};
export const showTokenUndo = async () =>
{
    outputLine("verbose", `showTokenUndo() is called.`);
    const entry = showTokenUndoBuffer.pop();
    if (entry)
    {
        if (entry.undo)
        {
            showSelection(entry.undo);
        }
        showTokenRedoBuffer.push(entry);
        onUpdateHistory();
    }
};
export const showTokenRedo = async () =>
{
    outputLine("verbose", `showTokenRedo() is called.`);
    const entry = showTokenRedoBuffer.pop();
    if (entry)
    {
        entry.undo = makeShowTokenCoreEntry() || entry.undo;
        showSelection(entry.redo);
        showTokenUndoBuffer.push(entry);
        onUpdateHistory();
    }
};
const onUpdateHistory = () =>
{
    outputLine("verbose", `onUpdateHistory() is called.`);
    Menu.removeCache(`root.full`);
};

export const copyToken = async (text: string) =>
{
    outputLine("verbose", `copyToken("${text}") is called.`);
    await vscode.env.clipboard.writeText(text);
}
export const pasteToken = async (text: string) =>
{
    outputLine("verbose", `pasteToken("${text}") is called.`);
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
    outputLine("silent", Locale.map("♻️ Reload Clairvoyant!"));
    Scan.reload();
    Menu.reload();
    showTokenUndoBuffer.splice(0, 0);
    showTokenRedoBuffer.splice(0, 0);
    groundBackupSelectionEntry = null;
    targetBackupSelectionEntry = null;
    Profiler.start();
    autoScanMode.get("").onInit();
};
const onDidChangeConfiguration = () =>
{
    outputLine("verbose", `onDidChangeConfiguration() is called.`);
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
        outputChannelVolume,
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
            showOutput();
            outputLine("silent", `${Locale.map("📊 Statistics Report")} - ${new Date()}`);
            outputLine("silent", `files: ${Object.keys(Scan.documentTokenEntryMap).length.toLocaleString()}`);
            outputLine("silent", `unique tokens: ${Object.keys(Scan.tokenDocumentEntryMap).length.toLocaleString()}`);
            outputLine("silent", `total tokens: ${Object.values(Scan.tokenCountMap).reduce((a, b) => a +b, 0).toLocaleString()}`);
            outputLine("silent", "");
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
            showOutput();
            if (Profiler.getIsProfiling())
            {
                outputLine("silent", `${Locale.map("📊 Profile Report")} - ${new Date()}`);
                const overall = Profiler.getOverall();
                const total = Profiler.getReport().map(i => i.ticks).reduce((p, c) => p +c);
                outputLine("silent", Locale.map("⚖ Overview"));
                outputLine("silent", `- Overall: ${overall.toLocaleString()}ms ( ${percentToDisplayString(1)} )`);
                outputLine("silent", `- Busy: ${total.toLocaleString()}ms ( ${percentToDisplayString(total / overall)} )`);
                outputLine("silent", Locale.map("🔬 Busy Details"));
                outputLine("silent", `- Total: ${total.toLocaleString()}ms ( ${percentToDisplayString(1)} )`);
                Profiler.getReport().forEach(i => outputLine("silent", `- ${i.name}: ${i.ticks.toLocaleString()}ms ( ${percentToDisplayString(i.ticks / total)} )`));
                outputLine("silent", "");
            }
            else
            {
                outputLine("silent", Locale.map("🚫 Profile has not been started."));
            }
        }
    )
);

export const sight = async () => await Menu.Show.root
({
    makeItemList: Object.keys(Scan.tokenDocumentEntryMap).length <= 0 ?
        Menu.makeStaticMenu:
        Menu.makeSightRootMenu
});
