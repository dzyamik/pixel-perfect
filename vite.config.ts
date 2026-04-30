import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

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

/**
 * Dev-server plugin: serves files under `/media/*` from the project
 * root's `media/` folder.
 *
 * Vite's `root: 'examples'` means the dev server doesn't normally see
 * project-root assets, but the README and the demo landing page both
 * reference `media/hero.gif` (the source of truth for the hero image,
 * kept at the repo root so GitHub renders it inline). Without this
 * plugin, the dev server returns the SPA-fallback HTML for
 * `/media/hero.gif` and the page shows a broken image.
 *
 * Build is unaffected — `npm run build`'s `cp -r media docs/` step
 * after `vite build` already places `media/hero.gif` at the deployed
 * location. This plugin only fills the dev gap.
 */
const projectRootMediaDir = resolve(__dirname, 'media');
function projectRootMedia(): Plugin {
    return {
        name: 'pp-serve-project-root-media',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.url === undefined || !req.url.startsWith('/media/')) {
                    next();
                    return;
                }
                // Strip query strings & fragments before resolving.
                const cleanUrl = req.url.split('?')[0]!.split('#')[0]!;
                const filePath = resolve(projectRootMediaDir, cleanUrl.slice('/media/'.length));
                if (
                    !filePath.startsWith(projectRootMediaDir) ||
                    !existsSync(filePath) ||
                    !statSync(filePath).isFile()
                ) {
                    next();
                    return;
                }
                const mime: Record<string, string> = {
                    '.gif': 'image/gif',
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.webp': 'image/webp',
                    '.webm': 'video/webm',
                    '.mp4': 'video/mp4',
                };
                const ext = extname(filePath).toLowerCase();
                res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream');
                res.setHeader('Cache-Control', 'no-cache');
                createReadStream(filePath).pipe(res);
            });
        },
    };
}

export default defineConfig({
    root: 'examples',
    publicDir: resolve(__dirname, 'examples/_public'),
    plugins: [projectRootMedia()],
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