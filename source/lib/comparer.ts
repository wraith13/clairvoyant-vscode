export const simple = <valueT>(a: valueT, b: valueT) =>
    a < b ? -1:
    b < a ? 1:
    0;
export const make = <objectT, valueT>(getValue: (object: objectT) => valueT) => (a: objectT, b: objectT) => simple(getValue(a), getValue(b));
export const string = (a: string, b: string) =>
    a.toLowerCase() < b.toLowerCase() ? -1:
    b.toLowerCase() < a.toLowerCase() ? 1:
    simple(a, b);
export const merge = <valueT>(comparerList: ((a: valueT, b: valueT) => number)[]) => (a: valueT, b: valueT) =>
{
    let result = 0;
    for(let i = 0; i < comparerList.length && 0 === result; ++i)
    {
        result = comparerList[i](a, b);
    }
    return result;
};
