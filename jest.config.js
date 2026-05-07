module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/server/**/*.test.js',
    '<rootDir>/server/**/__tests__/**/*.js',
    '<rootDir>/scripts/**/__tests__/**/*.test.js'
  ],
  collectCoverageFrom: [
    'server/**/*.js',
    '!server/index.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html']
};
