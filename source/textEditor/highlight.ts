import * as vscode from 'vscode';
import { phiColors } from 'phi-colors';

import * as Profiler from "../lib/profiler";
import * as Config from "../lib/config";
import { Cache } from "../lib/cache";

import * as Clairvoyant from "../clairvoyant";
import * as Scan from "../scan";
import * as Menu from '../ui/menu';
import * as Selection from "../textEditor/selection";

export const hash = (source: string): number =>
    source.split("").map(i => i.codePointAt(0) || 0).reduce((a, b) => (a *173 +b +((a & 0x5555) >>> 5)) & 8191)
    %34; // ← 通常、こういうところの数字は素数にすることが望ましいがここについては https://wraith13.github.io/phi-ratio-coloring/phi-ratio-coloring.htm で類似色の出てくる周期をベース(8,13,21,...)に調整すること。

let decorations: { [decorationParamJson: string]: { decorator: vscode.TextEditorDecorationType, rangesOrOptions: vscode.Range[] } } = { };

interface DecorationParam
{
    name: string;
    base: phiColors.Hsla;
    hue: number;
    alpha: number;
    overviewRulerLane?: vscode.OverviewRulerLane;
    isWholeLine?: boolean;
}
interface DecorationEntry
{
    range: vscode.Range;
    decorationParam: DecorationParam;
}
let hslaCache = new Cache((color: string) => phiColors.rgbaToHsla(phiColors.rgbaFromStyle(color)));
export const makeHueDecoration =
(
    name: string,
    hue: string | number,
    alpha: Config.Entry<number>,
    overviewRulerLane?: vscode.OverviewRulerLane,
    isWholeLine?: boolean
): DecorationParam =>
(
    {
        name,
        base: hslaCache.get
        (
            "number" === typeof hue ?
                Clairvoyant.highlightBaseColor.get(""):
                hue
        ),
        hue: "number" === typeof hue ? hue: 0,
        alpha: alpha.get(""),
        overviewRulerLane: overviewRulerLane,
        isWholeLine,
    }
);

export const createTextEditorDecorationType =
(
    backgroundColor: string,
    overviewRulerLane?: vscode.OverviewRulerLane,
    isWholeLine?: boolean
) => vscode.window.createTextEditorDecorationType
({
    backgroundColor: backgroundColor,
    overviewRulerColor: undefined !== overviewRulerLane ? backgroundColor: undefined,
    overviewRulerLane: overviewRulerLane,
    isWholeLine,
});

export const addDecoration = (entry: DecorationEntry) =>
{
    const key = JSON.stringify(entry.decorationParam);
    if (!decorations[key])
    {
        decorations[key] =
        {
            decorator: createTextEditorDecorationType
            (
                phiColors.rgbForStyle
                (
                    phiColors.hslaToRgba
                    (
                        phiColors.generate
                        (
                            entry.decorationParam.base,
                            entry.decorationParam.hue,
                            0,
                            0,
                            0
                        )
                    )
                )
                +((0x100 +entry.decorationParam.alpha).toString(16)).substr(1),
                entry.decorationParam.overviewRulerLane,
                entry.decorationParam.isWholeLine
            ),
            rangesOrOptions: []
        };
    }
    decorations[key].rangesOrOptions.push(entry.range);
};

let activeSelection: Selection.ShowTokenCoreEntry | undefined = undefined;
let latestToken: string | undefined = undefined;
let backupLatestToken: string | undefined = undefined;
let tokens: string[] = [];

export const reload = () =>
{
    activeSelection = undefined;
    latestToken = undefined;
    backupLatestToken = undefined;
    tokens = [];
    update();
    Object.keys(decorations).forEach(i => decorations[i].decorator.dispose());
    decorations = { };
    onUpdateToken("");
};

export const getHighlight = () => undefined !== latestToken ? tokens.filter(i => i !== latestToken).concat([latestToken]): tokens;
export const isHighlighted = (token: string) => 0 <= getHighlight().indexOf(token);
export const add = (token: string) =>
{
    tokens.push(token);
    onUpdateToken(token);
    update();
};
export const remove = (token: string) =>
{
    if (latestToken === token)
    {
        latestToken = undefined;
    }
    tokens = tokens.filter(i => i !== token);
    onUpdateToken(token);
    update();
};
export const toggle = (token: string) => isHighlighted(token) ? remove(token): add(token);

