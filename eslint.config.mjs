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
            "max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }],
            // main's manifest still says minAppVersion 1.8.9 while the settings tab
            // has used 1.11 APIs since 1.0.0. The 1.8.0 release raises it to 1.11.0
            // (branch lime/release-1.8.0); make this "error" again once main does.
            "obsidianmd/no-unsupported-api": "warn",
            "@typescript-eslint/no-unused-vars": ["error", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
            }],
        },
    },
    {
        // Functions that were already longer than 80 lines when the limit was
        // lowered from 150. They keep the old limit so they cannot grow further;
        // remove a path from this list once its functions fit in 80 lines.
        files: [
            "src/application/NoteIndexingService.ts",
            "src/application/SimilarNoteCoordinator.ts",
            "src/components/GeminiSettingsSection.tsx",
            "src/components/NoteBottomViewReact.tsx",
            "src/components/OllamaSettingsSection.tsx",
            "src/components/OpenAISettingsSection.tsx",
            "src/components/SemanticSearchModal.tsx",
            "src/components/SimilarNotesSettingTab.tsx",
            "src/components/StatusBarView.ts",
            "src/domain/service/EmbeddingService.ts",
            "src/domain/service/SimilarNoteFinder.ts",
            "src/infrastructure/noteChangeQueue.ts",
            "src/main.ts",
        ],
        rules: {
            "max-lines-per-function": ["error", { max: 150, skipBlankLines: true, skipComments: true }],
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
