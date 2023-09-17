const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
    mode: "production",
    entry: "./src/client/index.ts",
    devtool: "source-map",
    target: "node",
    externals: {
        url: "url",
        path: "path",
        ws: "WebSocket"
    },
    output: {
        path: __dirname + "/client-bundle",
        filename: "index.js",
        library: "microse",
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
                loader: "ts-loader",
                options: {
                    configFile: "tsconfig.json",
                }
            }
        ]
    },
    optimization: {
        minimizer: [
            new TerserPlugin({
                parallel: true,
                terserOptions: {
                    keep_classnames: true,
                    keep_fnames: true,
                },
            }),
        ],
    },
};
