import * as assert from "assert";
import { ModuleProxyApp } from "../client";
import config from "./app/config";
import { fork, kill } from "./server/process";
import sleep from "@hyurl/utils/sleep";
import MyError from "./app/error";
import * as fs from "fs-extra";

export default function (App: ModuleProxyApp) {
    it("should serve and connect an RPC service", async () => {
        let serverProcess = await fork(__dirname + "/server/index.js");

        let client = await App.connect(config);

        assert.strictEqual(client.dsn, "ws://127.0.0.1:18888/");
        assert.strictEqual(client.serverId, "ws://127.0.0.1:18888/");

        await client.register(app.services.detail);
        await app.services.detail.setName("Mr. Handsome");

        assert.strictEqual(await app.services.detail.getName(), "Mr. Handsome");

        await client.close();
        await kill(serverProcess);
    });

    it("should serve and connect an RPC service with a secret key", async () => {
        let serverProcess = await fork(__dirname + "/server/index.js", { USE_SECRET: "tesla" });
        let client = await App.connect({ ...config, secret: "tesla" });

        await client.register(app.services.detail);
        await app.services.detail.setName("Mr. Handsome");

        assert.strictEqual(await app.services.detail.getName(), "Mr. Handsome");

        await client.close();
        await kill(serverProcess);
    });

    it("should serve and connect an RPC service via a URL", async () => {
        let url = "ws://localhost:18888/microse";
        let serverProcess = await fork(__dirname + "/server/index.js", { USE_URL: url });
        let client = await App.connect(url);

        assert.strictEqual(client.dsn, url);
        assert.strictEqual(client.serverId, url);

        await client.register(app.services.detail);
        await app.services.detail.setName("Mr. Handsome");

        assert.strictEqual(await app.services.detail.getName(), "Mr. Handsome");

        await client.close();
        await kill(serverProcess);
    });

    it("should serve and connect an RPC service using WSS protocol", async () => {
        let serverProcess = await fork(__dirname + "/server/index.js", { USE_WSS: "true" });
        let client = await App.connect({
            ...config,
            protocol: "wss:",
            hostname: "localhost",
            ca: [await fs.readFile(process.cwd() + "/test/cert.pem")]
        });

        assert.strictEqual(client.dsn, "wss://localhost:18888/");
        assert.strictEqual(client.serverId, client.dsn);

        await client.register(app.services.detail);

        assert.strictEqual(await app.services.detail.getName(), "Mr. World");

        await client.close();
        await kill(serverProcess);
    });

    it("should reconnect the RPC service in the background automatically", async function () {
        this.timeout(3000);
        let filename = __dirname + "/server/index.js";
        let serverProcess = await fork(filename, { USE_SECRET: "tesla" });
        let client = await App.connect({ ...config, secret: "tesla" });

        await client.register(app.services.detail);

        // kill the server and restart it, the client will reconnect in the
        // background automatically.
        await kill(serverProcess);
        serverProcess = await fork(filename, { USE_SECRET: "tesla" });

        while (!client.connected) {
            await sleep(100);
        }

        assert.strictEqual(await app.services.detail.getName(), "Mr. World");

        await client.close();
        await kill(serverProcess);
    });

    it("should reject error is no remote service is available", async () => {
        let serverProcess = await fork(__dirname + "/server/index.js");
        let client = await App.connect(config);
        let err: ReferenceError;

        await client.register(app.services.detail);
        await kill(serverProcess);

        try {
            await app.services.detail.getName();
        } catch (e) {
            err = e;
        }

        assert.ok(err instanceof ReferenceError);

        await client.close();
    });

    it("should get result from a remote generator", async () => {
        let serverProcess = await fork(__dirname + "/server/index.js");
        let client = await App.connect(config);
        let result: (string | string[])[] = [];

        await client.register(app.services.detail);

        let generator = app.services.detail.getOrgs("Open Source", "Good Fella");
        while (true) {
            let res = await generator.next();

            result.push(res.value);

            if (res.done) {
                break;
            }
        }

        assert.deepStrictEqual(result, [
            "Mozilla",
            "GitHub",
            "Linux",
            ["Open Source", "Good Fella"]
        ]);

        await client.close();
        await kill(serverProcess);
    });

    it("should invoke next method on the remote generator", async () => {
        let serverProcess = await fork(__dirname + "/server/index.js");
        let client = await App.connect(config);

        await client.register(app.services.detail);

        let generator = app.services.detail.repeatAfterMe("12345");
        let result = await generator.next(<any>"Baidu");
        let result1 = await generator.next(<any>"Google");
        let returns = await generator.next(<any>"break");

        assert.deepStrictEqual(result, { value: undefined, done: false });
        assert.deepStrictEqual(result1, { value: "Google", done: false });
        assert.deepStrictEqual(returns, { value: "12345", done: true });

        await client.close();
        await kill(serverProcess);
    });

    it("should invoke return method on the remote generator", async () => {
        let serverProcess = await fork(__dirname + "/server/index.js");
        let client = await App.connect(config);

        await client.register(app.services.detail);

        let generator = app.services.detail.repeatAfterMe();
        let result = await generator.return("Google");

        assert.deepStrictEqual(result, { value: "Google", done: true });

        await client.close();
        await kill(serverProcess);
    });

    it("should invoke throw method on the remote generator", async () => {
        let serverProcess = await fork(__dirname + "/server/index.js");
        let client = await App.connect(config);

        await client.register(app.services.detail);

        let generator = app.services.detail.repeatAfterMe();
        let _err = new Error("test throw method");
        let err: Error;

        try {
            await generator.throw(_err);
        } catch (e) {
            err = e;
        }

        assert.ok(err instanceof Error);
        assert.strictEqual(err.message, "test throw method");
        assert.deepStrictEqual(await generator.next(), { value: undefined, done: true });

        await client.close();
        await kill(serverProcess);
    });

    it("should trigger timeout error", async () => {
        let serverProcess = await fork(__dirname + "/server/index.js");
        let _config = Object.assign({}, config, { timeout: 1000 });
        let client = await App.connect(_config);

        await client.register(app.services.detail);

        let err: MyError;

        try {
            await app.services.detail.triggerTimeout();
        } catch (e) {
            err = e;
        }

        assert(err instanceof Error);
        assert.strictEqual(
            err.message,
            "app.services.detail.triggerTimeout() timeout after 1 second");

        if (process.platform === "win32") {
            assert(err.stack.includes(process.cwd() + "\\test\\"));
        } else {
            assert(err.stack.includes(process.cwd() + "/test/"));
        }

        await client.close();
        await kill(serverProcess);
    });

    it("should transmit a custom error", async () => {
        let serverProcess = await fork(__dirname + "/server/index.js");
        let client = await App.connect(config);

        await client.register(app.services.detail);

        let err: MyError;

        try {
            await app.services.detail.userError();
        } catch (e) {
            err = e;
        }

        assert.ok(err instanceof MyError);
        assert.strictEqual(err.name, "MyError");
        assert.strictEqual(err.message, "something went wrong");
        assert.strictEqual(err.toString(), "MyError: something went wrong");

        if (process.platform === "win32") {
            assert(err.stack.includes(process.cwd() + "\\test\\"));
        } else {
            assert(err.stack.includes(process.cwd() + "/test/"));
        }

        await client.close();
        await kill(serverProcess);
    });

    it("should transmit a non-standard error", async () => {
        let serverProcess = await fork(__dirname + "/server/index.js");
        let client = await App.connect(config);

        await client.register(app.services.detail);

        let err: string;

        try {
            await app.services.detail.nonStandardError();
        } catch (e) {
            err = e;
        }

        assert.strictEqual(err, "something went wrong");

        await client.close();
        await kill(serverProcess);
    });

    it("should invoke the remote method in the background", async () => {
        let serverProcess = await fork(__dirname + "/server/index.js");
        let client = await App.connect(config);

        await client.register(app.services.detail);

        let time = Date.now();

        // DO NOT await
        app.services.detail.setTime(time);
        await sleep(500);

        let _time = await fs.readFile(__dirname + "/app/services/.tmp", "utf8");
        assert.strictEqual(Number(_time), time);

        await client.close();
        await kill(serverProcess);
    });

    it("should invoke the remote method await it after a while", async () => {
        let serverProcess = await fork(__dirname + "/server/index.js");
        let client = await App.connect(config);

        await client.register(app.services.detail);

        let promise = app.services.detail.setAndGet("Hello, World!");

        await sleep(50);

        assert.strictEqual(await promise, "Hello, World!");

        await client.close();
        await kill(serverProcess);
    });

    it("should serve an RPC service using JSON codec", async () => {
        let serverProcess = await fork(__dirname + "/server/index.js", { USE_CODEC: "CLONE" });
        let client = await App.connect({ ...config, codec: "CLONE" });

        await client.register(app.services.detail);

        assert.strictEqual(await app.services.detail.getName(), "Mr. World");

        await client.close();
        await kill(serverProcess);
    });
}
