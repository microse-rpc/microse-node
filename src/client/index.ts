import { ModuleProxy } from "../header";
import { ModuleProxy as ModuleProxyBase, createModuleProxy } from "./proxy";
import { ChannelOptions, RpcChannel } from '../rpc/channel';
import { RpcClient, ClientOptions } from "../rpc/client";
import { dict } from "../util";
import define from "@hyurl/utils/define";

export {
    RpcChannel,
    ChannelOptions,
    RpcClient,
    ClientOptions,
    createModuleProxy,
    ModuleProxy
};

export class ModuleProxyApp extends ModuleProxyBase {
    protected remoteSingletons = dict();
    protected __children = dict();

    constructor(readonly name: string) {
        super();
        define(this, "remoteSingletons", dict());
    }

    /**
     * Connects to an RPC server according to the given URL or Unix socket
     * filename.
     */
    connect(url: string, immediate?: boolean): Promise<RpcClient>;
    /** Connects to an RPC server according to the given options. */
    connect(options: ClientOptions, immediate?: boolean): Promise<RpcClient>;
    async connect(options: string | ClientOptions, immediate = true) {
        let client = new RpcClient(<any>options);
        immediate && (await client.open());
        return client;
    }
}
