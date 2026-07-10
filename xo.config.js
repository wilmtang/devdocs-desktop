const globals = require('globals')

module.exports = [
  {
    ignores: ['**/*.html', '**/*.md', 'dist/**'],
  },
  {
    prettier: true,
    space: true,
    semicolon: false,
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'capitalized-comments': 'off',
      'no-unused-expressions': ['error', {allowShortCircuit: true}],
      'guard-for-in': 'off',
      'max-params': ['error', 5],
      'import/order': 'off',
      // This is a CommonJS Electron app
      'unicorn/prefer-module': 'off',
      'n/prefer-global/process': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/name-replacements': 'off',
      'unicorn/consistent-class-member-order': 'off',
      // Renderer scripts are classic <script> tags, no top-level await
      'unicorn/prefer-top-level-await': 'off',
    },
  },
]
