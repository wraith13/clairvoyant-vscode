import * as vscode from 'vscode';
import packageJson from "../../package.json";
export const properties = Object.freeze(packageJson.contributes.configuration[0].properties);

export const applicationKey = packageJson.name;

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
    public getCache = (key: keyT): valueT => this.cache[JSON.stringify(key)];
    public clear = () => this.cache = { };
}
export class Entry<valueT>
{
    public defaultValue: valueT;
    public minValue: valueT | undefined;
    public maxValue: valueT | undefined;

    public constructor
    (
        public name: string,
        public validator?: (value: valueT) => boolean
    )
    {
        this.defaultValue = (<any>properties)[`${applicationKey}.${name}`].default;
        this.minValue = (<any>properties)[`${applicationKey}.${name}`].minimum;
        this.maxValue = (<any>properties)[`${applicationKey}.${name}`].maximum;
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
    public getCache = this.cache.getCache;
    public clear = this.cache.clear;
}
export class MapEntry<ObjectT>
{
    public constructor
    (
        public name: string,
        public mapObject: ObjectT
    )
    {
    }

    config = new Entry<keyof ObjectT>(this.name, makeEnumValidator(this.mapObject));
    public get = (key: string) => this.mapObject[this.config.cache.get(key)];
    public getCache = (key: string) => this.mapObject[this.config.cache.getCache(key)];
    public clear = this.config.cache.clear;
}

export const makeEnumValidator = <ObjectT>(mapObject: ObjectT): (value: keyof ObjectT) => boolean => (value: keyof ObjectT): boolean => 0 <= Object.keys(mapObject).indexOf(value.toString());
export const stringArrayValidator = (value: string[]) => "[object Array]" === Object.prototype.toString.call(value) && value.map(i => "string" === typeof i).reduce((a, b) => a && b, true);

