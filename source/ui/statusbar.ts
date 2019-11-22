import * as vscode from 'vscode';

import * as Profiler from "../lib/profiler";
import * as Locale from "../lib/locale";

import * as Clairvoyant from "../clairvoyant";

const create =
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

let eyeLabel: vscode.StatusBarItem;

export const make = () => eyeLabel = create
({
    alignment: vscode.StatusBarAlignment.Right,
    text: "$(eye)",
    command: `clairvoyant.sight`,
    tooltip: Locale.string("clairvoyant.sight.title")
});

export const update = () : void => Profiler.profile
(
    "StatusBar.update",
    () =>
    {
        if (Clairvoyant.showStatusBarItems.get(""))
        {
            if (Clairvoyant.busy.isBusy())
            {
                eyeLabel.text = "$(sync~spin)";
                eyeLabel.tooltip = `Clairvoyant: ${Locale.string("clairvoyant.sight.busy")}`;
            }
            else
            {
                eyeLabel.text = "$(eye)";
                eyeLabel.tooltip = `Clairvoyant: ${Locale.string("clairvoyant.sight.title")}`;
            }
            eyeLabel.show();
        }
        else
        {
            eyeLabel.hide();
        }
    }
);
