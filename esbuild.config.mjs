import builtins from "builtin-modules";
import esbuild from "esbuild";
import inlineWorkerPlugin from "esbuild-plugin-inline-worker";
import { polyfillNode } from "esbuild-plugin-polyfill-node";
import process from "node:process";

// Check if we should build workers only (for tests)
const buildWorkersOnly = process.argv[2] === "workers-only";

const prod = process.argv[2] === "production";

const polyfillPlugin = polyfillNode({
    globals: false,
    polyfills: {
        stream: true,
    },
});

const buildOptions = {
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: ["obsidian", "electron", ...builtins],
    format: "cjs",
    platform: "browser",
    target: "es2020",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    minify: prod ? true : false,
    outfile: "main.js",
    define: {
        "process.env.NODE_ENV": prod ? "\"production\"" : "\"development\"",
    },
    plugins: [
        inlineWorkerPlugin({
            define: {
                __IS_TEST__: "false", // Production build is not test
            },
            plugins: [polyfillPlugin],
        }),
    ],
};

// Worker build configuration for tests
const workerBuildOptions = {
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
        __IS_TEST__: "true", // Worker-only build is test environment
    },
    external: ["node:worker_threads", ...builtins],
    plugins: [polyfillPlugin],
};

// Decide which build to perform based on arguments
if (buildWorkersOnly) {
    // Build workers only (for tests)
    console.log("Building workers only for tests...");
    esbuild.build(workerBuildOptions).catch(() => process.exit(1));
} else if (prod) {
    // Production build
    esbuild.build(buildOptions).catch(() => process.exit(1));
} else {
    // Development build with watch
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
}
