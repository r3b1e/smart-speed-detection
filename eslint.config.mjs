import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.venv/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/*.d.ts",
      "prompt.md",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  {
    files: [
      "**/scripts/**",
      "**/*.config.*",
      "**/seed/**",
      "**/src/logger.ts",
      "**/src/**/logger.ts",
      "**/src/index.ts",
    ],
    rules: { "no-console": "off" },
  },
  {
    files: ["**/__tests__/**", "**/*.test.ts", "**/tests/**"],
    rules: { "no-console": "off" },
  },
  prettier
);
