import "source-map-support/register";
import * as assert from "assert";
import define from "@hyurl/utils/define";
import commonTest from "./rpc-common";
import { ModuleProxyApp } from "../src/client";

const App = new ModuleProxyApp("app");

describe("Standalone Client", () => {
    before(() => {
        define(global, "app", App);
    })

    it("should create a root module proxy instance", () => {
        assert.strictEqual(App.name, "app");
        assert.strictEqual(App.path, void 0);
    });

    it("should access to a module", () => {
        assert.strictEqual(app.simple.name, "app.simple");
        assert.strictEqual(app.simple.path, void 0);
        assert.strictEqual(app.simple.ctor, null);
        assert.strictEqual(app.simple.proto, null);
        assert.strictEqual(app.simple.exports, null);
    });

    it("should access to a deep module", () => {
        assert.strictEqual(app.services.detail.name, "app.services.detail");
        assert.strictEqual(app.services.detail.path, void 0);
        assert.strictEqual(app.services.detail.ctor, null);
        assert.strictEqual(app.services.detail.proto, null);
        assert.strictEqual(app.services.detail.exports, null);
    });

    it("should throw error if trying to create an instance", async () => {
        let err: Error;

        try {
            new app.services.detail("Mr. Handsome");
        } catch (e) {
            err = e;
        }

        assert(err instanceof TypeError);
        assert.strictEqual(err.message,
            "app.services.detail is not a constructor");
    });

    commonTest(App);
});
