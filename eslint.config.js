import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '.scratch/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      // The engine must be deterministic: no ambient clock, no global RNG.
      // A seed that cannot be replayed is not a seed.
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'The engine may not read the clock. Derive time from the race.' },
        { name: 'performance', message: 'The engine may not read the clock.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use a seeded stream from rng/streams.ts.' },
        { object: 'Date', property: 'now', message: 'The engine may not read the clock.' },
      ],
    },
  },
  {
    files: ['**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
