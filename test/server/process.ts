import * as childProcess from "child_process";

export function fork(
    filename: string,
    env: Record<string, string> = {}
): Promise<childProcess.ChildProcess> {
    return new Promise((resolve, reject) => {
        let prox = childProcess.fork(filename, { env });

        prox.once("error", reject).once("message", msg => {
            if (msg === "ready") {
                resolve(prox);
            }
        });
    });
}

export function kill(prox: childProcess.ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
        prox.send("exit");
        prox.once("exit", reject).once("message", msg => {
            if (msg === "exited") {
                prox.kill();
                resolve();
            }
        });
    });
}
