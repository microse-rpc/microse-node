import "source-map-support/register";
import * as assert from "assert";
import * as path from "path";
import * as fs from "fs-extra";
import Simple from "./app/simple";
import type iDetail from "./app/services/detail";
import config from "./app/config";
import define from "@hyurl/utils/define";
import { ModuleProxyApp, ModuleProxy } from "../src";

const App = new ModuleProxyApp("app", __dirname + "/app");
let Detail: typeof iDetail;

describe("Local Instance", () => {
    before(async () => {
        define(global, "app", App);
        Detail = (await import("./app/services/detail")).default;
    });

    it("should create a root module proxy instance", () => {
        assert.strictEqual(App.name, "app");
        assert.strictEqual(App.path, path.normalize(__dirname + "/app"));
    });

    it("should access to a module", () => {
        assert.strictEqual(app.simple.name, "app.simple");
        assert.strictEqual(app.simple.path, path.normalize(__dirname + "/app/simple"));
        assert.strictEqual(app.simple.ctor, Simple);
    });

    it("should access to a deep module", () => {
        assert.strictEqual(app.services.detail.name, "app.services.detail");
        assert.strictEqual(app.services.detail.path, path.normalize(__dirname + "/app/services/detail"));
        assert.strictEqual(app.services.detail.ctor, Detail);
    });

    it("should resolve module name according to the given path", () => {
        assert.strictEqual(App.resolve(app.services.detail.path), "app.services.detail");
        assert.strictEqual(App.resolve(app.services.detail.path + ".js"), "app.services.detail");
    });

    it("should call Object.prototype.toString() on the module proxy", () => {
        assert.strictEqual(
            Object.prototype.toString.call(app.services.detail),
            "[object ModuleProxy]"
        );
    });

    it("should create an instance", async () => {
        let test = new app.services.detail("Mr. Handsome");

        assert.ok(test instanceof Detail);
        assert.strictEqual(test.name, "Mr. Handsome");
        assert.strictEqual(await test.getName(), test.name);
    });

    it("should get the singleton instance", async () => {
        await app.services.detail.setName("Mr. Handsome");
        assert.strictEqual(await app.services.detail.getName(), "Mr. Handsome");
        await app.services.detail.setName("Mr. World");
        assert.strictEqual(await app.services.detail.getName(), "Mr. World");
    });

    it("should pass instanceof check onto the module proxy", () => {
        let test = new app.services.detail("A-yon Lee");
        assert(test instanceof app.services.detail);
    });

    it("should access to a prototype module", () => {
        assert.strictEqual(app.config.name, "app.config");
        assert.strictEqual(app.config.path, path.normalize(__dirname + "/app/config"));
        assert.deepStrictEqual(app.config.proto, config);
    });

    it("should create an instance from a prototype module", () => {
        let ins = new app.config();
        assert.deepStrictEqual(ins, config);

        let ins2 = new app.config({ host: "localhost" });
        assert.deepStrictEqual(ins2, { ...config, host: "localhost" });
    });

    it("should use a custom loader to load JSON module", () => {
        let Json = new ModuleProxyApp("json", __dirname + "/json");
        let cache = {};
        let json: ModuleProxy<any> = Json;

        Json.setLoader({
            extension: ".json",
            load(filename) {
                return cache[filename] || (
                    cache[filename] = JSON.parse(fs.readFileSync(filename, "utf8"))
                );
            },
            unload(filename) {
                cache[filename] && (delete cache[filename]);
            }
        });

        assert.deepStrictEqual(json.test.exports, { name: "JSON", version: "1.0.0" });
    });

    it("should use a custom loader with multiple extensions", () => {
        let Json = new ModuleProxyApp("json", __dirname + "/json");
        let json: ModuleProxy<any> = Json;
        let expected = {
            foo: "Hello",
            bar: "World"
        };

        Json.setLoader({
            cache: {},
            extension: [".js", ".json"],
            load(filename) {
                let ext = path.extname(filename);

                if (ext === ".js") {
                    return require(filename);
                } else if (this.cache[filename]) {
                    return this.cache[filename];
                } else { // .json
                    let content = fs.readFileSync(filename, "utf8");
                    let result = JSON.parse(content);
                    return (this.cache[filename] = result);
                }
            },
            unload(filename) {
                delete this.cache[filename];
            }
        });

        assert.deepStrictEqual(json.test1.exports, { "default": expected });
        assert.deepStrictEqual(json.test2.exports, expected);
        assert.strictEqual(Json.resolve(__dirname + "/json/test1.js"), "json.test1");
        assert.strictEqual(Json.resolve(__dirname + "/json/test2.json"), "json.test2");
    });

    it("should get result from a local generator", async () => {
        let result: (string | string[])[] = [];
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
    });

    it("should invoke next method in the local generator", async () => {
        let generator = app.services.detail.repeatAfterMe();
        let result = await generator.next(<any>"Google");
        let result1 = await generator.next(<any>"Google");

        assert.deepStrictEqual(result, { value: undefined, done: false });
        assert.deepStrictEqual(result1, { value: "Google", done: false });
    });

    it("should invoke return method in the local generator", async () => {
        let generator = app.services.detail.repeatAfterMe();
        let result = await generator.return("Google");

        assert.deepStrictEqual(result, { value: "Google", done: true });
    });

    it("should invoke throw method in the local generator", async () => {
        let generator = app.services.detail.repeatAfterMe();
        let _err = new Error("test throw method");
        let err: Error;

        try {
            await generator.throw(_err);
        } catch (e) {
            err = e;
        }

        assert.ok(err === _err);
        assert.ok(err instanceof Error);
        assert.strictEqual(err.message, "test throw method");
        assert.deepStrictEqual(await generator.next(), { value: undefined, done: true });
    });

    it("should return as-is from a local instance regular method", async () => {
        let data = {};
        let name = await app.services.detail.getName();
        let result = await app.services.detail.setAndGet(data);

        assert.strictEqual(name, "Mr. World");
        assert.strictEqual(result, data);
    });

    it("should use local instance if the client and server runs in the same process", async () => {
        let server = await App.serve(config);
        let client = await App.connect(config);

        await client.register(app.services.detail);

        let data = {};
        let result = await app.services.detail.setAndGet(data);

        assert(result === data);

        await client.close();
        await server.close();
    });
});
