import * as vscode from 'vscode';

import localeEn from "../package.nls.json";
import localeJa from "../package.nls.ja.json";

interface LocaleEntry
{
    [key : string] : string;
}
const localeTableKey = <string>JSON.parse(<string>process.env.VSCODE_NLS_CONFIG).locale;
const localeTable = Object.assign(localeEn, ((<{[key : string] : LocaleEntry}>{
    ja : localeJa
})[localeTableKey] || { }));
const localeString = (key : string) : string => localeTable[key] || key;

const getTicks = () => new Date().getTime();
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

const mapKeys = <keyT, valueT>(map: Map<keyT, valueT>) => Array.from(map.keys());
const mapValues = <keyT, valueT>(map: Map<keyT, valueT>) => Array.from(map.values());
const mapEntries = <keyT, valueT>(map: Map<keyT, valueT>) => Array.from(map.entries());

export const regExpExecToArray = (regexp: RegExp, text: string) => Profiler.profile
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

export const timeout = (wait: number) => new Promise((resolve) => setTimeout(resolve, wait));

export module Profiler
{
    let profileScore: { [scope: string]: number } = { };
    let entryStack: ProfileEntry[] = [ ];
    let isProfiling = false;
    let startAt = 0;
    let endAt = 0;
    let debugCount = 0;
    
    export class ProfileEntry
    {
        startTicks: number;
        childrenTicks: number;

        public constructor(public name: string)
        {
            this.childrenTicks = 0;
            if (isProfiling)
            {
                this.startTicks = getTicks();
                entryStack.push(this);
                if (this.name.startsWith("DEBUG:"))
                {
                    ++debugCount;
                }
                debug(`${"*".repeat(entryStack.length)} ${this.name} begin`);
            }
            else
            {
                this.startTicks = 0;
            }
        }
        public end()
        {
            if (0 !== this.startTicks)
            {
                debug(`${"*".repeat(entryStack.length)} ${this.name} end`);
                if (this.name.startsWith("DEBUG:"))
                {
                    --debugCount;
                }
                const wholeTicks = getTicks() -this.startTicks;
                if (undefined === profileScore[this.name])
                {
                    profileScore[this.name] = 0;
                }
                profileScore[this.name] += wholeTicks -this.childrenTicks;
                entryStack.pop();
                if (0 < entryStack.length)
                {
                    entryStack[entryStack.length -1].childrenTicks += wholeTicks;
                }
            }
        }
    }
    export const profile = <ResultT>(name: string, target: ()=>ResultT): ResultT =>
    {
        const entry = new ProfileEntry(name);
        try
        {
            return target();
        }
        catch(error) // 現状(VS Code v1.32.3)、こうしておかないとデバッグコンソールに例外情報が出力されない為の処置。
        {
            console.error(`Exception at: ${name}`);
            console.error(error);
            throw error; // ※この再送出により外側のこの関数で再び catch し重複してエラーが出力されることに注意。
        }
        finally
        {
            entry.end();
        }
    };

    export const getIsProfiling = () => isProfiling;

    export const start = () =>
    {
        isProfiling = true;
        profileScore = { };
        entryStack = [ ];
        startAt = getTicks();
    };
    export const stop = () =>
    {
        isProfiling = false;
        endAt = getTicks();
    };
    export const getOverall = () => (isProfiling ? getTicks(): endAt) - startAt;
    export const getReport = () =>
        Object.keys(profileScore)
            .map
            (
                name =>
                ({
                    name,
                    ticks: profileScore[name]
                })
            )
            .sort((a, b) => b.ticks -a.ticks);

    export const debug = (text: string, object?: any) =>
    {
        if (0 < debugCount)
        {
            if (undefined !== object)
            {
                console.log(text);
            }
            else
            {
                console.log(`${text}: ${JSON.stringify(object)}`);
            }
        }
    };
}

