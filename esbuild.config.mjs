import builtins from "builtin-modules";
import esbuild from "esbuild";
import inlineWorkerPlugin from "esbuild-plugin-inline-worker";
import process from "node:process";

const prod = process.argv[2] === "production";

const buildOptions = {
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: ["obsidian", "electron", ...builtins],
    format: "cjs",
    target: "es2020",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    outfile: "main.js",
    plugins: [inlineWorkerPlugin()],
};

if (prod) {
    // Production build
    esbuild.build(buildOptions).catch(() => process.exit(1));
} else {
    // Development build with watch
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
}
