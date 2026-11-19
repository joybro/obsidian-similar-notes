// ESLint 9 flat config. eslint-plugin-obsidianmd's recommended set is what the
// community.obsidian.md automated review runs, so lint here catches it first.
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import eslintReact from "@eslint-react/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const testFiles = [
    "src/**/__tests__/**",
    "src/**/__mocks__/**",
    "src/**/*.test.ts",
    "src/**/*.test.tsx",
    "src/test-setup.ts",
];

export default defineConfig([
    // Build output, Node build scripts and generated/static assets are not plugin source.
    globalIgnores([
        "node_modules",
        "main.js",
        "public",
        "scripts",
        "docs",
        "*.config.js",
        "*.config.mjs",
        "*.config.ts",
        "version-bump.mjs",
    ]),
    ...obsidianmd.configs.recommended,
    {
        files: ["src/**/*.tsx"],
        ...eslintReact.configs["recommended-typescript"],
    },
    {
        files: ["src/**/*.ts", "src/**/*.tsx"],
        languageOptions: {
            parserOptions: {
                project: "./tsconfig.eslint.json",
                tsconfigRootDir: import.meta.dirname,
                ecmaFeatures: { jsx: true },
            },
        },
        plugins: { "react-hooks": reactHooks },
        rules: {
            ...reactHooks.configs.recommended.rules,
            indent: ["error", 4, { SwitchCase: 1 }],
            "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
            "max-lines-per-function": ["error", { max: 150, skipBlankLines: true, skipComments: true }],
            "@typescript-eslint/no-unused-vars": ["error", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
            }],
        },
    },
    {
        files: testFiles,
        languageOptions: { globals: { ...globals.node } },
        // Tests poke at mocks and private members; the type-safety rules the
        // community review applies to plugin code are noise here.
        rules: {
            "max-lines": "off",
            "max-lines-per-function": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unsafe-assignment": "off",
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-unsafe-return": "off",
            "@typescript-eslint/no-unsafe-argument": "off",
            "@typescript-eslint/no-unsafe-call": "off",
            "@typescript-eslint/unbound-method": "off",
            "@typescript-eslint/no-floating-promises": "off",
            "eslint-comments/no-restricted-disable": "off",
        },
    },
]);
