module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/server/**/*.test.js',
    '**/server/**/__tests__/**/*.js'
  ],
  collectCoverageFrom: [
    'server/**/*.js',
    '!server/index.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html']
};
