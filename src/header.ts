import "@hyurl/utils/types";

type EnsureParameters<T> = T extends new (...args: infer A) => any ? A : any[];
type EnsureInstanceType<T> = T extends new (...args: any[]) => infer R ? R : T;
// type Voidable<T> = { [K in keyof T]: T[K] | void };
// type AsynchronizedFunctionProperties<T> = {
//     [K in keyof FunctionProperties<T>]: Asynchronize<T[K]>;
// };

export type ModuleProxy<T> = EnsureInstanceType<T> & {
    /**
     * When using `new` syntax on the module, this signature is called for
     * creating a new instance of the module class.
     */
    new(...args: EnsureParameters<T>): EnsureInstanceType<T>;

    /** The name (with namespace) of the module. */
    readonly name: string;
    /** The path (without extension) of the module. */
    readonly path: string;
    /** The very exports object of the module. */
    readonly exports: any;
    /** The very prototype of the module. */
    readonly proto: EnsureInstanceType<T>;
    /** The very class constructor of the module. */
    readonly ctor: T extends Function ? T : new (...args: any[]) => EnsureInstanceType<T>;
};

export interface ModuleLoader {
    [x: string]: any;
    /**
     * Extension name of the module file, by default, it's `.js` (or `.ts` in 
     * ts-node).
     */
    extension: string | string[],
    /**
     * It is recommended using this property to store loaded modules, so that
     * the internal watcher can manipulate the cache when necessary.
     */
    cache?: { [filename: string]: any; };
    /** Loads module from the given file or cache. */
    load(filename: string): any;
    /** Unloads the module in the cache if the file is modified. */
    unload(filename: string): void;
}
