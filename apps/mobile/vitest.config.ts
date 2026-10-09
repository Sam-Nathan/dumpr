import { defineConfig } from 'vitest/config';

// Pure TypeScript modules only (no react-native imports); UI is verified on device / by export.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});