export module Preview
{
    export const backup = () =>
    {
        if (undefined === backupLatestToken)
        {
            backupLatestToken = latestToken;
        }
    };
    export const showToken = (token: string | undefined) =>
    {
        latestToken = token;
        update();
    };
    export const showSelection = (slection: Selection.ShowTokenCoreEntry | undefined) =>
    {
        activeSelection = slection;
        update();
    };
    export const commit = () =>
    {
        if (undefined !== backupLatestToken && Clairvoyant.highlightMode.get("").trail)
        {
            onUpdateToken(backupLatestToken);
        }
        activeSelection = undefined;
        backupLatestToken = undefined;
        if (latestToken)
        {
            tokens = tokens.filter(i => i !== latestToken);
            tokens.push(latestToken);
            onUpdateToken(latestToken);
        }
        update();
    };
    export const rollback = () =>
    {
        activeSelection = undefined;
        latestToken = backupLatestToken;
        backupLatestToken = undefined;
        update();
    };

    export const dispose = (commitable: boolean) => commitable ? commit(): rollback();
}

const onUpdateToken = (token: string) =>
{
    Clairvoyant.outputLine("verbose", `onUpdateToken() is called.`);
    Menu.removeCache(`filelist.${token}`);
};

export const update = () =>
{
    Clairvoyant.outputLine("verbose", `Highlight.update() is called.`);
    vscode.window.visibleTextEditors
        .filter
        (
            textEditor =>
                Clairvoyant.isTargetEditor(textEditor) &&
                Clairvoyant.autoScanMode.get(textEditor.document.languageId).enabled &&
                !Clairvoyant.isExcludeDocument(textEditor.document)
        )
        .forEach(i => updateEditor(i));
};

export const updateEditor = (textEditor: vscode.TextEditor) => Profiler.profile
(
    "Highlight.updateEditor",
    () =>
    {
        Clairvoyant.outputLine("verbose", `Highlight.updateEditor() is called.`);
        Profiler.profile("Highlight.updateEditor.clear", () => Object.keys(decorations).forEach(i => decorations[i].rangesOrOptions = []));
        const document = textEditor.document;
        const tokenHits = Scan.documentTokenEntryMap[document.uri.toString()] || { };
        let entries : DecorationEntry[] = [];
        if (undefined !== latestToken)
        {
            if (activeSelection && activeSelection.document.uri.toString() === document.uri.toString())
            {
                //  line
                entries.push
                ({
                    range: document.lineAt(activeSelection.selection.active.line).range,
                    decorationParam: makeHueDecoration
                    (
                        `line`,
                        hash(latestToken),
                        Clairvoyant.activeHighlightLineAlpha,
                        undefined,
                        true
                    )
                });
                //  token
                entries.push
                ({
                    range: activeSelection.selection,
                    decorationParam: makeHueDecoration
                    (
                        `active.token:${latestToken}`,
                        hash(latestToken),
                        Clairvoyant.activeHighlightAlpha,
                        Clairvoyant.activeHighlightOverviewRulerLane.get(""),
                        false
                    )
                });
            }

            const validLatestToken = latestToken; // TypeScript の警告除け( 警告が出る方がおかしい状況なんだけど。。。 )
            entries = entries.concat
            (
                (tokenHits[Clairvoyant.encodeToken(validLatestToken)] || []).map
                (
                    hit =>
                    ({
                        range: Selection.make(document, hit, validLatestToken),
                        decorationParam: makeHueDecoration
                        (
                            `latest.token:${validLatestToken}`,
                            hash(validLatestToken),
                            Clairvoyant.latestHighlightAlpha,
                            Clairvoyant.latestHighlightOverviewRulerLane.get(""),
                            false
                        )
                    })
                )
            );
        }
        tokens.filter(i => latestToken !== i).forEach
        (
            token => entries = entries.concat
            (
                (tokenHits[Clairvoyant.encodeToken(token)] || []).map
                (
                    hit =>
                    ({
                        range: Selection.make(document, hit, token),
                        decorationParam: makeHueDecoration
                        (
                            `token:${token}`,
                            hash(token),
                            Clairvoyant.highlightAlpha,
                            Clairvoyant.highlightOverviewRulerLane.get(""),
                            false
                        )
                    })
                )
            )
        );
        
        entries.forEach(i => addDecoration(i));
        Profiler.profile
        (
            "Highlight.updateEditor.apply",
            () => Object.keys(decorations)
                .map(i => decorations[i])
                .forEach
                (
                    i => textEditor.setDecorations(i.decorator, i.rangesOrOptions)
                )
        );
    }
);
