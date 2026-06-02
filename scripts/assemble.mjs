import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');

console.log('[assemble] Starting extension assembly...');

copyIfExists(resolve(ROOT, 'manifest.json'), resolve(DIST, 'manifest.json'));

if (existsSync(resolve(ROOT, 'public/icons'))) {
  copyDir(resolve(ROOT, 'public/icons'), resolve(DIST, 'icons'));
}
if (existsSync(resolve(ROOT, 'unity'))) {
  copyDir(resolve(ROOT, 'unity'), resolve(DIST, 'unity'));
}

['popup/index.html', 'sidepanel/index.html'].forEach((file) => {
  const path = resolve(DIST, file);
  if (!existsSync(path)) return;
  let html = readFileSync(path, 'utf-8');
  html = html.replace(/\/assets\//g, '../assets/');
  writeFileSync(path, html);
  console.log(`[assemble] Fixed paths in ${file}`);
});

console.log('[assemble] Extension assembly complete!');

function copyIfExists(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

function copyDir(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = resolve(src, entry.name);
    const d = resolve(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}
