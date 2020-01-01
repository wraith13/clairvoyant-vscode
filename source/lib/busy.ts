const timeout = (wait: number) => new Promise((resolve) => setTimeout(resolve, wait));
export class Entry
{
    busyStackCount = 0;
    public constructor(public stateReceiver: (entry: Entry) => void)
    {
    }
    public do = async <valueT>(busyFunction: () => valueT) =>
    {
        try
        {
            await this.incrementBusy();
            return busyFunction();
        }
        finally
        {
            await this.decrementBusy();
        }
    }
    public doAsync = async <valueT>(busyFunction: () => Promise<valueT>) =>
    {
        try
        {
            await this.incrementBusy();
            return await busyFunction();
        }
        finally
        {
            await this.decrementBusy();
        }
    }
    public isBusy = () => 0 < this.busyStackCount;
    incrementBusy = async () =>
    {
        if (this.isBusy())
        {
            ++this.busyStackCount;
        }
        else
        {
            ++this.busyStackCount;
            await this.updateState();
        }
    }
    decrementBusy = async () =>
    {
        --this.busyStackCount;
        if (!this.isBusy())
        {
            await this.updateState();
        }
    }
    public updateState = async () =>
    {
        this.stateReceiver(this);
        await timeout(1);
    }
}
