import getGlobal from "@hyurl/utils/getGlobal";
import type { ModuleProxy } from "../header";
import { absPath } from '../util';

export enum ChannelEvents {
    CONNECT = 1,
    INVOKE,
    RETURN,
    THROW,
    YIELD,
    PUBLISH,
    PING,
    PONG
}

export interface ChannelOptions {
    [x: string]: any;
    protocol?: "ws:" | "wss:" | "ws+unix:";
    hostname?: string;
    port?: number;
    pathname?: string;
    secret?: string;
    id?: string;
    codec?: "JSON" | "CLONE";
    key?: string | Buffer | Buffer[];
    cert?: string | Buffer | Buffer[];
    pfx?: string | Buffer | Buffer[];
    ca?: string | Buffer | Buffer[];
    passphase?: string;
}

export type Request = [ChannelEvents, number, string?, string?, any[]?];
export type Response = [ChannelEvents, number | string, any?];
const _URL: typeof URL = getGlobal("URL") || require("url").URL;

/** An RPC channel that allows modules to communicate remotely. */
export abstract class RpcChannel implements ChannelOptions {
    readonly protocol: ChannelOptions["protocol"] = "ws:";
    readonly hostname: string = "127.0.0.1";
    readonly port: number = 80;
    readonly pathname: string = "/";
    readonly codec: ChannelOptions["codec"];
    readonly secret?: string;
    readonly key?: string | Buffer | Buffer[];
    readonly cert?: string | Buffer | Buffer[];
    readonly pfx?: string | Buffer | Buffer[];
    readonly ca?: string | Buffer | Buffer[];
    readonly passphase?: string;
    protected handleError: (err: Error) => void = err => console.error(err);

    constructor(url: string);
    constructor(port: number, hostname?: string);
    constructor(options: ChannelOptions);
    constructor(options: string | number | ChannelOptions, hostname = "") {
        let isAbsPath: boolean;
        let isUnixSocket: boolean;

        if (typeof options === "object") {
            Object.assign(this, options);
        } else if (typeof options === "number") {
            this.port = options;
            this.hostname = hostname || this.hostname;
        } else { // typeof options === "string"
            let url = String(options);
            isAbsPath = url[0] === "/";

            if (/^[a-zA-Z]:[\\\/]/.test(url)) { // Windows absolute path
                url = "ws+unix:" + url;
                isAbsPath = true;
            }

            let { protocol, hostname, port, pathname, searchParams } = new _URL(
                url,
                "ws+unix://localhost:80"
            );
            let id = searchParams.get("id");
            let codec = searchParams.get("codec");
            let secret = searchParams.get("secret");
            isUnixSocket = protocol === "ws+unix:";

            Object.assign(this, <ChannelOptions>{
                protocol,
                hostname: isUnixSocket ? "" : hostname,
                port: isUnixSocket ? 0 : Number(port),
                id,
                codec,
                secret
            });

            if (isUnixSocket) {
                if (isAbsPath) {
                    this.pathname = pathname;
                } else if (pathname !== "/") {
                    this.pathname = absPath(pathname.slice(1), true);
                } else {
                    throw new Error("IPC requires a pathname");
                }
            } else {
                this.pathname = pathname;
            }
        }

        if (isUnixSocket &&
            typeof process === "object" && process.platform === "win32"
        ) {
            throw new Error("IPC on Windows is currently not supported");
        }

        this.codec ||= "JSON";
    }

    /** Gets the data source name according to the configuration. */
    get dsn() {
        let { protocol, hostname, port, pathname } = this;

        if (protocol === "ws+unix:") {
            return protocol + pathname;
        } else {
            return protocol + "//" + hostname + ":" + port + pathname;
        }
    }

    /**
     * Binds an error handler invoked whenever an error occurred in asynchronous
     * operations which can't be caught during run-time.
     */
    onError(handler: (err: Error) => void) {
        this.handleError = handler;
    }

    /** Opens the channel. */
    abstract open(): Promise<void>;

    /** Closes the channel. */
    abstract close(): Promise<void>;

    /** Registers a module proxy to the channel. */
    abstract register<T extends object>(mod: ModuleProxy<T>): Promise<void>;
}
