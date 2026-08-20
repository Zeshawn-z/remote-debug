const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

module.exports = tseslint.config(eslint.configs.recommended, ...tseslint.configs.recommended, {
  languageOptions: {
    globals: {
      ...globals.node,
      ...globals.browser,
    },
  },
  rules: {
    quotes: ['error', 'single'],
    'prefer-const': 2,
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/no-require-imports': 'off',
    // ES5 产物里不能用可选 catch 绑定，catch (e) 的 e 允许不使用
    '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }],
    // 注入端大量使用 obj && obj.method() 的短路调用
    '@typescript-eslint/no-unused-expressions': [
      'error',
      { allowShortCircuit: true, allowTernary: true },
    ],
  },
});
