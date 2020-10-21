import { ModuleProxy } from "../../src";

declare global {
    namespace app {
        const simple: ModuleProxy<Simple>;
    }
}

export default class Simple {
    data: object;

    async init() {
        this.data = { foo: "hello", bar: "world" };
    }
}
