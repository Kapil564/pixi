import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      'main/index': './src/main/index.ts',
      'main/preload': './src/main/preload.ts',
      'db/migrate': './src/db/migrate.ts',
    },
    format: ['cjs'],
    platform: 'node',
    target: 'node20',
    bundle: true,
    clean: true,
    sourcemap: true,
    external: ['electron', 'better-sqlite3'],
    noExternal: [
      '@google/generative-ai',
      'dotenv',
      'drizzle-orm',
      'fish-audio',
      'groq-sdk',
      'node-cron',
      'node-notifier',
      'node-record-lpcm16',
      'openai',
      'socket.io',
      'socket.io-client',
      'zod',
    ],
  },
  {
    entry: {
      'renderer/index': './src/renderer/index.tsx',
    },
    format: ['iife'],
    platform: 'browser',
    target: 'chrome120',
    bundle: true,
    sourcemap: true,
    noExternal: ['react', 'react-dom'],
    esbuildOptions: (options) => {
      options.jsx = 'automatic';
    },
  },
]);
