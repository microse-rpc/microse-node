# Microse

Microse (stands for *Micro Remote Object Serving Engine*) is a light-weight
engine that provides applications the ability to auto-load modules and serve
them remotely as RPC services.

For API reference, please check the [API documentation](./docs/api.md),
or the [Protocol Reference](./docs/protocol.md).

## Install

```sh
npm i microse
```

## Auto-loading and Hot-reloading

In NodeJS (with CommonJS module solution), `require` and `import` will
immediately load the corresponding module and make a reference in the current
scope. That means, if the module doesn't finish initiation, e.g. circular
import, the application may not work as expected. And if the module file is
modified, the application won't be able to reload that module without
restarting the program.

Microse, on the other hand, based on the namespace and ES6 proxy, it creates a 
*"soft-link"* of the module, and only import the module when truly needed. And
since it's soft-linked, when the module file is changed, it has the ability to
wipe out the memory cache and reload the module with very few side-effects.

## How to use?

In order to use microse, one must create a root `ModuleProxyApp` instance and
assign it to the global scope, so other files can directly use it as a root
namespace without importing the module.

### Example

```typescript
// src/app.ts
import { ModuleProxyApp } from "microse";

// Expose and merge the app as a namespace under the global scope.
declare global {
    namespace app { }
}

// Create the instance.
export const App = global["app"] = new ModuleProxyApp("app", __dirname);

// Watch file changes and hot-reload modules.
App.watch();
```

In other files, just define and export a default class, and merge the type to 
the namespace `app`, so that another file can access it directly via namespace.

