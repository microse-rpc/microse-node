import "source-map-support/register";
import * as assert from "assert";
import define from "@hyurl/utils/define";
import sleep from "@hyurl/utils/sleep";
import config from "./app/config";
import { ModuleProxyApp } from "../src";

const App = new ModuleProxyApp("app", __dirname + "/app");

describe("Pub-Sub", () => {
    before(() => {
        define(global, "app", App);
    });

    it("should get all clients connected to the service", async () => {
        let server = await App.serve(config);
        let client = await App.connect(config);

        assert.deepStrictEqual(server.getClients(), [client.id]);

        await client.close();
        await server.close();
    });

    it("should subscribe and publish a topic", async () => {
        let server = await App.serve(config);
        let client = await App.connect(config);
        let data: string;

        client.subscribe("set-data", msg => {
            data = msg;
        });

        server.publish("set-data", "Mr. World");

        while (!data) {
            await sleep(50);
        }

        assert.strictEqual(data, "Mr. World");

        await client.close();
        await server.close();
    });

    it("should subscribe and publish multiple topics", async () => {
        let server = await App.serve(config);
        let client = await App.connect(config);
        let data1: string;
        let data2: string;
        let data3: string;

        client.subscribe("set-data", msg => {
            data1 = msg;
        }).subscribe("set-data", msg => {
            data2 = msg;
        }).subscribe("set-data-2", msg => {
            data3 = msg;
        });

        server.publish("set-data", "Mr. World");
        server.publish("set-data-2", "Mr. World");

        while (!data1 || !data2 || !data3) {
            await sleep(50);
        }

        assert.strictEqual(data1, "Mr. World");
        assert.strictEqual(data2, "Mr. World");
        assert.strictEqual(data3, "Mr. World");

        await client.close();
        await server.close();
    });

    it("should unsubscribe topic handlers", async () => {
        let server = await App.serve(config);
        let client = await App.connect(config);
        let listener1 = () => null;
        let listener2 = () => null;

        client.subscribe("set-data", listener1)
            .subscribe("set-data", listener2)
            .subscribe("set-data-2", listener1)
            .subscribe("set-data-2", listener2);

        client.unsubscribe("set-data", listener1);
        client.unsubscribe("set-data-2");

        assert(client["topics"] instanceof Map);
        assert(client["topics"].size === 1);
        assert(client["topics"].get("set-data") instanceof Set);
        assert(client["topics"].get("set-data").size === 1);
        assert(client["topics"].get("set-data").has(listener2));

        await client.close();
        await server.close();
    });

    it("should publish a topic to specified clients", async () => {
        let server = await App.serve(config);
        let client = await App.connect(Object.assign({}, config, { id: "abc" }));
        let data: string;

        assert.strictEqual(client.id, "abc");

        client.subscribe("set-data", msg => {
            data = msg;
        });

        server.publish("set-data", "Mr. World", ["abc"]);

        while (!data) {
            await sleep(50);
        }

        assert.strictEqual(data, "Mr. World");

        await client.close();
        await server.close();
    });
});
