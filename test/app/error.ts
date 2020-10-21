import define from "@hyurl/utils/define";

export default class MyError extends Error {
    constructor(message: string) {
        super(message);
    }

    get name() {
        return this.constructor.name;
    }
}

define(global, "MyError", MyError);
