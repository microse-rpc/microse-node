import type * as _path from "path";
import hash = require("string-hash");
import type { ModuleProxy } from "./header";
import type { ModuleProxyApp } from ".";

var path: typeof _path;
export const root = Symbol("proxyRoot");
export const server = Symbol("server");

/**
 * - 0: not ready (default)
 * - 1: ready
 */
export const readyState = Symbol("readyState");

export function dict(): { [x: string]: any; } {
    return Object.create(null);
}

export function absPath(filename: string, withPipe = false): string {
    if (!/^\/|^[a-zA-Z]:[\\\/]/.test(filename) && typeof process === "object") {
        filename = (path ||= require("path")).resolve(process.cwd(), filename);
    }

    if (path?.sep) {
        filename = filename.replace(/\\|\//g, path.sep);
    }

    if (withPipe &&
        typeof process === "object" && process.platform === "win32" &&
        !/\\\\[.?]\\pipe\\/.test(filename)
    ) {
        filename = "\\\\?\\pipe\\" + filename;
    }

    return filename;
}

export function evalRouteId(value: any): number {
    value = value?.valueOf();
    let type = typeof value;

    switch (type) {
        case "number":
        case "boolean":
            return Number(value);

        case "string":
        case "symbol":
        case "bigint":
            return hash(String(value));

        case "function":
            return hash(String(value.name || value));

        case "object":
        case "undefined":
            if (value === null || value === undefined) {
                return 0;
            } else if (value instanceof RegExp || value instanceof Error) {
                return hash(String(value));
            } else if (value instanceof Map || value instanceof Set) {
                return value.size;
            } else if (Array.isArray(value)
                || value instanceof ArrayBuffer
                || value instanceof DataView
                || ArrayBuffer.isView(value)
            ) {
                return Number(value["byteLength"] || value["length"]);
            } else {
                return hash(formatObjectStructure(value));
            }
    }
}

export function formatObjectStructure(obj: object) {
    let token = "{";

    // Only iterate object properties shallowly.
    Object.keys(obj).sort().forEach((key, i) => {
        if (i !== 0) {
            token += "," + key;
        } else {
            token += key;
        }
    });

    return token + "}";
}

export function throwUnavailableError(name: string) {
    throw new ReferenceError(`Service ${name} is not available`);
}

export function createInstance(mod: ModuleProxy<any>, forRemote = false) {
    let ins: any;
    let { ctor, exports } = mod;

    if (ctor) {
        if (forRemote) {
            // Create instance without instantiating, used for remote instance.
            ins = Object.create(ctor.prototype);
        } else {
            return new mod();
        }
    } else if (typeof exports.default === "object") {
        ins = exports.default;
    } else {
        ins = exports;
    }

    return ins;
}

export function getInstance(app: ModuleProxyApp, modName: string) {
    return app["singletons"][modName] || (
        app["singletons"][modName] = createInstance(app["__cache"][modName])
    );
}

export async function tryLifeCycleFunction(
    mod: ModuleProxy<{ init?(): any, destroy?(): any; }>,
    fn: "init" | "destroy",
    errorHandle: (err: Error) => void = void 0
) {
    let ins = getInstance(mod[root], mod.name);

    if (fn === "init") {
        if (typeof ins.init === "function") {
            if (errorHandle) {
                try { await ins.init(); } catch (err) { errorHandle(err); }
            } else {
                await ins.init();
            }
        }

        ins[readyState] = 1; // ready
    } else if (fn === "destroy") {
        ins[readyState] = 0; // not ready

        if (typeof ins.destroy === "function") {
            if (errorHandle) {
                try { await ins.destroy(); } catch (err) { errorHandle(err); }
            } else {
                await ins.destroy();
            }
        }
    }
}
