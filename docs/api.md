# API Reference

## ModuleProxy

```typescript
type ModuleProxy<T> = T & {
    /**
     * When using `new` syntax on the module, this signature is called for
     * creating a new instance of the module class.
     */
    new(...args: ConstructorParameters<T>): EnsureInstanceType<T>;

    /** The name (with namespace) of the module. */
    readonly name: string;
    /** The path (without extension) of the module. */
    readonly path: string;
    /** The very exports object of the module. */
    readonly exports: any;
    /** The very prototype of the module. */
    readonly proto: EnsureInstanceType<T>;
    /** The very class constructor of the module. */
    readonly ctor: T extends Function ? T : new (...args: any[]) => EnsureInstanceType<T>;
}
```

`ModuleProxy` is implemented as an abstract class in microse, and is used to
create proxy when accessing a module, users shall only use the type instead.

## ModuleProxyApp

```typescript
class ModuleProxyApp extends ModuleProxy {
    constructor(name: string, path: string, loader?: ModuleLoader);
}
```

This class is used to create a root module proxy, and the root module should be
declared as a namespace under the global scope.

```typescript
import { ModuleProxyApp } from "microse";

// This statement creates a root module and assign it to the global scope in 
// Node.js.
const App = global["app"] = new ModuleProxyApp("app", __dirname);

// This declaration merging creates a namespace app under the global scope in
// TypeScript, so you can use it everywhere for IDE intellisense.
declare global {
    namespace app { }
}
```

This class has the following extra properties and methods:

- `serve(options: string | ServerOptions): Promise<RpcServer>`
    Serves an RPC server according to the given options. If `options` is a
    string, it could be a URL or Unix socket filename.
- `connect(options: string | ClientOptions): Promise<RpcClient>`
    Connects to an RPC server according to the given options.  If `options` is a
    string, it could be a URL or Unix socket filename.
- `resolve(path: string): string` Resolves the given path to a module name.
- `watch(listener?: (event: "change" | "unlink", filename: string) => void): FSWatcher` 
    Watches file changes and reload the corresponding module.
    - `listener` if provided, it will be called after the module cache has been
        cleared.
    - `FSWatcher` is a type exposed by 
        [chokidar](https://github.com/paulmillr/chokidar).
- `setLoader(loader: ModuleLoader): void` Sets a custom loader to resolve the 
    module.

#### Serve and Connect to IPC

If the first argument passed to `serve()` or `connect()` is a string of
filename, the RPC connection will be bound to a Unix socket, a.k.a. IPC, for
example:

```ts
const server = await App.serve("/tmp/test.sock");
const client = await App.connect("/tmp/test.sock");
```

**NOTE: only the `connect()` method is available for the standalone client.**

## ModuleLoader

```typescript
export interface ModuleLoader {
    extension: string | string[],
    load(filename: string): any;
    unload(filename: string): void;
}
```

By default, microse supports JavaScript modules and (TypeScript modules in 
**ts-node**), By setting a custom loader, a ModuleProxy instance can resolve any
kind of module wanted. (NOTE: The loader must provide cache support.)

- `extension` Extension name of the module file, by default, it's `.js` (or `.ts`
    in ts-node).
- `load(filename: string): any` Loads module from the given file or cache.
- `unload(filename: string): void` Unloads the module in the cache if the file
    is modified.

```typescript
// Add a loader to resolve JSON modules.
const json = new ModuleProxyApp("json", __dirname + "/json");

json.setLoader({
    cache: {},
    extension: ".json",
    load(filename) {
        return this.cache[filename] ||= JSON.parse(fs.readFileSync(filename, "utf8"));
    },
    unload(filename) {
        delete this.cache[filename];
    }
});
```

## createModuleProxy

```ts
export function createModuleProxy(
    name: string,
    path: string,
    loader?: ModuleLoader,
    singletons?: { [name: string]: any },
    root?: ModuleProxyApp
): ModuleProxy
```

Creates a module proxy manually. This function is used underneath of microse
engine, however, if you want to create a module proxy whose file path is
outside the root proxy, you can use this function to do so.

## RpcChannel

```typescript
abstract class RpcChannel implements ChannelOptions { }
```

This abstract class just indicates the RPC channel that allows modules to
communicate remotely. methods `ModuleProxy.serve()` and `ModuleProxy.connect()`
return its server and client implementations accordingly.

The following properties and methods work in both implementations:

- `id: string` The unique ID of the server or the client.
- `dsn: string` Gets the data source name according to the configuration.
- `open(): Promise<void>` Opens the channel. This method is called internally by
    `ModuleProxy.serve()` and `ModuleProxy.connect()`.
