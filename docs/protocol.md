# Protocol Reference

This documentation addresses the transmission protocol underneath the microse
RPC channel, by implement the server and/or client according to the protocol,
any program in any programming language can serve and/or connect to microse
services.

## WebSocket

Microse uses the standard WebSocket protocol under the hood for data
transmission, and based on that, it introduces a top-level standard to encode
and decode messages.

## ChannelEvents

These events are used for transmission, some for the server only, some for the
client only, and some for both.

```ts
enum ChannelEvents {
    CONNECT = 1,
    INVOKE = 2,
    RETURN = 3,
    THROW = 4,
    YIELD = 5,
    PUBLISH = 6,
    PING = 7,
    PONG = 8,
}
```

## Connection

To serve and connect an microse server, use the following url syntax:

```url
<ws|wss>://<hostname>:<port>[/pathname]?id=<id>[&secret=<key>][&codec=<codec>]
```

Or Unix socket path:

```url
[ws+unix:]<filename>?id=<id>[&secret=<key>][&codec=<codec>]
```

The WebSocket server must check the request on `upgrade` stage, to see if the
WebSocket connection has an `id` in its request url, and respond
`401 Unauthorized` error if not presented. And if the server configures the
`secret` option, it shall, as well, check the `secret` provided by the client,
if not match, a `401` error shall be responded as well.

## Message

All messages transmitted between the server and client are arrays in JSON format,
which its first element is the channel event that being used for the peer to
know which event is emitted, the remaining elements maybe different for each
event, and they will be addressed in the following sections.

### `CONNECT` event

Once the connection is established, the server shall send a message of
`CONNECT` event positively in the following signature to perform a handshake:

```
[CONNECT, serverId] // for example [1, "test-server"]
```

The client must accept this event in order to update its server map according
to the `serverId` received.

After the connection is established and the handshake is finished, the client
and the server are safe to send and receive messages.

### `INVOKE` event

To call a remote function, the client shall send a message in the following
signature as a request:

```
[INVOKE, requestId, module, method, [...args]] // for example [2, 1, "app.services.user", "setName", [10000, "John Smith"]]
```

The client must implement some kind of technique to provide an incremental
`requestId`, which is used for marking the request, after the server called the
target `module` and its `method`, the server will send a `RETURN` event or
`THROW` event for errors (or `INVOKE` event for generator calls) to the client
with the same `requestId`, so the client knows which request the response
belongs to.

### `RETURN` event

#### As Response

After the server finished a request, it shall send a message in the following
signature as response:

```
[RETURN, requestId, result?] // for example [3, 1, true]
```

#### As Generator Call (ignore this if the program doesn't support generator functions)

Use JavaScript for example, when you call the `return(data)` method of a
generator, the `data` will be sent by the client via the `RETURN` event in the
following signature as a sub-request:

```
[RETURN, requestId, module, method, [data]] // for example [3, 2, "app.services.user", "someGeneratorMethod", ["foo"]]
```

Which the `requestId` is the same id sent by the parent request when calling the
generator function via the `INVOKE` event. The server shall send the same
`data` back to the client and close the generator, which is the default behavior
of a generator function.

#### As Generator Response (ignore this if the program doesn't support generator functions)

Similar to regular response, except the `data` will always be an object with
`done` and an optional `value` properties.

```
[RETURN, requestId, { done: true, value?, key? }] // for example [3, 2, { done: true, value: "foo" }]
```

`key` is used for PHP implementation to support `yield $key => $value`, but
since this is the `RETURN` event, the key will alway be `null` ot not set.

### `THROW` event

#### As Response

If any error was thrown by the remote function, the server shall send a message
in the following signature as an error/exception response.

```
[THROW, requestId, error] // for example [4, 1, "The name has been taken"]]
```

The `error` can be a string or an object that contains properties that can be
used for the client to regenerate the error instance:

- `name` The error instance or its constructor's name
- `message` The error message passed to the constructor.
- `stack` (optional) The stack trace of the error instance.
- any other properties may be sent as well.

For example:

```jsonc
{
    "name": "Error",
    "message": "something went wrong",
    "stack": "Error: something went wrong\n..."
}
```

#### As Generator Call (ignore this if the program doesn't support generator functions)

Use JavaScript for example, when you call the `throw(error)` method of a
generator, the `error` will be sent by the client via the `THROW` event in the
following signature as a sub-request:

```
[THROW, requestId, module, method, [error]] // for example [4, 2, "app.services.user", "someGeneratorMethod", ["something went wrong"]]
```

Which the `requestId` is the same id sent by the parent request when calling the
generator function via the `INVOKE` event. The server shall send the same
`error` back to the client and close the generator, which is the default
behavior of a generator function.

### `YIELD` event (ignore this if the program doesn't support generator functions)

Use JavaScript for example, when you call the `next(value)` method of a
generator, the `value` will be sent by the client via `YIELD` event in the
following signature as a sub-request:

```
[YIELD, requestId, module, method, [data]] // for example [5, 2, "app.services.user", "someGeneratorMethod", ["bar"]]
```

Which the `requestId` is the same id sent by the parent request when calling the
generator function via the `INVOKE` event.

After the `next()` function is called and `yield value` inside the generator
function, the `value` will be sent by the server via the `YIELD` event in the
following signature as response:

```
[YIELD, requestId, { done: false, value, key? }] // for example [5, 2, { done: false, value: "baz" }]
```

`key` is used for PHP implementation to support `yield $key => $value`, other
languages that doesn't support this syntax should just ignore the `key`.

### `PUBLISH` event

If the server wants to publish data to the client, it shall send a message in
the following signature:

```
[PUBLISH, topic, data] // for example [6, "foo", "a message to everyone"]
```

The client shall receive this event and trigger any handler bound to the topic.

### `PING` and `PONG` event

After connection, the client can positively and constantly send a message in
the following signature, in order to detect availability and keep the connection
alive:

```
[PING, timestamp] // for example [7, 1602752717476]
```

The server shall accept this event and send back the `timestamp` in the
following signature:

```
[PONG, timestamp] // for example [8, 1602752717476]
```

The client shall implement a method to detected network delay and close the
connection in order to re-establish a new connection if there is too much delay.

NOTE: if the WebSocket implementation supports native ping/pong frame, it is
recommended to use the built-in function instead, which means, the server should
implement both the `PING` event and the `ping` frame if possible, and send back
`PONG` event or `pong` frame accordingly.
