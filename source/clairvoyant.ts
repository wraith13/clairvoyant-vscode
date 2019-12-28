import * as vscode from 'vscode';

import * as Profiler from "./lib/profiler";
import * as Config from "./lib/config";
import * as Locale from "./lib/locale";
import * as Busy from "./lib/busy";
import * as File from "./lib/file";
import * as Comparer from "./lib/comparer";
;
import * as Menu from "./ui/menu";
import * as StatusBar from "./ui/statusbar";

import * as Selection from "./textEditor/selection";
import * as Highlight from "./textEditor/highlight";
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
const gotoHistoryModeObject = Object.freeze
({
    "single": (_lastValidViemColumn: number) => `@0`,
    "by view column": (lastValidViemColumn: number) => `@${lastValidViemColumn}`,
});
const highlightModeObject = Object.freeze
({
    "none":
    {
        active: false,
        latest: false,
        trail: false,
    },
    "active":
    {
        active: true,
        latest: false,
        trail: false,
    },
    "latest":
    {
        active: true,
        latest: true,
        trail: false,
    },
    "trail":
    {
        active: true,
        latest: true,
        trail: true,
    },
});
const overviewRulerLaneObject = Object.freeze
({
    "none": undefined,
    "left": vscode.OverviewRulerLane.Left,
    "center": vscode.OverviewRulerLane.Center,
    "right": vscode.OverviewRulerLane.Right,
    "full": vscode.OverviewRulerLane.Full,
});

const colorValidator = (value: string): boolean => /^#[0-9A-Fa-f]{6}$/.test(value);