export module Clairvoyant
{
    const applicationKey = "clairvoyant";
    let context: vscode.ExtensionContext;

    let eyeLabel: vscode.StatusBarItem;

    let isBusy = 0;
    const busy = async <valueT>(busyFunction: () => valueT) =>
    {
        try
        {
            ++isBusy;
            updateStatusBarItems();
            await timeout(1);
            return busyFunction();
        }
        finally
        {
            --isBusy;
            updateStatusBarItems();
        }
    };

    class Cache<keyT, valueT>
    {
        cache: { [key: string]: valueT } = { };
        public constructor(public loader: (key: keyT) => valueT)
        {

        }

        public get = (key: keyT): valueT => this.getCore(key, JSON.stringify(key));
        private getCore = (key: keyT, keyJson: string): valueT => undefined === this.cache[keyJson] ?
            (this.cache[keyJson] = this.loader(key)):
            this.cache[keyJson]
        public clear = () => this.cache = { };
    }
    class Config<valueT>
    {
        public constructor
        (
            public name: string,
            public defaultValue: valueT,
            public validator?: (value: valueT) => boolean,
            public minValue?: valueT,
            public maxValue?: valueT
        )
        {

        }

        regulate = (rawKey: string, value: valueT): valueT =>
        {
            let result = value;
            if (this.validator && !this.validator(result))
            {
                // settings.json をテキストとして直接編集してる時はともかく GUI での編集時に無駄にエラー表示が行われてしまうので、エンドユーザーに対するエラー表示は行わない。
                //vscode.window.showErrorMessage(`${rawKey} setting value is invalid! Please check your settings.`);
                console.error(`"${rawKey}" setting value(${JSON.stringify(value)}) is invalid! Please check your settings.`);
                result = this.defaultValue;
            }
            else
            {
                if (undefined !== this.minValue && result < this.minValue)
                {
                    result = this.minValue;
                }
                else
                if (undefined !== this.maxValue && this.maxValue < result)
                {
                    result = this.maxValue;
                }
            }
            return result;
        }

        cache = new Cache
        (
            (lang: string): valueT =>
            {
                let result: valueT;
                if (undefined === lang || null === lang || 0 === lang.length)
                {
                    result = <valueT>vscode.workspace.getConfiguration(applicationKey)[this.name];
                    if (undefined === result)
                    {
                        result = this.defaultValue;
                    }
                    else
                    {
                        result = this.regulate(`${applicationKey}.${this.name}`, result);
                    }
                }
                else
                {
                    const langSection = vscode.workspace.getConfiguration(`[${lang}]`, null);
                    result = <valueT>langSection[`${applicationKey}.${this.name}`];
                    if (undefined === result)
                    {
                        result = this.get("");
                    }
                    else
                    {
                        result = this.regulate(`[${lang}].${applicationKey}.${this.name}`, result);
                    }
                }
                return result;
            }
        );

        public get = this.cache.get;
        public clear = this.cache.clear;
    }
    class ConfigMap<ObjectT>
    {
        public constructor
        (
            public name: string,
            public defaultValue: keyof ObjectT,
            public mapObject: ObjectT
        )
        {
        }

        config = new Config<keyof ObjectT>(this.name, this.defaultValue, makeEnumValidator(this.mapObject));
        public get = (key: string) => this.mapObject[this.config.cache.get(key)];
        public clear = this.config.cache.clear;
    }
    
    const makeEnumValidator = <ObjectT>(mapObject: ObjectT): (value: keyof ObjectT) => boolean => (value: keyof ObjectT): boolean => 0 <= Object.keys(mapObject).indexOf(value.toString());

