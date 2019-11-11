import * as vscode from 'vscode';

/*
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
*/
const localeString = (key : string) : string => key;

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
    let nextLabel: vscode.StatusBarItem;
    let previousLabel: vscode.StatusBarItem;
    let nextDocumentLabel: vscode.StatusBarItem;
    let previousDocumentLabel: vscode.StatusBarItem;

    let isBusy = 0;
    const busy = async <valueT>(busyFunction: () => valueT) =>
    {
        try
        {
            ++isBusy;
            updateStatusBarItems();
            await timeout(0);
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
    const showStatusBarItemsObject = Object.freeze
    ({
        "none":
        {
            show: () =>
            {
                nextDocumentLabel.hide();
                nextLabel.hide();
                eyeLabel.hide();
                previousLabel.hide();
                previousDocumentLabel.hide();
            }
        },
        "eye only":
        {
            show: () =>
            {
                nextDocumentLabel.hide();
                nextLabel.hide();
                eyeLabel.show();
                previousLabel.hide();
                previousDocumentLabel.hide();
            }
        },
        "eye,next,previous":
        {
            show: () =>
            {
                nextDocumentLabel.hide();
                nextLabel.show();
                eyeLabel.show();
                previousLabel.show();
                previousDocumentLabel.hide();
            }
        },
        "full":
        {
            show: () =>
            {
                nextDocumentLabel.show();
                nextLabel.show();
                eyeLabel.show();
                previousLabel.show();
                previousDocumentLabel.show();
            }
        },
    });

    const enabledProfile = new Config("enabledProfile", true);
    const autoScanMode = new ConfigMap("autoScanMode", "folder", autoScanModeObject);
    const showStatusBarItems = new ConfigMap("showStatusBarItems", "full", showStatusBarItemsObject);

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
            vscode.commands.registerCommand(`${applicationKey}.scanDocument`, scanDocument),
            vscode.commands.registerCommand(`${applicationKey}.scanOpenDocuments`, scanOpenDocuments),
            vscode.commands.registerCommand(`${applicationKey}.scanFolder`, scanFolder),
            vscode.commands.registerCommand(`${applicationKey}.sight`, sight),
            vscode.commands.registerCommand(`${applicationKey}.reload`, reload),
            vscode.commands.registerCommand
            (
                `${applicationKey}.startProfile`, () =>
                {
                    outputChannel.show();
                    if (Profiler.getIsProfiling())
                    {
                        outputChannel.appendLine(localeString("🚫 You have already started the profile."));
                    }
                    else
                    {
                        outputChannel.appendLine(`${localeString("⏱ Start Profile!")} - ${new Date()}`);
                        Profiler.start();
                    }
                }
            ),
            vscode.commands.registerCommand
            (
                `${applicationKey}.stopProfile`, () =>
                {
                    outputChannel.show();
                    if (Profiler.getIsProfiling())
                    {
                        Profiler.stop();
                        outputChannel.appendLine(`${localeString("🏁 Stop Profile!")} - ${new Date()}`);
                        outputChannel.appendLine(localeString("📊 Profile Report"));
                        const total = Profiler.getReport().map(i => i.ticks).reduce((p, c) => p +c);
                        outputChannel.appendLine(`- Total: ${total.toLocaleString()}ms ( ${percentToDisplayString(1)} )`);
                        Profiler.getReport().forEach(i => outputChannel.appendLine(`- ${i.name}: ${i.ticks.toLocaleString()}ms ( ${percentToDisplayString(i.ticks / total)} )`));
                    }
                    else
                    {
                        outputChannel.appendLine(localeString("🚫 Profile has not been started."));
                    }
                }
            ),
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
            nextDocumentLabel = createStatusBarItem
            ({
                alignment: vscode.StatusBarAlignment.Right,
                text: "$(triangle-right)",
                command: `${applicationKey}.nextDocument`,
                tooltip: "%clairvoyant.nextDocument.title%"
            }),
            nextLabel = createStatusBarItem
            ({
                alignment: vscode.StatusBarAlignment.Right,
                text: "$(chevron-right)",
                command: `${applicationKey}.next`,
                tooltip: "%clairvoyant.next.title%"
            }),
            eyeLabel = createStatusBarItem
            ({
                alignment: vscode.StatusBarAlignment.Right,
                text: "$(eye)",
                command: `${applicationKey}.sight`,
                tooltip: "%clairvoyant.sight.title%"
            }),
            previousLabel = createStatusBarItem
            ({
                alignment: vscode.StatusBarAlignment.Right,
                text: "$(chevron-left)",
                command: `${applicationKey}.previous`,
                tooltip: "%clairvoyant.previous.title%"
            }),
            previousDocumentLabel = createStatusBarItem
            ({
                alignment: vscode.StatusBarAlignment.Right,
                text: "$(triangle-left)",
                command: `${applicationKey}.previousDocument`,
                tooltip: "%clairvoyant.previousDocument.title%"
            }),


            //  イベントリスナーの登録
            vscode.workspace.onDidChangeConfiguration(onDidChangeConfiguration),
            vscode.workspace.onDidChangeWorkspaceFolders(() => scanFolder()),
            vscode.workspace.onDidChangeTextDocument(event => scanDocument(event.document)),
            vscode.window.onDidChangeActiveTextEditor(textEditor => textEditor && scanDocument(textEditor.document)),
        );

        reload();
    };

    interface Entry
    {
        preview: string;
        selection: vscode.Selection;
    }
    const documentTokenEntryMap = new Map<vscode.TextDocument, Map<string, Entry[]>>();
    const tokenDocumentEntryMap = new Map<string, Map<vscode.TextDocument, Entry[]>>();

    const makeSureTokenDocumentEntryMap = () => Profiler.profile
    (
        "makeSureTokenDocumentEntryMap",
        () =>
        {
            if (tokenDocumentEntryMap.size <= 0)
            {
                mapValues(documentTokenEntryMap)
                    .map(i => mapKeys(i))
                    .reduce((a, b) => a.concat(b).filter((i, index, a) => index === a.indexOf(i)))
                    .forEach
                    (
                        token =>
                        {
                            tokenDocumentEntryMap.set
                            (
                                token,
                                new Map<vscode.TextDocument, Entry[]>
                                (
                                    <[vscode.TextDocument, Entry[]][]>
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

    const showToken = async (document: vscode.TextDocument, entry: Entry) =>
    {
        const textEditor = await vscode.window.showTextDocument(document);
        textEditor.selection = entry.selection;
        textEditor.revealRange(entry.selection);
    };
    const copyToken = async (text: string) => await vscode.env.clipboard.writeText(text);
    const pasteToken = async (text: string) =>
    {
        const textEditor = vscode.window.activeTextEditor;
        if (textEditor)
        {
            await textEditor.edit(editBuilder => editBuilder.replace(textEditor.selection, text));
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

    const makePreview = (document: vscode.TextDocument, index: number, _token: string) => Profiler.profile
    (
        "makePreview",
        () =>
        {
            try
            {
                const anchor = document.positionAt(index);
                const line = document.getText(new vscode.Range(anchor.line, 0, anchor.line +1, 0));
                return line.length < 1024 ? line.trim().replace(/\s+/gm, " "): "$(eye-closed) TOO LONG LINE";
            }
            catch(error)
            {
                return `ERROR: ${document.fileName}, ${index}, ${_token}`;
            }
        }
    );
    const makeSelection = (document: vscode.TextDocument, index: number, token: string) => Profiler.profile
    (
        "makeSelection",
        () => new vscode.Selection(document.positionAt(index), document.positionAt(index +token.length))
    );
    const scanDocument = async (document: vscode.TextDocument) => busy
    (
        () =>
        Profiler.profile
        (
            "scanDocument",
            () =>
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
                        preview: makePreview(document, match.index, match[0]),
                        selection: makeSelection(document, match.index, match[0]),
                    })
                );
                const map = new Map<string, Entry[]>();
                const tokens = hits.map(i => i.token).filter((i, index, a) => index === a.indexOf(i));
                tokens.forEach
                (
                    token =>
                    {
                        map.set
                        (
                            token,
                            hits.filter(i => token === i.token)
                        );
                    }
                );
                mapKeys(documentTokenEntryMap)
                    .filter(i => i.fileName === document.fileName)
                    .forEach(i => documentTokenEntryMap.delete(i));
                documentTokenEntryMap.set(document, map);
                tokenDocumentEntryMap.clear();
            }
        )
    );

    const scanOpenDocuments = () => vscode.window.visibleTextEditors.filter(i => i.viewColumn).forEach(i => scanDocument(i.document));
    const scanFolder = () => vscode.window.visibleTextEditors.filter(i => i.viewColumn).forEach(i => scanDocument(i.document));

    const stripFileName = (path : string) : string => path.substr(0, path.length -stripDirectory(path).length);
    const stripDirectory = (path : string) : string => path.split('\\').reverse()[0].split('/').reverse()[0];
    const digest = (text : string) : string => text.replace(/\s+/g, " ").substr(0, 128);
    interface CommandMenuItem extends vscode.QuickPickItem
    {
        command: () => Promise<void>;
    }
    const showMenu = async (items: CommandMenuItem[]) =>
    {
        const select = await vscode.window.showQuickPick(items);
        if (select)
        {
            await select.command();
        }
    };
    const makeSightShowMenu = (document: vscode.TextDocument, entries: Entry[]): CommandMenuItem[] => Profiler.profile
    (
        "makeSightTokenMenu",
        () => entries
            .map
            (
                entry =>
                ({
                    label: `$(rocket) ${entry.preview} `, // この末尾のスペースは showQuickPick の絞り込みでユーザーが他の入力候補を除外する為のモノ
                    detail: `Go to #${entry.selection.anchor.line +1}:${entry.selection.anchor.character +1}`,
                    command: async () => showToken(document, entry)
                })
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
    const makeSightTokenMenu = (token: string, entry: Map<vscode.TextDocument, Entry[]>): CommandMenuItem[] => Profiler.profile
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
                    label: `$(file-text) ${stripDirectory(entry[0].fileName)}`,
                    description: entry[0].isUntitled ?
                        digest(entry[0].getText()):
                        stripFileName(entry[0].fileName),
                    detail: `count: ${entry[1].length}`,
                    command: async () =>await showMenu(await busy(() => makeSightShowMenu(entry[0], entry[1])))
                })
            )
        )
    );
    const makeSightFileTokenMenu = (document: vscode.TextDocument, token: string, entries: Entry[]): CommandMenuItem[] => Profiler.profile
    (
        "makeSightFileTokenMenu",
        () => makeSightTokenCoreMenu(token).concat(makeSightShowMenu(document, entries))
    );
    const makeSightFileRootMenu = (document: vscode.TextDocument, entries: Map<string, Entry[]>): CommandMenuItem[] => Profiler.profile
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
                    command: async () => await showMenu(await busy(() => makeSightFileTokenMenu(document, entry[0], entry[1])))
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
                label: `$(file-text) ${stripDirectory(entry[0].fileName)}`,
                description: entry[0].isUntitled ?
                    digest(entry[0].getText()):
                    stripFileName(entry[0].fileName),
                command: async () =>await showMenu(await busy(() => makeSightFileRootMenu(entry[0], entry[1])))
            })
        )
    );
    const getRootMenuOrder = () => context.globalState.get<string>("clairvoyant.rootMenuOrder", "token");
    const makeSightRootMenu = (): CommandMenuItem[] => Profiler.profile
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
                        await sight();
                    },
                }:
                {
                    label: `$(list-ordered) Sort by token`,
                    command: async () =>
                    {
                        context.globalState.update("clairvoyant.rootMenuOrder", "token");
                        await sight();
                    },
                },
            {
                label: `$(list-ordered) Show by file`,
                command: async () =>
                {
                    await showMenu(await busy(makeSightFileListMenu));
                },
            },
        ])
        .concat
        (
            mapEntries(makeSureTokenDocumentEntryMap())
                .sort
                (
                    "token" === getRootMenuOrder() ?
                        (a, b) => stringComparer(a[0], b[0]):
                        mergeComparer
                        ([
                            makeComparer
                            (
                                (entry: [string, Map<vscode.TextDocument, Entry[]>]) =>
                                    -mapValues(entry[1]).map(i => i.length).reduce((a, b) => a +b)
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
                                .map(entry => `$(file-text) ${stripDirectory(entry[0].fileName)}(${entry[1].length})`)
                                .join(", "),
                        command: async () => await showMenu(await busy(() => makeSightTokenMenu(entry[0], entry[1])))
                    })
                )
        )
    );

    const sight = async () => await showMenu(await busy(makeSightRootMenu));

    export const updateStatusBarItems = () : void =>
    {
        eyeLabel.text = 0 < isBusy ? "$(sync~spin)": "$(eye)";
        eyeLabel.tooltip = 0 < isBusy ? "%clairvoyant.sight.busy%": "%clairvoyant.sight.title%";
        showStatusBarItems.get("").show();
    };
}

export function activate(context: vscode.ExtensionContext): void
{
    Clairvoyant.initialize(context);
}
export function deactivate(): void
{
}
