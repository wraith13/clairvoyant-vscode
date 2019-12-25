import * as vscode from 'vscode';

import * as Profiler from "../lib/profiler";

import * as Clairvoyant from "../clairvoyant";
import * as Menu from '../ui/menu';

export const make = (document: vscode.TextDocument, index: number, token: string) => Profiler.profile
(
    "Selection.make",
    () => new vscode.Selection(document.positionAt(index), document.positionAt(index +token.length))
);
export const toString = (selection: vscode.Range | vscode.Position | number): string =>
{
    if (selection instanceof vscode.Range)
    {
        if (selection.start.line !== selection.end.line)
        {
            return `${toString(selection.start)} - ${toString(selection.end)}`;
        }
        else
        if (selection.start.character !== selection.end.character)
        {
            return `${toString(selection.start)}-${toString(selection.end.character)}`;
        }
        else
        {
            return toString(selection.start);
        }
    }
    else
    if (selection instanceof vscode.Position)
    {
        return `line:${toString(selection.line)} row:${toString(selection.character)}`;
    }
    else
    {
        return `${selection +1}`;
    }
};
export const makeWhole = (document: vscode.TextDocument) => Profiler.profile
(
    "Selection.makeWhole",
    () => new vscode.Selection(document.positionAt(0), document.positionAt(document.getText().length))
);

let lastValidViemColumn: number = 1;
export const setLastValidViemColumn = (viewColumn: number) => lastValidViemColumn = viewColumn;
export const getLastValidViemColumn = () => lastValidViemColumn;
export const getLastTextEditor = <resultT = vscode.TextEditor>(getter: (textEditor: vscode.TextEditor) => resultT = (i => <any>i)) =>
    vscode.window.visibleTextEditors.filter(i => i.viewColumn === getLastValidViemColumn()).map(getter)[0];

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

class Entry
{
    showTokenUndoBuffer: ShowTokenDoEntry[] = [];
    showTokenRedoBuffer: ShowTokenDoEntry[] = [];
    backupTargetTextEditor: vscode.TextEditor | undefined = undefined;
    groundBackupSelectionEntry: ShowTokenCoreEntry | null = null;
    targetBackupSelectionEntry: ShowTokenCoreEntry | null = null;
    lastPreviewSelectionEntry: ShowTokenCoreEntry | null = null;
    previewViewColumn: vscode.ViewColumn = 1;

    public constructor(public viewColumn: string) { }

    public showTextDocumentWithBackupSelection = async (document: vscode.TextDocument) =>
    {
        Clairvoyant.outputLine("verbose", `Selection.Entry(${this.viewColumn}).showTextDocumentWithBackupSelection() is called.`);
        this.previewViewColumn = getLastValidViemColumn();
        this.groundBackupSelectionEntry = makeShowTokenCoreEntry();
        if (this.groundBackupSelectionEntry && this.groundBackupSelectionEntry.document.uri.toString() === document.uri.toString())
        {
            this.targetBackupSelectionEntry = null;
        }
        else
        {
            await vscode.window.showTextDocument(document, this.previewViewColumn);
            this.targetBackupSelectionEntry = makeShowTokenCoreEntry();
        }
        this.lastPreviewSelectionEntry = null;
        this.backupTargetTextEditor = vscode.window.activeTextEditor;
    }
    public previewSelection = (entry: { document: vscode.TextDocument, selection: vscode.Selection }) =>
    {
        const textEditor = vscode.window.visibleTextEditors.filter(i => i.viewColumn === this.previewViewColumn)[0];
        if (textEditor)
        {
            revealSelection(textEditor, entry.selection);
            this.lastPreviewSelectionEntry = entry;
        }
    }

