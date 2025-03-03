module.exports = {
    preset: "ts-jest",
    testEnvironment: "jsdom",
    moduleNameMapper: {
        "^obsidian$": "<rootDir>/src/__mocks__/obsidian.ts",
    },
    transform: {
        "^.+\\.tsx?$": [
            "ts-jest",
            {
                tsconfig: "tsconfig.json",
                isolatedModules: true,
            },
        ],
    },
    setupFilesAfterEnv: ["<rootDir>/src/setupTests.ts"],
};