- `close(): Promise<void>` Closes the channel.
- `register<T>(mod: ModuleProxy<T>): Promise<void>` Registers a module to the
    channel.
- `deregister<T>(mod: ModuleProxy<T>): Promise<void>` De-registers a module from
    the channel.
- `onError(handler: (err: Error) => void): void` Binds an error handler invoked 
    whenever an error occurred in asynchronous operations which can't be caught
    during run-time.

### ChannelOptions

```typescript
interface ChannelOptions {
    [x: string]: any;
    protocol?: "ws:" | "wss:" | "ws+unix:";
    hostname?: string;
    port?: number;
    pathname?: string;
    secret?: string;
    id?: string;
    key?: string | Buffer | Buffer[];
    cert?: string | Buffer | Buffer[];
    pfx?: string | Buffer | Buffer[];
    ca?: string | Buffer | Buffer[];
    passphrase?: string;
}
```

If `protocol` is `ws+unix:` and `pathname` is provided, the RPC channel will be
bound to an IPC channel. Otherwise, the RPC channel will be bound to a network
channel according to the `hostname` and `port`.

`secret` is used as a password for authentication, if used, the client must
provide it as well in order to grant permission to connect.

The `id` property is a little ambiguous. On the server-side, if omitted, it will
fall back to `dsn`, used for the client routing requests. On the client-side, if
omitted, a random string will be generated, used for the server to publish
topics.

If `protocol` is `wss:`, `key` and `cert` (or `pfx`) must be provided in order
to ship a secure server, and if the key is encrypted, the `passphrase` should
be provided as well.

If the server uses a self-signed certificate, the client should provide the `ca`
option as an array containing the certificate in order to establish the secure
connection.

## RpcServer

```typescript
class RpcServer extends RpcChannel implements ServerOptions { }
```

The server implementation of the RPC channel, which has the following extra
methods:

- `publish(topic: string, data: any, clients?: string[]): boolean` Publishes 
    data to the corresponding topic, if `clients` are provided, the topic will
    only be published to them.
- `getClients(): string[]` Returns all IDs of clients that connected to the 
    server.

### ServerOptions

```ts
export interface ServerOptions extends ChannelOptions {
    httpServer?: http.Server | https.Server;
}
```

By default, the server will create an HTTP(s) server to handle WebSocket
connections according to the options automatically, however if `httpServer` is
provided, that server will be used instead.

## RpcClient

```typescript
class RpcClient extends RpcChannel implements ClientOptions { }
```

The client implementation of the RPC channel, which has the following extra
properties and methods:

- `connecting: boolean` Whether the channel is in connecting state.
- `connected: boolean` Whether the channel is connected.
- `closed: boolean` Whether the channel is closed.
- `pause(): void`  Pauses the channel and redirect traffic to other channels.
- `resume(): void` Resumes the channel and continue handling traffic.
- `subscribe(topic: string, handle: Subscriber): this` Subscribes a handle
    function to the corresponding topic.
- `unsubscribe(topic: string, handle?: Subscriber): boolean` Unsubscribes the
    handle function or all handlers from the corresponding topic.

The `Subscriber` is a type of

```typescript
type Subscriber = (data: any) => void | Promise<void>;
```

### ClientOptions

```typescript
interface ClientOptions extends ChannelOptions {
    serverId?: string;
    codec?: "JSON" | "CLONE";
    timeout?: number;
    pingTimeout?: number;
    pingInterval?: number;
    rejectUnauthorized?: boolean;
}
```

By default, the `serverId` is automatically set according to the `dsn` of the
server, and updated after established the connect. However, if an ID is set when
serving the RPC server, it would be better to set `serverId` to that ID as well.

The `codec` property sets in what format should the data be transferred, default
value is `JSON`. The `CLONE` codec uses the
[structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm), that means it supports more types
than JSON does, like Date, RegExp, TypedArray, etc. However, the `CLONE` codec
only works in Node.js (both server side and client side), with non-Node.js
server, it simply ignores the setting and fallback to `JSON`.

By default `timeout` is set `5000`ms, it is used to force a timeout error when
an RPC request fires and doesn't get a response after a long time.

The `pingTimeout` (default `5000`ms) is used to set the maximum delay of the
connection, the client will constantly check the availability of the connection.
If there are too much delay between the peers, the connection will be
automatically released and a new connection will be created.

The client uses `pingInterval` (default `5000`ms) to set a timer of ping
function so that to ensure the connection is alive. If the server doesn't
response after sending a ping in time, the client will consider the server is
down and will destroy and retry the connection.

By default, `rejectUnauthorized` is set `true`, however, if the server uses a
self-signed certification and the client doesn't provided a valid `ca` option,
you can set this option to `false` to allow connecting.