    public rollbackSelection = async () =>
    {
        Clairvoyant.outputLine("verbose", `Selection.Entry(${this.viewColumn}).rollbackSelection() is called.`);
        if (this.lastPreviewSelectionEntry)
        {
            if (Clairvoyant.enablePreviewIntercept.get(""))
            {
                const currentSelectionEntry = makeShowTokenCoreEntry();
                if
                (
                    currentSelectionEntry &&
                    this.lastPreviewSelectionEntry.document.uri.toString() === currentSelectionEntry.document.uri.toString() &&
                    !this.lastPreviewSelectionEntry.selection.isEqual(currentSelectionEntry.selection) &&
                    this.backupTargetTextEditor === vscode.window.activeTextEditor
                )
                {
                    this.targetBackupSelectionEntry = null;
                    this.groundBackupSelectionEntry = null;
    
                    const data =
                    {
                        entry: this.lastPreviewSelectionEntry,
                    };
                    setTimeout
                    (
                        () => this.previewSelection(data.entry),
                        0
                    );
                }
            }
            this.lastPreviewSelectionEntry = null;
        }
        
        if (this.targetBackupSelectionEntry)
        {
            this.previewSelection(this.targetBackupSelectionEntry);
            this.targetBackupSelectionEntry = null;
        }
        if (this.groundBackupSelectionEntry)
        {
            showSelection
            (
                this.groundBackupSelectionEntry,
                await vscode.window.showTextDocument
                (
                    this.groundBackupSelectionEntry.document,
                    this.backupTargetTextEditor ?
                    this.backupTargetTextEditor.viewColumn:
                        undefined
                )
            );
            this.groundBackupSelectionEntry = null;
        }
        this.backupTargetTextEditor = undefined;
    }
    public dispose = async (commitable: boolean) =>
    {
        if (!commitable)
        {
            this.rollbackSelection();
        }
    }
    public showToken = async (entry: { document: vscode.TextDocument, selection: vscode.Selection }) =>
    {
        Clairvoyant.outputLine("verbose", `Selection.Entry(${this.viewColumn}).showToken() is called.`);
        this.showTokenUndoBuffer.push
        ({
            redo: entry,
            undo: this.groundBackupSelectionEntry || makeShowTokenCoreEntry(),
        });
        showSelection(entry);
        this.showTokenRedoBuffer.splice(0, 0);
        onUpdateHistory();
    }
    public showTokenUndo = async () =>
    {
        Clairvoyant.outputLine("verbose", `Selection.Entry(${this.viewColumn}).showTokenUndo() is called.`);
        const entry = this.showTokenUndoBuffer.pop();
        if (entry)
        {
            if (entry.undo)
            {
                showSelection(entry.undo);
            }
            this.showTokenRedoBuffer.push(entry);
            onUpdateHistory();
        }
    }
    public showTokenRedo = async () =>
    {
        Clairvoyant.outputLine("verbose", `Selection.Entry(${this.viewColumn}).showTokenRedo() is called.`);
        const entry = this.showTokenRedoBuffer.pop();
        if (entry)
        {
            entry.undo = makeShowTokenCoreEntry() || entry.undo;
            showSelection(entry.redo);
            this.showTokenUndoBuffer.push(entry);
            onUpdateHistory();
        }
    }
}

const entryMap: { [viewColumn: string]: Entry } = { };
export const getEntry = () =>
{
    const key = Clairvoyant.gotoHistoryMode.get("")(lastValidViemColumn);
    if (!entryMap[key])
    {
        entryMap[key] = new Entry(key);
    }
    return entryMap[key];
};

