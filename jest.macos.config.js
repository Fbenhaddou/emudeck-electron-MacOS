module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/src/main/macos/**/__tests__/*.test.ts',
    '<rootDir>/src/main/components/**/__tests__/*.test.ts',
    '<rootDir>/src/renderer/macos/**/__tests__/*.test.tsx',
    '<rootDir>/.erb/scripts/__tests__/*.test.js',
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.macos.json' }],
  },
  moduleNameMapper: { '\\.css$': 'identity-obj-proxy' },
};
