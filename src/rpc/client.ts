import type * as NodeWebSocket from "ws";
import type * as NodeV8 from "v8";
import { sequence } from "@ayonli/jsext/number";
import { toObject as error2object, fromObject as object2error } from "@ayonli/jsext/error";
import { ThenableAsyncGenerator, ThenableAsyncGeneratorLike } from 'thenable-generator';
import type { ModuleProxyApp } from "..";
import type { ModuleProxy } from "../proxy";
import { ModuleProxy as ModuleProxyType } from "../header";
import getGlobal from "@hyurl/utils/getGlobal";
import isOwnKey from "@hyurl/utils/isOwnKey";
import define from "@hyurl/utils/define";
import sleep from "@hyurl/utils/sleep";
import {
    RpcChannel,
    ChannelOptions,
    ChannelEvents,
    Response,
    Request
} from "./channel";
import {
    readyState,
    dict,
    root,
    server,
    createInstance,
    throwUnavailableError,
    getInstance
} from "../util";
import EventEmitter = require("events");


const WebSocket = getGlobal("WebSocket") || require("ws");
const isNodeJS = typeof process?.versions?.node === "string";
const v8: typeof NodeV8 = isNodeJS ? require("v8") : null;

export type Subscriber = (data: any) => void | Promise<void>;
export type ChannelState = "initiated" | "connecting" | "connected" | "closed";
export type Task = {
    resolve: (data: any) => void,
    reject: (err: Error) => void;
};

export interface ClientOptions extends ChannelOptions {
    serverId?: string;
    codec?: "JSON" | "CLONE";
    timeout?: number;
    pingTimeout?: number;
    pingInterval?: number;
    rejectUnauthorized?: boolean;
}

export class RpcClient extends RpcChannel implements ClientOptions {
    /** The unique ID of the client, used for the server publishing topics. */
    readonly id: string;
    readonly serverId: string;
    readonly codec?: ClientOptions["codec"];
    readonly timeout: number;
    readonly pingInterval: number;
    readonly pingTimeout: number;
    readonly rejectUnauthorized: boolean;
    private state: ChannelState = "initiated";
    private socket: WebSocket | null = null;
    private registry: { [name: string]: ModuleProxyType<any>; } = dict();
    readonly taskId = sequence(0, Number.MAX_SAFE_INTEGER, 1, true);
    readonly tasks = new Map<number, Task>();
    private topics = new Map<string, Set<Subscriber>>();
    private pingTimer: NodeJS.Timeout | null = null;
    private destructTimer: NodeJS.Timeout | null = null;

    constructor(url: string);
    constructor(port: number, hostname?: string);
    constructor(options: ClientOptions);
    constructor(options: string | number | ClientOptions, hostname?: string) {
        super(<any>options, hostname);

        if (!isNodeJS) {
            if (this.protocol === "ws+unix:") {
                throw new Error("Unix socket is only supported in Node.js");
            }

            if (this.codec === "CLONE") {
                throw new Error("'CLONE' codec is only supported in Node.js");
            }
        }

        this.id ||= Math.random().toString(16).slice(2);
        this.serverId ||= this.dsn;
        this.codec ||= "JSON";
        this.timeout ||= 5000;
        this.pingTimeout ||= 5000;
        this.pingInterval ||= 5000;
        this.rejectUnauthorized ??= true;
    }

    /** Whether the channel is in connecting state. */
    get connecting() {
        return this.state === "connecting";
    }
    /** Whether the channel is connected. */
    get connected() {
        return this.state === "connected";
    }
    /** Whether the channel is closed. */
    get closed() {
        return this.state === "closed";
    };

