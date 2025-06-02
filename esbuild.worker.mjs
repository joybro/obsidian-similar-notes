import builtins from "builtin-modules";
import esbuild from "esbuild";

// This is a workaround to build the worker file for the tests
// for production, we build the worker file with esbuild-plugin-inline-worker plugin
// and use the built file in the main.js

esbuild
    .build({
        entryPoints: [
            "src/domain/service/transformers.worker.ts",
            "src/adapter/orama/orama.worker.ts",
        ],
        bundle: true,
        outdir: "public",
        format: "iife",
        platform: "browser",
        target: "es2020",
        minify: true,
        define: {
            "process.versions.node": "undefined",
            "process.versions": "undefined",
            process: "undefined",
        },
        external: ["node:worker_threads", ...builtins],
    })
    .catch(() => process.exit(1));