    const autoScanModeObject = Object.freeze
    ({
        "none":
        {
            onInit: () => { },
            enabled: false,
        },
        "current document":
        {
            onInit: () => { },
            enabled: true,
        },
        "open documents":
        {
            onInit: () => scanOpenDocuments(),
            enabled: true,
        },
        "folder":
        {
            onInit: () => scanFolder(),
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

    const enabledProfile = new Config("enabledProfile", true);
    const autoScanMode = new ConfigMap("autoScanMode", "folder", autoScanModeObject);
    const showStatusBarItems = new Config("showStatusBarItems", true);
    const textEditorRevealType = new ConfigMap("textEditorRevealType", "InCenterIfOutsideViewport", textEditorRevealTypeObject);

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
                        documentTokenEntryMap.delete(activeTextEditor.document);
                        await scanDocument(activeTextEditor.document);
                    }
                }
            ),
            vscode.commands.registerCommand(`${applicationKey}.scanOpenDocuments`, scanOpenDocuments),
            vscode.commands.registerCommand(`${applicationKey}.scanFolder`, scanFolder),
            vscode.commands.registerCommand(`${applicationKey}.sight`, sight),
            vscode.commands.registerCommand(`${applicationKey}.reload`, reload),
            vscode.commands.registerCommand
            (
                `${applicationKey}.reportProfile`, () =>
                {
                    outputChannel.show();
                    if (Profiler.getIsProfiling())
                    {
                        outputChannel.appendLine(`${localeString("📊 Profile Report")} - ${new Date()}`);
                        const overall = Profiler.getOverall();
                        const total = Profiler.getReport().map(i => i.ticks).reduce((p, c) => p +c);
                        outputChannel.appendLine(localeString("⚖ Overview"));
                        outputChannel.appendLine(`- Overall: ${overall.toLocaleString()}ms ( ${percentToDisplayString(1)} )`);
                        outputChannel.appendLine(`- Busy: ${total.toLocaleString()}ms ( ${percentToDisplayString(total / overall)} )`);
                        outputChannel.appendLine(localeString("🔬 Busy Details"));
                        outputChannel.appendLine(`- Total: ${total.toLocaleString()}ms ( ${percentToDisplayString(1)} )`);
                        Profiler.getReport().forEach(i => outputChannel.appendLine(`- ${i.name}: ${i.ticks.toLocaleString()}ms ( ${percentToDisplayString(i.ticks / total)} )`));
                        outputChannel.appendLine("");
                    }
                    else
                    {
                        outputChannel.appendLine(localeString("🚫 Profile has not been started."));
                    }
                }
            ),

            //  ステータスバーアイコンの登録
            eyeLabel = createStatusBarItem
            ({
                alignment: vscode.StatusBarAlignment.Right,
                text: "$(eye)",
                command: `${applicationKey}.sight`,
                tooltip: localeString("%clairvoyant.sight.title%")
            }),