    open(): Promise<void> {
        return new Promise((resolve, reject) => {
            let {
                id,
                serverId,
                protocol,
                hostname,
                port,
                pathname,
                secret,
                codec,
            } = this;

            if (this.socket && (
                this.socket.readyState === WebSocket.CONNECTING ||
                this.socket.readyState === WebSocket.OPEN
            )) {
                throw new Error(`Channel to ${serverId} is already open`);
            } else if (this.closed) {
                throw new Error(
                    `Cannot reconnect to ${serverId} after closing the channel`
                );
            }

            this.state = "connecting";

            let url: string;
            let socket: WebSocket;

            if (protocol === "ws+unix:") {
                url = `ws+unix://${pathname}:/?id=${id}`;
            } else {
                url = `${protocol}//${hostname}:${port}${pathname}?id=${id}`;
            }

            if (secret) {
                url += `&secret=${secret}`;
            }

            if (codec) {
                url += `&codec=${codec}`;
            }

            if (isNodeJS) {
                socket = new (<typeof NodeWebSocket><any>WebSocket)(url, {
                    timeout: this.timeout,
                    key: this.key,
                    cert: this.cert,
                    pfx: this.pfx,
                    ca: this.ca,
                    rejectUnauthorized: this.rejectUnauthorized,
                    handshakeTimeout: this.timeout,
                    followRedirects: true,
                    maxRedirects: 5
                }) as any;
            } else {
                socket = new WebSocket(url);
            }

            define(this, "socket", socket, true);

            // Accept the first message for handshake.
            socket.onmessage = ({ data: msg }) => {
                let res = this.parseResponse(msg);

                if (!Array.isArray(res) || res[0] !== ChannelEvents.CONNECT) {
                    // Protocol error, shall close the channel.
                    this.close();
                    socket.onerror?.call(socket, null as any);
                } else {
                    this.state = "connected";
                    Object.assign(this, { codec: res[2] || "JSON" });
                    this.updateServerId(String(res[1]));
                    this.prepareChannel();
                    this.resume();
                    resolve();
                }
            };
            socket.onerror = (ev: any) => {
                if (ev?.["error"]) {
                    reject(ev["error"]);
                } else {
                    reject(new Error(`Cannot connect to ${this.serverId}`));
                }
            };
        });
    }

    async close(): Promise<void> {
        await new Promise<void>(resolve => {
            this.state = "closed";
            this.pause();

            if (this.socket) {
                this.socket.close();
                resolve();
            } else {
                resolve();
            }
        });

        for (let name in this.registry) {
            let mod = this.registry[name];
            let singletons = mod[root]?.["remoteSingletons"]?.[name];

            if (singletons?.[this.serverId]) {
                delete singletons[this.serverId];
            }
        }
    }

    async register<T>(mod: ModuleProxyType<T>) {
        if (!this.registry[mod.name]) {
            let singletons = (mod as any)[root]["remoteSingletons"][mod.name] || (
                ((mod as any)[root] as ModuleProxyApp)["remoteSingletons"][mod.name] = dict()
            );

            singletons[this.serverId] = this.createRemoteInstance(mod);
            singletons[this.serverId][readyState] = this.connected ? 1 : 0;
            this.registry[mod.name] = mod;
        }
    }

    async deregister<T>(mod: ModuleProxyType<T>) {
        let singletons = ((mod as any)[root] as ModuleProxyApp)?.["remoteSingletons"]?.[mod.name];

        if (singletons?.[this.serverId]) {
            delete singletons[this.serverId];
        }
    }

    /** Pauses the channel and redirect traffic to other channels. */
    pause(): void {
        this.pingTimer && clearInterval(this.pingTimer);
        this.destructTimer && clearTimeout(this.destructTimer);
        this.flushReadyState(0);
    }

    /** Resumes the channel and continue handling traffic. */
    resume(): void {
        this.flushReadyState(1);

        // Ping the server constantly in order to check connection
        // availability.
        this.pingTimer = setInterval(() => {
            if (typeof (this.socket as any)["ping"] === "function") {
                // Send WebSocket 'ping' frame.
                (this.socket as any)["ping"](Date.now());
            } else {
                this.send(ChannelEvents.PING, Date.now());
            }

            // Set a timer
            this.destructTimer = setTimeout(() => {
                this.socket?.close(1001, "Slow Connection");
            }, this.pingTimeout);
        }, this.pingInterval);
    }

    private flushReadyState(state: number) {
        for (let name in this.registry) {
            let mod = this.registry[name];
            let singletons = mod[root]["remoteSingletons"][name];

            if (singletons?.[this.serverId]) {
                singletons[this.serverId][readyState] = state;
            }
        }
    }

    private updateServerId(serverId: string) {
        if (serverId !== this.serverId) {
            // Update remote singletons map.
            for (let name in this.registry) {
                let mod: ModuleProxy = this.registry[name];
                let singletons = ((mod as any)[root] as ModuleProxyApp)["remoteSingletons"][name];

                if (singletons?.[this.serverId]) {
                    singletons[serverId] = singletons[this.serverId];
                    delete singletons[this.serverId];
                }
            }

            Object.assign(this, { serverId });
        }
    }