const revealSelection = (textEditor: vscode.TextEditor, selection: vscode.Selection) =>
{
    textEditor.selection = selection;
    textEditor.revealRange(selection, Clairvoyant.textEditorRevealType.get(textEditor.document.languageId));
};
const showSelection = async (entry: { document: vscode.TextDocument, selection: vscode.Selection }, textEditor?: vscode.TextEditor ) =>
{
    revealSelection(textEditor || await vscode.window.showTextDocument(entry.document), entry.selection);
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
const onUpdateHistory = () =>
{
    Clairvoyant.outputLine("verbose", `onUpdateHistory() is called.`);
    Menu.removeCache(`root.full`);
};

export const reload = () =>
{
    Object.keys(entryMap).forEach(i => delete entryMap[i]);
};

export module Log
{
    const latests: {[viemColumn: number]:{ [uri: string]: vscode.Selection }} = { };
    const recentDocuments: {[viemColumn: number]: string[] } = { };

    export const getLatest = (viemColumn: number, uri: string) =>
    {
        const documentSelectionMap = latests[viemColumn];
        if (undefined !== documentSelectionMap)
        {
            const selection = documentSelectionMap[uri];
            if (undefined !== selection)
            {
                return selection;
            }
        }
        return undefined;
    };
    export const update = (current: vscode.TextEditor) =>
    {
        if (undefined !== current.viewColumn)
        {
            const uri = current.document.uri.toString();
            if (undefined === latests[current.viewColumn])
            {
                latests[current.viewColumn] = { };
            }
            latests[current.viewColumn][uri] = current.selection;

            if (undefined === recentDocuments[current.viewColumn])
            {
                recentDocuments[current.viewColumn] = [ ];
            }
            recentDocuments[current.viewColumn] = [uri].concat(recentDocuments[current.viewColumn].filter(i => i !== uri));
        }
    };
}

export module PreviewTextEditor
{
    let IsLunatic: boolean;

    export const make = async () =>
    {
        IsLunatic =
            !vscode.workspace.getConfiguration("workbench.editor")["enablePreview"] &&
            Clairvoyant.enableLunaticPreview.get("");
        IsLunatic ?
            LunaticPreviewTextEditor.make():
            RegularPreviewTextEditor.make();
    };
    export const show = async (previewDocument: vscode.TextDocument | undefined) => IsLunatic ?
        LunaticPreviewTextEditor.show(previewDocument):
        RegularPreviewTextEditor.show(previewDocument);
    export const dispose = async (commitable: boolean) => IsLunatic ?
        LunaticPreviewTextEditor.dispose(commitable):
        RegularPreviewTextEditor.dispose(commitable);
}

export module LunaticPreviewTextEditor
{
    let backupDocument: vscode.TextDocument | undefined;
    let lastPreviewDocument: vscode.TextDocument | undefined;
    let document: vscode.TextDocument;
    let textEditor: vscode.TextEditor;
    let viewColumn: vscode.ViewColumn;

    export const make = async () =>
    {
        viewColumn = lastValidViemColumn;
        const oldTextEditor = getLastTextEditor();
        backupDocument = oldTextEditor ? oldTextEditor.document: undefined;
        document = await vscode.workspace.openTextDocument();
        textEditor = await vscode.window.showTextDocument(document, { viewColumn, preserveFocus:true, preview:true });
        if (backupDocument)
        {
            await show(backupDocument);
        }
    };
    export const show = async (previewDocument: vscode.TextDocument | undefined) =>
    {
        lastPreviewDocument = previewDocument;
        const targetDocument = previewDocument || backupDocument;
        if (undefined !== targetDocument)
        {
            await textEditor.edit(editBuilder => editBuilder.replace(makeWhole(document), targetDocument.getText()));
            await vscode.languages.setTextDocumentLanguage(document, targetDocument.languageId);
            revealSelection
            (
                textEditor,
                Log.getLatest(viewColumn, targetDocument.uri.toString()) ||
                new vscode.Selection(document.positionAt(0), document.positionAt(0))
            );
        }
    };
    export const dispose = async (commitable: boolean) =>
    {
        textEditor = await vscode.window.showTextDocument(document, viewColumn);
        await textEditor.edit(editBuilder => editBuilder.delete(makeWhole(document)));
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

        if (undefined !== lastPreviewDocument && commitable)
        {
            await vscode.window.showTextDocument(lastPreviewDocument, viewColumn);
            revealSelection
            (
                textEditor,
                Log.getLatest(viewColumn, lastPreviewDocument.uri.toString()) ||
                new vscode.Selection(lastPreviewDocument.positionAt(0), lastPreviewDocument.positionAt(0))
            );
        }
    };
}
export module RegularPreviewTextEditor
{
    let backupDocument: vscode.TextDocument | undefined;
    let lastPreviewDocument: vscode.TextDocument | undefined;
    let viewColumn: vscode.ViewColumn;

    export const make = async () =>
    {
        viewColumn = lastValidViemColumn;
        const oldTextEditor = getLastTextEditor();
        backupDocument = oldTextEditor ? oldTextEditor.document: undefined;
    };
    export const show = async (previewDocument: vscode.TextDocument | undefined) =>
    {
        lastPreviewDocument = previewDocument;
        const targetDocument = previewDocument || backupDocument;
        if (undefined !== targetDocument)
        {
            const textEditor = await vscode.window.showTextDocument(targetDocument, { viewColumn, preserveFocus:true, preview:true });
            revealSelection
            (
                textEditor,
                Log.getLatest(viewColumn, targetDocument.uri.toString()) ||
                new vscode.Selection(targetDocument.positionAt(0), targetDocument.positionAt(0))
            );
        }
    };
    export const dispose = async (commitable: boolean) =>
    {
        if (backupDocument !== lastPreviewDocument)
        {
            if (commitable)
            {
                if (undefined !== lastPreviewDocument)
                {
                    await vscode.window.showTextDocument(lastPreviewDocument, { viewColumn, preview:false });
                }
            }
            else
            {
                if (undefined !== backupDocument)
                {
                    await vscode.window.showTextDocument(backupDocument, viewColumn);
                }
            }
        }
    };
}