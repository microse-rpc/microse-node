import * as net from "net";
import * as path from "path";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as WebSocket from "ws";
import * as v8 from "v8";
import { toObject as error2object, fromObject as object2error } from "@ayonli/jsext/error";
import { isIteratorLike } from "check-iterable";
import { ThenableAsyncGenerator } from "thenable-generator";
import { RpcChannel, Request, ChannelOptions, ChannelEvents } from "./channel";
import type { ModuleProxyApp, ModuleProxy } from "..";
import isOwnKey from "@hyurl/utils/isOwnKey";
import define from "@hyurl/utils/define";
import {
    dict,
    root,
    server,
    readyState,
    tryLifeCycleFunction,
    isSocketResetError,
    throwUnavailableError,
    getInstance
} from "../util";


export interface ServerOptions extends ChannelOptions {
    httpServer?: http.Server | https.Server;
}

export class RpcServer extends RpcChannel implements ServerOptions {
    /** The unique ID of the server, used for the client routing requests. */
    readonly id: string;
    readonly httpServer: http.Server | https.Server | undefined;
    private wsServer: WebSocket.Server | null = null;
    private registry: { [name: string]: ModuleProxy<any>; } = dict();
    private clients = new Map<WebSocket, {
        id: string;
        codec: "JSON" | "CLONE";
    }>();
    /** Stores the all suspended generator calls. */
    private tasks = new Map<WebSocket, Map<number, ThenableAsyncGenerator>>();
    private proxyRoot: ModuleProxyApp | null = null;
    private useExternalHttpServer: boolean;

    constructor(url: string);
    constructor(port: number, hostname?: string);
    constructor(options: ServerOptions);
    constructor(options: string | number | ServerOptions, hostname?: string) {
        super(<any>options, hostname);
        this.id ||= this.dsn;
        this.httpServer ||= undefined;
        this.useExternalHttpServer = !!this.httpServer;
    }

    private updateAddress() {
        let dsn = this.dsn;
        let addr = this.httpServer?.address();

        if (typeof addr === "object") {
            define(this, "port", addr?.port, true);
        }

        if (this.id === dsn) {
            define(this, "id", this.dsn, true);
        }
    }

    private async ensureDir(dirname: string) {
        try {
            await fs.promises.mkdir(dirname, { recursive: true });
        } catch (err: any) {
            if (err["code"] !== "EEXIST")
                throw err;
        }
    }

    private async unlinkIfExists(filename: string) {
        try {
            await fs.promises.unlink(filename);
        } catch (err: any) {
            if (err["code"] !== "ENOENT")
                throw err;
        }
    }

    async open(): Promise<void> {
        let { protocol, pathname } = this;
        let isUnixSocket = protocol === "ws+unix:";

        if (isUnixSocket && pathname) {
            await this.ensureDir(path.dirname(pathname));

            // If the path exists, it's more likely caused by a previous 
            // server process closing unexpected, just remove it before ship
            // the new server.
            await this.unlinkIfExists(pathname);
        }

        return new Promise((resolve, reject) => {
            let wsServer: WebSocket.Server;
            let { hostname, port, httpServer, useExternalHttpServer } = this;
            let isUnixSocket = protocol === "ws+unix:";
            let callback = () => {
                httpServer?.removeListener("error", reject);
                wsServer.on("connection", this.handleConnection.bind(this));
                wsServer.on("error", this.handleError);

                this.updateAddress();
                resolve();
            };

            if (!httpServer) {
                if (protocol === "wss:") {
                    httpServer = https.createServer({
                        key: this.key,
                        cert: this.cert,
                        pfx: this.pfx,
                        ca: this.ca,
                        passphrase: this.passphrase,
                    }).listen(port, hostname, callback);
                } else {
                    httpServer = http.createServer();

                    if (isUnixSocket) {
                        httpServer.listen(pathname, callback);
                    } else {
                        httpServer.listen(port, hostname, callback);
                    }
                }

                // Forbid HTTP requests or any WebSocket connection that is not
                // using the right pathname.
                httpServer.on("request", (_, res: http.ServerResponse) => {
                    res.writeHead(406);
                    res.end();
                }).on("upgrade", (
                    req: http.IncomingMessage,
                    socket: net.Socket,
                ) => {
                    let _pathname = req.url?.split("?")[0];

                    if (!isUnixSocket && _pathname !== pathname) {
                        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
                        socket.destroy();
                    }
                });

                Object.assign(this, { httpServer });
            }

            httpServer.on("upgrade", this.handleHandshake.bind(this));
            wsServer = this.wsServer = new WebSocket.Server({
                noServer: true,
                perMessageDeflate: true
            });
            httpServer.once("error", reject);

            if (useExternalHttpServer) {
                if (httpServer.listening) {
                    callback();
                } else {
                    httpServer.once("listening", callback);
                    resolve();
                }
            }
        });
    }

