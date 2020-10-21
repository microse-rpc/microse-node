import "source-map-support/register";
import * as assert from "assert";
import * as fs from "fs-extra";
import * as http from "http";
import config from "./app/config";
import { fork, kill } from "./server/process";
import * as WebSocket from "ws";
import define from "@hyurl/utils/define";
import sleep from "@hyurl/utils/sleep";
import commonTest from "./rpc-common";
import { ModuleProxyApp } from "./../src";

const App = new ModuleProxyApp("app", __dirname + "/app");

describe("Remote Instance", () => {
    before(async () => {
        define(global, "app", App);
    });

    it("should serve and connect an IPC service", async () => {
        // IPC on Windows is currently not supported.
        if (process.platform === "win32")
            return;

        let sockPath = process.cwd() + "/microse.sock";
        let serverProcess = await fork(__dirname + "/server/index.js", { USE_IPC: sockPath });

        let client = await App.connect(sockPath);

        await client.register(app.services.detail);
        await app.services.detail.setName("Mr. Handsome");

        assert.strictEqual(await app.services.detail.getName(), "Mr. Handsome");

        await client.close();
        await kill(serverProcess);
    });

    commonTest(<any>App);

    it("should serve the app via a custom HTTP server", async () => {
        let serverProcess = await fork(__dirname + "/server/index.js", { USE_HTTP: "true" });
        let client = await App.connect(config);

        await client.register(app.services.detail);

        assert.strictEqual(await app.services.detail.getName(), "Mr. World");

        await client.close();
        await kill(serverProcess);
    });

    it("should connect and invoke function via a custom WebSocket", async () => {
        let serverProcess = await fork(__dirname + "/server/index.js", { USE_CODEC: "JSON" });
        let socket = new WebSocket(`ws://${config.hostname}:${config.port}?id=abc123`);
        let result = await new Promise<string>(async (resolve) => {
            let ready = false;

            socket.onmessage = async e => {
                let msg = String(e.data);
                let res: [number, number, any] = JSON.parse(msg);
                let [event, taskId, data] = res;

                if (event === 1) {
                    ready = true;
                } else if (event === 3 && taskId === 1) { // RETURN
                    resolve(data);
                }
            };

            while (!ready) {
                await sleep(10);
            }

            socket.send(JSON.stringify([
                2, // INVOKE
                1, // taskId
                "app.services.detail",
                "getName",
                [] // arguments
            ]));
        });

        assert.strictEqual(result, "Mr. World");

        socket.close();
        await kill(serverProcess);
    });

    it("should refuse connect if no client id isn't provided", async function () {
        let server = await App.serve(config);
        let socket = new WebSocket(`ws://${config.hostname}:${config.port}`);
        let err = await new Promise<Error>(resolve => socket.once("error", resolve));

        assert.strictEqual(err.message, "Unexpected server response: 401");

        await server.close();
    });

    it("should refuse connect if the secret is incorrect", async () => {
        let _config = Object.assign({ secret: "tesla" }, config);
        let server = await App.serve(_config);
        let socket = new WebSocket(`ws://${config.hostname}:${config.port}?id=abc123&secret=test`);
        let err = await new Promise<Error>(resolve => socket.once("error", resolve));

        assert.strictEqual(err.message, "Unexpected server response: 401");

        await server.close();
    });

    it("should refuse connect if used a unrecognized pathname", async function () {
        let server = await App.serve(config);
        let socket = new WebSocket(`ws://${config.hostname}:${config.port}/somewhere?id=abc123`);
        let err = await new Promise<Error>(resolve => socket.once("error", resolve));

        assert.strictEqual(err.message, "Unexpected server response: 404");

        await server.close();
    });

    it("should refuse connect if sending an HTTP request to the server", async () => {
        let server = await App.serve(config);
        let err = await new Promise<Error>(resolve => {
            http.get(`http://${config.hostname}:${config.port}?id=abc123`, res => {
                let { statusCode, statusMessage } = res;

                if (statusCode !== 200) {
                    resolve(new Error(`${statusCode} ${statusMessage}`));
                } else {
                    resolve(null);
                }
            });
        });

        assert.strictEqual(err.message, "406 Not Acceptable");

        await server.close();
    });

    it("should close the server before closing the client", async () => {
        let server = await App.serve(config);
        let client = await App.connect(config);

        await server.register(app.services.detail);
        await client.register(app.services.detail);

        app.services.detail.getOrgs();
        assert.strictEqual(server["clients"].size, 1);
        assert.strictEqual(server["tasks"].size, 1);

        await server.close();
        assert.strictEqual(server["clients"].size, 0);
        assert.strictEqual(server["tasks"].size, 0);

        await client.close();
    });

    it("should trigger life cycle functions", async () => {
        app.services.detail.proto["init"] = async function init() {
            this.setName("Mr. Handsome");
        };
        app.services.detail.proto["destroy"] = async function destroy() {
            this.setName("Mr. World");
        };

        let server = await App.serve(config, false);

        await server.register(app.services.detail);

        assert.strictEqual(await app.services.detail.getName(), "Mr. Handsome");

        await server.close();

        assert.strictEqual(await app.services.detail.getName(), "Mr. World");

        app.services.detail.proto["init"] = null;
        app.services.detail.proto["destroy"] = null;
    });

    it("should watch file change and reload module", async function () {
        this.timeout(15000);
        let watcher = App.watch();
        let contents = await fs.readFile(app.services.detail.path + ".js", "utf8");
        let newContents: string;

        await new Promise(resolve => watcher.once("ready", resolve));

        // update file content
        newContents = contents.replace("return this.name", "return this.name + ' Buddy'");
        await fs.writeFile(app.services.detail.path + ".js", newContents, "utf8");
        await new Promise(resolve => watcher.once("change", resolve));
        await sleep(100); // wait a while for reload

        assert.strictEqual(await app.services.detail.getName(), "Mr. World Buddy");


        // recover file content
        newContents = contents.replace("return this.name + ' Buddy'", "return this.name");
        await fs.writeFile(app.services.detail.path + ".js", newContents, "utf8");
        await new Promise(resolve => watcher.once("change", resolve));
        await sleep(100);

        watcher.close();
    });
});