    /** Subscribes a handle function to the corresponding topic. */
    subscribe(topic: string, handle: Subscriber) {
        let handlers = this.topics.get(topic);
        handlers || this.topics.set(topic, handlers = new Set());
        handlers.add(handle);
        return this;
    }

    /**
     * Unsubscribes the handle function or all handlers from the corresponding
     * topic.
     */
    unsubscribe(topic: string, handle?: Subscriber) {
        if (!handle) {
            return this.topics.delete(topic);
        } else {
            let handlers = this.topics.get(topic);

            if (handlers) {
                return handlers.delete(handle);
            } else {
                return false;
            }
        }
    }

    send(...data: Request) {
        if (this.socket?.readyState === WebSocket.OPEN) {
            let msg: string | Buffer;

            if (data[0] === ChannelEvents.THROW &&
                data[4]?.[0] instanceof Error &&
                this.codec !== "CLONE"
            ) {
                data[4][0] = error2object(data[4][0]);
            }

            if (this.codec === "CLONE" && !!v8) {
                msg = v8.serialize(data);
            } else {
                msg = JSON.stringify(data);
            }

            this.socket?.send(msg);
        }
    }

    private async reconnect() {
        while (true) {
            if (this.closed)
                break;

            try {
                await this.open();
                break;
            } catch (e) {
                await sleep(2000);
            }
        }
    }

    private prepareChannel() {
        const socket = this.socket as WebSocket;
        socket.onerror = (ev: any) => {
            let err: Error;

            if (ev?.["error"]) {
                err = ev["error"];
            } else {
                err = new Error("Unexpected error during connection");
            }

            this.handleError(err);
        };

        socket.onclose = () => {
            // If the socket is closed or reset. but the channel remains open,
            // pause the service immediately and try to reconnect.
            if (!this.connecting && !this.closed) {
                this.pause();
                this.reconnect();
            }
        };

        socket.onmessage = async ({ data: msg }) => {
            let res = this.parseResponse(msg);

            if (!Array.isArray(res) || typeof res[0] !== "number")
                return;

            let [event, taskId, data = void 0] = res;
            let task: Task | undefined;

            if (typeof data === "object" && data !== null) {
                if (event === ChannelEvents.THROW && this.codec !== "CLONE") {
                    data = object2error(data);
                }
            }

            switch (event) {
                // When receiving response from the server, resolve 
                // immediately.
                case ChannelEvents.INVOKE:
                case ChannelEvents.YIELD:
                case ChannelEvents.RETURN: {
                    if (task = this.tasks.get(<number>taskId)) {
                        task.resolve(data);
                    }
                    break;
                }

                // If any error occurs on the server, it will be delivered
                // to the client.
                case ChannelEvents.THROW: {
                    if (task = this.tasks.get(<number>taskId)) {
                        task.reject(data);
                    }
                    break;
                }

                case ChannelEvents.PONG: {
                    this.destructTimer && clearTimeout(this.destructTimer);
                    break;
                }

                case ChannelEvents.PUBLISH: {
                    // If receives the PUBLISH event, call all the handlers
                    // bound to the corresponding topic. 
                    let handlers = this.topics.get(<string>taskId);

                    if (handlers) {
                        handlers.forEach(async (handle) => {
                            try {
                                await handle(data);
                            } catch (err) {
                                this.handleError(err);
                            }
                        });
                    }
                    break;
                }
            }
        };

        if (typeof (this.socket as any)["on"] === "function") {
            // Listen WebSocket 'pong' frame.
            (this.socket as any as EventEmitter).on("pong", () => {
                this.destructTimer && clearTimeout(this.destructTimer);
            });
        }

        return this;
    }

    private parseResponse(msg: any) {
        let res: Response | null = null;

        try {
            if (typeof msg === "string") {
                res = JSON.parse(msg);
            } else if (this.codec === "CLONE" && !!v8) {
                res = v8.deserialize(msg);
            }
        } catch (err) {
            this.handleError(err);
        }

        return res;
    }

