import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Reserve `console.warn`/`console.error` for production logging;
      // ban informational `console.log`. Per-file opt-out via
      // `// eslint-disable-next-line no-console` is fine for debugging.
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  // Override default ignores of eslint-config-next, and additionally
  // skip the agent bundles that ship with the project (they have their
  // own lint configuration and would otherwise drown the report in
  // unrelated errors).
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".opencode/**",
    ".agents/**",
  ]),
]);

export default eslintConfig;