export const autoScanMode = new Config.MapEntry("clairvoyant.autoScanMode", autoScanModeObject);
export const maxFiles = new Config.Entry<number>("clairvoyant.maxFiles");
export const showStatusBarItems = new Config.Entry<boolean>("clairvoyant.showStatusBarItems");
export const textEditorRevealType = new Config.MapEntry("clairvoyant.textEditorRevealType", textEditorRevealTypeObject);
export const isExcludeStartsWidhDot = new Config.Entry<boolean>("clairvoyant.isExcludeStartsWidhDot");
export const excludeDirectories = new Config.Entry("clairvoyant.excludeDirectories", Config.stringArrayValidator);
export const excludeExtentions = new Config.Entry("clairvoyant.excludeExtentions", Config.stringArrayValidator);
export const targetProtocols = new Config.Entry("clairvoyant.targetProtocols", Config.stringArrayValidator);
export const enablePreviewIntercept = new Config.Entry<boolean>("clairvoyant.enablePreviewIntercept");
export const gotoHistoryMode = new Config.MapEntry("clairvoyant.gotoHistoryMode", gotoHistoryModeObject);
export const parserRegExp = new Config.Entry<string>("clairvoyant.parserRegExp", value => "string" === typeof value);
export const highlightMode = new Config.MapEntry("clairvoyant.highlightMode", highlightModeObject);
export const highlightBaseColor = new Config.Entry("clairvoyant.highlightBaseColor", colorValidator);
export const highlightAlpha = new Config.Entry<number>("clairvoyant.highlightAlpha", value => "number" === typeof value);
export const activeHighlightAlpha = new Config.Entry<number>("clairvoyant.activeHighlightAlpha", value => "number" === typeof value);
export const activeHighlightLineAlpha = new Config.Entry<number>("clairvoyant.activeHighlightLineAlpha", value => "number" === typeof value);
export const latestHighlightAlpha = new Config.Entry<number>("clairvoyant.latestHighlightAlpha", value => "number" === typeof value);
export const activeHighlightOverviewRulerLane = new Config.MapEntry("clairvoyant.activeHighlightOverviewRulerLane", overviewRulerLaneObject);
export const latestHighlightOverviewRulerLane = new Config.MapEntry("clairvoyant.latestHighlightOverviewRulerLane", overviewRulerLaneObject);
export const highlightOverviewRulerLane = new Config.MapEntry("clairvoyant.highlightOverviewRulerLane", overviewRulerLaneObject);
export const enableLunaticPreview = new Config.Entry<boolean>("clairvoyant.enableLunaticPreview");
const outputChannelVolume = new Config.MapEntry("clairvoyant.outputChannelVolume", outputChannelVolumeObject);
const outputChannel = vscode.window.createOutputChannel(Config.applicationName);
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
        vscode.commands.registerCommand(`${applicationKey}.sightDocument`, sightDocument),
        vscode.commands.registerCommand(`${applicationKey}.sightToken`, sightToken),
        vscode.commands.registerCommand(`${applicationKey}.lunaticGoToFile`, lunaticGoToFile),
        vscode.commands.registerCommand(`${applicationKey}.back`, Selection.getEntry().showTokenUndo),
        vscode.commands.registerCommand(`${applicationKey}.forward`, Selection.getEntry().showTokenRedo),
        vscode.commands.registerCommand(`${applicationKey}.reload`, reload),
        vscode.commands.registerCommand(`${applicationKey}.reportStatistics`, reportStatistics),
        vscode.commands.registerCommand(`${applicationKey}.reportProfile`, reportProfile),
        vscode.commands.registerCommand
        (
            `${applicationKey}.nextToken`,
            () =>
            {
                outputLine("verbose", `"${applicationKey}.nextToken" is called.`);
                const activeTextEditor = vscode.window.activeTextEditor;
                if (undefined !== activeTextEditor)
                {
                    const selection = Scan.getNextTokenSelection(activeTextEditor);
                    if (undefined !== selection)
                    {
                        Selection.getEntry().showToken({document: activeTextEditor.document, selection});
                    }
                }
            }
        ),
        vscode.commands.registerCommand
        (
            `${applicationKey}.previousToken`,
            () =>
            {
                outputLine("verbose", `"${applicationKey}.previousToken" is called.`);
                const activeTextEditor = vscode.window.activeTextEditor;
                if (undefined !== activeTextEditor)
                {
                    const selection = Scan.getPreviousTokenSelection(activeTextEditor);
                    if (undefined !== selection)
                    {
                        Selection.getEntry().showToken({document: activeTextEditor.document, selection});
                    }
                }
            }
        ),
        vscode.commands.registerCommand
        (
            `${applicationKey}.toggleHighlight`,
            () =>
            {
                outputLine("verbose", `"${applicationKey}.toggleHighlight" is called.`);
                const activeTextEditor = vscode.window.activeTextEditor;
                if (undefined !== activeTextEditor)
                {
                    const token = Scan.getToken(activeTextEditor);
                    if (undefined !== token)
                    {
                        Highlight.toggle(token);
                    }
                }
            }
        ),

        //  ステータスバーアイコンの登録
        StatusBar.make(),

        //  イベントリスナーの登録
        vscode.workspace.onDidChangeConfiguration(onDidChangeConfiguration),
        vscode.workspace.onDidChangeWorkspaceFolders(reload),
        vscode.workspace.onDidChangeTextDocument
        (
            async (event) =>
            {
                try
                {
                    const uri = event.document.uri.toString();
                    //  OuputChannel に対するイベント処理中に OuputChannel に書き出すと無限ループになってしまうのでミュートする
                    muteOutput = uri.startsWith("output:");

                    outputLine("verbose", `onDidChangeTextDocument("${uri}") is called.`);
                    if (autoScanMode.get(event.document.languageId).enabled && !isExcludeDocument(event.document))
                    {
                        await Scan.scanDocument(event.document, true);
                        vscode.window.visibleTextEditors
                            .filter(i => i.document.uri.toString() === uri)
                            .forEach(i => Highlight.updateEditor(i));
                    }
                    else
                    {
                        await Scan.detachDocument(event.document);
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
                if (Scan.isScanedDocment(document))
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
            async (textEditor) =>
            {
                outputLine("verbose", `onDidChangeActiveTextEditor("${textEditor ? textEditor.document.uri.toString(): "undefined"}") is called.`);
                if (textEditor && isTargetEditor(textEditor))
                {
                    outputLine("verbose", `lastValidViemColumn: ${textEditor.viewColumn}`);
                    if (textEditor.viewColumn)
                    {
                        Selection.setLastValidViemColumn(textEditor.viewColumn);
                    }
                    if (autoScanMode.get(textEditor.document.languageId).enabled && !isExcludeDocument(textEditor.document))
                    {
                        await Scan.scanDocument(textEditor.document);
                        Highlight.updateEditor(textEditor);
                    }
                }
                setIsDocumentScanedWithClairvoyant(undefined !== textEditor && Scan.isScanedDocment(textEditor.document));
            }
        ),
        vscode.window.onDidChangeTextEditorSelection(event => Selection.Log.update(event.textEditor)),
        vscode.languages.onDidChangeDiagnostics(onDidChangeDiagnostics),
    );

    reload();
};

export const setIsDocumentScanedWithClairvoyant = (isDocumentScanedWithClairvoyant: boolean) => vscode.commands.executeCommand
(
    'setContext',
    'isDocumentScanedWithClairvoyant',
    isDocumentScanedWithClairvoyant
);

export const isTargetEditor = (textEditor: vscode.TextEditor) => undefined !== textEditor.viewColumn;

export const isTargetProtocol = (uri: string) => targetProtocols.get("").some(i => uri.startsWith(i));
export const isExcludeFile = (filePath: string) => excludeExtentions.get("").some(i => filePath.toLowerCase().endsWith(i.toLowerCase()));
export const startsWithDot = (path: string) => isExcludeStartsWidhDot.get("") && path.startsWith(".");
export const isExcludeDocument = (document: vscode.TextDocument) =>
    !Scan.isScanedDocment(document) &&
    (
        !isTargetProtocol(document.uri.toString()) ||
        File.extractRelativePath(document.uri.toString()).split("/").some(i => 0 <= excludeDirectories.get("").indexOf(i) || startsWithDot(i)) ||
        isExcludeFile(document.uri.toString())
    );

export const encodeToken = (token: string) => `@${token}`;
export const decodeToken = (token: string) => token.substring(1);


export const copyToken = async (text: string) =>
{
    outputLine("verbose", `copyToken("${text}") is called.`);
    await vscode.env.clipboard.writeText(text);
};
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

const clearConfig = () =>
{
    [
        autoScanMode,
        maxFiles,
        showStatusBarItems,
        textEditorRevealType,
        isExcludeStartsWidhDot,
        excludeDirectories,
        excludeExtentions,
        targetProtocols,
        enablePreviewIntercept,
        gotoHistoryMode,
        parserRegExp,
        highlightMode,
        highlightBaseColor,
        highlightAlpha,
        activeHighlightAlpha,
        activeHighlightLineAlpha,
        latestHighlightAlpha,
        activeHighlightOverviewRulerLane,
        latestHighlightOverviewRulerLane,
        highlightOverviewRulerLane,
        enableLunaticPreview,
        outputChannelVolume,
    ]
    .forEach(i => i.clear());

    vscode.commands.executeCommand
    (
        'setContext',
        'enableLunaticPreviewWithClairvoyant',
        enableLunaticPreview.get("")
    );
};

export const reload = () =>
{
    outputLine("silent", Locale.map("♻️ Reload Clairvoyant!"));
    Scan.reload();
    Menu.reload();
    Selection.reload();
    Highlight.reload();
    clearConfig();
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
        gotoHistoryMode: gotoHistoryMode.getCache(""),
        enableLunaticPreview: enableLunaticPreview.getCache(""),
    };
    clearConfig();
    StatusBar.update();
    if (JSON.stringify(old.gotoHistoryMode) !== JSON.stringify(gotoHistoryMode.get("")))
    {
        Selection.reload();
    }
    if
    (
        old.autoScanMode !== autoScanMode.get("") ||
        old.maxFiles !== maxFiles.get("") ||
        old.isExcludeStartsWidhDot !== isExcludeStartsWidhDot.get("") ||
        JSON.stringify(old.excludeDirectories) !== JSON.stringify(excludeDirectories.get("")) ||
        JSON.stringify(old.excludeExtentions) !== JSON.stringify(excludeExtentions.get("")) ||
        JSON.stringify(old.targetProtocols) !== JSON.stringify(targetProtocols.get("")) ||
        old.enableLunaticPreview !== enableLunaticPreview.get("")
    )
    {
        Scan.reload();
        Menu.reload();
        autoScanMode.get("").onInit();
    }
};