    private createRemoteInstance(mod: ModuleProxyType<any>) {
        // Generate a proxified singleton instance to the module, so that it can
        // be used for remote requests. the remote instance should only return
        // methods.
        let ins = mod.path ? createInstance(mod, true) : {};

        return new Proxy(ins, {
            get: (ins, prop: string | symbol) => {
                if (typeof prop === "symbol") {
                    return ins[prop];
                }

                if (!mod.path || ins[prop] === undefined) {
                    if (!isOwnKey(ins, prop)) {
                        let fn = this.createFunction(<any>mod, <string>prop);

                        define(ins, prop, fn);
                        define(fn, "name", prop);
                        define(fn, "toString", function toString() {
                            return `function ${prop}() { [native code] }`;
                        }, false, true);
                    }

                    return ins[prop];
                }

                let type = typeof ins[prop];
                let isFn = type === "function";

                if (isFn && !ins[prop]["proxified"] && !isOwnKey(ins, prop)) {
                    let origin = ins[prop];
                    let fn = this.createFunction(<any>mod, prop);

                    define(ins, prop, fn);
                    define(fn, "proxified", true);
                    define(fn, "name", origin.name);
                    define(fn, "length", origin.length);
                    define(fn, "toString", function toString() {
                        return "[ModuleProxy] "
                            + Function.prototype.toString.call(origin);
                    }, false, true);
                }

                return isFn
                    ? ins[prop]
                    : (type === "undefined" ? undefined : null);
            },
            has: (ins, prop: string | symbol) => {
                return typeof prop === "symbol"
                    ? (prop in ins)
                    : typeof ins[prop] === "function";
            }
        });
    }

    private createFunction(mod: ModuleProxy, method: string) {
        let self = this;
        return function (...args: any[]) {
            if (mod.path) {
                // If the RPC server and the RPC client runs in the same process,
                // then directly call the local instance to prevent unnecessary
                // network traffics.
                let app = (mod as any)[root] as ModuleProxyApp;
                if (app && app[server]?.id === self.serverId) {
                    let ins = getInstance(app, mod.name);

                    if (isOwnKey(ins, readyState) && ins[readyState] !== 1) {
                        throwUnavailableError(mod.name);
                    } else {
                        return new ThenableAsyncGenerator(ins[method](...args));
                    }
                }

                if (!self.connected) {
                    throwUnavailableError(mod.name);
                }
            }

            // Return a ThenableAsyncGenerator instance when the remote function
            // is called, so that it can be awaited or used as a generator.
            return new ThenableAsyncGenerator(new ThenableIteratorProxy(
                <any>self,
                mod.name,
                method,
                ...args
            ));
        };
    }
}

class ThenableIteratorProxy implements ThenableAsyncGeneratorLike {
    readonly taskId = this.client.taskId.next().value as number;
    private state: "pending" | "closed" = "pending";
    private result: any;

    /**
     * Generators calls will be queued in a sequence so that when the server
     * yield a value (which is sequential), the client can process them
     * properly. For regular calls, the queue's size is fixed to 1.
     */
    private queue: Array<{
        event: ChannelEvents,
        data?: any,
        resolve: Function,
        reject: Function;
    }> = [];

    constructor(
        private client: RpcClient,
        private modName: string,
        private method: string,
        ...args: any[]
    ) {
        // Initiate the task immediately when the remote method is called, this
        // operation will create a individual task, it will either be awaited as
        // a promise or iterated as a iterator.
        this.result = this.invokeTask(ChannelEvents.INVOKE, ...args);
    }

    next(value?: any) {
        return this.invokeTask(ChannelEvents.YIELD, value);
    }

    return(value?: any) {
        return this.invokeTask(ChannelEvents.RETURN, value);
    }

    throw(err?: Error) {
        return this.invokeTask(ChannelEvents.THROW, err) as Promise<never>;
    }

    then(resolver: (data: any) => any, rejecter: (err: any) => any) {
        return Promise.resolve(this.result).then((res) => {
            // Mark the state to closed, so that any operations on the current
            // generator after will return the local result instead of
            // requesting the remote service again.
            this.state = "closed";
            this.result = res;

            // With INVOKE event, the task will finish immediately after
            // awaiting the response, once a task is finished, it should be 
            // removed from the queue right away.
            this.client.tasks.delete(this.taskId);

            return res;
        }).then(resolver, rejecter);
    }

