/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+\.tsx?$": ["ts-jest",{}],
  },
  // Increase timeout for integration tests with database
  testTimeout: 30000,
  // Separate test patterns
  testMatch: [
    "**/__tests__/**/*.test.ts",
    "**/__tests__/**/*.integration.test.ts",
    "**/tests/**/*.test.ts"
  ],
};