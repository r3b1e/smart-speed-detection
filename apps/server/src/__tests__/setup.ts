/**
 * Vitest setup — env must be in place BEFORE src/config.ts is imported.
 * Loaded via vitest.config.ts setupFiles.
 */
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.JWT_ACCESS_SECRET = "test-access-secret-please-be-long";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-please-be-long";
process.env.MONGODB_URI = "mongodb://127.0.0.1:9/ignored-in-tests";
