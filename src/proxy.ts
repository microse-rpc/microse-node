import { sep, dirname, basename, extname, normalize } from "path";
import { applyMagic } from "js-magic";
import { ModuleLoader } from './index';
import { readdirSync } from 'fs';
import cloneDeep = require("lodash/cloneDeep");
import merge = require("lodash/merge");
import values = require("lodash/values");
import typeOf from "@hyurl/utils/typeOf";
import define from "@hyurl/utils/define";
import isEmpty from "@hyurl/utils/isEmpty";
import type { ModuleProxyApp } from ".";
import {
    dict,
    root,
    throwUnavailableError,
    readyState,
    evalRouteId,
    getInstance
} from './util';

const cmd = process.execArgv.concat(process.argv).join(" ");
const isTsNode = cmd.includes("ts-node");
export const defaultLoader: ModuleLoader = {
    extension: isTsNode ? ".ts" : ".js",
    cache: require.cache,
    load: require,
    unload(filename) {
        delete this.cache[filename];
    }
};

/** Creates a module proxy. */
export function createModuleProxy(
    name: string,
    path: string,
    app: ModuleProxyApp
): ModuleProxy {
    let proxy: ModuleProxy = <any>function (...args: any[]) {
        if (new.target) {
            if (proxy.ctor) {
                return new proxy.ctor(...args);
            } else if (proxy.proto) {
                return merge(cloneDeep(proxy.proto), args[0]);
            } else {
                throw new TypeError(`${name} is not a constructor`);
            }
        } else {
            let index = name.lastIndexOf(".");
            let modName = name.slice(0, index);
            let method = name.slice(index + 1);
            let singletons = app["remoteSingletons"][modName];

            if (!isEmpty(singletons)) {
                let route = args[0] ?? "";
                let ins: any;

                // If the route matches any key of the remoteSingletons,
                // return the corresponding singleton as wanted.
                if (typeof route === "string" && singletons[route]) {
                    ins = singletons[route];
                } else {
                    let _singletons = values(singletons)
                        .filter(s => s[readyState]);
                    let count = _singletons.length;

                    if (count === 1) {
                        ins = _singletons[0];
                    } else if (count >= 2) {
                        // If the module is connected to more than one remote
                        // instances, redirect traffic to one of them
                        // automatically according to the route.
                        let id = evalRouteId(route);
                        ins = _singletons[id % count];
                    }
                }

                if (ins) {
                    return ins[method](...args);
                } else {
                    throwUnavailableError(modName);
                }
            } else {
                let ins = getInstance(app, modName);

                if (typeof ins?.[method] === "function") {
                    return ins[method](...args);
                } else {
                    throw new TypeError(`${name} is not a function`);
                }
            }
        }
    };

    Object.setPrototypeOf(proxy, ModuleProxy.prototype);
    define(proxy, "name", name);
    define(proxy, "path", normalize(path), true);
    define(proxy, "__children", dict());

    app["__cache"][name] = proxy;
    proxy[root] = app;
    proxy[Symbol.toStringTag] = "ModuleProxy";
    proxy[Symbol.hasInstance] = function ModuleProxy(ins: any) {
        return ins instanceof proxy.ctor;
    };

    return applyMagic(<any>proxy, true);
}


@applyMagic
export abstract class ModuleProxy {
    abstract readonly name: string;
    readonly path: string;
    protected __children: { [name: string]: ModuleProxy; };

    get exports(): any {
        let loader: ModuleLoader = this[root]?.loader;

        if (typeof loader.extension === "string") {
            return loader.load(this.path + loader.extension);
        } else {
            let dir = dirname(this.path);
            let name = basename(this.path);
            let files = readdirSync(dir);

            for (let file of files) {
                let ext = extname(file);
                let _name = basename(file, ext);

                if (_name === name && loader.extension.includes(ext)) {
                    return loader.load(this.path + ext);
                }
            }

            throw new Error(`Cannot find module '${this.path}'`);
        }
    }

    get proto(): any {
        let { exports } = this;

        if (typeof exports === "object") {
            if (typeof exports.default === "object") {
                return exports.default;
            } else if (typeOf(exports.default) === "class") {
                return exports.default.prototype;
            }

            return exports;
        } else if (typeOf(exports) === "class") {
            return exports.prototype;
        } else {
            return null;
        }
    }

    get ctor(): new (...args: any[]) => any {
        let { exports } = this;

        if (typeof exports === "object" && typeOf(exports.default) === "class") {
            return exports.default;
        } else if (typeOf(exports) === "class") {
            return exports;
        } else {
            return null;
        }
    }

    protected __get(prop: string) {
        if (prop in this) {
            return this[prop];
        } else if (prop in this.__children) {
            return this.__children[prop];
        } else if (typeof prop != "symbol") {
            return this.__children[prop] = createModuleProxy(
                this.name + "." + String(prop),
                this.path + sep + String(prop),
                this[root] || this
            );
        }
    }

    protected __has(prop: string) {
        return (prop in this) || (prop in this.__children);
    }

    toString() {
        return this.name;
    }

    toJSON() {
        return this.name;
    }
}