            //  イベントリスナーの登録
            vscode.workspace.onDidChangeConfiguration(onDidChangeConfiguration),
            vscode.workspace.onDidChangeWorkspaceFolders(() => autoScanMode.get("").onInit()),
            vscode.workspace.onDidChangeTextDocument
            (
                event =>
                {
                    if (autoScanMode.get(event.document.languageId).enabled)
                    {
                        documentTokenEntryMap.delete(event.document);
                        scanDocument(event.document);
                    }
                }
            ),
            vscode.window.onDidChangeActiveTextEditor
            (
                textEditor =>
                {
                    if (textEditor && autoScanMode.get(textEditor.document.languageId).enabled)
                    {
                        scanDocument(textEditor.document);
                    }
                }
            ),
        );

        reload();
    };

    const documentTokenEntryMap = new Map<vscode.TextDocument, Map<string, number[]>>();
    const tokenDocumentEntryMap = new Map<string, Map<vscode.TextDocument, number[]>>();

    const makeSureTokenDocumentEntryMap = () => Profiler.profile
    (
        "makeSureTokenDocumentEntryMap",
        () =>
        {
            if (tokenDocumentEntryMap.size <= 0)
            {
                mapValues(documentTokenEntryMap)
                    .map(i => mapKeys(i))
                    .reduce((a, b) => a.concat(b).filter((i, index, a) => index === a.indexOf(i)), [])
                    .forEach
                    (
                        token =>
                        {
                            tokenDocumentEntryMap.set
                            (
                                token,
                                new Map<vscode.TextDocument, number[]>
                                (
                                    <[vscode.TextDocument, number[]][]>
                                    mapEntries(documentTokenEntryMap)
                                        .map
                                        (
                                            i =>
                                            ({
                                                textDocument: i[0],
                                                entries: i[1].get(token)
                                            })
                                        )
                                        .filter(i => undefined !== i.entries)
                                        .map(i => [ i.textDocument, i.entries ])
                                )
                            );
                        }
                    );
            }
            return tokenDocumentEntryMap;
        }
    );

    const showToken = async (entry: { document: vscode.TextDocument, selection: vscode.Selection }) =>
    {
        const textEditor = await vscode.window.showTextDocument(entry.document);
        textEditor.selection = entry.selection;
        textEditor.revealRange(entry.selection, textEditorRevealType.get(entry.document.languageId));
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
        documentTokenEntryMap.clear();
        tokenDocumentEntryMap.clear();
        onDidChangeConfiguration();
    };
    const onDidChangeConfiguration = () =>
    {
        [
            enabledProfile,
            autoScanMode,
            showStatusBarItems,
            textEditorRevealType,
        ]
        .forEach(i => i.clear());
        startOrStopProfile();
        updateStatusBarItems();
        autoScanMode.get("").onInit();
    };

    const startOrStopProfile = () =>
    {
        if (Profiler.getIsProfiling() !== enabledProfile.get(""))
        {
            if (enabledProfile.get(""))
            {
                Profiler.start();
            }
            else
            {
                Profiler.stop();
            }
        }
    };

    const scanDocument = async (document: vscode.TextDocument) => await busy
    (
        () =>
        Profiler.profile
        (
            "scanDocument",
            () =>
            {
                if (documentTokenEntryMap.get(document))
                {
                    console.log(`scanDocument SKIP: ${document.fileName}`);
                }
                else
                {
                    console.log(`scanDocument: ${document.fileName}`);
                    const text = document.getText();
                    const hits = regExpExecToArray
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
                            //preview: makePreview(document, match.index, match[0]),
                            //selection: makeSelection(document, match.index, match[0]),
                        })
                    );
                    const map = new Map<string, number[]>();
                    const tokens = hits.map(i => i.token).filter((i, index, a) => index === a.indexOf(i));
                    tokens.forEach
                    (
                        token =>
                        {
                            map.set
                            (
                                token,
                                hits.filter(i => token === i.token).map(i => i.index)
                            );
                        }
                    );
                    mapKeys(documentTokenEntryMap)
                        .filter(i => i.fileName === document.fileName)
                        .forEach(i => documentTokenEntryMap.delete(i));
                    documentTokenEntryMap.set(document, map);
                    tokenDocumentEntryMap.clear();
                }
            }
        )
    );

    const scanOpenDocuments = async () => await Promise.all(vscode.window.visibleTextEditors.filter(i => i.viewColumn).map(async (i) => await scanDocument(i.document)));
    const scanFolder = async () => await Promise.all(vscode.window.visibleTextEditors.filter(i => i.viewColumn).map(async (i) => await scanDocument(i.document)));

    const extractRelativePath = (path : string) : string =>
    {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(path));
        return workspaceFolder && path.startsWith(workspaceFolder.uri.fsPath) ? path.substring(workspaceFolder.uri.fsPath.length): path;
    };
    const extractDirectory = (path : string) : string => extractRelativePath(path.substr(0, path.length -extractFileName(path).length));
    const extractFileName = (path : string) : string => path.split('\\').reverse()[0].split('/').reverse()[0];
    const digest = (text : string) : string => text.replace(/\s+/g, " ").substr(0, 128);
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
    const makeGotoCommandMenuItem = (document: vscode.TextDocument, index: number, token: string) => Profiler.profile
    (
        "makeGotoCommandMenuItem",
        () =>
        {
            const anchor = document.positionAt(index);
            const line = document.getText(new vscode.Range(anchor.line, 0, anchor.line +1, 0));
            const result =
            {

                label: `$(rocket) Go to line:${anchor.line +1} row:${anchor.character +1}-${anchor.character +1 +token.length}`,
                detail: line.length < 1024 ? line.trim().replace(/\s+/gm, " "): "$(eye-closed) TOO LONG LINE",
                command: async () => showToken({ document, selection: makeSelection(document, index, token) })
            };
            return result;
        }
    );
    const makeSightShowMenu = (document: vscode.TextDocument, token: string, indices: number[]): CommandMenuItem[] => Profiler.profile
    (
        "makeSightTokenMenu",
        () => indices.map
        (
            index => makeGotoCommandMenuItem(document, index, token)
        )
    );
    const makeSightTokenCoreMenu = (token: string): CommandMenuItem[] =>
    ([
        {
            label: `$(clippy) Copy "${token}" to clipboard`,
            command: async () => copyToken(token),
        },
        {
            label: `$(clippy) Paste "${token}" to text editor`,
            command: async () => pasteToken(token),
        },
    ]);
    const makeSightTokenMenu = (token: string, entry: Map<vscode.TextDocument, number[]>): CommandMenuItem[] => Profiler.profile
    (
        "makeSightTokenMenu",
        () => makeSightTokenCoreMenu(token).concat
        (
            mapEntries(entry)
            .sort(mergeComparer([makeComparer(entry => -entry[1].length), makeComparer(entry => entry[0].fileName)]))
            .map
            (
                entry =>
                ({
                    label: `$(file-text) ${extractFileName(entry[0].fileName)}`,
                    description: entry[0].isUntitled ?
                        digest(entry[0].getText()):
                        extractDirectory(entry[0].fileName),
                    detail: `count: ${entry[1].length}`,
                    command: async () =>await showMenu(await busy(() => makeSightShowMenu(entry[0], token, entry[1])), { matchOnDetail: true })
                })
            )
        )
    );
    const makeSightFileTokenMenu = (document: vscode.TextDocument, token: string, indices: number[]): CommandMenuItem[] => Profiler.profile
    (
        "makeSightFileTokenMenu",
        () => makeSightTokenCoreMenu(token).concat(makeSightShowMenu(document, token, indices))
    );
    const makeSightFileRootMenu = (document: vscode.TextDocument, entries: Map<string, number[]>): CommandMenuItem[] => Profiler.profile
    (
        "makeSightFileRootMenu",
        () =>
        ([
            "token" === getRootMenuOrder() ?
                {
                    label: `$(list-ordered) Sort by count`,
                    command: async () =>
                    {
                        context.globalState.update("clairvoyant.rootMenuOrder", "count");
                        await showMenu(await busy(() => makeSightFileRootMenu(document, entries)));
                    },
                }:
                {
                    label: `$(list-ordered) Sort by token`,
                    command: async () =>
                    {
                        context.globalState.update("clairvoyant.rootMenuOrder", "token");
                        await showMenu(await busy(() => makeSightFileRootMenu(document, entries)));
                    },
                },
        ])
        .concat
        (
            mapEntries(entries).sort
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
                    label: `$(tag) ${entry[0]} `, // この末尾のスペースは showQuickPick の絞り込みでユーザーが他の入力候補を除外する為のモノ
                    description: undefined,
                    detail: `count: ${entry[1].length}`,
                    command: async () => await showMenu(await busy(() => makeSightFileTokenMenu(document, entry[0], entry[1])), { matchOnDetail: true })
                })
            )
        )
    );
    const makeSightFileListMenu = (): CommandMenuItem[] => Profiler.profile
    (
        "makeSightFileListMenu",
        () => mapEntries(documentTokenEntryMap)
        .sort(makeComparer(entry => entry[0].fileName))
        .map
        (
            entry =>
            ({
                label: `$(file-text) ${extractFileName(entry[0].fileName)}`,
                description: entry[0].isUntitled ?
                    digest(entry[0].getText()):
                    extractDirectory(entry[0].fileName),
                command: async () =>await showMenu(await busy(() => makeSightFileRootMenu(entry[0], entry[1])))
            })
        )
    );
    const getRootMenuOrder = () => context.globalState.get<string>("clairvoyant.rootMenuOrder", "token");
    const makeSightRootMenu = (tokenDocumentEntryMap: Map<string, Map<vscode.TextDocument, number[]>>): CommandMenuItem[] => Profiler.profile
    (
        "makeSightRootMenu",
        () =>
        ([
            "token" === getRootMenuOrder() ?
                {
                    label: `$(list-ordered) Sort by count`,
                    command: async () =>
                    {
                        context.globalState.update("clairvoyant.rootMenuOrder", "count");
                        await showMenu(await busy(() => makeSightRootMenu(tokenDocumentEntryMap)));
                    },
                }:
                {
                    label: `$(list-ordered) Sort by token`,
                    command: async () =>
                    {
                        context.globalState.update("clairvoyant.rootMenuOrder", "token");
                        await showMenu(await busy(() => makeSightRootMenu(tokenDocumentEntryMap)));
                    },
                },
            {
                label: `$(list-ordered) Show by file`,
                command: async () =>
                {
                    await showMenu(await busy(makeSightFileListMenu), { matchOnDescription: true });
                },
            },
        ])
        .concat
        (
            mapEntries(tokenDocumentEntryMap)
                .sort
                (
                    "token" === getRootMenuOrder() ?
                        (a, b) => stringComparer(a[0], b[0]):
                        mergeComparer
                        ([
                            makeComparer
                            (
                                (entry: [string, Map<vscode.TextDocument, number[]>]) =>
                                    -mapValues(entry[1]).map(i => i.length).reduce((a, b) => a +b, 0)
                            ),
                            (a, b) => stringComparer(a[0], b[0])
                        ])
                )
                .map
                (
                    entry =>
                    ({
                        label: `$(tag) ${entry[0]} `, // この末尾のスペースは showQuickPick の絞り込みでユーザーが他の入力候補を除外する為のモノ
                        description: undefined,
                        detail: mapEntries(entry[1])
                                .sort(mergeComparer([makeComparer(entry => -entry[1].length), makeComparer(entry => entry[0].fileName)]))
                                .map(entry => `$(file-text) ${extractFileName(entry[0].fileName)}(${entry[1].length})`)
                                .join(", "),
                        command: async () => await showMenu(await busy(() => makeSightTokenMenu(entry[0], entry[1])), { matchOnDescription: true })
                    })
                )
        )
    );

    const sight = async () =>
    {
        const tokenDocumentEntryMap =await busy(makeSureTokenDocumentEntryMap);
        if (tokenDocumentEntryMap.size <= 0)
        {
            await vscode.window.showInformationMessage(localeString("No scan data"));
        }
        else
        {
            await showMenu(await busy(() => makeSightRootMenu(tokenDocumentEntryMap)));
        }
    }

    export const updateStatusBarItems = () : void =>
    {
        eyeLabel.text = 0 < isBusy ? "$(sync~spin)": "$(eye)";
        eyeLabel.tooltip = 0 < isBusy ? localeString("%clairvoyant.sight.busy%"): localeString("%clairvoyant.sight.title%");
        if (showStatusBarItems.get(""))
        {
            eyeLabel.show();
        }
        else
        {
            eyeLabel.hide();
        }
    };
}

export function activate(context: vscode.ExtensionContext): void
{
    Clairvoyant.initialize(context);
}
export function deactivate(): void
{
}
