const assert = require('node:assert/strict');
const fs = require('node:fs');

function parseWeightFromTitle(title) {
  const patterns = [
    /(?<![\d.,])(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*(ml|g|l)\b/gi,
    /(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(ml|g|l|gramas?|litros?)\b/gi
  ];
  let total = 0;
  let found = false;
  const occupied = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(title)) !== null) {
      const end = match.index + match[0].length;
      if (!match[3] && occupied.some(([start, finish]) => match.index < finish && end > start)) continue;
      const amount = Number((match[3] ? match[2] : match[1]).replace(',', '.'));
      const unit = (match[3] || match[2]).toLowerCase();
      const grams = unit === 'l' || unit.startsWith('lit') ? amount * 1000 : amount;
      total += match[3] ? Number(match[1].replace(',', '.')) * grams : grams;
      occupied.push([match.index, end]);
      found = true;
    }
  }
  return found ? total : null;
}

function normalizeText(value) {
  return String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\'"`´]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function detectKitOrBundle(title) {
  const raw = String(title || '').toLowerCase();
  return raw.includes('+') || /(^|\s)(kit|bundle)(?=\s|$)/.test(normalizeText(title));
}

function smartTruncate(text, maxLength, addEllipsis = true) {
  if (!text || text.length <= maxLength) return text;
  const target = addEllipsis ? maxLength - 3 : maxLength;
  let result = text.substring(0, target).trimEnd();
  const lastSpace = result.lastIndexOf(' ');
  if (lastSpace > 0 && lastSpace > target * 0.5) result = result.substring(0, lastSpace).trimEnd();
  return addEllipsis ? `${result}...` : result;
}

assert.equal(parseWeightFromTitle('500ml'), 500);
assert.equal(parseWeightFromTitle('6x500ml'), 3000);
assert.equal(parseWeightFromTitle('2x250ml + 100ml'), 600);
assert.equal(parseWeightFromTitle('0.5L'), 500);
assert.equal(parseWeightFromTitle('0,5L'), 500);
assert.equal(parseWeightFromTitle('1.5L'), 1500);
assert.equal(detectKitOrBundle('Product A + Product B'), true);
assert.equal(detectKitOrBundle('Kit Repair'), true);
assert.equal(detectKitOrBundle('Normal single product'), false);
assert.ok(smartTruncate('This is a deliberately long product excerpt for testing', 85).length <= 85);

const source = fs.readFileSync('extension/content.js', 'utf8');
const worker = fs.readFileSync('extension/background.js', 'utf8');
const options = fs.readFileSync('extension/options.js', 'utf8');
const optionsHtml = fs.readFileSync('extension/options.html', 'utf8');
const panelCss = fs.readFileSync('extension/panel.css', 'utf8');
const manifest = fs.readFileSync('extension/manifest.json', 'utf8');

const errorDetailsSource = source.slice(
  source.indexOf('function getGenerationErrorDetails'),
  source.indexOf('function sleep')
);
const getGenerationErrorDetails = Function(`${errorDetailsSource}\nreturn getGenerationErrorDetails;`)();

