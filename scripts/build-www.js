#!/usr/bin/env node
'use strict';
/* Assemble the web bundle that the Android shell and the hosted site ship.

   The game has no build step, so this is a copy: index.html plus the
   folders it references. Dev-only material (training harness, headless
   simulator, docs, serve.py) stays out so the bundle carries only what
   the page loads. Output: ./www (git-ignored).

   Two optional env vars shape the HOSTED build (the GitHub Pages workflow
   sets them; `npm run sync` for Android leaves them unset):

     WEB_HOSTED=1        add a strict Content-Security-Policy <meta> and a
                         robots.txt. Not used for Android: the Capacitor
                         bridge injects an inline script the CSP would block.
     WEB_GATE=<phrase>   require this passphrase before the game opens. Only
                         its salted SHA-256 is written into the page. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'www');
const SHIP = ['index.html', 'icon.svg', 'manifest.webmanifest', '_headers', 'css', 'js', 'models'];
const GATE_SALT = 'legends-arena:gate:v1:';

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

const indexPath = path.join(out, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const inject = tag => { html = html.replace('<meta name="theme-color"', tag + '\n<meta name="theme-color"'); };
const notes = [];

if (process.env.WEB_HOSTED) {
  inject('<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; ' +
    'style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; font-src \'self\'; connect-src \'self\'; ' +
    'manifest-src \'self\'; worker-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">');
  fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  notes.push('hosted: CSP meta + robots.txt');
}
if (process.env.WEB_GATE) {
  const hash = crypto.createHash('sha256').update(GATE_SALT + process.env.WEB_GATE.trim()).digest('hex');
  inject(`<meta name="legends-gate" content="${hash}">`);
  notes.push('gate: enabled');
}
fs.writeFileSync(indexPath, html);
console.log(`www/: ${files} files from ${SHIP.length} entries${notes.length ? ' · ' + notes.join(' · ') : ''}`);

function countFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .reduce((n, e) => n + (e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1), 0);
}
