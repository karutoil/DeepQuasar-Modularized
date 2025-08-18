module.exports = {
  root: true,
  env: {
    node: true,
    es2024: true,
    browser: true,
  },
  parserOptions: {
    ecmaVersion: 2024,
    sourceType: 'module',
  },
  extends: ['eslint:recommended', 'plugin:import/recommended'],
  plugins: ['import', 'unused-imports'],
  rules: {
    // use eslint-plugin-unused-imports to auto-remove imports and handle unused vars
    'no-unused-vars': 'off',
    'unused-imports/no-unused-imports': 'error',
    'unused-imports/no-unused-vars': [
      'warn',
      { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
    ],
    'no-console': 'off',
    'import/no-unresolved': 'off',
  },
  settings: {
    'import/resolver': {
      node: {
        extensions: ['.js', '.cjs', '.mjs', '.json'],
      },
    },
  },
};
