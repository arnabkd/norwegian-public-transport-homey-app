module.exports = {
  extends: 'athom/homey-app',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  rules: {
    'node/no-missing-import': 'off',
    'import/no-unresolved': 'off',
    'import/extensions': 'off',
    'node/no-unsupported-features/es-syntax': 'off',
  },
  ignorePatterns: ['.eslintrc.js'],
};
