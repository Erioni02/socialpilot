import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/playwright-report/**", "**/test-results/**", "**/.superpowers/**", "**/storage/**", ".data/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
    }
  },
  { files: ["scripts/**/*.{js,mjs}", "**/*.config.{js,ts,mjs}"], languageOptions: { globals: globals.node } }
);
