import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';

import base, { DB_SPECS } from './vitest.config.ts';

// The suites that need a real Postgres, behind their own config like `vitest.socket.config.ts`.
// They still skip themselves without `TEST_DATABASE_URL`, which names something outside the
// repository.
//
// `fileParallelism: false` because every one of them clears the same tables before each test.
//
// `exclude` is set after the merge, not inside it: `mergeConfig` concatenates arrays, so the base
// config's exclusion of exactly these files would otherwise survive and leave nothing to run.
const merged = mergeConfig(base, defineConfig({
    test:
    {
        include: DB_SPECS,
        fileParallelism: false
    }
}));

merged.test = { ...merged.test, exclude: [...configDefaults.exclude] };

export default merged;
