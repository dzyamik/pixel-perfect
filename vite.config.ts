import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Auto-discover example sub-folders
const examplesDir = resolve(__dirname, 'examples');
const exampleEntries = Object.fromEntries(
    readdirSync(examplesDir)
        .filter((name) => {
            const full = resolve(examplesDir, name);
            return statSync(full).isDirectory() && !name.startsWith('_');
        })
        .map((name) => [name, resolve(examplesDir, name, 'index.html')])
);

export default defineConfig({
    root: 'examples',
    publicDir: resolve(__dirname, 'examples/_public'),
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
            '@core': resolve(__dirname, 'src/core'),
            '@physics': resolve(__dirname, 'src/physics'),
            '@phaser': resolve(__dirname, 'src/phaser'),
        },
    },
    build: {
        outDir: resolve(__dirname, 'dist-examples'),
        rollupOptions: {
            input: {
                index: resolve(__dirname, 'examples/index.html'),
                ...exampleEntries,
            },
        },
    },
    server: {
        open: '/index.html',
    },
});