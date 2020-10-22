import { ModuleProxy } from "../../src";

declare global {
    namespace app {
        const config: ModuleProxy<{
            host: string;
            port: number;
            timeout: number;
            get?: (name: string) => Promise<string>;
        }>;
    }
}

export default {
    hostname: "127.0.0.1",
    port: 18888,
    timeout: 1000
};

export async function get(name: string) {
    return exports.default[name] ?? null;
}