(NOTE: Microse offers first priority of the `default` export, if a module
doesn't have a default export, microse will try to load all exports instead.)

```typescript
// Be aware that the namespace must correspond to the filename.
// src/bootstrap.ts
import { ModuleProxy } from "microse";

declare global {
    namespace app {
        const bootstrap: ModuleProxy<Bootstrap>
    }
}

export default class Bootstrap {
    init() {
        // ...
    }
}
```

```typescript
// src/models/user.ts
import { ModuleProxy } from "microse";

declare global {
    namespace app {
        namespace models {
            // a module class with parameters must use the signature `typeof T`.
            const user: ModuleProxy<typeof User>
        }
    }
}

export default class User {
    constructor(private name: string) { }

    getName() {
        return this.name;
    }

    setName(name: string) {
        this.name = name
    }
}
```

And other files can access to the modules via the namespace:

```typescript
// src/index.ts
import "./app";

// Accessing the module as a singleton and call its function directly.
app.bootstrap.init();

// Using `new` syntax on the module to create a new instance.
var user = new app.models.user("Mr. Handsome");

console.log(user.getName()); // Mr. Handsome
```

### Prototype Module

Any module that exports an object as default will be considered as a prototype 
module, when creating a new instance of that module, the object will be used as
a prototype (a deep clone will be created, if an argument is passed, it will be
merged into the new object). However when calling the singleton of that module,
the original object itself will be returned.

```typescript
// src/config.ts
import { ModuleProxy } from "microse";

declare global {
    namespace app {
        const config: ModuleProxy<Config>;
    }
}

export interface Config {
    // ...
}

export default <Config>{
    // ...
}
```

## Remote Service

RPC is the central part of microse engine, which allows user to serve a module
remotely, whether in another process or in another machine.

### Example

For example, if I want to serve a user service in a different process and
communicate via RPC channel, I just have to do this:

```typescript
// src/services/user.ts
import { ModuleProxy } from "microse";

declare global {
    namespace app {
        namespace services {
            const user: ModuleProxy<typeof UserService>
        }
    }
}

// It is recommended not to define the 'constructor' or use a non-parameter
// constructor.
export default class UserService {
    private users: { firstName: string, lastName: string }[] = [
        { firstName: "David", lastName: "Wood" },
        // ...
    ];

    // Any method that will potentially be called remotely shall be async.
    async getFullName(firstName: string) {
        let user = this.users.find(user => {
            return user.firstName === firstName;
        });

        return user ? `${firstName} ${user.lastName}` : void 0;
    }
}
```

```typescript
// src/remote-service.ts
import { App } from "./app";

(async () => {
    let service = await App.serve("ws://localhost:4000");

    await service.register(app.services.user);

    console.log("Service started!");
})();
```

Just try `ts-node --files src/remote-service` (or `node dist/remote-service`), 
and the service will be started immediately.

And in **index.ts**, connect to the service before using remote functions:

```typescript
// index.ts
import { App } from "./app";

(async () => {
    let service = await App.connect("ws://localhost:4000");

    // Once registered, all functions of the service module will be remotized.
    await service.register(app.services.user);

    // Accessing the instance in local style but actually calling remote.
    let fullName = await app.services.user.getFullName("David");

    console.log(fullName); // David Wood
})();
```

### Hot-reloading in Remote Service

The local watcher may notice the local file has been changed and try to reload
the local module (and the local singleton), however, it will not affect any
remote instances, that said, the instance served remotely can still be watched
and reloaded on the remote server individually.

In the above example, since the **remote-service.ts** module imports **app.ts**
module as well, which starts the watcher, when the **user.ts** module is changed,
the **remote-service.ts** will reload the module as expected, and the
**index.ts** calls it remotely will get the new result as expected.

## Generator Support

When in the need of transferring large data, generator functions could be a
great help, unlike general functions, which may block network traffic when
transmitting large data since they send the data as a whole, generator functions,
on the other hand, will transfer the data piece by piece.

```typescript
// src/services/user.ts
import { ModuleProxy } from "microse";

declare global {
    namespace app {
        namespace services {
            const user: ModuleProxy<UserService>
        }
    }
}

export default class UserService {
    private friends = {
        "David": [
            { firstName: "Albert", lastName: "Einstein" },
            { firstName: "Nicola", lastName: "Tesla" },
            // ...
        ],
        // ...
    }

    async *getFriendsOf(name: string) {
        let friends = this.friends[name]

        if (friends) {
            for (let friend of friends) {
                yield `${friend.firstName} ${friend.lastName}`;
            }
        }

        return "We are buddies";
    }
}
```

```ts
// index.ts
(async () => {
    let generator = app.services.user.getFriendsOf("David");

    for await (let name of generator) {
        console.log(name);
        // Albert Einstein
        // Nicola tesla
        // ...
    }

    // The following usage gets the same result.
    let generator2 = app.services.user.getFriendsOf();

    while (true) {
        let { value, done } = await generator2.next();

        console.log(value);
        // NOTE: calling next() will return the returning value of the generator
        // as well, so the output would be:
        //
        // Albert Einstein
        // Nicola tesla
        // ...
        // We are buddies

        if (done) {
            break;
        }
    }
})();
```

## Life Cycle Support

Microse provides a way to support life cycle functions, if a service class has
an `init()` method, it will be used for asynchronous initiation, and if the
class has a `destroy()` method, it will be used for asynchronous destruction.
With these feature, the service class can, for example, connect to a database
when starting the server and release the connection when the server shuts down.

This feature will still work after hot-reloaded the module. However, there
would be a slight downtime during hot-reloading, and any call would fail until
the service is re-available again.

```ts
// src/services/user.ts
declare global {
    namespace app {
        namespace services {
            const user: ModuleProxy<UserService>
        }
    }
}

export default class UserService {
    async init() {
        // ...
    }

    async destroy() {
        // ...
    }
}
```

## Standalone Client

Microse also supports running as a standalone client outside the main program
codebase, Instead of importing from the main module, we import the 
`microse/client` sub-module, which is designed to be run in standalone Node.js
programs or even web apps. The client will not actually load any modules since
there are no such files, instead, it just map the module names so you can use
them as usual. To create a standalone client, use the following code:

```ts
import { ModuleProxyApp } from "microse/client";

const app = global.app = new ModuleProxyApp("app"); // no path needed

(async () => {
    client = await app.connect("ws://localhost:4000");
    
    await client.register(app.services.user)
})();
```

And when declaring modules, just pass an interface to `ModuleProxy`:

```ts
import { ModuleProxy } from "microse/client";

declare global {
    namespace app {
        namespace services {
            const user: ModuleProxy<UserService>;
        }
    }
}

interface UserService { // or use `declare class`
    getName(id: number): Promise<string>;
    setName(id: number, name: string): void;
}
```

For more details, please check the [API documentation](./docs/api.md).
