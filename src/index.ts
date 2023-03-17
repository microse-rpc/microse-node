import { extname, resolve, sep } from "path";
import { watch, FSWatcher } from "chokidar";
import once = require("lodash/once");
import define from "@hyurl/utils/define";
import { ChannelOptions, RpcChannel } from './rpc/channel';
import { RpcClient, ClientOptions } from "./rpc/client";
import { RpcServer, ServerOptions } from "./rpc/server";
import { ModuleProxy, ModuleLoader } from "./header";
import {
    ModuleProxy as ModuleProxyBase,
    createModuleProxy,
    defaultLoader
} from "./proxy";
import { server, dict, tryLifeCycleFunction, findDependents } from './util';

export {
    ChannelOptions,
    RpcChannel,
    RpcServer,
    RpcClient,
    ServerOptions,
    ClientOptions,
    FSWatcher,
    findDependents,
    createModuleProxy,
    ModuleProxy,
    ModuleLoader
};

export class ModuleProxyApp extends ModuleProxyBase {
    private [server]: RpcServer = null;
    protected singletons = dict();
    protected remoteSingletons = dict();
    protected __cache: object;
    protected loader: ModuleLoader;

    constructor(
        readonly name: string,
        path: string,
        loader = defaultLoader
    ) {
        super();
        define(this, "path", resolve(path), true);
        define(this, "loader", loader);
        define(this, "__children", dict());
        define(this, "__cache", dict());
    }

    /**
     * Serves an RPC server according to the given URL or Unix socket filename.
     */
    serve(url: string): Promise<RpcServer>;
    /** Serves an RPC server according to the given options. */
    serve(options: ServerOptions): Promise<RpcServer>;
    async serve(options: string | ServerOptions) {
        this[server] = new RpcServer(<any>options);
        this[server]["proxyRoot"] = this;
        await this[server].open();
        return this[server];
    }

    /**
     * Connects to an RPC server according to the given URL or Unix socket
     * filename.
     */
    connect(url: string): Promise<RpcClient>;
    /** Connects to an RPC server according to the given options. */
    connect(options: ClientOptions): Promise<RpcClient>;
    async connect(options: string | ClientOptions) {
        let client = new RpcClient(<any>options);
        await client.open();
        return client;
    }

    /** Resolves the given path to a module name. */
    resolve(path: string): string {
        path = resolve(path);
        let dir = this.path + sep;

        if (path.startsWith(dir)) {
            let modPath = path.slice(dir.length),
                ext = extname(modPath);

            if (Array.isArray(this.loader.extension)) {
                if (this.loader.extension.includes(ext)) {
                    modPath = modPath.slice(0, -ext.length);
                } else {
                    return;
                }
            } else if (ext === this.loader.extension) {
                modPath = modPath.slice(0, -ext.length);
            } else if (ext) {
                return;
            }

            return this.name + "." + modPath.replace(/\\|\//g, ".");
        } else {
            return;
        }
    }

    /**
     * Watches file changes and reload the corresponding module.
     * @param listener Additional listener function for the file's `change` and
     *  `unlink` events.
     * @param reloadDependents Reload all the dependent files that rely on the 
     *  changed file as well. NOTE: This is experimental, and will not trigger
     *  life cycle functions in the dependents if they have any. By default,
     *  only the files in the same directory of the root proxy app will be
     *  searched, we can set a function to expand this limit if wanted.
     */
    watch(
        listener?: (event: "change" | "unlink", filename: string) => void,
        reloadDependents: boolean | ((files: string[]) => string[]) = false
    ) {
        let { path } = this;
        let clearCache = async (
            event: "change" | "unlink",
            filename: string,
            cb: Parameters<ModuleProxyApp["watch"]>[0]
        ) => {
            const jobs = [this.unload(filename)];

            if (this.loader.cache === require.cache && reloadDependents) {
                const dir = path + sep;
                const dependents = typeof reloadDependents === "function"
                    ? findDependents(filename, reloadDependents)
                    : findDependents(
                        filename,
                        files => files.filter(file => file.startsWith(dir))
                    );

                // unload all dependents
                jobs.push(...dependents.map(file => this.unload(file)));
            }

            await Promise.all(jobs);
            cb && cb(event, filename);
        };

        return watch(path, {
            awaitWriteFinish: true,
            followSymlinks: false,
            ignored: (file: string) => {
                let ext = extname(file);

                if (!ext) {
                    return false;
                } else if (typeof this.loader.extension === "string") {
                    return this.loader.extension !== ext;
                } else {
                    return !this.loader.extension.includes(ext);
                }
            }
        }).on("change", (filename) => {
            clearCache("change", filename, listener);
        }).on("unlink", (filename) => {
            clearCache("unlink", filename, listener);
        }).on("unlinkDir", dirname => {
            dirname = dirname + sep;

            if (this.loader.cache) {
                for (let filename in this.loader.cache) {
                    if (filename.startsWith(dirname)) {
                        clearCache("unlink", filename, listener);
                    }
                }
            }
        });
    }

    /**
     * Unloads the module from the cache, if the module is served as a singleton,
     * unloads the instance as well.
     */
    async unload(filename: string) {
        let name = this.resolve(filename);

        if (name && this.singletons[name]) {
            let tryUnload = once(() => {
                delete this.singletons[name];
                this.loader.unload(filename);
            });

            try {
                if (this[server] &&
                    !this[server]["disableLifeCycle"] &&
                    this[server]["registry"][name]
                ) {
                    let mod = this[server]["registry"][name];
                    let handleError = this[server]["handleError"];
                    await tryLifeCycleFunction(mod, "destroy", handleError);
                    tryUnload();
                    await tryLifeCycleFunction(mod, "init", handleError);
                } else {
                    tryUnload();
                }
            } catch (err) {
                console.error(err);
                tryUnload();
            }
        } else {
            this.loader.unload(filename);
        }
    }

    /** Sets a custom loader to resolve the module. */
    setLoader(loader: ModuleLoader) {
        define(this, "loader", loader);
    }
}

export default ModuleProxy;