    private handleHandshake(
        req: http.IncomingMessage,
        socket: net.Socket,
        head: Buffer
    ) {
        // verify authentication

        if (socket.destroyed)
            return;

        let {
            pathname: _pathname,
            searchParams
        } = new URL(req.url as string, "ws://localhost");

        if (this.protocol !== "ws+unix:" && _pathname !== this.pathname)
            return;

        let clientId = searchParams.get("id");
        let secret = searchParams.get("secret");
        let codec = searchParams.get("codec") as "JSON" | "CLONE" || "JSON";

        if (!clientId || (this.secret && secret !== this.secret)) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
        } else {
            this.wsServer?.handleUpgrade(req, socket, head, client => {
                this.clients.set(client, { id: clientId as string, codec });
                this.tasks.set(client, new Map());
                this.wsServer?.emit('connection', client, req);

                // Notify the client that the connection is ready.
                this.dispatch(client, ChannelEvents.CONNECT, this.id);
            });
        }
    }

    async close(): Promise<void> {
        await new Promise<void>(resolve => {
            if (this.wsServer) {
                this.wsServer.close(() => {
                    // wsServer.close() will not emit 'close' event on the
                    // clients, so we need to close suspended tasks and empty
                    // maps here.
                    this.tasks.forEach(tasks => {
                        tasks.forEach(task => task.return());
                        tasks.clear();
                    });
                    this.tasks.clear();
                    this.clients.clear();

                    if (!this.useExternalHttpServer) {
                        this.httpServer?.close(() => {
                            resolve();
                        });
                    } else {
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });

        // Perform destructions for every module all at once.
        await Promise.all(Object.values(this.registry).map(mod => {
            return tryLifeCycleFunction(mod, "destroy", this.handleError);
        }));

        if (this.proxyRoot) {
            this.proxyRoot[server] = null;
            this.proxyRoot["remoteSingletons"] = dict();
            this.proxyRoot = null;
        }
    }

    async register<T>(mod: ModuleProxy<T>) {
        this.registry[mod.name] = mod;
        await tryLifeCycleFunction(<any>mod, "init", this.handleError);
    }

    async deregister<T>(mod: ModuleProxy<T>) {
        delete this.registry[mod.name];
        await tryLifeCycleFunction(<any>mod, "destroy", this.handleError);
    }

    /**
     * Publishes data to the corresponding topic, if `clients` are provided, the
     * topic will only be published to them.
     */
    publish(topic: string, data: any, clients?: string[]) {
        let sent = false;

        for (let [socket, { id }] of this.clients) {
            if (!clients?.length || clients?.includes(id)) {
                this.dispatch(socket, ChannelEvents.PUBLISH, topic, data);
                sent = true;
            }
        }

        return sent;
    }

    /** Returns all IDs of clients that connected to the server. */
    getClients(): string[] {
        let clients: string[] = [];

        for (let [, { id }] of this.clients) {
            clients.push(id);
        }

        return clients;
    }

    private dispatch(
        socket: WebSocket,
        event: ChannelEvents,
        taskId: number | string,
        data: any = void 0
    ) {
        if (socket.readyState === WebSocket.OPEN) {
            const codec = this.clients.get(socket)?.codec;
            let msg: string | Buffer;

            if (event === ChannelEvents.THROW &&
                data instanceof Error &&
                codec !== "CLONE"
            ) {
                data = error2object(data);
            }

            let _data: [ChannelEvents, number | string, any?];

            if (event === ChannelEvents.CONNECT) {
                _data = [event, String(taskId), codec];
            } else if (event === ChannelEvents.PONG) {
                _data = [event, Number(taskId)];
            } else {
                _data = [event, taskId];

                if (data !== undefined || event === ChannelEvents.PUBLISH) {
                    _data.push(data);
                }
            }

            try {
                if (codec === "CLONE") {
                    msg = v8.serialize(_data);
                } else {
                    msg = JSON.stringify(_data);
                }

                socket.send(msg);
            } catch (err) {
                this.dispatch(socket, ChannelEvents.THROW, taskId, err);
            }
        }
    }

    private handleConnection(socket: WebSocket, _: http.IncomingMessage) {
        socket.on("error", err => {
            // When any error occurs, if it's a socket reset error, e.g.
            // client disconnected unexpected, the server could just 
            // ignore the error. For other errors, the server should 
            // handle them with a custom handler.
            if (!isSocketResetError(err)) {
                this.handleError(err);
            }
        }).on("close", () => {
            let tasks = this.tasks.get(socket);
            this.tasks.delete(socket);
            this.clients.delete(socket);

            if (tasks) {
                // Close all suspended tasks of the socket.
                tasks.forEach(task => task.return());
            }
        }).on("ping", (data) => {
            socket.pong(data);
        }).on("message", this.handleMessage.bind(this, socket));
    }

    private async handleMessage(socket: WebSocket, msg: string | Buffer) {
        const codec = this.clients.get(socket)?.codec;
        let req: Request | undefined;

        try {
            if (typeof msg === "string") {
                req = JSON.parse(msg);
            } else if (Buffer.isBuffer(msg) && codec === "CLONE") {
                req = v8.deserialize(msg);
            }
        } catch (err) {
            this.handleError(err);
        }

        if (!Array.isArray(req) || typeof req[0] !== "number")
            return;

        let [event, taskId, modName, method, args = []] = req;

        if (event === ChannelEvents.THROW &&
            typeof args[0] === "object" &&
            codec !== "CLONE"
        ) {
            args[0] = object2error(args[0]);
        }

        switch (event) {
            case ChannelEvents.INVOKE:
                await this.handleInvokeEvent(
                    socket, taskId, modName as string, method as string, args);
                break;

            case ChannelEvents.YIELD:
            case ChannelEvents.RETURN:
            case ChannelEvents.THROW: {
                await this.handleGeneratorEvents(
                    socket, event, taskId, modName as string, method as string, args[0]);
                break;
            }

            case ChannelEvents.PING: {
                this.dispatch(socket, ChannelEvents.PONG, taskId);
                break;
            }
        }
    }

    private async handleInvokeEvent(
        socket: WebSocket,
        taskId: number,
        modName: string,
        method: string,
        args: any[]
    ) {
        let tasks = this.tasks.get(socket);
        let event: ChannelEvents;
        let data: any;

        try {
            // Connect to the singleton instance and invokes it's
            // method to handle the request.
            let app = this.registry[modName][root];
            let ins = getInstance(app, modName);

            if (isOwnKey(ins, readyState) && ins[readyState] !== 1) {
                throwUnavailableError(modName);
            }

            let task = ins[method](...args);

            if (task && isIteratorLike(task)) {
                tasks?.set(<number>taskId, task as any);
                event = ChannelEvents.INVOKE;
            } else {
                data = await task;
                event = ChannelEvents.RETURN;
            }
        } catch (err) {
            if (err instanceof Error &&
                err.message === "ins[method] is not a function"
            ) {
                err.message = `${modName}.${method} is not a function`;
            }

            event = ChannelEvents.THROW;
            data = err;
        }

        // Send response or error to the client.
        this.dispatch(socket, event, taskId, data);
    }

    private async handleGeneratorEvents(
        socket: WebSocket,
        event: ChannelEvents,
        taskId: number,
        modName: string,
        method: string,
        input: any
    ) {
        let tasks = this.tasks.get(socket);
        let task = tasks?.get(<number>taskId);
        let data: any;

        try {
            if (!task) {
                let callee = `${modName}.${method}()`;
                throw new ReferenceError(`Failed to call ${callee}`);
            }

            // Invokes the generator's method according to
            // the event.
            if (event === ChannelEvents.YIELD) {
                data = await task.next(input);
            } else if (event === ChannelEvents.RETURN) {
                data = await task.return(input);
            } else {
                // Calling the throw method will cause an error
                // being thrown and go to the catch block.
                await task.throw(input);
            }

            if (data.done) {
                event = ChannelEvents.RETURN;
                tasks?.delete(<number>taskId);
            }
        } catch (err) {
            event = ChannelEvents.THROW;
            data = err;
            task && tasks?.delete(<number>taskId);
        }

        this.dispatch(socket, event, taskId, data);
    }
}
