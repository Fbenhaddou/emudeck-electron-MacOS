module.exports = {
  extends: 'erb',
  plugins: ['@typescript-eslint'],
  rules: {
    // A temporary hack related to IDE not resolving correct package.json
    'import/no-extraneous-dependencies': 'off',
    'import/no-unresolved': 'error',
    // Since React 17 and typescript 4.1 you can safely disable the rule
    'react/react-in-jsx-scope': 'off',
    'no-console': 'off',
    'no-alert': 'off',
    'react/no-danger': 'off',
    'react-hooks/exhaustive-deps': 'off',
    'no-shadow': 'off',
    'react/no-unescaped-entities': 'off',
  },
  overrides: [
    {
      files: [
        'src/main/macos/**/*.ts',
        'src/main/components/**/*.ts',
        'src/shared/**/*.ts',
        'src/renderer/macos/**/*.tsx',
      ],
      rules: {
        // TypeScript checks these more accurately for type-only declarations.
        'no-undef': 'off',
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': 'error',
        'import/extensions': [
          'error',
          'ignorePackages',
          { ts: 'never', tsx: 'never' },
        ],
        'react/jsx-filename-extension': ['error', { extensions: ['.tsx'] }],
        'no-void': ['error', { allowAsStatement: true }],
      },
    },
  ],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
    createDefaultProgram: true,
  },
  settings: {
    'import/resolver': {
      // See https://github.com/benmosher/eslint-plugin-import/issues/1396#issuecomment-575727774 for line below
      node: {},
      webpack: {
        config: require.resolve('./.erb/configs/webpack.config.eslint.js'),
      },
      typescript: {},
    },
    'import/parsers': {
      '@typescript-eslint/parser': ['.ts', '.tsx'],
    },
  },
};
