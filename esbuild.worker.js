const esbuild = require("esbuild");

esbuild
    .build({
        entryPoints: ["src/services/model/transformersWorker.ts"],
        bundle: true,
        outfile: "public/transformersWorker.js",
        format: "iife",
        platform: "browser",
        target: ["chrome58", "firefox57", "safari11", "edge16"],
        minify: true,
        define: {
            "process.versions.node": "undefined",
            "process.versions": "undefined",
            process: "undefined",
        },
        external: ["node:worker_threads"],
    })
    .catch(() => process.exit(1));
