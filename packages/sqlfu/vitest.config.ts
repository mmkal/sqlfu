import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    provide: {
        updateSnapshots: process.argv.includes('--update') || process.argv.includes('-u'),
    }
  },
});
