import * as vscode from 'vscode';

import * as Profiler from "../lib/profiler";

import * as Clairvoyant from "../clairvoyant";
import * as Menu from '../ui/menu';

export const make = (document: vscode.TextDocument, index: number, token: string) => Profiler.profile
(
    "Selection.make",
    () => new vscode.Selection(document.positionAt(index), document.positionAt(index +token.length))
);

let lastValidViemColumn: number = 1;
export const setLastValidViemColumn = (viewColumn: number) => lastValidViemColumn = viewColumn;

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

    public constructor(public viewColumn: string) { }

    public previewSelection = (entry: { document: vscode.TextDocument, selection: vscode.Selection }, textEditor = getPreviewTextEditor(entry.document)) =>
    {
        if (textEditor)
        {
            revealSelection(textEditor, entry.selection);
            this.lastPreviewSelectionEntry = entry;
        }
    }

    public showTextDocumentWithBackupSelection = async (document: vscode.TextDocument) =>
    {
        Clairvoyant.outputLine("verbose", `Selection.Entry(${this.viewColumn}).showTextDocumentWithBackupSelection() is called.`);
        this.groundBackupSelectionEntry = makeShowTokenCoreEntry();
        if (this.groundBackupSelectionEntry && this.groundBackupSelectionEntry.document.uri.toString() === document.uri.toString())
        {
            this.targetBackupSelectionEntry = null;
        }
        else
        {
            await vscode.window.showTextDocument(document);
            this.targetBackupSelectionEntry = makeShowTokenCoreEntry();
        }
        this.lastPreviewSelectionEntry = null;
        this.backupTargetTextEditor = vscode.window.activeTextEditor;
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
                        textEditor: this.backupTargetTextEditor,
                    };
                    setTimeout
                    (
                        () => this.previewSelection(data.entry, data.textEditor),
                        0
                    );
                }
            }
            this.lastPreviewSelectionEntry = null;
        }
        
        if (this.targetBackupSelectionEntry)
        {
            this.previewSelection(this.targetBackupSelectionEntry, this.backupTargetTextEditor);
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
