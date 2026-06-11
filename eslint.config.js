import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "dist-api", "android/**", "ios/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-prototype-builtins": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  {
    // Numeric integrity guardrails for rendered UI. Raw `.toFixed()` inside
    // JSX bypasses the shared formatters (formatCurrency / formatPercent /
    // formatCompactCurrency), which are the only places that handle
    // NaN/Infinity/null. Em dashes are banned repo-wide by convention.
    files: ["src/pages/**/*.tsx", "src/components/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXExpressionContainer CallExpression > MemberExpression[property.name='toFixed']",
          message:
            "No uses .toFixed() directo en JSX: usa formatCurrency/formatPercent/formatCompactCurrency de @/utils/currency, que manejan null/NaN/Infinity.",
        },
        {
          selector: "Literal[value=/\\u2014/]",
          message: "Em dash prohibido. Usa coma, punto, dos puntos o 'Sin datos'/'N/A' para estados vacios.",
        },
        {
          selector: "JSXText[value=/\\u2014/]",
          message: "Em dash prohibido. Usa coma, punto, dos puntos o 'Sin datos'/'N/A' para estados vacios.",
        },
      ],
    },
  },
);
