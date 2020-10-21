module.exports = {
    mode: "production",
    entry: "./src/client/index.ts",
    devtool: "source-map",
    target: "node",
    externals: {
        url: "url",
        path: "path",
        ws: "WebSocket",
        fron: "FRON",
        bson: "BSON",
        "bson-ext": "BsonExt"
    },
    output: {
        path: __dirname + "/client-bundle",
        filename: "index.js",
        library: "alar",
        libraryTarget: "umd",
        globalObject: "this",
    },
    resolve: {
        extensions: [".ts", ".js"]
    },
    module: {
        rules: [
            {
                test: /\.ts?$/,
                loader: "ts-loader"
            }
        ]
    }
};
