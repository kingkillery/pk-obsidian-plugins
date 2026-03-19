import { beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';

// Clean up test database before each test
beforeEach(async () => {
  const testDataDir = './test-data';
  try {
    await fs.rm(testDataDir, { recursive: true, force: true });
  } catch {
    // Directory might not exist, that's ok
  }
});

// Clean up after all tests
afterEach(async () => {
  const testDataDir = './test-data';
  try {
    await fs.rm(testDataDir, { recursive: true, force: true });
  } catch {
    // Directory might not exist, that's ok
  }
});
