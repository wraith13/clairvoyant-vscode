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
                //console.log(`${"*".repeat(entryStack.length)} ${this.name} begin`);
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
                //console.log(`${"*".repeat(entryStack.length)} ${this.name} end`);
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

    const outputChannel = vscode.window.createOutputChannel("Clairvoyant Profiler"));
        
    export const initialize = (context: vscode.ExtensionContext): void =>
    {
        context.subscriptions.push
        (
            //  コマンドの登録
            vscode.commands.registerCommand(`${applicationKey}.scanDocument`, scanDocument),
            vscode.commands.registerCommand(`${applicationKey}.scanOpenDocuments`, scanOpenDocuments),
            vscode.commands.registerCommand(`${applicationKey}.scanFolder`, scanFolder),
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
    };

    const reload = () =>
    {
        //clearDB();
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
    const scanDocument = (document: vscode.TextDocument) => Profiler.profile
    (
        "scanDocument",
        () =>
        {
            const text = document.getText();
            regExpExecToArray
            (
                /\w+/gm,
                text
            )
            .map
            (
                match =>
                ({
                    index: match.index,
                    token: match[0],
                })
            )
            .map
            (
                i =>
                ({
                    startPosition: i.index,
                    length: i.token.length,
                })
            );
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
}