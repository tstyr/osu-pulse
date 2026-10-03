import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "work/**",
    "bot-audio/**",
    "renderer/local/**",
    "renderer/.venv*/**",
    "renderer/output/**",
    "renderer/temp/**",
    "renderer/logs/**",
    "lavalink/runtime/**",
    "lavalink/plugins/**",
    "lavalink/logs/**",
    "src/app/.well-known/workflow/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
