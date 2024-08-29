import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      dts: {
        bundle: false,
      },
    },
  ],
  output: {
    target: 'node',
  },
});