assert.equal(/setInputValue\('#preco'/.test(source), false, 'apply path must not overwrite price');
assert.match(source, /sanitizeDescriptionHtml/);
assert.match(source, /const safeHtml = sanitizeDescriptionHtml\(html\)/, 'every editor path must use sanitized HTML');
assert.doesNotMatch(source, /element\.value = html \|\| ''/, 'raw HTML must never reach editor backing field');
assert.match(source, /draft\.missing_fields = Array\.from\(new Set\(missing\)\)/, 'model missing fields must survive local validation');
assert.match(source, /Number\.isFinite\(data\.peso\)/, 'unknown weight must not become zero');
assert.doesNotMatch(source, /setChosenSelect\('#type', 'physical'\)/, 'Apply must not force product type');
assert.doesNotMatch(source, /#taxable|name="estado"|forceUncheckCheckbox|value', '0'/, 'Apply must not force unrelated product settings');
assert.match(source, /opt\.selected = matchedValues\.has\(opt\.value\)/, 'category Apply must replace stale selections');
assert.match(source, /if \(isSameProduct\) \{[\s\S]*lockedValues/, 'locks must be scoped to current product');
assert.match(source, /openMediaSearch/, 'media action must be search-only');
assert.doesNotMatch(source, /item\.click\(\)/, 'media action must not select assets automatically');
assert.doesNotMatch(source, /confirmBtn\.click\(\)/, 'media action must not confirm assets automatically');
assert.doesNotMatch(source, /requestSubmit|\.submit\(/, 'extension must not submit the product form');
assert.doesNotMatch(source, /button\[type=["']submit["']\]|Gravar dados/, 'extension must not target Shopkit submit action');
assert.match(source, /chrome\.runtime\.sendMessage\(\{ type: 'generate-draft'/, 'content script must use worker transport');
assert.doesNotMatch(source, /Authorization:|fetch\(.*api\.openai\.com/s, 'content script must not hold API request credentials');
assert.match(worker, /host_permissions|OPENAI_RESPONSES_URL|Authorization:/, 'worker must own OpenAI request');
assert.match(worker, /REQUEST_TIMEOUT_MS = 60000/, 'worker must bound complete request');
assert.match(worker, /const deadline = Date\.now\(\) \+ REQUEST_TIMEOUT_MS/, 'fallback attempts must share one total deadline');
assert.match(worker, /typeof message\.model !== 'string'/, 'worker must validate model messages');
assert.match(worker, /finally \{[\s\S]*clearTimeout\(timeoutId\)/, 'worker must clear timeout after body processing');
assert.match(manifest, /https:\/\/\*\.shopk\.it\/admin\/products\/create/, 'manifest must contain sole reusable Shopkit route');
assert.doesNotMatch(source, /example-store\.shopk\.it/, 'content script must not duplicate store URL');
assert.match(manifest, /"background"[\s\S]*"service_worker": "background\.js"/);
assert.match(optionsHtml, /Configuração da extensão|Chave API da OpenAI|gpt-5\.6-luna/);
assert.match(options, /clear-key|chrome\.storage\.local\.remove\('apiKey'\)/, 'user must be able to delete local key');
assert.match(source, /type: 'open-options'/, 'content script must expose a configuration action');
assert.match(worker, /message\.type === 'open-options'[\s\S]*openOptionsPage/, 'worker must open configuration page');
assert.match(source, /chrome\.storage\.onChanged/, 'open Shopkit page must refresh configuration state');
assert.match(source, /draft\.language !== 'pt-PT'/, 'draft language must be validated');
assert.match(source, /new URL\(url\)\.protocol !== 'https:'/, 'supplier URLs must be HTTPS');
assert.doesNotMatch(source, /replace\(\/```json\|```\/g/, 'parser must not silently strip markdown fences');
assert.match(source, /inlineBtn\.disabled\s*=\s*isGenerating\s*\|\|\s*!isConfigReady/);
assert.match(source, /if \(isGenerating \|\| !isConfigReady\) return;/);
assert.match(source, /Generation failed: \$\{details\.log\}/);
assert.match(source, /status === 401[\s\S]*status === 400[\s\S]*status === 429[\s\S]*AbortError[\s\S]*NetworkError/);
assert.match(panelCss, /#ai-product-builder-toggle\s*\{[\s\S]*left:\s*24px;[\s\S]*bottom:\s*24px;/);
assert.match(panelCss, /@media \(max-width: 520px\)[\s\S]*left:\s*16px;[\s\S]*bottom:\s*16px;/);

[
  [new Error('API key not configured'), 'missing API key', 'Configure a API key nas opções da extensão.'],
  [Object.assign(new Error(), { status: 401, apiError: { code: 'invalid_api_key' } }), 'HTTP 401 [invalid_api_key]', 'A API key não foi aceite. Verifique a configuração.'],
  [Object.assign(new Error(), { status: 400, apiError: { param: 'text.format.schema', code: 'invalid_value', type: 'invalid_request_error', message: 'Schema is invalid' } }), 'HTTP 400 | param: text.format.schema | code: invalid_value | type: invalid_request_error | message: Schema is invalid', 'O pedido à API não é válido. Verifique a configuração do modelo.'],
  [Object.assign(new Error(), { status: 429, apiError: { code: 'insufficient_quota' } }), 'HTTP 429 [insufficient_quota]', 'Limite ou créditos da API indisponíveis.'],
  [Object.assign(new Error(), { name: 'AbortError' }), 'timeout', 'A geração demorou demasiado tempo. Tente novamente.'],
  [Object.assign(new Error(), { name: 'NetworkError' }), 'network failure', 'Não foi possível contactar a API. Verifique a ligação de rede e tente novamente.'],
  [new Error('private data must not appear'), 'unexpected error', 'Não foi possível gerar o rascunho. Tente novamente.']
].forEach(([error, log, message]) => {
  const details = getGenerationErrorDetails(error);
  assert.equal(details.log, log);
  assert.equal(details.message, message);
  assert.deepEqual(Object.keys(details.diagnostic), ['status', 'type', 'code', 'param', 'message']);
});

console.log('regression tests passed');
