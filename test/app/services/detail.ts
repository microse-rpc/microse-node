import MyError from "../error";
import sleep from "@hyurl/utils/sleep";
import * as fs from "fs-extra";
import { ModuleProxy } from "../../../src";

declare global {
    namespace app {
        namespace services {
            const detail: ModuleProxy<typeof Detail>;
        }
    }
}

export default class Detail {
    protected propFn: () => void;

    constructor(public name = "Mr. World") {
        this.propFn = () => { };
    }

    async setName(name: string) {
        this.name = name;
    }

    async getName() {
        return this.name;
    }

    async *getOrgs(...args: string[]) {
        yield "Mozilla";
        yield "GitHub";
        yield "Linux";
        return args;
    }

    async *repeatAfterMe(result?: any): AsyncIterableIterator<string> {
        let value = void 0;
        while (true) {
            value = yield value;

            if (value === "break")
                break;
        }

        return result;
    }

    async userError(): Promise<never> {
        throw new MyError("something went wrong");
    }

    async nonStandardError(): Promise<never> {
        throw "something went wrong";
    }

    async triggerTimeout() {
        await sleep(1500);
    }

    async setTime(time: number) {
        await fs.writeFile(__dirname + "/.tmp", String(time), "utf8");
    }

    async setAndGet(data: any) {
        return data;
    }

    async readFile(filename: string) {
        return await fs.readFile(filename, "utf8");
    }

    static getInstance() {
        return new this("Mr. World");
    }
}
