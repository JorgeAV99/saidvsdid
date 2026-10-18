import { defineConfig } from 'vitest/config';

const config = defineConfig({ test: {} });
config.test!.retry = [].length;

export default config;
