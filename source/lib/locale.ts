import localeEn from "../../package.nls.json";
import localeJa from "../../package.nls.ja.json";

export type KeyType = keyof typeof localeEn;

interface LocaleEntry
{
    [key : string] : string;
}
const localeTableKey = <string>JSON.parse(<string>process.env.VSCODE_NLS_CONFIG).locale;
const localeTable = Object.assign(localeEn, ((<{[key : string] : LocaleEntry}>{
    ja : localeJa
})[localeTableKey] || { }));
export const string = (key : string) : string => localeTable[key] || key;
export const map = (key : KeyType) : string => string(key);