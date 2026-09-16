const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const extensionDir = path.join(root, 'extension');
const manifestPath = path.join(extensionDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function assertFile(relativePath) {
  assert.equal(fs.existsSync(path.join(extensionDir, relativePath)), true, `Missing extension file: ${relativePath}`);
}

for (const script of manifest.background?.service_worker ? [manifest.background.service_worker] : []) assertFile(script);
for (const script of manifest.content_scripts?.flatMap(item => item.js || []) || []) assertFile(script);
for (const stylesheet of manifest.content_scripts?.flatMap(item => item.css || []) || []) assertFile(stylesheet);
for (const icon of Object.values(manifest.icons || {})) assertFile(icon);
assertFile(manifest.options_page);

const optionsHtml = fs.readFileSync(path.join(extensionDir, manifest.options_page), 'utf8');
for (const [, stylesheet] of optionsHtml.matchAll(/<link[^>]+href="([^"]+)"/g)) assertFile(stylesheet);
for (const [, script] of optionsHtml.matchAll(/<script[^>]+src="([^"]+)"/g)) assertFile(script);

assert.deepEqual(manifest.content_scripts[0].matches, ['https://*.shopk.it/admin/products/create']);
assert.deepEqual(manifest.host_permissions, ['https://api.openai.com/*']);
console.log('manifest validation passed');
