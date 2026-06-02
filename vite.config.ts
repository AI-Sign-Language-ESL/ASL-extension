import { defineConfig, build as viteBuild } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname);
const SRC = resolve(ROOT, 'src');
const DIST = resolve(ROOT, 'dist');
const PUBLIC = resolve(ROOT, 'public');

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'chrome-extension',
      closeBundle: async () => {
        copyManifest();
        copyPublicAssets();
        copyUnityAssets();
        fixHtmlPaths();
        await buildContentScript();
      },
    },
  ],
  build: {
    outDir: DIST,
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(SRC, 'popup/index.html'),
        sidepanel: resolve(SRC, 'sidepanel/index.html'),
        background: resolve(SRC, 'background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'background.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (asset) => {
          if (asset.name?.endsWith('.css') && asset.name?.startsWith('popup')) return 'popup/style.css';
          if (asset.name?.endsWith('.css') && asset.name?.startsWith('sidepanel')) return 'sidepanel/style.css';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  resolve: {
    alias: { '@': SRC },
  },
});

async function buildContentScript() {
  console.log('[build] building content script as self-contained bundle...');
  await viteBuild({
    configFile: false,
    plugins: [],
    build: {
      outDir: DIST,
      emptyOutDir: false,
      sourcemap: false,
      minify: false,
      rollupOptions: {
        input: {
          'content/content': resolve(SRC, 'content/index.ts'),
        },
        output: {
          entryFileNames: 'content/content.js',
          inlineDynamicImports: true,
        },
      },
    },
    resolve: {
      alias: { '@': SRC },
    },
  });
  console.log('[build] content script built successfully');
}

function copyManifest() {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf-8'));
  manifest.version = process.env.npm_package_version || manifest.version;
  writeFileSync(resolve(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('[build] manifest.json copied');
}

function copyPublicAssets() {
  if (!existsSync(PUBLIC)) return;
  const copyDir = (src, dest) => {
    if (!existsSync(src)) return;
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const s = resolve(src, entry.name);
      const d = resolve(dest, entry.name);
      if (entry.isDirectory()) copyDir(s, d);
      else copyFileSync(s, d);
    }
  };
  copyDir(PUBLIC, DIST);
  console.log('[build] public assets copied');
}

function copyUnityAssets() {
  const unitySrc = resolve(ROOT, 'unity');
  const unityDest = resolve(DIST, 'unity');
  if (existsSync(unitySrc)) {
    mkdirSync(unityDest, { recursive: true });
    const copyDir = (src, dest) => {
      for (const entry of readdirSync(src, { withFileTypes: true })) {
        const s = resolve(src, entry.name);
        const d = resolve(dest, entry.name);
        if (entry.isDirectory()) copyDir(s, d);
        else copyFileSync(s, d);
      }
    };
    copyDir(unitySrc, unityDest);
    console.log('[build] unity assets copied');
  }
}

function fixHtmlPaths() {
  for (const file of ['popup/index.html', 'sidepanel/index.html']) {
    const srcPath = resolve(DIST, 'src', file);
    const destPath = resolve(DIST, file);
    if (existsSync(srcPath)) {
      mkdirSync(dirname(destPath), { recursive: true });
      let html = readFileSync(srcPath, 'utf-8');
      html = html.replace(/href="\/(popup|sidepanel)\/style\.css/g, 'href="./style.css');
      html = html.replace(/\/assets\//g, '../assets/');
      writeFileSync(destPath, html);
      console.log(`[build] moved ${file} to dist/ root`);
    }
  }
  const srcDir = resolve(DIST, 'src');
  if (existsSync(srcDir)) {
    rmSync(srcDir, { recursive: true, force: true });
    console.log('[build] cleaned dist/src/');
  }
}