    private close() {
        this.state = "closed";

        // Stop all pending tasks.
        for (let task of this.queue) {
            switch (task.event) {
                case ChannelEvents.INVOKE:
                    task.resolve(void 0);
                    break;

                case ChannelEvents.YIELD:
                    task.resolve({ value: void 0, done: true });
                    break;

                case ChannelEvents.RETURN:
                    task.resolve({ value: task.data, done: true });
                    break;

                case ChannelEvents.THROW:
                    task.reject(task.data);
                    break;
            }
        }

        this.queue = [];
    }

    private captureStackTrack() {
        let call = {};
        Error.captureStackTrace(call);
        return call as { readonly stack: string; };
    }

    private resolveStackTrace(
        err: Error | string,
        call: { readonly stack: string; }
    ) {
        if (!(err instanceof Error))
            return;

        let stacks = call.stack.split("\n");
        let offset = stacks.findIndex(
            line => line.startsWith("    at new ThenableIteratorProxy")
        );

        if (offset !== -1) {
            offset += 2;
            stacks = stacks.slice(offset);
            err.stack += "\n" + stacks.join("\n");
        }
    }

    private humanizeDuration(duration: number): string {
        let num: number;
        let unit: string;

        if (duration < 1000) {
            num = duration;
            unit = "millisecond";
        } else if (duration < 60000) {
            num = Math.round(duration / 1000);
            unit = "second";
        } else {
            num = Math.round(duration / 60000);
            unit = "minute";
        }

        if (num !== 1)
            unit += "s";

        return num + " " + unit;
    }

    private createTask(call: { readonly stack: string; }) {
        return {
            resolve: (data: any) => {
                if (this.state === "pending") {
                    if (this.queue.length > 0) {
                        this.queue.shift()?.resolve(data);
                    }
                }
            },
            reject: (err: any) => {
                if (this.state === "pending") {
                    if (this.queue.length > 0) {
                        this.resolveStackTrace(err, call);
                        this.queue.shift()?.reject(err);
                    }

                    this.close();
                }
            }
        };
    }

    private createTimeout(call: { readonly stack: string; }) {
        return setTimeout(() => {
            if (this.queue.length > 0) {
                let task = this.queue.shift();
                let callee = `${this.modName}.${this.method}()`;
                let duration = this.humanizeDuration(this.client.timeout);
                let err = new Error(`${callee} timeout after ${duration}`);

                this.resolveStackTrace(err, call);
                task?.reject(err);
            }

            this.close();
        }, this.client.timeout);
    }

    private prepareTask(event: ChannelEvents, args: any[] = []): Promise<any> {
        let call = this.captureStackTrack();

        if (!this.client.tasks.has(this.taskId)) {
            this.client.tasks.set(this.taskId, this.createTask(call));
        }

        // Pack every request as Promise, and assign the resolver and rejecter 
        // to the task, so that when the result or any error is received, 
        // they can be called properly.
        return new Promise((resolve, reject) => {
            let timer = this.createTimeout(call);

            this.queue.push({
                event,
                // 'data' is used for generator calls as the yielded/thrown data
                // when the iterator is closed early.
                data: args[0],
                resolve: (data: any) => {
                    clearTimeout(timer);
                    resolve(data);
                },
                reject: (err: any) => {
                    clearTimeout(timer);
                    reject(err);
                }
            });

            this.client.send(
                event,
                this.taskId,
                this.modName,
                this.method,
                args
            );
        });
    }

    private async invokeTask(event: ChannelEvents, ...args: any[]): Promise<any> {
        if (this.state === "closed") {
            switch (event) {
                case ChannelEvents.INVOKE:
                    return this.result;

                case ChannelEvents.YIELD:
                    return { value: undefined, done: true };

                case ChannelEvents.RETURN:
                    return { value: args[0], done: true };

                case ChannelEvents.THROW:
                    throw args[0];
            }
        } else {
            try {
                let res = await this.prepareTask(event, args);

                if (event !== ChannelEvents.INVOKE) {
                    ("value" in res) || (res.value = void 0);

                    if (res.done) {
                        this.state = "closed";
                        this.result = res.value;
                        this.client.tasks.delete(this.taskId);
                    }
                }

                return res;
            } catch (err) {
                this.state = "closed";
                this.client.tasks.delete(this.taskId);

                throw err;
            }
        }
    }
}
