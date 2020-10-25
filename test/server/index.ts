import config from "../app/config";
import define from "@hyurl/utils/define";
import * as fs from "fs-extra";
import * as http from "http";
import "../app/error";
import { ModuleProxyApp, RpcServer } from "../../src";

export const App = new ModuleProxyApp("app", __dirname + "/../app");

define(global, "app", App);

(async () => {
    var server: RpcServer;

    if (process.env["USE_IPC"]) {
        server = await App.serve(<string>process.env["USE_IPC"]);
    } else if (process.env["USE_URL"]) {
        server = await App.serve(<string>process.env["USE_URL"]);
    } else if (process.env["USE_ID"]) {
        server = await App.serve({ ...config, id: process.env["USE_ID"] });
    } else if (process.env["USE_SECRET"]) {
        server = await App.serve({ ...config, secret: process.env["USE_SECRET"] });
    } else if (process.env["USE_CODEC"]) {
        server = await App.serve({ ...config, codec: <any>process.env["USE_CODEC"] });
    } else if (process.env["USE_COMPRESS"]) {
        server = await App.serve({ ...config, compress: true });
    } else if (process.env["USE_WSS"]) {
        server = await App.serve({
            ...config,
            protocol: "wss:",
            hostname: "localhost",
            key: await fs.readFile(process.cwd() + "/test/key.pem", "utf8"),
            cert: await fs.readFile(process.cwd() + "/test/cert.pem", "utf8"),
            passphrase: "alartest"
        });
    } else if (process.env["USE_HTTP"]) {
        let httpServer = http.createServer();
        server = await App.serve({ httpServer });
        await new Promise(resolve => httpServer.listen(config.port, config.hostname, resolve));
    } else {
        server = await App.serve(config);
    }

    await server.register(app.services.detail);

    process.send("ready");

    process.on("message", async (msg) => {
        if (msg === "exit") {
            await server.close();
            process.send("exited");
        }
    });
})();
