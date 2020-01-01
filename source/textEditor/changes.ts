import * as vscode from 'vscode';
import * as Comparer from "../lib/comparer";
import * as Clairvoyant from "../clairvoyant";
export const cache: { [uri: string]: vscode.Selection[]} = { };
export const removeCache = (key: string) =>
{
    Clairvoyant.outputLine("verbose", `Change.removeCache("${key}") is called.`);
    Object.keys(cache).filter(i => i.startsWith(key)).forEach(i => delete cache[i]);
    return key;
};
export const getCacheOrMake = async (textEditor: vscode.TextEditor, itemMaker: (textEditor: vscode.TextEditor) => Promise<vscode.Selection[]>) =>
{
    const uri = textEditor.document.uri.toString();
    if (!cache[uri])
    {
        cache[uri] = await itemMaker(textEditor);
    }
    return cache[uri];
};
export const get = async (): Promise<vscode.Selection[]>  => vscode.window.activeTextEditor ?
    await getCacheOrMake
    (
        vscode.window.activeTextEditor,
        async (textEditor: vscode.TextEditor) =>
        {
            const result: vscode.Selection[] = [];
            const backup = textEditor.selections;
            const first = JSON.stringify(textEditor.selection);
            while(true)
            {
                await vscode.commands.executeCommand("workbench.action.editor.nextChange");
                const json = JSON.stringify(textEditor.selection);
                if
                (
                    first !== json &&
                    result.filter(i => JSON.stringify(i) === json).length <= 0
                )
                {
                    result.push(textEditor.selection);
                }
                else
                {
                    break;
                }
            }
            result.sort
            (
                Comparer.merge
                ([
                    Comparer.make(i => i.start.line),
                    Comparer.make(i => i.start.character),
                    Comparer.make(i => i.end.line),
                    Comparer.make(i => i.end.character),
                ])
            );
            textEditor.selections = backup;
            return result;
        }
    ):
    [];
