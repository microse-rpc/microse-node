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
import { server, dict, tryLifeCycleFunction, } from './util';

export {
    ChannelOptions,
    RpcChannel,
    RpcServer,
    RpcClient,
    ServerOptions,
    ClientOptions,
    FSWatcher,
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

    /** Watches file change and reload the corresponding module. */
    watch(listener?: (event: "change" | "unlink", filename: string) => void) {
        let { path } = this;
        let clearCache = async (
            event: "change" | "unlink",
            filename: string,
            cb: Parameters<ModuleProxyApp["watch"]>[0]
        ) => {
            let name = this.resolve(filename);

            if (name && this.singletons[name]) {
                let tryUnload = once(() => {
                    delete this.singletons[name];
                    this.loader.unload(filename);
                });

                try {
                    if (this[server] &&
                        this[server]["enableLifeCycle"] &&
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

    /** Sets a custom loader to resolve the module. */
    setLoader(loader: ModuleLoader) {
        define(this, "loader", loader);
    }
}

export default ModuleProxy;
