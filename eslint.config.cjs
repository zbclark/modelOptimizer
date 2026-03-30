const importPlugin = require('eslint-plugin-import');

module.exports = [
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script'
    },
    plugins: {
      import: importPlugin
    },
    rules: {
      'no-unused-vars': 'error',
      'import/no-dynamic-require': 'error',
      'global-require': 'error'
    }
  }
];
