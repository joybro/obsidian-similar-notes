import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: "jsdom",
        setupFiles: ["./src/test/setup.ts"],
        include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
        coverage: {
            provider: "v8",
            reporter: ["text", "json", "html"],
            include: ["src/**/*.{js,jsx,ts,tsx}"],
            exclude: ["**/*.{test,spec}.{js,jsx,ts,tsx}", "**/node_modules/**"],
        },
        mockReset: true,
    },
    resolve: {
        alias: {
            obsidian: resolve(__dirname, "src/__mocks__/obsidian.ts"),
        },
    },
});
