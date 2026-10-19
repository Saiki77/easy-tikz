// esbuild plugin: `await import('http')` (the AI server, loaded on a computer
// only) becomes a module that runs `require('http')` when it is first
// imported. esbuild 0.13 would keep the dynamic import as it is, and inside
// Obsidian that goes to the browser's module loader instead of Node's
// require. Static imports and require() calls are not touched.
export const lazyNodeModules = {
    name: 'lazy-node-modules',
    setup(build) {
        build.onResolve({ filter: /^(node:)?http$/ }, (args) => (args.kind === 'dynamic-import' ? { path: args.path, namespace: 'lazy-node' } : undefined));
        build.onLoad({ filter: /.*/, namespace: 'lazy-node' }, (args) => ({ contents: `module.exports = require(${JSON.stringify(args.path)});`, loader: 'js' }));
        // The require() inside that module stays Node's.
        build.onResolve({ filter: /.*/, namespace: 'lazy-node' }, (args) => ({ path: args.path, external: true }));
    },
};