export const onDidChangeDiagnostics = (event: vscode.DiagnosticChangeEvent) =>
{
    event.uris.forEach
    (
        uri =>Menu.removeCache(`${uri.toString()}.makeSightFileRootMenu:`)
    );
};
export const getDocumentDiagnostics = (uri: vscode.Uri) => vscode.languages.getDiagnostics(uri)
.sort
(
    Comparer.merge
    ([
        Comparer.make(i => i.severity),
        Comparer.make(i => i.range.start.line),
        Comparer.make(i => i.range.start.character),
        Comparer.make(i => i.range.end.line),
        Comparer.make(i => i.range.end.character),
    ])
);
export const getDocumentDiagnosticsSummary = (uri: vscode.Uri):{ severity: vscode.DiagnosticSeverity, count: number }[] =>
{
    const result: { severity: vscode.DiagnosticSeverity, count: number }[] = [];
    const diagnostics = getDocumentDiagnostics(uri);
    const severities = diagnostics
        .map(i => i.severity)
        .filter((i, index, list) => index === list.indexOf(i));
    severities.forEach
    (
        severity =>
        {
            result.push
            ({
                severity,
                count: diagnostics.filter(i => i.severity === severity).length
            });
        }
    );
    return result;
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
        Menu.makeSightRootMenu,
    options:
    {
        matchOnDescription: true,
        filePreview: enableLunaticPreview.get(""),
    }
});

