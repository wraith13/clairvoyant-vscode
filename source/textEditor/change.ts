import * as vscode from 'vscode';

export const get = async (): Promise<vscode.Selection[]>  =>
{
    const result: vscode.Selection[] = [];
    const textEditor = vscode.window.activeTextEditor;
    if (textEditor)
    {
        const backup = textEditor.selections;
        const first = textEditor.selection;

        while(true)
        {
            await vscode.commands.executeCommand("workbench.action.editor.nextChange");
            if (first.start !== textEditor.selection.start && 0 <= result.filter(i => i.start === textEditor.selection.start).length)
            {
                result.push(textEditor.selection);
            }
            else
            {
                break;
            }
        }
        textEditor.selections = backup;
    }
    return result;
};

