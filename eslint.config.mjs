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
      // El guion bajo inicial es la convención del propio repo para
      // "existe por la firma, no se usa" (`_req`, `_k`, `_m`). Sin esta
      // regla, esos identificadores DELIBERADOS generaban avisos que
      // ocultaban los descuidos de verdad — imports muertos y variables
      // olvidadas — que son lo que sí merece atención.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Los scripts de `scripts/` son CLIs: imprimir por stdout ES su
    // interfaz. La regla generaba 51 avisos permanentes que sólo
    // servían para enterrar los avisos reales del código de aplicación.
    files: ["scripts/**/*.ts"],
    rules: { "no-console": "off" },
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
