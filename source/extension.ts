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
                if (0 < debugCount)
                {
                    console.log(`${"*".repeat(entryStack.length)} ${this.name} begin`);
                }
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
                if (0 < debugCount)
                {
                    console.log(`${"*".repeat(entryStack.length)} ${this.name} end`);
                }
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
}

export module Clairvoyant
{
    const applicationKey = "clairvoyant";
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

    const enabledProfile = new Config("enabledProfile", true);
    const autoScanMode = new ConfigMap("autoScanMode", "folder", autoScanModeObject);

    const outputChannel = vscode.window.createOutputChannel("Clairvoyant");
        
    export const initialize = (context: vscode.ExtensionContext): void =>
    {
        console.log("Clairvoyant Initialize!!!");
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

            //  イベントリスナーの登録
            vscode.workspace.onDidChangeConfiguration(onDidChangeConfiguration),
            vscode.workspace.onDidChangeWorkspaceFolders(() => scanFolder()),
            vscode.workspace.onDidChangeTextDocument(event => scanDocument(event.document)),
            vscode.window.onDidChangeActiveTextEditor(textEditor => textEditor && scanDocument(textEditor.document)),
        );

        reload();
console.log("Clairvoyant Initialized!!!");
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
                Array.from(documentTokenEntryMap.values())
                    .map(i => Array.from(i.keys()))
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
                                    Array.from(documentTokenEntryMap.entries())
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
        ]
        .forEach(i => i.clear());
        startOrStopProfile();
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
    const makePreview = (document: vscode.TextDocument, index: number, _token: string) => Profiler.profile
    (
        "makePreview",
        () =>
        {
            try
            {
                const anchor = document.positionAt(index);
                const line = document.getText(new vscode.Range(anchor.line, 0, anchor.line +1, 0));
                return line.length < 1024 ? line.trim().replace(/\s+/gm, " "): "TOO LONG LINE";
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
    const scanDocument = (document: vscode.TextDocument) => Profiler.profile
    (
        "scanDocument",
        () =>
        {
            //if (autoScanMode.get(document.languageId).enabled)
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
            documentTokenEntryMap.set(document, map);
        }
    );
    const scanOpenDocuments = () => Profiler.profile
    (
        "scanFolder",
        () =>
        {
            vscode.workspace.textDocuments.forEach(i => scanDocument(i));
        }
    );
    const scanFolder = () => Profiler.profile
    (
        "scanFolder",
        () =>
        {
            vscode.workspace.textDocuments.forEach(i => scanDocument(i));
        }
    );
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
    const makeSightShowMenu = (document: vscode.TextDocument, entries: Entry[]) => Profiler.profile
    (
        "makeSightTokenMenu",
        () => entries
            .map
            (
                entry =>
                ({
                    label: `$(rocket) Go to ${entry.selection.anchor.line +1}:${entry.selection.anchor.character +1}`,
                    detail: entry.preview,
                    command: async () => showToken(document, entry)
                })
            )
    );
    const makeSightTokenMenu = (token: string, entry: Map<vscode.TextDocument, Entry[]>) => Profiler.profile
    (
        "makeSightTokenMenu",
        () =>
        (<any>[
            {
                label: `$(clippy) Copy "${token}" to clipboard`,
                command: async () => copyToken(token),
            },
            {
                label: `$(clippy) Paste "${token}" to text editor`,
                command: async () => pasteToken(token),
            },
        ])
        .concat
        (
            Array.from(entry.entries())
            .map
            (
                entry =>
                ({
                    label: `$(file-text) ${stripDirectory(entry[0].fileName)}`,
                    description: entry[0].isUntitled ?
                        digest(entry[0].getText()):
                        stripFileName(entry[0].fileName),
                    detail: `count: ${entry[1].length}`,
                    command: async () =>await showMenu(makeSightShowMenu(entry[0], entry[1]))
                })
            )
        )
    );
    const makeSightRootMenu = () => Profiler.profile
    (
        "makeSightRootMenu",
        () => Array.from(makeSureTokenDocumentEntryMap().entries())
        .map
        (
            entry =>
            ({
                label: entry[0],
                description: undefined,
                detail: Array.from(entry[1].entries())
                        .map(entry => `${stripDirectory(entry[0].fileName)}(${entry[1].length})`)
                        .join(", "),
                    command: async () => await showMenu(makeSightTokenMenu(entry[0], entry[1]))
                })
            )
    );
    const sight = async () =>
    {
        const menu = makeSightRootMenu();
        menu.sort
        (
            (a, b) =>
                a.label.toLowerCase() < b.label.toLowerCase() ? -1:
                b.label.toLowerCase() < a.label.toLowerCase() ? 1:
                a.label < b.label ? -1:
                b.label < a.label ? 1:
                0
        );
        console.log(`tokens: ${JSON.stringify(menu.map(i => i.label))}`);
        await showMenu(menu);
    };
}

export function activate(context: vscode.ExtensionContext): void
{
    Clairvoyant.initialize(context);
}
export function deactivate(): void
{
}
