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
    metafile: true,
    define: {
        "process.env.NODE_ENV": prod ? '"production"' : '"development"',
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

// Helper function to analyze bundle size from metafile
async function analyzeBundle(metafile) {
    // Sort imports by size (largest first)
    const imports = Object.entries(metafile.outputs["main.js"].imports || {});

    // Get the output file size
    const outputSize = metafile.outputs["main.js"].bytes;
    console.log(
        `\n📦 Bundle size: ${(outputSize / 1024 / 1024).toFixed(
            2
        )} MB (${outputSize.toLocaleString()} bytes)\n`
    );

    // Format bytes to human readable format
    const formatBytes = (bytes) => {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    // Analyze the modules included in the bundle
    console.log("🔍 Top 20 largest modules in the bundle:\n");

    // Get all inputs sorted by size (largest first)
    const sortedInputs = Object.entries(metafile.inputs)
        .map(([name, info]) => ({
            name,
            size: info.bytes,
            importedBy: info.imports?.map((imp) => imp.path) || [],
        }))
        .sort((a, b) => b.size - a.size);

    // Print top 20 modules by size
    sortedInputs.slice(0, 20).forEach((module, i) => {
        console.log(
            `${i + 1}. ${module.name} - ${formatBytes(module.size)} ${
                module.importedBy.length > 0
                    ? `(imported by ${module.importedBy.length} modules)`
                    : ""
            }`
        );
    });

    // Additional analysis tip
    console.log("\n💡 For more detailed analysis, check the 'meta.json' file.");
}

// Decide which build to perform based on arguments
if (buildWorkersOnly) {
    // Build workers only (for tests)
    console.log("Building workers only for tests...");
    esbuild.build(workerBuildOptions).catch(() => process.exit(1));
} else if (prod) {
    // Production build
    console.log("Building for production with bundle analysis...");
    const result = await esbuild.build(buildOptions);
    if (result.metafile) {
        // Write metafile for further analysis
        const fs = await import("fs/promises");
        await fs.writeFile(
            "meta.json",
            JSON.stringify(result.metafile, null, 2)
        );
        await analyzeBundle(result.metafile);
    }
} else {
    // Development build with watch
    console.log("Starting development build with bundle analysis...");
    const ctx = await esbuild.context(buildOptions);
    const buildResult = await ctx.rebuild();
    if (buildResult.metafile) {
        // Write metafile for further analysis
        const fs = await import("fs/promises");
        await fs.writeFile(
            "meta.json",
            JSON.stringify(buildResult.metafile, null, 2)
        );
        await analyzeBundle(buildResult.metafile);
    }
    await ctx.watch();
}
