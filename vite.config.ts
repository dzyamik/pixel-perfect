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
    // Relative asset paths so the built site can be served from any
    // sub-path (root, /pixel-perfect/ on GitHub Pages, file://, etc.)
    // without changing the config.
    base: './',
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
            '@core': resolve(__dirname, 'src/core'),
            '@physics': resolve(__dirname, 'src/physics'),
            '@phaser': resolve(__dirname, 'src/phaser'),
        },
    },
    build: {
        // Builds are committed to the repo as the deployable demo site.
        // No CI; run `npm run build` manually before committing demo
        // changes you want to publish.
        outDir: resolve(__dirname, 'docs'),
        emptyOutDir: true,
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