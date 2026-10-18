import { defineConfig } from 'vitest/config';

const config = defineConfig({ test: {} });
config.test!.retry = 2;

export default config;
