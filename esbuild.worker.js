const esbuild = require("esbuild");

// This is a workaround to build the worker file for the tests
// for production, we build the worker file with esbuild-plugin-inline-worker plugin
// and use the built file in the main.js

esbuild
    .build({
        entryPoints: ["src/domain/service/transformers.worker.ts"],
        bundle: true,
        outfile: "public/transformers.worker.js",
        format: "iife",
        platform: "browser",
        target: "es2020",
        minify: true,
        define: {
            "process.versions.node": "undefined",
            "process.versions": "undefined",
            process: "undefined",
        },
        external: ["node:worker_threads"],
    })
    .catch(() => process.exit(1));
