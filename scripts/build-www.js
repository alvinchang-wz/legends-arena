#!/usr/bin/env node
'use strict';
/* Assemble the web bundle the Android shell ships.

   The game has no build step, so this is a copy: index.html plus the
   folders it references. Dev-only material (training harness, headless
   simulator, docs, serve.py) stays out so the APK carries only what the
   WebView loads. Output: ./www (git-ignored; `npx cap sync` reads it). */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'www');
const SHIP = ['index.html', 'icon.svg', 'manifest.webmanifest', 'css', 'js', 'models'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let files = 0;
for (const name of SHIP) {
  const src = path.join(root, name);
  if (!fs.existsSync(src)) throw new Error(`missing ${name}`);
  fs.cpSync(src, path.join(out, name), {
    recursive: true,
    filter: p => !/(^|[\\/])(\.|.*\.test\.js$)/.test(path.basename(p)),
  });
  files += fs.statSync(src).isDirectory() ? countFiles(src) : 1;
}
console.log(`www/: ${files} files from ${SHIP.length} entries`);

function countFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .reduce((n, e) => n + (e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1), 0);
}
