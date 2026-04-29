import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    test: {
        environment: 'node',
        globals: false,
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
        exclude: [
            'node_modules',
            '.next',
            'services/**',
            'scripts/**',
            'src/scripts/**',
        ],
        testTimeout: 15_000,
        // Evita que suites que mutan `process.env` o fetch global se pisen entre sí.
        fileParallelism: false,
    },
});
