import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Next 16's eslint-plugin-react-hooks is stricter than 15. Session keeps
      // latest callbacks in refs during render; hydrating client state in
      // effects is also widespread. Leave those patterns for a later pass.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "release/**",
    "next-env.d.ts",
    "node_modules/**",
    "electron/**",
  ]),
]);

export default eslintConfig;
