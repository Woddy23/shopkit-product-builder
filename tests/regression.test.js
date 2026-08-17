const assert = require('node:assert/strict');
const fs = require('node:fs');

function parseWeightFromTitle(title) {
  const patterns = [
    /(\d+)\s*x\s*(\d+)\s*(ml|g|l)/gi,
    /(\d+)\s*(ml|g|l|gramas?|litros?)/gi
  ];
  let total = 0;
  let found = false;
  const occupied = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(title)) !== null) {
      const end = match.index + match[0].length;
      if (!match[3] && occupied.some(([start, finish]) => match.index < finish && end > start)) continue;
      const amount = Number(match[3] ? match[2] : match[1]);
      const unit = (match[3] || match[2]).toLowerCase();
      const grams = unit === 'l' || unit.startsWith('lit') ? amount * 1000 : amount;
      total += match[3] ? Number(match[1]) * grams : grams;
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
assert.equal(parseWeightFromTitle('1L'), 1000);
assert.equal(detectKitOrBundle('Product A + Product B'), true);
assert.equal(detectKitOrBundle('Kit Repair'), true);
assert.equal(detectKitOrBundle('Normal single product'), false);
assert.ok(smartTruncate('This is a deliberately long product excerpt for testing', 85).length <= 85);

const source = fs.readFileSync('extension/content.js', 'utf8');
const panelCss = fs.readFileSync('extension/panel.css', 'utf8');
const manifest = fs.readFileSync('extension/manifest.json', 'utf8');
const errorDetailsSource = source.slice(
  source.indexOf('function getGenerationErrorDetails'),
  source.indexOf('function sleep')
);
const getGenerationErrorDetails = Function(`${errorDetailsSource}\nreturn getGenerationErrorDetails;`)();
assert.equal(/setInputValue\('#preco'/.test(source), false, 'apply path must not overwrite price');
assert.match(source, /sanitizeDescriptionHtml/);
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

const generationSource = source.slice(
  source.indexOf('async function generateDraftForPreview'),
  source.indexOf('function createInlineGenerateButton')
);
const previewUpdateSource = source.slice(
  source.indexOf('function updateDraftFromPreview'),
  source.indexOf('function createCategoryChipHTML')
);
const applySource = source.slice(
  source.indexOf('async function applyProductData'),
  source.indexOf('function displayNeedsReview')
);
assert.doesNotMatch(generationSource, /applyProductData\(/, 'generation must only prepare preview');
assert.equal((source.match(/applyProductData\(draftState\)/g) || []).length, 1, 'only explicit Apply may apply draft');
assert.match(generationSource, /hasGeneratedDraft\s*=\s*false[\s\S]*setGenerationLoading\(true\)/, 'new generation must invalidate the previous applicable draft');
assert.equal((generationSource.match(/hasGeneratedDraft\s*=\s*true/g) || []).length, 1, 'only successful generation may enable Apply');
assert.match(generationSource, /generatedDraftTitleKey\s*===\s*requestedTitleKey/, 'draft preservation must compare normalized product identity');
assert.match(generationSource, /if \(isSameProduct\) \{[\s\S]*fieldsToPreserve\.forEach/, 'automatic value preservation must be limited to the same product');
assert.doesNotMatch(previewUpdateSource, /lockedValues|Restore locked field values/, 'preview edits must not be overwritten by stale locked values');
assert.doesNotMatch(applySource, /isFieldLocked\(/, 'locks must not block explicit Apply');
assert.match(applySource, /return true;[\s\S]*catch \(error\)[\s\S]*return false;/, 'Apply must report unexpected success or failure');
assert.doesNotMatch(source, /draftState\.categorias_text\s*=\s*parseCsv\(getPanelElement\('#preview-categorias'\)/, 'category chips must not overwrite draft categories');
assert.match(source, /panelHost\.setAttribute\('data-open', 'false'\)/, 'panel must start closed');
assert.match(source, /:host\(\[data-open="true"\]\)/, 'Shadow host open state must match host attributes');
assert.doesNotMatch(source, /:host\[data-open="true"\]/, 'invalid Shadow host open selector must not return');
assert.match(source, /id="apply-form"[^>]*disabled/, 'Apply must start disabled');
assert.match(source, /event\.key === 'Escape'/, 'Escape must close panel');
assert.match(source, /inlineBtn\.disabled\s*=\s*isGenerating\s*\|\|\s*!isConfigReady/, 'inline Generate must respect config readiness');
assert.match(source, /if \(isGenerating \|\| !isConfigReady\) return;/, 'inline Generate must block generation when config is not ready');
assert.match(source, /Generation failed: \$\{details\.log\}/, 'generation failures must retain safe classification');
assert.match(source, /status === 401[\s\S]*status === 400[\s\S]*status === 429[\s\S]*AbortError[\s\S]*NetworkError/, 'generation failures must classify expected API errors');
assert.match(panelCss, /#ai-product-builder-toggle\s*\{[\s\S]*left:\s*24px;[\s\S]*right:\s*auto;[\s\S]*bottom:\s*24px;/, 'floating trigger must use bottom-left desktop position');
assert.match(panelCss, /@media \(max-width: 520px\)[\s\S]*left:\s*16px;[\s\S]*right:\s*auto;[\s\S]*bottom:\s*16px;/, 'floating trigger must use bottom-left mobile position');
assert.doesNotMatch(source, /requestSubmit|\.submit\(/, 'extension must not submit the product form');
assert.doesNotMatch(source, /button\[type=["']submit["']\]|Gravar dados/, 'extension must not target the Shopkit submit action');
assert.match(source, /const MODEL_DEFAULT = 'gpt-5\.6-luna'/, 'GPT-5.6 Luna must be default model');
assert.match(source, /api\.openai\.com\/v1\/responses/, 'GPT-5.6 Luna must use Responses API');
assert.match(source, /reasoning:\s*\{\s*effort:\s*'none'\s*\}/, 'GPT-5.6 reasoning effort must be none');
assert.match(source, /store:\s*false/, 'Responses request must disable storage');
assert.match(source, /type:\s*'json_schema'/, 'Responses request must use Structured Outputs');
assert.match(source, /name:\s*'shopkit_product_draft'/, 'Structured Output schema must be named');
assert.doesNotMatch(source, /tagsModalLink\.click\(/, 'option discovery must not click native tags modal');
assert.ok(source.indexOf('<summary>Pesquisa e Media</summary>') < source.indexOf('<h4 class="section-title">Produto</h4>'), 'research must precede product');
assert.ok(source.indexOf('<summary>Detalhes adicionais</summary>') > source.indexOf('<h4 class="section-title">SEO</h4>'), 'details must follow SEO');
assert.match(source, /@media \(max-width: 420px\)[\s\S]*\.compact-grid \{ grid-template-columns: 1fr; \}/, 'narrow detail fields must stack');
assert.match(source, /setupInlineObserver\(\)/, 'inline Generate must be monitored by observer for dynamic DOM replacement');
assert.match(source, /ensureInlineGenerateButton\(\)/, 'loading cleanup must re-ensure inline Generate presence');
assert.match(manifest, /https:\/\/example-store\.shopk\.it\/admin\/products\/create/, 'portfolio-safe placeholder hostname must remain intact');

console.log('regression tests passed');