export const sightDocument = async () =>
{
    const activeTextEditor = vscode.window.activeTextEditor;
    if (undefined === activeTextEditor || !Scan.isScanedDocment(activeTextEditor.document))
    {
        await Menu.Show.root
        ({
            makeItemList: Menu.makeStaticMenu,
            options:
            {
                matchOnDescription: true,
            }
        });
    }
    else
    {
        await Menu.Show.root
        ({
            makeItemList: () => Menu.makeSightDocumentRootMenu(activeTextEditor.document.uri.toString()),
            options:
            {
                matchOnDescription: true,
            }
        });
    }
};

export const sightToken = async () =>
{
    const activeTextEditor = vscode.window.activeTextEditor;
    const token = undefined === activeTextEditor ? undefined: Scan.getToken(activeTextEditor);
    if (undefined === activeTextEditor || undefined === token)
    {
        await Menu.Show.root
        ({
            makeItemList: Menu.makeStaticMenu,
            options:
            {
                matchOnDescription: true,
            }
        });
    }
    else
    {
        await Menu.Show.root
        ({
            makeItemList: () => Menu.makeSightTokenRootMenu(activeTextEditor.document.uri.toString(), token),
            options:
            {
                matchOnDescription: true,
                matchOnDetail: true,
                document: activeTextEditor.document,
                token,
                }
        });
    }
};

export const lunaticGoToFile = async () =>
{
    if (Object.keys(Scan.documentMap).length <= 0)
    {
        await Menu.Show.root
        ({
            makeItemList: Menu.makeStaticMenu,
            options:
            {
                matchOnDescription: true,
            }
        });
    }
    else
    {
        await Menu.Show.root
        ({
            makeItemList: () => Menu.makeLunaticGoToFileMenu(),
            options:
            {
                matchOnDescription: true,
                filePreview: true,
            }
        });
    }
};
