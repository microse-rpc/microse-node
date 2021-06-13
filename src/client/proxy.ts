import { applyMagic } from "js-magic";
import values = require("lodash/values");
import define from "@hyurl/utils/define";
import isEmpty from "@hyurl/utils/isEmpty";
import type { ModuleProxyApp } from ".";
import {
    root,
    readyState,
    evalRouteId,
    throwUnavailableError,
    dict
} from "../util";

/**
 * Creates a module proxy manually.
 */
export function createModuleProxy(
    name: string,
    app: ModuleProxyApp
): ModuleProxy {
    let proxy: ModuleProxy = <any>function (...args: any[]) {
        if (new.target) {
            throw new TypeError(`${name} is not a constructor`);
        } else {
            let index = name.lastIndexOf(".");
            let modName = name.slice(0, index);
            let method = name.slice(index + 1);
            let singletons = app["remoteSingletons"][modName];

            if (!isEmpty(singletons)) {
                let route = args[0] || "";
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
                        // instances, redirect traffic to one of them automatically
                        // according to the route.
                        let id = evalRouteId(route);
                        ins = _singletons[id % count];
                    }
                }

                if (ins) {
                    return ins[method](...args);
                }
            }

            throwUnavailableError(modName);
        }
    };

    Object.setPrototypeOf(proxy, ModuleProxy.prototype);
    define(proxy, "name", name);
    define(proxy, "__children", dict());

    proxy[root] = app;
    proxy[Symbol.toStringTag] = "ModuleProxy";
    proxy[Symbol.hasInstance] = function ModuleProxy(_: any) {
        return false;
    };

    return applyMagic(<any>proxy, true);
}

@applyMagic
export abstract class ModuleProxy {
    abstract readonly name: string;
    protected abstract __children: { [name: string]: ModuleProxy; };

    get path(): string {
        return void 0;
    }

    get exports() {
        return null;
    }

    get proto() {
        return null;
    }

    get ctor() {
        return null;
    }

    protected __get(prop: string) {
        if (prop in this) {
            return this[prop];
        } else if (prop in this.__children) {
            return this.__children[prop];
        } else if (typeof prop != "symbol") {
            return this.__children[prop] = createModuleProxy(
                this.name + "." + String(prop),
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
