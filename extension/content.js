(function() {
  'use strict';

  // Strict runtime URL guard
  if (location.origin !== 'https://example-store.shopk.it' || location.pathname !== '/admin/products/create') {
    return;
  }

  // Track needs review items
  let needsReview = [];
  const draftState = {
    language: 'pt-PT',
    titulo: '',
    excerpt: '',
    descricao_html: '',
    marca_text: null,
    categorias_text: [],
    tags_text: [],
    peso: null,
    barcode: null,
    referencia: null,
    lockedFields: [], // Fields locked from AI changes
    seo: {
      product_page_title: '',
      product_meta_description: '',
      product_meta_tags: ''
    },
    media: {
      attach_existing_by_search: []
    },
    missing_fields: [],
    notes_for_user: []
  };
  let discoveredOptions = {
    categories: [],
    brands: [],
    tags: [],
    missing: []
  };
  let shadowRoot = null;
  let panelHost = null;
  let toggleButton = null;
  let panelOpener = null;
  let hasGeneratedDraft = false;
  let isGenerating = false;
  let isConfigReady = false;
  let generatedDraftTitleKey = '';

  const MODEL_DEFAULT = 'gpt-5.6-luna';
  const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
  const PRODUCT_DRAFT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
      language: { type: 'string' }, titulo: { type: 'string' }, excerpt: { type: 'string' },
      descricao_html: { type: 'string' },
      marca_text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      categorias_text: { type: 'array', items: { type: 'string' } },
      tags_text: { type: 'array', items: { type: 'string' } },
      peso: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      barcode: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      referencia: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      handle: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      seo: { type: 'object', additionalProperties: false, properties: {
        product_page_title: { type: 'string' }, product_meta_description: { type: 'string' }, product_meta_tags: { type: 'string' }
      }, required: ['product_page_title', 'product_meta_description', 'product_meta_tags'] },
      media: { type: 'object', additionalProperties: false, properties: {
        attach_existing_by_search: { type: 'array', items: { type: 'string' } }
      }, required: ['attach_existing_by_search'] },
      supplier_url_suggestions: { type: 'object', additionalProperties: false, properties: {
        official: { type: 'array', items: { type: 'string' } }, suppliers: { type: 'array', items: { type: 'string' } }
      }, required: ['official', 'suppliers'] },
      missing_fields: { type: 'array', items: { type: 'string' } },
      notes_for_user: { type: 'array', items: { type: 'string' } }
    },
    required: ['language', 'titulo', 'excerpt', 'descricao_html', 'marca_text', 'categorias_text', 'tags_text', 'peso', 'barcode', 'referencia', 'handle', 'seo', 'media', 'supplier_url_suggestions', 'missing_fields', 'notes_for_user']
  };

  function hasValue(value) {
    return value !== undefined && value !== null && value !== '';
  }

  function hasArray(value) {
    return Array.isArray(value) && value.length > 0;
  }

  function getPanelElement(selector) {
    return shadowRoot ? shadowRoot.querySelector(selector) : null;
  }

  function openPanel(opener = null) {
    if (!panelHost) return;
    if (opener) panelOpener = opener;
    panelHost.inert = false;
    panelHost.setAttribute('data-open', 'true');
    panelHost.setAttribute('aria-hidden', 'false');
    toggleButton?.setAttribute('aria-expanded', 'true');
  }

  function closePanel(returnFocus = true) {
    if (!panelHost) return;
    panelHost.inert = true;
    panelHost.setAttribute('data-open', 'false');
    panelHost.setAttribute('aria-hidden', 'true');
    toggleButton?.setAttribute('aria-expanded', 'false');
    if (returnFocus && panelOpener?.isConnected) panelOpener.focus();
  }

  function togglePanel(opener = null) {
    if (panelHost?.getAttribute('data-open') === 'true') {
      closePanel();
    } else {
      openPanel(opener);
    }
  }

  function setPanelMessage(type, message) {
    const messageEl = getPanelElement('#panel-message');
    if (!messageEl) return;
    messageEl.className = `panel-message ${type || 'info'}`;
    messageEl.textContent = message || '';
    messageEl.hidden = !message;
  }

  function updateApplyState() {
    const applyBtn = getPanelElement('#apply-form');
    if (applyBtn) applyBtn.disabled = !hasGeneratedDraft || isGenerating;
  }

  function setGenerationLoading(loading) {
    isGenerating = loading;
    const generateBtn = getPanelElement('#generate-draft');
    const inlineGenerateBtn = document.querySelector('#ai-product-builder-inline');
    if (generateBtn) {
      generateBtn.disabled = loading || !isConfigReady;
      generateBtn.textContent = loading ? '⟳ A gerar rascunho…' : 'Gerar rascunho';
    }
    if (inlineGenerateBtn) {
      inlineGenerateBtn.disabled = loading || !isConfigReady;
      inlineGenerateBtn.textContent = loading ? '⟳ A gerar…' : '✦ Gerar com IA';
    }
    ensureInlineGenerateButton();
    panelHost?.setAttribute('aria-busy', String(loading));
    updateApplyState();
  }

  function sanitizeLogString(value, maxLen = 300) {
    if (!value || typeof value !== 'string') return '';
    return value.replace(/https?:\/\/[^\s]+/gi, '[url]').slice(0, maxLen);
  }

  function getGenerationErrorDetails(error) {
    const status = Number(error?.status);
    const apiError = error?.apiError || {};
    const sanitize = (value, maxLen = 300) => {
      if (!value || typeof value !== 'string') return '';
      return value.replace(/https?:\/\/[^\s]+/gi, '[url]').slice(0, maxLen);
    };
    const diagnostic = {
      status: status || null,
      type: sanitize(apiError.type, 50) || null,
      code: sanitize(apiError.code, 50) || null,
      param: sanitize(apiError.param, 80) || null,
      message: sanitize(apiError.message, 300) || null
    };

    if (error?.message === 'API key not configured') {
      return { log: 'missing API key', diagnostic, message: 'Configure a API key nas opções da extensão.' };
    }
    if (status === 401) {
      return { log: `HTTP 401${diagnostic.code ? ` [${diagnostic.code}]` : ''}`, diagnostic, message: 'A API key não foi aceite. Verifique a configuração.' };
    }
    if (status === 400) {
      return {
        log: `HTTP 400${diagnostic.param ? ` | param: ${diagnostic.param}` : ''}${diagnostic.code ? ` | code: ${diagnostic.code}` : ''}${diagnostic.type ? ` | type: ${diagnostic.type}` : ''}${diagnostic.message ? ` | message: ${diagnostic.message}` : ''}`,
        diagnostic,
        message: 'O pedido à API não é válido. Verifique a configuração do modelo.'
      };
    }
    if (status === 429) {
      return { log: `HTTP 429${diagnostic.code ? ` [${diagnostic.code}]` : ''}`, diagnostic, message: 'Limite ou créditos da API indisponíveis.' };
    }
    if (error?.name === 'AbortError') return { log: 'timeout', diagnostic, message: 'A geração demorou demasiado tempo. Tente novamente.' };
    if (error?.name === 'NetworkError') return { log: 'network failure', diagnostic, message: 'Não foi possível contactar a API. Verifique a ligação de rede e tente novamente.' };
    return { log: status ? `HTTP ${status}` : 'unexpected error', diagnostic, message: 'Não foi possível gerar o rascunho. Tente novamente.' };
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function parseCsv(value) {
    if (!value) return [];
    return value
      .split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0);
  }

  function resetDraftState() {
    // Preserve lockedFields before reset
    const preservedLockedFields = draftState.lockedFields || [];

    draftState.language = 'pt-PT';
    draftState.titulo = '';
    draftState.excerpt = '';
    draftState.descricao_html = '';
    draftState.marca_text = null;
    draftState.categorias_text = [];
    draftState.tags_text = [];
    draftState.peso = null;
    draftState.barcode = null;
    draftState.referencia = null;
    draftState.seo.product_page_title = '';
    draftState.seo.product_meta_description = '';
    draftState.seo.product_meta_tags = '';
    draftState.media.attach_existing_by_search = [];
    draftState.missing_fields = [];
    draftState.notes_for_user = [];
    draftState.supplier_url_suggestions = { official: [], suppliers: [] };

    // Restore lockedFields after reset
    draftState.lockedFields = preservedLockedFields;
  }

  // Helper: Get field value from draftState (handles nested SEO fields and field name mapping)
  function getDraftField(field) {
    const seoMap = {
      'seo_title': 'product_page_title',
      'seo_description': 'product_meta_description',
      'seo_tags': 'product_meta_tags'
    };

    // Field name mapping (lock name -> draftState property name)
    const fieldMap = {
      'descricao': 'descricao_html'
    };

    // Map field name if needed
    const mappedField = fieldMap[field] || field;

    if (seoMap[field]) {
      return draftState.seo[seoMap[field]];
    }
    return draftState[mappedField];
  }

  // Helper: Set field value in draftState (handles nested SEO fields and field name mapping)
  function setDraftField(field, value) {
    const seoMap = {
      'seo_title': 'product_page_title',
      'seo_description': 'product_meta_description',
      'seo_tags': 'product_meta_tags'
    };

    // Field name mapping (lock name -> draftState property name)
    const fieldMap = {
      'descricao': 'descricao_html'
    };

    // Map field name if needed
    const mappedField = fieldMap[field] || field;

    if (seoMap[field]) {
      draftState.seo[seoMap[field]] = value;
    } else {
      draftState[mappedField] = value;
    }
  }

  async function getConfig() {
    const { apiKey = '', model = MODEL_DEFAULT } = await chrome.storage.local.get(['apiKey', 'model']);
    const trimmedApiKey = (apiKey || '').trim();
    const trimmedModel = (model || '').trim();
    return { apiKey: trimmedApiKey, model: trimmedModel || MODEL_DEFAULT };
  }

  function sanitizeText(value) {
    return (value || '').toString().trim();
  }

  function sanitizeDescriptionHtml(value) {
    const template = document.createElement('template');
    template.innerHTML = String(value || '');
    const allowed = new Set(['H1', 'P', 'STRONG', 'UL', 'LI', 'BR', 'SMALL']);
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
    const remove = [];
    let node;
    while ((node = walker.nextNode())) {
      if (!allowed.has(node.tagName)) {
        remove.push(node);
        continue;
      }
      Array.from(node.attributes).forEach(attribute => node.removeAttribute(attribute.name));
    }
    remove.forEach(element => element.replaceWith(document.createTextNode(element.textContent || '')));
    return template.innerHTML;
  }

  function normalizeText(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\'"'`´]/g, '')
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function slugifyHandle(text) {
    return sanitizeText(text)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  function trimToElementMax(elOrSelector, value, fallbackMax, label) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    const raw = sanitizeText(value);
    let maxLength = Number.isFinite(fallbackMax) ? fallbackMax : 0;
    if (el) {
      const attr = el.getAttribute && el.getAttribute('maxlength');
      const ml = attr || (typeof el.maxLength === 'number' ? String(el.maxLength) : '');
      const n = parseInt(ml, 10);
      if (Number.isFinite(n) && n > 0) maxLength = n;
    }
    if (!maxLength) {
      return { value: raw, trimmed: false, maxLength: null, label: label || '' };
    }
    if (raw.length <= maxLength) {
      return { value: raw, trimmed: false, maxLength, label: label || '' };
    }
    const sliced = raw.slice(0, maxLength).trimEnd();
    const lastSpace = sliced.lastIndexOf(' ');
    if (lastSpace > 0) {
      const wordAware = sliced.slice(0, lastSpace).trimEnd();
      return { value: wordAware, trimmed: true, maxLength, label: label || '' };
    }
    return { value: sliced, trimmed: true, maxLength, label: label || '' };
  }

  // Smart truncate: cuts at word boundaries to avoid breaking words
  function smartTruncate(text, maxLength, addEllipsis = true) {
    if (!text || text.length <= maxLength) return text;

    // Leave room for ellipsis if needed
    const targetLength = addEllipsis ? maxLength - 3 : maxLength;
    let truncated = text.substring(0, targetLength).trimEnd();

    // Find last complete word
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > 0 && lastSpace > targetLength * 0.5) {
      // Only cut at word boundary if we keep at least 50% of the text
      truncated = truncated.substring(0, lastSpace).trimEnd();
    }

    return addEllipsis ? truncated + '...' : truncated;
  }

  function ensureElementTabActive(el) {
    if (!el) return;
    const pane = el.closest('.tab-pane');
    if (!pane || !pane.id) return;

    const cls = pane.classList;
    if (cls.contains('active') || cls.contains('show')) return;

    const selector = [
      `[aria-controls="${pane.id}"]`,
      `[href="#${pane.id}"]`,
      `[data-toggle="tab"][href="#${pane.id}"]`,
      `[data-bs-toggle="tab"][href="#${pane.id}"]`
    ].join(',');

    const trigger = document.querySelector(selector);
    if (trigger && typeof trigger.click === 'function') trigger.click();
  }

  function detectKitOrBundle(title) {
    const raw = String(title || '').toLowerCase();
    const normalized = normalizeText(title);
    return raw.includes('+') || /(^|\s)(kit|bundle)(?=\s|$)/.test(normalized);
  }

  function matchBrandFromTitle(title, discoveredBrands) {
    const normalizedTitle = normalizeText(title);
    let bestMatch = null;
    let bestLength = 0;

    for (const brand of discoveredBrands) {
      const normalizedBrand = normalizeText(brand.text);
      if (normalizedTitle.includes(normalizedBrand) && normalizedBrand.length > bestLength) {
        bestMatch = brand.text;
        bestLength = normalizedBrand.length;
      }
    }

    return bestMatch;
  }

  function matchCategoryFromTitle(title, discoveredCategories) {
    const normalizedTitle = normalizeText(title);
    const keywordMap = {
      'shampoo': 'shampoo',
      'condicionador': 'condicionador',
      'condicioner': 'condicionador',
      'mascara': 'mascara',
      'máscara': 'mascara',
      'mask': 'mascara',
      'leave-in': 'leave-in',
      'leavein': 'leave-in',
      'coloracao': 'coloracao',
      'coloração': 'coloracao',
      'coloration': 'coloracao',
      'toner': 'toner',
      'tintura': 'coloracao',
      'tintura': 'coloracao',
      'creme': 'creme',
      'cream': 'creme',
      'oleo': 'oleo',
      'óleo': 'oleo',
      'oil': 'oleo',
      'serum': 'serum',
      'spray': 'spray'
    };

    const foundCategories = [];
    for (const cat of discoveredCategories) {
      const normalizedCat = normalizeText(cat.text);
      if (normalizedTitle.includes(normalizedCat)) {
        foundCategories.push(cat.text);
      }
    }

    if (foundCategories.length === 1) {
      return foundCategories[0];
    }

    for (const [keyword, target] of Object.entries(keywordMap)) {
      if (normalizedTitle.includes(keyword)) {
        for (const cat of discoveredCategories) {
          if (normalizeText(cat.text).includes(target)) {
            return cat.text;
          }
        }
      }
    }

    return null;
  }

  function matchTagsFromTitle(title, discoveredTags) {
    const normalizedTitle = normalizeText(title);
    const tokens = normalizedTitle.split(/\s+/);
    const matchedTags = [];

    for (const tag of discoveredTags) {
      const normalizedTag = normalizeText(tag);
      if (normalizedTag.length < 3) continue;

      // Exact token match
      if (tokens.some(token => token === normalizedTag)) {
        matchedTags.push(tag);
        continue;
      }

      // Substring/token-overlap match
      const tagTokens = normalizedTag.split(/\s+/);
      let overlapCount = 0;
      for (const tagToken of tagTokens) {
        if (tokens.some(token => token.includes(tagToken) || tagToken.includes(token))) {
          overlapCount++;
        }
      }
      if (overlapCount >= 1) {
        matchedTags.push(tag);
      }
    }

    return matchedTags.slice(0, 8);
  }

  function parseWeightFromTitle(title) {
    // Patterns: "500ml", "200 g", "1L", "6x13ml", "100g", "250ml"
    // Now using global flag (g) to find ALL matches, not just first
    const patterns = [
      /(\d+)\s*x\s*(\d+)\s*(ml|g|l)/gi,  // multipack: "6x13ml"
      /(\d+)\s*(ml|g|l|gramas?|litros?)/gi // simple: "500ml", "1 litro"
    ];

    let totalGrams = 0;
    let foundAny = false;

    // Track already processed matches to avoid duplicates
    const processedMatches = new Set();
    const occupiedRanges = [];

    for (const pattern of patterns) {
      let match;
      // Reset lastIndex to ensure we search from the beginning
      pattern.lastIndex = 0;

      while ((match = pattern.exec(title)) !== null) {
        // Create unique key for this match
        const matchKey = `${match.index}-${match[0]}`;

        // Skip if already processed this match
        if (processedMatches.has(matchKey)) continue;
        const end = match.index + match[0].length;
        if (!match[3] && occupiedRanges.some(([start, finish]) => match.index < finish && end > start)) continue;
        processedMatches.add(matchKey);

        let grams;
        if (match[3]) { // multipack pattern has 3 capture groups
          const count = parseInt(match[1]);
          const amount = parseInt(match[2]);
          const unit = match[3].toLowerCase();
          const unitGrams = unit === 'ml' ? 1 : (unit === 'g' ? 1 : 1000);
          grams = count * amount * unitGrams;
        } else { // simple pattern has 2 capture groups
          const amount = parseInt(match[1]);
          const unit = match[2].toLowerCase();
          grams = unit === 'ml' || unit === 'g' || unit.startsWith('gram') ? amount : amount * 1000;
        }

        totalGrams += grams;
        occupiedRanges.push([match.index, end]);
        foundAny = true;
      }
    }

    return foundAny ? totalGrams : null;
  }

  function rulesMatchFromTitle(title, discoveredOptions) {
    const isKit = detectKitOrBundle(title);
    const brand = matchBrandFromTitle(title, discoveredOptions.brands);
    const category = matchCategoryFromTitle(title, discoveredOptions.categories);
    const tags = matchTagsFromTitle(title, discoveredOptions.tags);

    const reasons = [];
    if (isKit) reasons.push('Detected kit/bundle');
    if (!brand) reasons.push('Brand not found in title');
    if (!category) reasons.push('Category ambiguous or not found');

    const confidence = brand && (!isKit) ? 'HIGH' : 'LOW';

    return { brand, category, tags, confidence, reasons, isKit };
  }

  async function getSupplierPreferences(brandKey) {
    return new Promise(resolve => {
      chrome.storage.local.get(['supplierUrlPreferences'], result => {
        const prefs = result.supplierUrlPreferences || {};
        resolve(prefs[brandKey] || { official: [], suppliers: [], counts: {}, lastUsed: null });
      });
    });
  }

  async function updateSupplierPreference(brandKey, url, group) {
    return new Promise(resolve => {
      chrome.storage.local.get(['supplierUrlPreferences'], result => {
        const prefs = result.supplierUrlPreferences || {};
        if (!prefs[brandKey]) {
          prefs[brandKey] = { official: [], suppliers: [], counts: {}, lastUsed: null };
        }
        const brandPrefs = prefs[brandKey];

        const key = `${group}:${url}`;
        brandPrefs.counts[key] = (brandPrefs.counts[key] || 0) + 1;
        brandPrefs.lastUsed = new Date().toISOString();

        chrome.storage.local.set({ supplierUrlPreferences: prefs }, resolve);
      });
    });
  }

  function mapOptions(options) {
    return options.map(option => ({
      value: option.value,
      text: option.text.trim()
    })).filter(option => option.text.length > 0);
  }

  async function discoverStoreOptions() {
    const missing = [];

    const brandSelect = document.querySelector('#marca')
      || document.querySelector('select[name="marca"], select[id*="marca"], select[name*="brand"], select[id*="brand"]');
    if (brandSelect) {
      discoveredOptions.brands = mapOptions(Array.from(brandSelect.options));
    } else {
      discoveredOptions.brands = [];
      missing.push('marca');
    }

    const categoriesSelect = document.querySelector('#categorias')
      || document.querySelector('select[name="categorias"], select[name="categorias[]"], select[id*="categor"], select[name*="categor"], select[id*="category"], select[name*="category"]');
    if (categoriesSelect) {
      discoveredOptions.categories = mapOptions(Array.from(categoriesSelect.options));
    } else {
      discoveredOptions.categories = [];
      missing.push('categorias');
    }

    discoveredOptions.tags = [];
    const tagsModal = document.querySelector('#products-all-tags');

    // First try reading tags from DOM without opening modal
    if (tagsModal) {
      const tagLabels = tagsModal.querySelectorAll('label, .tag-item, .checkbox label');
      discoveredOptions.tags = Array.from(tagLabels)
        .map(label => label.textContent.trim())
        .filter(text => text.length > 0);
    }

    // If still no tags found, mark as missing
    if (discoveredOptions.tags.length === 0) {
      missing.push('tags');
    }

    discoveredOptions.missing = missing;
    return discoveredOptions;
  }

  function updateDiscoverStatus() {
    const statusEl = getPanelElement('#discover-status');
    if (!statusEl) return;

    const categoriesCount = discoveredOptions.categories.length;
    const brandsCount = discoveredOptions.brands.length;
    const tagsCount = discoveredOptions.tags.length;

    let status = `Discovered: ${categoriesCount} categories, ${brandsCount} brands, ${tagsCount} tags`;

    if (discoveredOptions.missing.length > 0) {
      status += ` | Missing: ${discoveredOptions.missing.join('/')}`;
    }

    statusEl.textContent = status;
  }

  function bestMatch(text, options) {
    const normalizedText = normalizeText(text);
    let bestMatch = null;
    let bestScore = 0;

    for (const option of options) {
      const normalizedOption = normalizeText(option.text || option);
      if (normalizedText === normalizedOption) {
        return option.text || option;
      }

      // Token overlap scoring
      const textTokens = normalizedText.split(/\s+/);
      const optionTokens = normalizedOption.split(/\s+/);
      let overlapCount = 0;
      for (const textToken of textTokens) {
        for (const optionToken of optionTokens) {
          if (textToken === optionToken || textToken.includes(optionToken) || optionToken.includes(textToken)) {
            overlapCount++;
            break;
          }
        }
      }
      const score = overlapCount / Math.max(textTokens.length, optionTokens.length);
      if (score > bestScore && score >= 0.3) {
        bestScore = score;
        bestMatch = option.text || option;
      }
    }

    return bestMatch;
  }

  function validateAgainstOptions(draft) {
    const missing = [];

    // Fuzzy match for brand
    if (draft.marca_text) {
      const brandMatch = bestMatch(draft.marca_text, discoveredOptions.brands);
      draft.marca_text = brandMatch || null;
      if (!brandMatch) missing.push('marca');
    }

    // Fuzzy match for categories - more adaptive with partial matching
    if (hasArray(draft.categorias_text)) {
      const matchedCategories = [];
      for (const cat of draft.categorias_text) {
        const catMatch = bestMatch(cat, discoveredOptions.categories);
        if (catMatch) {
          matchedCategories.push(catMatch);
        } else {
          // Try partial matching - if category contains known keywords
          const normCat = normalizeText(cat);
          const partialMatch = discoveredOptions.categories.find(opt =>
            normalizeText(opt.text).includes(normCat) ||
            normCat.includes(normalizeText(opt.text))
          );
          if (partialMatch) {
            matchedCategories.push(partialMatch.text);
          }
        }
      }
      draft.categorias_text = matchedCategories;
    }
    if (!hasArray(draft.categorias_text)) {
      missing.push('categorias');
    }

    // Fuzzy match for tags (up to 8 unique) - more adaptive
    if (hasArray(draft.tags_text)) {
      // If no tag options were discovered, keep model tags (dedupe + limit) instead of wiping
      if (!Array.isArray(discoveredOptions.tags) || discoveredOptions.tags.length === 0) {
        const cleaned = draft.tags_text.map(sanitizeText).filter(Boolean);
        draft.tags_text = Array.from(new Set(cleaned)).slice(0, 8);
      } else {
        const matchedTags = new Set();
        for (const tag of draft.tags_text) {
          const tagMatch = bestMatch(tag, discoveredOptions.tags);
          if (tagMatch && matchedTags.size < 8) {
            matchedTags.add(tagMatch);
          } else if (!tagMatch && matchedTags.size < 8) {
            // If no exact match but tag is short and relevant, keep it
            const normTag = normalizeText(tag);
            if (tag.length <= 20 && normTag.length >= 3) {
              matchedTags.add(tag);
            }
          }
        }
        draft.tags_text = Array.from(matchedTags);
      }
    }
    if (!hasArray(draft.tags_text)) {
      missing.push('tags');
    }

    draft.missing_fields = missing;
  }

  function validateDraftShape(draft) {
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('Model response did not contain a product draft.');
    if (['titulo', 'excerpt', 'descricao_html'].some(field => typeof draft[field] !== 'string')) throw new Error('Model response contained invalid product text fields.');
    if (!Array.isArray(draft.categorias_text) || !Array.isArray(draft.tags_text)) throw new Error('Model response contained invalid category or tag fields.');
    if (!draft.seo || typeof draft.seo !== 'object' || ['product_page_title', 'product_meta_description', 'product_meta_tags'].some(field => typeof draft.seo[field] !== 'string')) throw new Error('Model response contained invalid SEO fields.');
    return draft;
  }

  function shouldIncludeTemperature(model) {
    const m = (model || '').trim().toLowerCase();
    if (m.startsWith('gpt-5')) return false;
    return true;
  }

  function parseModelResponse(text) {
    let cleaned = (text || '').replace(/```json|```/g, '').trim();

    // Log the first characters for debugging

    // Remove BOM if present
    cleaned = cleaned.replace(/^\uFEFF/, '');

    // Fix invalid escape sequences that cause JSON parsing errors
    // Only escape newlines/tabs that are inside JSON strings (between quotes)
    let inString = false;
    let escaped = false;
    let result = '';

    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      const prev = cleaned[i - 1];

      if (!inString) {
        // Outside string: keep structural characters as-is
        if (char === '"' && prev !== '\\') {
          inString = true;
        }
        result += char;
      } else {
        // Inside string: need to handle escapes
        if (escaped) {
          // Previous char was backslash, this is escaped
          result += char;
          escaped = false;
        } else if (char === '\\') {
          // Start escape sequence
          result += char;
          escaped = true;
        } else if (char === '"') {
          // End of string
          result += char;
          inString = false;
        } else if (char === '\n') {
          // Escape literal newlines inside strings
          result += '\\n';
        } else if (char === '\t') {
          // Escape literal tabs inside strings
          result += '\\t';
        } else if (char === '\r') {
          // Remove carriage returns
        } else if (/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f-\x9f]/.test(char)) {
          // Remove other control characters
        } else {
          result += char;
        }
      }
    }

    cleaned = result;

    // Fix incomplete hex escapes outside of our processing
    cleaned = cleaned.replace(/\\x(?![0-9a-fA-F]{2})/g, '');


    // Helper to fix common JSON truncation issues
    function attemptJSONRepair(jsonStr) {
      let repaired = jsonStr;

      // Fix truncated arrays (missing closing bracket)
      const openBrackets = (repaired.match(/\[/g) || []).length;
      const closeBrackets = (repaired.match(/\]/g) || []).length;
      if (openBrackets > closeBrackets) {
        repaired += ']'.repeat(openBrackets - closeBrackets);
      }

      // Fix truncated objects (missing closing brace)
      const openBraces = (repaired.match(/\{/g) || []).length;
      const closeBraces = (repaired.match(/\}/g) || []).length;
      if (openBraces > closeBraces) {
        repaired += '}'.repeat(openBraces - closeBraces);
      }

      // Fix trailing commas before closing brackets/braces
      repaired = repaired.replace(/,\s*([}\]])/g, '$1');

      // Fix incomplete string at end
      const lastQuote = repaired.lastIndexOf('"');
      const lastNewline = repaired.lastIndexOf('\n');
      const lastColon = repaired.lastIndexOf(':');
      if (lastQuote > lastColon && lastQuote > lastNewline) {
        // Likely have an unclosed string
        const openQuotes = (repaired.match(/"/g) || []).length;
        if (openQuotes % 2 !== 0) {
          repaired += '"';
        }
      }

      return repaired;
    }

    // Try parsing as-is first
    try {
      return JSON.parse(cleaned);
    } catch (error) {

      // Try extracting JSON from first { to last }
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const extracted = cleaned.substring(firstBrace, lastBrace + 1);
        try {
          return JSON.parse(extracted);
        } catch (extractError) {
          // Try repairing the extracted JSON
          const repaired = attemptJSONRepair(extracted);
          try {
            return JSON.parse(repaired);
          } catch (repairError) {
          }
        }
      }

      // Aggressive repair: try to complete the JSON structure
      const aggressivelyRepaired = attemptJSONRepair(cleaned);
      try {
        return JSON.parse(aggressivelyRepaired);
      } catch (aggressiveError) {
        throw new Error('Model response was malformed or truncated. No data was applied.');
      }
    }
  }

  async function generateDraft({ titulo, marcaHint, categoriaHint, notes, supplierUrl, preselectedBrand, preselectedCategory, preselectedTags }) {
    const { apiKey, model } = await getConfig();
    if (!apiKey) {
      throw new Error('API key not configured');
    }

    if (!discoveredOptions.categories?.length || !discoveredOptions.brands?.length) {
      await discoverStoreOptions();
    }

    const categoriesList = preselectedCategory ? [preselectedCategory] : [];
    const brandsList = preselectedBrand ? [preselectedBrand] : [];
    const tagsList = (preselectedTags && preselectedTags.length) ? preselectedTags : [];

    const prompt = `Gera um JSON estrito para rascunho de produto.

Informacao fornecida:
- titulo: ${titulo}
- categoria (hint): ${categoriaHint || 'N/A'}

Opcoes pre-selecionadas (extensão trata de marca/categorias/tags):
- marca pre-selecionada: "${preselectedBrand || 'N/A'}"
- categoria pre-selecionada: "${preselectedCategory || 'N/A'}"
- tags pre-selecionadas: ${preselectedTags && preselectedTags.length > 0 ? preselectedTags.join(', ') : 'N/A'}

OPCOES_DISPONIVEIS:
- marcas: ${discoveredOptions.brands.slice(0, 100).map(b => b.text).join(', ')}
- categorias: ${discoveredOptions.categories.slice(0, 200).map(c => c.text).join(', ')}
- tags: ${discoveredOptions.tags.slice(0, 200).join(', ')}

Regras:
- Return ONLY valid JSON (no markdown, no code fences). Ensure all quotes/brackets are closed.
- language = "pt-PT".
- Nao inventar factos. Se desconhecido, usar null/[] e adicionar em missing_fields.
- marca_text: deve ser EXATAMENTE uma das OPCOES_DISPONIVEIS.marcas (texto exato). Se nao houver boa correspondencia, usar null.
- categorias_text: deve ter 1-3 items EXATAMENTE das OPCOES_DISPONIVEIS.categorias (texto exato). Se disponivel, preferir subcategoria especifica (ex: "Main > Sub").
- tags_text: deve ter 3-8 items EXATAMENTE das OPCOES_DISPONIVEIS.tags (texto exato).
  - Se OPCOES_DISPONIVEIS.tags estiver vazio, gera tags_text livres (3-8) relevantes e curtas.
- media.attach_existing_by_search: 2-4 termos (curtos) para procurar na biblioteca de media (ex: "frente", "verso", "rótulo", "pack", etc.). Nunca vazio.
- supplier_url_suggestions: gerar URLs realistas baseadas no nome do produto + marca. Priorizar fornecedores portugueses/PT (ex: perfumarias, farmácias, lojas de beleza nacionais). Máximo 3 URLs oficiais da marca e 3 URLs de fornecedores. Se não conheceres fornecedores específicos, gerar URLs de pesquisa no Google Shopping Portugal com query formatada: "https://www.google.com/search?q={marca}+{nome_produto}&tbm=shop". Nunca gerar URLs inventadas ou privadas - apenas URLs de pesquisa válidas que possam ser abertas.
- EXCERPT (máx 85 caracteres) é OBRIGATÓRIO e CRÍTICO:
  * ANTES de gerar, contar os caracteres do excerpt
  * MÁXIMO ABSOLUTO: 85 caracteres (incluindo espaços e pontuação)
  * Se o texto gerado tiver >85 caracteres, cortar IMEDIATAMENTE antes de enviar
  * Estrutura ideal: "{Marca} {Produto}: {benefício}. {Resultado}."
  * Exemplos de tamanho correto:
    - "L'Oreal Shampoo: limpa suavemente. Cabelo hidratado." (52 chars) ✓
    - "Máscara Kérastase: nutrição profunda. Brilho intenso." (55 chars) ✓
    - "Condicionador: desembaraça e dá brilho. Fácil de usar." (54 chars) ✓
  * Se o produto tiver nome grande, usar apenas: "{Produto}: {benefício}."
  * NUNCA exceder 85 caracteres - é um limite rígido do sistema
- Hierarquia de cortes se aproximar de 85:
  1. Remover resultado/acabamento
  2. Abreviar marca (ex: "L'Oreal" → "L'Oreal Paris" não → "L'Oreal")
  3. Remover marca se necessário
  4. Simplificar benefício
- IMPORTANTE: VALIDAR contagem antes de retornar o JSON. Se excerpt.length > 85, cortar.
- Exemplos válidos:
  * "L'Oreal Shampoo Vitamino Color: protege a cor. Brilho intenso." (59 chars)
  * "Kérastase Elixir Ultime: nutrição profunda. Cabelo sedoso." (57 chars)
  * "Máscara L'Oreal Absolut Repair: reconstrução imediata." (56 chars)
- DESCRICAO_HTML é OBRIGATÓRIO e deve seguir este template universal (adaptar ao produto real - cabelo/unhas/estética):

TEMPLATE:
<h1>{Tipo de produto} {Marca} {Linha/Modelo} {Tamanho} – {Variante/Código/Tom}</h1>

<p><strong>Intro:</strong> {O que é} para {objetivo principal}. {Resultado/efeito principal} com {acabamento/textura/sensação}.</p>

<ul>
<li><strong>Benefício 1:</strong> {resultado principal}</li>
<li><strong>Benefício 2:</strong> {resultado secundário}</li>
<li><strong>Benefício 3:</strong> {sensação/uso: fácil aplicação, não pesa, etc.}</li>
<li><strong>Benefício 4:</strong> {acabamento: brilho, definição, controlo, uniformidade}</li>
</ul>

<p><strong>O que faz:</strong> {1–2 frases explicando a ação de forma neutra, sem promessas absolutas}.</p>

<p><strong>Detalhes:</strong><br>
Categoria: {cabelo | unhas | rosto | corpo}<br>
Indicação: {tipo de cabelo/necessidade/uso}<br>
Textura/Acabamento: {creme/gel/spray | brilho/mate | leve/rico}<br>
Uso: {profissional | doméstico | ambos}<br>
Ativos/tecnologia: {2–5 itens (somente se confirmados)}<br>
Conteúdo: {ml/g/unidades}<br>
Compatibilidade: {ex.: cabelos pintados | sem sulfatos | vegano} (somente se confirmado)
</p>

<p><strong>Para quem é:</strong> {1 frase: perfil + necessidade + resultado desejado}.</p>

<p><strong>Como usar:</strong><br>
1) {quando aplicar / em que etapa}<br>
2) {quantidade / distribuição}<br>
3) {tempo/ativação/etapa crítica} (somente se confirmado)<br>
4) {enxaguar / finalizar / selar}<br>
5) {frequência sugerida} (se aplicável)
</p>

<p><small>Notas: {teste de mecha / evitar contacto com olhos / uso externo / seguir instruções do fabricante}.</small></p>

- product_page_title (Título SEO): máx 70 caracteres
- product_meta_description (Meta descrição): máx 140 caracteres.
- Estrutura (1 frase, máx 2 benefícios):
  "{Produto} {Marca} {Variante} {Tamanho}: {benefício 1}, {benefício 2}. {Contexto curto}."
- Versão curta (quando nome é grande):
  "{Produto} {Marca} {Variante}: {benefício 1} e {benefício 2}. {Tamanho}."
- Hierarquia de cortes se >140:
  1. Remover contexto curto
  2. Remover tamanho
  3. Reduzir para 1 benefício só
  4. Abreviar variantes (ex: "Absolut Repair" → "Absolut")
  5. Remover variante se necessário
- Regras:
  * No máximo 2 benefícios
  * Contexto curtíssimo: "Para cabelo seco." / "Efeito gloss."
  * Evitar adjetivos repetidos: "intenso", "duradouro", "profissional"
- Exemplos:
  * "Máscara L'Oreal Absolut Repair 500ml: nutre e dá brilho. Para cabelo seco." (76 chars)
  * "Shampoo Kérastase Elixir Ultime 250ml: limpa e hidrata. Leve para uso frequente." (80 chars)
  * "Coloração L'Oreal Inoa 60ml: cor uniforme e brilho natural. Resultado de salão." (79 chars)
- Peso: se o título tiver volume em ml (ex: 500ml), usar 1ml = 1g como estimativa (ex: 500ml → 500g). Se tiver gramas, usar esse valor.
  - Título SEO máx 70 caracteres (sem espaços a mais no início/fim); Meta descrição máx 140 caracteres; Meta tags curtas e relevantes (sem limite fixo); URL/handle curto, sem acentos e com hífens, será cortado ao limite do campo.
  - Se possível, gerar handle a partir do título (sem acentos, hífens). Se não tiveres confiança, usar null e adicionar handle a missing_fields.

Schema:
{
  "language": "pt-PT",
  "titulo": string,
  "excerpt": string,
  "descricao_html": string,
  "marca_text": string|null,
  "categorias_text": string[],
  "tags_text": string[],
  "peso": number|null,
  "barcode": string|null,
  "referencia": string|null,
  "handle": string|null,
  "seo": {
    "product_page_title": string,
    "product_meta_description": string,
    "product_meta_tags": string
  },
  "media": {
    "attach_existing_by_search": string[]
  },
  "supplier_url_suggestions": {
    "official": string[],
    "suppliers": string[]
  },
  "missing_fields": string[],
  "notes_for_user": string[]
}`;

    const productDraftSchema = {
      type: 'object',
      properties: {
        language: { type: 'string' },
        titulo: { type: 'string' },
        excerpt: { type: 'string' },
        descricao_html: { type: 'string' },
        marca_text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        categorias_text: { type: 'array', items: { type: 'string' } },
        tags_text: { type: 'array', items: { type: 'string' } },
        peso: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        barcode: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        referencia: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        handle: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        seo: {
          type: 'object',
          properties: {
            product_page_title: { type: 'string' },
            product_meta_description: { type: 'string' },
            product_meta_tags: { type: 'string' }
          },
          required: ['product_page_title', 'product_meta_description', 'product_meta_tags'],
          additionalProperties: false
        },
        media: {
          type: 'object',
          properties: {
            attach_existing_by_search: { type: 'array', items: { type: 'string' } }
          },
          required: ['attach_existing_by_search'],
          additionalProperties: false
        },
        supplier_url_suggestions: {
          type: 'object',
          properties: {
            official: { type: 'array', items: { type: 'string' } },
            suppliers: { type: 'array', items: { type: 'string' } }
          },
          required: ['official', 'suppliers'],
          additionalProperties: false
        },
        missing_fields: { type: 'array', items: { type: 'string' } },
        notes_for_user: { type: 'array', items: { type: 'string' } }
      },
      required: [
        'language', 'titulo', 'excerpt', 'descricao_html', 'marca_text',
        'categorias_text', 'tags_text', 'peso', 'barcode', 'referencia', 'handle',
        'seo', 'media', 'supplier_url_suggestions', 'missing_fields', 'notes_for_user'
      ],
      additionalProperties: false
    };

    const normModel = (model || '').trim().toLowerCase();
    const isGpt5 = normModel.startsWith('gpt-5');
    const apiMode = isGpt5 ? 'responses' : 'chat_completions';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    let requestBody;
    let apiUrl;

    if (isGpt5) {
      apiUrl = 'https://api.openai.com/v1/responses';
      requestBody = {
        model,
        input: prompt,
        max_output_tokens: 6000,
        reasoning: { effort: 'none' },
        store: false,
        text: {
          format: {
            type: 'json_schema',
            name: 'shopkit_product_draft',
            strict: true,
            schema: productDraftSchema
          }
        }
      };
    } else {
      apiUrl = OPENAI_URL;
      requestBody = {
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 3500,
        response_format: { type: 'json_object' }
      };
      if (shouldIncludeTemperature(model)) {
        requestBody.temperature = 0.2;
      }
    }

    try {
      let response;
      try {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        const networkError = new Error('OpenAI network request failed.');
        networkError.name = 'NetworkError';
        throw networkError;
      }
      clearTimeout(timeoutId);


      if (!response.ok) {
        let apiError = null;
        try {
          const errBody = await response.json();
          apiError = errBody?.error || null;
        } catch (_) {
          try {
            const rawErrText = await response.text();
            if (rawErrText) apiError = { message: rawErrText.slice(0, 200) };
          } catch (__) {}
        }
        const requestError = Object.assign(
          new Error(`OpenAI request failed (${response.status}).`),
          { status: response.status, apiError }
        );
        throw requestError;
      }

      const rawBody = await response.text();

      if (!rawBody) {
        throw new Error('Empty HTTP body from OpenAI');
      }

      let result;
      try {
        result = JSON.parse(rawBody);
      } catch (e) {
        throw e;
      }


      let rawText = '';

      if (isGpt5) {
        const outputArr = Array.isArray(result?.output) ? result.output : [];
        const msg = outputArr.find(o => o?.type === 'message' && o?.role === 'assistant');
        if (msg && Array.isArray(msg?.content)) {
          rawText = msg.content
            .map((c) => {
              if (typeof c === 'string') return c;
              if (c && typeof c === 'object') {
                if (typeof c.text === 'string') return c.text;
                if (c.text && typeof c.text === 'object' && typeof c.text.value === 'string') return c.text.value;
                if (typeof c.content === 'string') return c.content;
              }
              return '';
            })
            .join('')
            .trim();
        }
        // Fallback: some Responses shapes can include output_text items directly in result.output
        if (!rawText && outputArr.length) {
          rawText = outputArr
            .map((o) => {
              if (o?.type === 'output_text' && typeof o.text === 'string') return o.text;
              if (typeof o?.text === 'string') return o.text;
              return '';
            })
            .join('')
            .trim();
        }
      } else {
        const choice = result?.choices?.[0];

        if (choice?.finish_reason === 'length') {
          throw new Error('Model output truncated (finish_reason=length). Increase token limit or reduce descricao_html size.');
        }

        if (choice?.message?.refusal) {
          throw new Error(`Model refusal: ${choice.message.refusal.slice(0, 200)}`);
        }

        if (typeof choice?.message?.content === 'string') {
          rawText = choice.message.content.trim();
        } else if (Array.isArray(choice?.message?.content)) {
          rawText = choice.message.content
            .map((p) => {
              if (typeof p === 'string') return p;
              if (p && typeof p === 'object' && typeof p.text === 'string') return p.text;
              if (p && typeof p === 'object' && typeof p.text?.value === 'string') return p.text.value;
              if (p && typeof p === 'object' && typeof p.content === 'string') return p.content;
              return '';
            })
            .join('').trim();
        } else if (typeof choice?.message?.tool_calls?.[0]?.function?.arguments === 'string') {
          rawText = choice.message.tool_calls[0].function.arguments.trim();
        } else if (typeof choice?.message?.function_call?.arguments === 'string') {
          rawText = choice.message.function_call.arguments.trim();
        } else if (typeof choice?.text === 'string') {
          rawText = choice.text.trim();
        } else if (typeof result?.output_text === 'string') {
          rawText = result.output_text.trim();
        }
      }

      rawText = (rawText || '').trim();

      if (!rawText) {
        const choice = isGpt5 ? null : result?.choices?.[0];
        if (!isGpt5 && requestBody.response_format) {
          // Retry without response_format for providers that reject it.
          const retryBody = { ...requestBody };
          delete retryBody.response_format;

          let retryResponse;
          try {
            retryResponse = await fetch(apiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
              body: JSON.stringify(retryBody),
              signal: controller.signal
            });
          } catch (retryErr) {
          }

          if (retryResponse) {
            const retryRawBody = await retryResponse.text();
            if (retryRawBody) {
              let retryResult;
              try {
                retryResult = JSON.parse(retryRawBody);
                const retryChoice = retryResult?.choices?.[0];

                if (typeof retryChoice?.message?.content === 'string') {
                  rawText = retryChoice.message.content.trim();
                } else if (Array.isArray(retryChoice?.message?.content)) {
                  rawText = retryChoice.message.content
                    .map((p) => {
                      if (typeof p === 'string') return p;
                      if (p && typeof p === 'object' && typeof p.text === 'string') return p.text;
                      if (p && typeof p === 'object' && typeof p.text?.value === 'string') return p.text.value;
                      if (p && typeof p === 'object' && typeof p.content === 'string') return p.content;
                      return '';
                    })
                    .join('').trim();
                } else if (typeof retryChoice?.message?.tool_calls?.[0]?.function?.arguments === 'string') {
                  rawText = retryChoice.message.tool_calls[0].function.arguments.trim();
                } else if (typeof retryChoice?.message?.function_call?.arguments === 'string') {
                  rawText = retryChoice.message.function_call.arguments.trim();
                } else if (typeof retryChoice?.text === 'string') {
                  rawText = retryChoice.text.trim();
                } else if (typeof retryResult?.output_text === 'string') {
                  rawText = retryResult.output_text.trim();
                }

              } catch (retryParseErr) {
              }
            }
          }
        }

        if (!rawText) {
          throw new Error('Model returned empty response content (after retry)');
        }
      }

      const draft = validateDraftShape(parseModelResponse(rawText));
      validateAgainstOptions(draft);

      // Weight inference fallback
      if (draft.peso === null || draft.peso === undefined) {
        const inferredWeight = parseWeightFromTitle(titulo);
        if (inferredWeight) {
          draft.peso = inferredWeight;
          if (!draft.notes_for_user) draft.notes_for_user = [];
          draft.notes_for_user.push(`Peso estimado a partir do título: ${inferredWeight}g`);
        }
      }

      // Media fallback
      if (!draft.media || !hasArray(draft.media.attach_existing_by_search) || draft.media.attach_existing_by_search.length === 0) {
        const handle = draft.handle || slugifyHandle(titulo);
        const marca = draft.marca_text || '';
        draft.media = {
          attach_existing_by_search: [
            handle,
            marca ? `${marca} ${titulo}` : titulo
          ].slice(0, 4)
        };
      }

      // Supplier URL fallback
      if (!draft.supplier_url_suggestions ||
          (!hasArray(draft.supplier_url_suggestions.official) || draft.supplier_url_suggestions.official.length === 0) ||
          (!hasArray(draft.supplier_url_suggestions.suppliers) || draft.supplier_url_suggestions.suppliers.length === 0)) {
        const marca = draft.marca_text || titulo.split(' ')[0];
        const searchQuery = encodeURIComponent(`${marca} ${titulo}`);
        draft.supplier_url_suggestions = {
          official: [`https://www.google.com/search?q=${encodeURIComponent(marca + ' official site')}`],
          suppliers: [`https://www.google.com/search?q=${encodeURIComponent(marca + ' suppliers distributors')}`]
        };
      }

      return draft;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  function getLockedFields() {
    const locked = [];
    const checkboxes = shadowRoot?.querySelectorAll('input[data-lock]') || [];
    checkboxes.forEach(cb => {
      if (cb.checked) {
        locked.push(cb.getAttribute('data-lock'));
      }
    });
    return locked;
  }

  // Helper: Check if a field is locked
  function isFieldLocked(fieldName) {
    return draftState.lockedFields?.includes(fieldName) || false;
  }

  function updateDraftFromPreview() {
    draftState.titulo = sanitizeText(getPanelElement('#preview-titulo')?.value);
    draftState.excerpt = sanitizeText(getPanelElement('#preview-excerpt')?.value);
    draftState.descricao_html = sanitizeText(getPanelElement('#preview-descricao')?.value);
    draftState.marca_text = sanitizeText(getPanelElement('#preview-marca')?.value) || null;
    // Categories are read-only chips; draftState remains their source of truth.
    draftState.tags_text = parseCsv(getPanelElement('#preview-tags')?.value);
    const pesoValue = sanitizeText(getPanelElement('#preview-peso')?.value);
    draftState.peso = pesoValue ? Number(pesoValue) : null;
    draftState.barcode = sanitizeText(getPanelElement('#preview-barcode')?.value) || null;
    draftState.referencia = sanitizeText(getPanelElement('#preview-referencia')?.value) || null;
    draftState.seo.product_page_title = sanitizeText(getPanelElement('#preview-seo-title')?.value);
    draftState.seo.product_meta_description = sanitizeText(getPanelElement('#preview-seo-description')?.value);
    draftState.seo.product_meta_tags = sanitizeText(getPanelElement('#preview-seo-tags')?.value);
    draftState.lockedFields = getLockedFields();
  }

  // Helper: Escape HTML special characters
  function escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Helper: Create a category chip owned by the panel Shadow DOM.
  function createCategoryChipHTML(fullPath, parentText, childText) {
    const displayText = childText || fullPath;
    const titleAttr = fullPath ? ` title="${escapeHtml(fullPath)}"` : '';
    return `<li class="category-chip"${titleAttr}>${parentText ? '› ' : ''}${escapeHtml(displayText)}</li>`;
  }

  // Helper: Build hierarchical category display with parent › child format
  function buildHierarchicalCategories() {
    const categories = draftState.categorias_text || [];
    if (categories.length === 0) return '';

    // Get category select from main DOM (not shadow DOM)
    const catSelect = document.querySelector('#categorias')
      || document.querySelector('select[name="categorias"], select[name="categorias[]"], select[id*="categor"], select[name*="categor"], select[id*="category"], select[name*="category"]');

    if (!catSelect) {
      return `<ul class="category-chips">${categories.map(cat => createCategoryChipHTML(cat, null, cat)).join('')}</ul>`;
    }

    const options = Array.from(catSelect.options);

    // Build maps for value->text and subcategory->parent
    const parentMap = new Map(); // subcategory value -> parent text
    let lastParentText = null;

    options.forEach(opt => {
      const className = opt.className || '';

      if (className.includes('category') && !className.includes('subcategory')) {
        // This is a parent category
        lastParentText = opt.text;
      } else if (className.includes('subcategory') && lastParentText) {
        // This is a subcategory, map to its parent
        parentMap.set(opt.value, lastParentText);
        parentMap.set(opt.text.toLowerCase(), lastParentText);
      }
    });

    // Build hierarchical display strings
    const hierarchicalCategories = categories.map(cat => {
      const normCat = normalizeText(cat);

      // Find matching option
      let match = options.find(opt => normalizeText(opt.text) === normCat);
      if (!match) {
        match = options.find(opt => {
          const normOpt = normalizeText(opt.text);
          return normOpt.includes(normCat) || normCat.includes(normOpt);
        });
      }

      if (!match || !match.text) return createCategoryChipHTML(cat, null, cat);

      const parentText = parentMap.get(match.value) || parentMap.get(match.text.toLowerCase());

      if (parentText) {
        // This is a subcategory - show as "Parent › Child"
        return createCategoryChipHTML(`${parentText} › ${match.text}`, parentText, match.text);
      }

      // This is a parent category
      return createCategoryChipHTML(match.text, null, match.text);
    });

    return `<ul class="category-chips">${hierarchicalCategories.join('')}</ul>`;
  }

  function updatePreviewFromDraft() {
    // Update text/number inputs
    const previewFields = [
      ['#preview-titulo', draftState.titulo],
      ['#preview-excerpt', draftState.excerpt],
      ['#preview-descricao', draftState.descricao_html],
      ['#preview-marca', draftState.marca_text || ''],
      ['#preview-tags', (draftState.tags_text || []).join(', ')],
      ['#preview-peso', draftState.peso ?? ''],
      ['#preview-barcode', draftState.barcode || ''],
      ['#preview-referencia', draftState.referencia || ''],
      ['#preview-seo-title', draftState.seo.product_page_title || ''],
      ['#preview-seo-description', draftState.seo.product_meta_description || ''],
      ['#preview-seo-tags', draftState.seo.product_meta_tags || '']
    ];

    previewFields.forEach(([selector, value]) => {
      const el = getPanelElement(selector);
      if (el) {
        el.value = value;
      }
    });

    // Update categories with HTML (not text)
    const catEl = getPanelElement('#preview-categorias');
    if (catEl) {
      catEl.innerHTML = buildHierarchicalCategories();
    }

    const missingList = getPanelElement('#preview-missing');
    if (missingList) {
      missingList.innerHTML = '';
      const missing = draftState.missing_fields || [];
      if (missing.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'None';
        missingList.appendChild(li);
      } else {
        missing.forEach(item => {
          const li = document.createElement('li');
          li.textContent = item;
          missingList.appendChild(li);
        });
      }
    }

    updateSupplierSuggestionsUI();
  }

  async function generateDraftForPreview(tituloOverride = null) {
    if (isGenerating) return;

    if (!isConfigReady) {
      hasGeneratedDraft = false;
      updateApplyState();
      setPanelMessage('error', 'Configure a API key nas opções da extensão.');
      return;
    }

    const titulo = tituloOverride || sanitizeText(getPanelElement('#input-titulo')?.value);
    if (!titulo) {
      setPanelMessage('error', 'Introduza o título do produto antes de gerar.');
      getPanelElement('#input-titulo')?.focus();
      return;
    }

    const requestedTitleKey = normalizeText(sanitizeText(titulo));
    const isSameProduct = Boolean(generatedDraftTitleKey && generatedDraftTitleKey === requestedTitleKey);

    const marcaHint = '';
    const categoriaHint = '';
    const notes = '';
    const supplierUrl = '';

    hasGeneratedDraft = false;
    setGenerationLoading(true);
    setPanelMessage('loading', 'A gerar o rascunho. Pode continuar a consultar o formulário.');

    try {
      updateDraftFromPreview();
      await discoverStoreOptions();

      const rulesMatch = rulesMatchFromTitle(titulo, discoveredOptions);

      const draft = await generateDraft({
        titulo,
        marcaHint,
        categoriaHint,
        notes,
        supplierUrl,
        preselectedBrand: rulesMatch.brand,
        preselectedCategory: rulesMatch.category,
        preselectedTags: rulesMatch.tags
      });

      if (!draft.marca_text && rulesMatch?.brand) draft.marca_text = rulesMatch.brand;
      if ((!draft.tags_text || draft.tags_text.length === 0) && rulesMatch?.tags?.length) draft.tags_text = rulesMatch.tags;
      if ((!draft.categorias_text || draft.categorias_text.length === 0) && rulesMatch?.category) draft.categorias_text = [rulesMatch.category];

      // Store locked values before resetting
      const lockedValues = {};
      draftState.lockedFields.forEach(field => {
        lockedValues[field] = getDraftField(field);
      });

      // Store all current values before reset (to preserve non-empty values if AI returns empty)
      const previousValues = {
        excerpt: draftState.excerpt,
        descricao_html: draftState.descricao_html,
        marca_text: draftState.marca_text,
        categorias_text: [...draftState.categorias_text],
        tags_text: [...draftState.tags_text],
        seo: {
          product_page_title: draftState.seo.product_page_title,
          product_meta_description: draftState.seo.product_meta_description,
          product_meta_tags: draftState.seo.product_meta_tags
        }
      };

      resetDraftState();
      Object.assign(draftState, draft);

      // Restore values for fields where AI returned empty (only if not locked)
      const fieldsToPreserve = [
        { key: 'excerpt', prev: previousValues.excerpt, curr: draftState.excerpt },
        { key: 'descricao_html', prev: previousValues.descricao_html, curr: draftState.descricao_html },
        { key: 'marca_text', prev: previousValues.marca_text, curr: draftState.marca_text },
        { key: 'categorias_text', prev: previousValues.categorias_text, curr: draftState.categorias_text, isArray: true },
        { key: 'tags_text', prev: previousValues.tags_text, curr: draftState.tags_text, isArray: true },
        { key: 'seo_title', prev: previousValues.seo.product_page_title, curr: draftState.seo.product_page_title },
        { key: 'seo_description', prev: previousValues.seo.product_meta_description, curr: draftState.seo.product_meta_description },
        { key: 'seo_tags', prev: previousValues.seo.product_meta_tags, curr: draftState.seo.product_meta_tags }
      ];

      if (isSameProduct) {
        fieldsToPreserve.forEach(({ key, prev, curr, isArray }) => {
          const isLocked = isFieldLocked(key);
          const prevHasValue = isArray
            ? (prev && prev.length > 0)
            : (prev && prev !== '');
          const currIsEmpty = isArray
            ? (!curr || curr.length === 0)
            : (!curr || curr === '');

          if (!isLocked && prevHasValue && currIsEmpty) {
            setDraftField(key, prev);
          }
        });
      }

      // Restore locked field values after AI generation
      Object.keys(lockedValues).forEach(field => {
        if (lockedValues[field] !== undefined) {
          setDraftField(field, lockedValues[field]);
        }
      });

      // Re-apply locked values to the draft object for preview update
      Object.keys(lockedValues).forEach(field => {
        if (lockedValues[field] !== undefined && draft[field] !== undefined) {
          draft[field] = lockedValues[field];
        }
      });

      needsReview.length = 0;
      generatedDraftTitleKey = requestedTitleKey;
      hasGeneratedDraft = true;
      updatePreviewFromDraft();
      updateSummaryStats();
      updateBadgeStatuses();
      displayNeedsReview();
      setPanelMessage('success', 'Rascunho gerado. Reveja os campos antes de aplicar.');
    } catch (error) {
      const details = getGenerationErrorDetails(error);
      if (details.diagnostic?.status) {
        console.error('[AIPB] OpenAI request failed', details.diagnostic);
      } else {
        console.error(`[AIPB] Generation failed: ${details.log}`);
      }
      setPanelMessage('error', details.message);
    } finally {
      setGenerationLoading(false);
    }
  }

  function createInlineGenerateButton() {
    const existingBtn = document.querySelector('#ai-product-builder-inline');
    if (existingBtn && existingBtn.isConnected) {
      existingBtn.disabled = isGenerating || !isConfigReady;
      if (existingBtn.getAttribute('data-aipb-bound') === 'true') {
        return existingBtn;
      }
      existingBtn.setAttribute('data-aipb-bound', 'true');
      return existingBtn;
    }

    const titleField = document.querySelector('#produto_titulo');
    if (!titleField) return null;

    const container = titleField.closest('.form-group, .input-group, .field-group') || titleField.parentElement;
    if (!container) return null;

    const inlineBtn = document.createElement('button');
    inlineBtn.type = 'button';
    inlineBtn.id = 'ai-product-builder-inline';
    inlineBtn.className = 'aipb-inline-generate';
    inlineBtn.setAttribute('data-aipb-bound', 'true');
    inlineBtn.textContent = isGenerating ? '⟳ A gerar…' : '✦ Gerar com IA';
    inlineBtn.disabled = isGenerating || !isConfigReady;

    inlineBtn.addEventListener('click', async () => {
      if (isGenerating || !isConfigReady) return;

      const titleInput = document.querySelector('#produto_titulo');
      const titulo = sanitizeText(titleInput?.value);
      openPanel(inlineBtn);
      if (!titulo) {
        setPanelMessage('error', 'Introduza primeiro o título do produto no formulário.');
        getPanelElement('#input-titulo')?.focus();
        return;
      }

      const panelInput = getPanelElement('#input-titulo');
      if (panelInput) panelInput.value = titulo;

      await generateDraftForPreview(titulo);
    });

    container.appendChild(inlineBtn);
    return inlineBtn;
  }

  let inlineObserver = null;
  function setupInlineObserver() {
    if (inlineObserver) return;
    const target = document.querySelector('form, #content, .content, main') || document.body;
    if (!target) return;
    let timer = null;
    inlineObserver = new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        ensureInlineGenerateButton();
      }, 150);
    });
    inlineObserver.observe(target, { childList: true, subtree: true });
  }

  function ensureInlineGenerateButton() {
    createInlineGenerateButton();
  }

  function updateSupplierSuggestionsUI() {
    const officialContainer = getPanelElement('#supplier-official');
    const suppliersContainer = getPanelElement('#supplier-suppliers');

    if (!officialContainer || !suppliersContainer) return;

    officialContainer.innerHTML = '';
    suppliersContainer.innerHTML = '';

    const suggestions = draftState.supplier_url_suggestions || { official: [], suppliers: [] };

    suggestions.official.slice(0, 3).forEach(url => {
      const chip = createSuggestionChip(url, 'official');
      officialContainer.appendChild(chip);
    });

    suggestions.suppliers.slice(0, 3).forEach(url => {
      const chip = createSuggestionChip(url, 'suppliers');
      suppliersContainer.appendChild(chip);
    });

    const officialGroup = officialContainer.closest('.suggestion-group');
    const suppliersGroup = suppliersContainer.closest('.suggestion-group');

    if (officialGroup) officialGroup.hidden = suggestions.official.length === 0;
    if (suppliersGroup) suppliersGroup.hidden = suggestions.suppliers.length === 0;
  }

  function createSuggestionChip(url, group, productTitle = '') {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'suggestion-chip';
    chip.textContent = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    chip.title = url;
    chip.addEventListener('click', async () => {
      // Search for product instead of opening generic URL
      const searchQuery = encodeURIComponent(productTitle || draftState.titulo || '');
      let searchUrl;
      if (group === 'official') {
        // Google Shopping for product
        searchUrl = `https://www.google.com/search?q=${searchQuery}&tbm=shop`;
      } else {
        // Google Images for product photos
        searchUrl = `https://www.google.com/search?q=${searchQuery}&tbm=isch`;
      }
      window.open(searchUrl, '_blank');
      const brandKey = draftState.marca_text ? normalizeText(draftState.marca_text) : 'unknown';
      await updateSupplierPreference(brandKey, url, group);
    });
    return chip;
  }

  async function refreshConfigStatus() {
    const config = await getConfig();
    const warning = getPanelElement('#config-warning');
    const generateBtn = getPanelElement('#generate-draft');
    const inlineGenerateBtn = document.querySelector('#ai-product-builder-inline');
    if (!generateBtn || !warning) return;
    isConfigReady = Boolean(config.apiKey);
    if (inlineGenerateBtn) inlineGenerateBtn.disabled = isGenerating || !isConfigReady;
    if (!config.apiKey) {
      warning.textContent = 'Configure a API key nas opções da extensão.';
      warning.className = 'config-status warning';
      generateBtn.disabled = true;
    } else {
      warning.textContent = 'Configuração pronta.';
      warning.className = 'config-status ready';
      generateBtn.disabled = isGenerating;
    }
  }

  // Helper: Check if element exists and is not disabled
  function isFieldEditable(selector) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) return { exists: false, editable: false };
    if (el.disabled) return { exists: true, editable: false };
    if (el.closest('.disabled, [disabled]')) return { exists: true, editable: false };
    return { exists: true, editable: true };
  }

  // Helper: Dispatch events
  function dispatchEvents(element, eventTypes) {
    if (!element || !eventTypes || !Array.isArray(eventTypes)) {
      return;
    }
    eventTypes.forEach(type => {
      element.dispatchEvent(new Event(type, { bubbles: true }));
    });
  }

  // Store hierarchical text mapping for category enhancement
  let categoryHierarchicalMap = new Map(); // value -> "Parent › Child"
  let categoryObserver = null;

  // Helper: Enhance chosen.js category chips with icons, tooltips, and hierarchical display
  function enhanceChosenCategoryChips() {
    const catSelect = document.querySelector('#categorias')
      || document.querySelector('select[name="categorias"], select[name="categorias[]"], select[id*="categor"], select[name*="categor"]');
    if (!catSelect) return;

    const selectId = catSelect.id || 'categorias';
    const chosenContainer = document.querySelector(`#${selectId}_chosen, #${selectId}_chzn, .chosen-container[id*="${selectId}"]`);
    if (!chosenContainer) return;

    const chips = chosenContainer.querySelectorAll('.chosen-choices .search-choice');

    chips.forEach(chip => {
      // Skip if already enhanced
      if (chip.hasAttribute('data-aipb-enhanced')) return;

      const closeBtn = chip.querySelector('.search-choice-close');
      const span = chip.querySelector('span');
      if (!span) return;

      // Get the option value from close button
      const optionIndex = closeBtn ? closeBtn.getAttribute('data-option-array-index') : null;
      const optionValue = optionIndex ? catSelect.options[optionIndex]?.value : null;

      // Get hierarchical text from our mapping, or fallback to option text
      let hierarchicalText = '';
      let displayText = '';

      if (optionValue && categoryHierarchicalMap.has(optionValue)) {
        hierarchicalText = categoryHierarchicalMap.get(optionValue);
        // Extract child text for display
        const parts = hierarchicalText.split(' › ');
        displayText = parts.length > 1 ? '› ' + parts[1] : parts[0];
      } else {
        // Fallback: check if option text contains the separator
        const optText = optionIndex ? catSelect.options[optionIndex]?.text : span.textContent;
        if (optText && optText.includes('›')) {
          hierarchicalText = optText;
          const parts = optText.split(' › ');
          displayText = parts.length > 1 ? '› ' + parts[1] : parts[0];
        } else {
          displayText = optText || span.textContent;
        }
      }

      // Add enhancement classes and attributes
      chip.classList.add('text-truncate');
      chip.setAttribute('data-toggle', 'tooltip');
      chip.setAttribute('data-container', 'body');
      chip.setAttribute('data-original-title', hierarchicalText || displayText);
      chip.setAttribute('data-aipb-enhanced', 'true');

      // Update span content with icon and prefix
      span.innerHTML = `<i class="fa fa-folder-open-o fa-fw"></i> ${escapeHtml(displayText)}`;

    });

    // Initialize tooltips if Bootstrap/jQuery available
    if (window.jQuery && window.jQuery.fn.tooltip) {
      window.jQuery(chosenContainer).find('[data-toggle="tooltip"]').tooltip();
    }
  }

  // Helper: Setup MutationObserver to auto-enhance new category chips
  function setupCategoryObserver() {
    if (categoryObserver) return; // Already set up

    const catSelect = document.querySelector('#categorias')
      || document.querySelector('select[name="categorias"], select[name="categorias[]"], select[id*="categor"], select[name*="categor"]');
    if (!catSelect) return;

    const selectId = catSelect.id || 'categorias';
    const chosenContainer = document.querySelector(`#${selectId}_chosen, #${selectId}_chzn, .chosen-container[id*="${selectId}"]`);
    if (!chosenContainer) return;

    const choicesList = chosenContainer.querySelector('.chosen-choices');
    if (!choicesList) return;

    categoryObserver = new MutationObserver((mutations) => {
      let shouldEnhance = false;
      mutations.forEach(mutation => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          shouldEnhance = true;
        }
      });
      if (shouldEnhance) {
        setTimeout(enhanceChosenCategoryChips, 50);
      }
    });

    categoryObserver.observe(choicesList, { childList: true, subtree: true });
  }

  // Helper: Escape HTML to prevent XSS
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Helper: Set input value with events
  function setInputValue(selector, value, eventName = 'input') {
    const { exists, editable } = isFieldEditable(selector);
    if (!exists) {
      needsReview.push({ field: selector, reason: 'Element not found' });
      return false;
    }
    if (!editable) {
      needsReview.push({ field: selector, reason: 'Field is disabled' });
      return false;
    }
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    el.value = value;
    dispatchEvents(el, [eventName, 'change']);
    return true;
  }

  // Helper: Set value using first existing selector
  function setInputValueFirst(selectors = [], value, fieldName = '', eventName = 'input') {
    let found = false;
    for (const sel of selectors) {
      const result = setInputValue(sel, value, eventName);
      if (result) {
        found = true;
        break;
      }
    }
    if (!found) {
      const label = fieldName || selectors.join(', ');
      needsReview.push({ field: selectors[0] || fieldName || 'campo', reason: `Campo não encontrado (${label})` });
    }
    return found;
  }

  // Helper: Set input value with retry logic for stubborn fields
  function setInputValueWithRetry(selector, value, eventName = 'input', maxRetries = 3) {
    const attemptSet = (retryCount) => {
      const { exists, editable } = isFieldEditable(selector);
      if (!exists) {
        if (retryCount < maxRetries) {
          setTimeout(() => attemptSet(retryCount + 1), 500 * (retryCount + 1));
          return false;
        }
        needsReview.push({ field: selector, reason: 'Element not found after retries' });
        return false;
      }
      if (!editable) {
        needsReview.push({ field: selector, reason: 'Field is disabled' });
        return false;
      }
      const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
      el.value = value;
      dispatchEvents(el, [eventName, 'change']);
      return true;
    };
    return attemptSet(0);
  }

  // Helper: Set value using first existing selector with retry
  function setInputValueFirstWithRetry(selectors = [], value, fieldName = '', eventName = 'input', maxRetries = 3) {
    let found = false;
    let lastError = '';

    const attemptSet = (retryCount) => {
      for (const sel of selectors) {
        const { exists, editable } = isFieldEditable(sel);
        if (exists && editable) {
          const el = document.querySelector(sel);
          el.value = value;
          dispatchEvents(el, [eventName, 'change']);
          found = true;
          return true;
        }
        if (!exists) lastError = 'Element not found';
        if (!editable) lastError = 'Field is disabled';
      }

      if (!found && retryCount < maxRetries) {
        setTimeout(() => attemptSet(retryCount + 1), 500 * (retryCount + 1));
        return false;
      }

      if (!found) {
        const label = fieldName || selectors.join(', ');
        needsReview.push({ field: selectors[0] || fieldName || 'campo', reason: `Campo não encontrado após ${maxRetries} tentativas (${label}): ${lastError}` });
      }
      return found;
    };

    return attemptSet(0);
  }

  // Helper: Set Chosen.js select with aggressive updates
  function setChosenSelect(selector, value) {
    const el = document.querySelector(selector);
    if (!el) {
      needsReview.push({ field: selector, reason: 'Element not found' });
      return false;
    }

    // Check if editable
    const { editable } = isFieldEditable(selector);
    if (!editable) {
      needsReview.push({ field: selector, reason: 'Field is disabled' });
      return false;
    }

    // Set the value
    el.value = value;

    // Immediate events
    dispatchEvents(el, ['change', 'input', 'blur']);

    // jQuery chosen.js update if available
    if (window.jQuery) {
      try {
        const $el = window.jQuery(el);
        $el.val(value).trigger('change');
        $el.trigger('chosen:updated');
        $el.trigger('liszt:updated'); // Legacy chosen.js
      } catch (e) {
      }
    }

    // Dispatch chosen:updated event
    el.dispatchEvent(new Event('chosen:updated', { bubbles: true }));
    el.dispatchEvent(new Event('liszt:updated', { bubbles: true }));

    // Multiple retries to ensure chosen.js updates
    const delays = [50, 150, 300, 600];
    delays.forEach((delay, index) => {
      setTimeout(() => {
        // Re-verify value
        if (el.value !== value) {
          el.value = value;
        }

        // Trigger events again
        dispatchEvents(el, ['change', 'input']);
        el.dispatchEvent(new Event('chosen:updated', { bubbles: true }));

        if (window.jQuery) {
          try {
            const $el = window.jQuery(el);
            $el.val(value).trigger('change');
            $el.trigger('chosen:updated');
            $el.trigger('liszt:updated');
          } catch (e) {
            // Ignore
          }
        }

      }, delay);
    });

    return true;
  }

  // Helper: Set TinyMCE content
  function setTinyMCEContent(selector, html) {
    const element = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!element) {
      needsReview.push({ field: selector, reason: 'Element not found' });
      return false;
    }
    if (!isFieldEditable(element).editable) {
      needsReview.push({ field: selector, reason: 'Field not editable' });
      return false;
    }

    ensureElementTabActive(element);

    if (window.tinymce && element.id) {
      const ed = window.tinymce.get(element.id);
      if (ed) {
        ed.setContent(sanitizeDescriptionHtml(html));
        ed.save();
        ed.fire('change');
        ed.fire('input');
        if (typeof ed.focus === 'function') ed.focus();
        dispatchEvents(element, ['input', 'change']);
        return true;
      }

      element.value = html || '';
      dispatchEvents(element, ['input', 'change']);

      const retrySetContent = (delay) => {
        setTimeout(() => {
          ensureElementTabActive(element);
          const edRetry = window.tinymce?.get(element.id);
          if (edRetry) {
            edRetry.setContent(sanitizeDescriptionHtml(html));
            edRetry.save();
            edRetry.fire('change');
            edRetry.fire('input');
            if (typeof edRetry.focus === 'function') edRetry.focus();
            dispatchEvents(element, ['input', 'change']);
          }
        }, delay);
      };

      retrySetContent(500);
      retrySetContent(1500);
      retrySetContent(3000);
      return true;
    }

    // Fallback: write directly to TinyMCE iframe when window.tinymce unavailable
    ensureElementTabActive(element);
    const iframe = document.querySelector(`#${element.id}_ifr`);
    if (iframe && iframe.contentWindow && iframe.contentWindow.document) {
      const body = iframe.contentWindow.document.body;
      if (body) {
        body.replaceChildren();
        const safeHtml = sanitizeDescriptionHtml(html);
        body.insertAdjacentHTML('beforeend', safeHtml);
        element.value = safeHtml;
        dispatchEvents(element, ['input', 'change']);
        dispatchEvents(body, ['input', 'change']);
        return true;
      }
    }

    element.value = sanitizeDescriptionHtml(html);
    dispatchEvents(element, ['input', 'change']);
    return true;
  }

  // Helper: Set tags (product tags field)
  function setTags(tags) {
    const tagsArr = Array.isArray(tags) ? tags : String(tags || '').split(',');
    const clean = tagsArr.map(t => t.trim()).filter(Boolean);

    // Find the actual input (can be hidden via CSS)
    const input = document.querySelector('input[name="tags_products"]');
    if (!input) {
      console.warn('[AIPB] Tags input not found');
      needsReview.push({ field: 'tags', reason: 'Campo de tags não encontrado' });
      return false;
    }

    // Always set the input value
    input.value = clean.join(',');

    // Trigger events on input
    ['input', 'change', 'keyup', 'blur'].forEach(evt => {
      input.dispatchEvent(new Event(evt, { bubbles: true }));
    });

    // Trigger jQuery events if available
    if (window.jQuery) {
      window.jQuery(input).trigger('change');
      window.jQuery(input).trigger('input');
    }

    // Find or create the visual wrapper
    let wrapper = document.querySelector('.bootstrap-tagsinput');

    // If no wrapper exists, try to find one near the input
    if (!wrapper) {
      const parent = input.parentElement;
      if (parent && parent.classList.contains('bootstrap-tagsinput')) {
        wrapper = parent;
      }
    }

    if (wrapper) {

      // Remove existing tags (but keep the input)
      const existingTags = wrapper.querySelectorAll('.tag');
      existingTags.forEach(t => t.remove());

      // Find the input inside the wrapper
      const wrapperInput = wrapper.querySelector('input[type="text"]');

      // Create and insert tags BEFORE the input
      clean.forEach((tag, index) => {
        const span = document.createElement('span');
        span.className = 'tag label label-info';
        span.textContent = tag;
        span.style.cssText = 'display:inline-block;padding:3px 8px;margin:2px 4px 2px 0;background:#5bc0de;color:white;border-radius:3px;font-size:12px;';

        if (wrapperInput) {
          wrapper.insertBefore(span, wrapperInput);
        } else {
          wrapper.appendChild(span);
        }

      });

      // Trigger change on wrapper
      wrapper.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Multiple retries to ensure tags stick
    const retryDelays = [100, 300, 600, 1000];
    retryDelays.forEach((delay, i) => {
      setTimeout(() => {
        // Re-verify input value
        if (input.value !== clean.join(',')) {
          input.value = clean.join(',');
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Re-create visual tags if wrapper exists
        if (wrapper) {
          const currentTags = wrapper.querySelectorAll('.tag');
          if (currentTags.length !== clean.length) {
            currentTags.forEach(t => t.remove());
            const wrapperInput = wrapper.querySelector('input[type="text"]');
            clean.forEach(tag => {
              const span = document.createElement('span');
              span.className = 'tag label label-info';
              span.textContent = tag;
              span.style.cssText = 'display:inline-block;padding:3px 8px;margin:2px 4px 2px 0;background:#5bc0de;color:white;border-radius:3px;font-size:12px;';
              if (wrapperInput) {
                wrapper.insertBefore(span, wrapperInput);
              } else {
                wrapper.appendChild(span);
              }
            });
          }
        }
      }, delay);
    });

    return true;
  }

  // Helper: Set checkbox/radio
  function setCheckbox(selector, checked) {
    const { exists, editable } = isFieldEditable(selector);
    if (!exists) {
      needsReview.push({ field: selector, reason: 'Element not found' });
      return false;
    }
    if (!editable) {
      needsReview.push({ field: selector, reason: 'Field is disabled' });
      return false;
    }
    const el = document.querySelector(selector);
    el.checked = checked;
    dispatchEvents(el, ['change']);
    return true;
  }

  // Apply product data to form
  async function applyProductData(data) {
    try {
      // Safety check: ensure needsReview is an array
      if (!needsReview || !Array.isArray(needsReview)) {
        needsReview = [];
      }
      needsReview.length = 0;
    let appliedCount = 0;

    // Locks protect reviewed values from AI regeneration, not explicit Apply.
    if (setInputValue('#produto_titulo', data.titulo || '')) appliedCount++;
    if (setTinyMCEContent('#descricao', data.descricao_html || '')) appliedCount++;

    // Apply excerpt with smart truncation and validation
    let excerptValue = data.excerpt || '';
    const excerptMax = 85;

    // First: truncate if exceeds max
    if (excerptValue.length > excerptMax) {
      const originalLength = excerptValue.length;
      excerptValue = smartTruncate(excerptValue, excerptMax, true);
    }

    // Validate: hard cut at max if still over (fallback safety)
    if (excerptValue.length > excerptMax) {
      excerptValue = excerptValue.substring(0, excerptMax - 3) + '...';
    }

    if (setInputValueWithRetry('#excerpt', excerptValue, 'input', 3)) appliedCount++;
    if ((data.excerpt || '').length > excerptMax) {
      needsReview.push({ field: '#excerpt', reason: `Excerto foi cortado para ${excerptMax} caracteres` });
    }
    if (setChosenSelect('#type', 'physical')) appliedCount++;

    // Categories with hierarchy support
    if (hasArray(data.categorias_text)) {
      const catSelect = document.querySelector('#categorias')
        || document.querySelector('select[name="categorias"], select[name="categorias[]"], select[id*="categor"], select[name*="categor"], select[id*="category"], select[name*="category"]');
      if (catSelect) {
        const options = Array.from(catSelect.options);

        // Build hierarchy map: find parent for each subcategory
        const parentMap = new Map(); // subcategory value -> parent value
        const valueToTextMap = new Map(); // value -> text
        let lastParentValue = null;
        let lastParentText = null;

        options.forEach(opt => {
          const className = opt.className || '';
          valueToTextMap.set(opt.value, opt.text);

          if (className.includes('category') && !className.includes('subcategory')) {
            // This is a parent category
            lastParentValue = opt.value;
            lastParentText = opt.text;
          } else if (className.includes('subcategory') && lastParentValue) {
            // This is a subcategory, map to its parent
            parentMap.set(opt.value, lastParentValue);
            // Store hierarchical text for this subcategory
            categoryHierarchicalMap.set(opt.value, `${lastParentText} › ${opt.text}`);
          }
        });

        // Also store parent categories in the map
        options.forEach(opt => {
          const className = opt.className || '';
          if (className.includes('category') && !className.includes('subcategory')) {
            categoryHierarchicalMap.set(opt.value, opt.text);
          }
        });


        // Find matches with fuzzy matching
        const matchedValues = new Set();

        data.categorias_text.forEach(cat => {
          const normCat = normalizeText(cat);

          // Try exact match first
          let match = options.find(opt => normalizeText(opt.text) === normCat);

          // If no exact match, try partial/fuzzy match
          if (!match) {
            match = options.find(opt => {
              const normOpt = normalizeText(opt.text);
              return normOpt.includes(normCat) || normCat.includes(normOpt);
            });
          }

          if (match) {
            matchedValues.add(match.value);
            // If this is a subcategory, also add its parent
            if (parentMap.has(match.value)) {
              const parentValue = parentMap.get(match.value);
              matchedValues.add(parentValue);
            } else {
            }
          } else {
          }
        });

        if (matchedValues.size > 0) {
          // Select all matched options
          options.forEach(opt => {
            if (matchedValues.has(opt.value)) {
              opt.selected = true;
            }
          });

          // Dispatch events to update chosen.js
          dispatchEvents(catSelect, ['change', 'chosen:updated']);

          // jQuery trigger if available
          if (window.jQuery) {
            try {
              const $cat = window.jQuery(catSelect);
              $cat.trigger('change');
              $cat.trigger('chosen:updated');
              $cat.trigger('liszt:updated');
            } catch (e) {
              // Ignore
            }
          }

          // Setup observer and enhance chips after chosen.js renders them
          setupCategoryObserver();

          // Multiple attempts to enhance chips as chosen.js renders them
          [100, 300, 600, 1000].forEach(delay => {
            setTimeout(() => {
              enhanceChosenCategoryChips();
            }, delay);
          });

          appliedCount++;
        } else {
          needsReview.push({ field: '#categorias', reason: 'No match for categories: ' + data.categorias_text.join(', ') });
        }
      } else {
        needsReview.push({ field: '#categorias', reason: 'Category select not found' });
      }
    }

    // Brand - with aggressive fallback
    async function setBrandAggressively(selector, value, brandText) {
      const el = document.querySelector(selector);
      if (!el) {
        return false;
      }


      // Method 1: Direct value setting
      el.value = value;

      // Method 2: jQuery if available
      if (window.jQuery) {
        try {
          const $el = window.jQuery(el);
          $el.val(value).trigger('change');
          $el.trigger('chosen:updated');
          $el.trigger('liszt:updated');
        } catch (e) {
        }
      }

      // Method 3: Native events
      dispatchEvents(el, ['change', 'input', 'blur']);
      el.dispatchEvent(new Event('chosen:updated', { bubbles: true }));
      el.dispatchEvent(new Event('liszt:updated', { bubbles: true }));

      // Method 4: Find and click the chosen.js dropdown option
      setTimeout(() => {
        const chosenId = el.getAttribute('id') || 'marca';
        const chosenContainer = document.querySelector(`#${chosenId}_chzn, #${chosenId}_chosen, .chosen-container[data-uuid*="${chosenId}"]`);
        if (chosenContainer) {
          const chosenOptions = chosenContainer.querySelectorAll('.chosen-results li, .chzn-results li');
          chosenOptions.forEach(li => {
            if (li.textContent.trim() === brandText) {
              li.click();
            }
          });
        }
      }, 100);

      // Verify and retry
      const verifyAndRetry = (attempt) => {
        setTimeout(() => {
          if (el.value !== value) {
            el.value = value;
            dispatchEvents(el, ['change', 'input']);
            el.dispatchEvent(new Event('chosen:updated', { bubbles: true }));

            if (window.jQuery) {
              try {
                window.jQuery(el).val(value).trigger('change').trigger('chosen:updated');
              } catch (e) {}
            }
          } else {
          }
        }, attempt * 200);
      };

      // Multiple verification retries
      [1, 2, 3, 5, 8].forEach(verifyAndRetry);

      return true;
    }

    if (hasValue(data.marca_text)) {
      const brandSelect = document.querySelector('#marca');
      if (brandSelect) {
        const options = Array.from(brandSelect.options);
        const normBrand = normalizeText(data.marca_text);

        // Try exact match first
        let match = options.find(opt => normalizeText(opt.text) === normBrand);

        // If no exact match, try fuzzy contains both ways
        if (!match) {
          let bestMatch = null;
          let bestLength = 0;
          for (const opt of options) {
            const normOpt = normalizeText(opt.text);
            if (normOpt.includes(normBrand) || normBrand.includes(normOpt)) {
              const matchLength = Math.max(normOpt.length, normBrand.length);
              if (matchLength > bestLength) {
                bestMatch = opt;
                bestLength = matchLength;
              }
            }
          }
          match = bestMatch;
        }

        if (match) {
          // Use aggressive brand setting
          await setBrandAggressively('#marca', match.value, match.text);
          appliedCount++;
        } else {
          needsReview.push({ field: '#marca', reason: 'No match for brand: ' + data.marca_text });
        }
      } else {
        needsReview.push({ field: '#marca', reason: 'Brand select not found' });
      }
    } else if (data.titulo) {
      // Fallback: Smart brand extraction from title - improved version

      const brandSelect = document.querySelector('#marca');
      if (!brandSelect) {
        needsReview.push({ field: '#marca', reason: 'Brand select not found' });
      } else {
        const options = Array.from(brandSelect.options);
        const normalizedTitle = normalizeText(data.titulo);
        const titleWords = normalizedTitle.split(/\s+/).filter(w => w.length >= 3);

        let bestMatch = null;
        let bestScore = 0;

        for (const opt of options) {
          if (!opt.value) continue; // Skip empty option

          const normOpt = normalizeText(opt.text);
          let score = 0;

          // Check if entire option text appears in title
          if (normalizedTitle.includes(normOpt)) {
            score += normOpt.length * 3;
          }

          // Check if any title word matches or is contained in option
          for (const word of titleWords) {
            if (normOpt === word) {
              score += word.length * 2; // Exact match
            } else if (normOpt.includes(word) && word.length >= 4) {
              score += word.length; // Partial match
            } else if (word.includes(normOpt) && normOpt.length >= 4) {
              score += normOpt.length; // Reverse partial match
            }
          }

          // Special bonus for brand-like words (uppercase, known patterns)
          const brandPatterns = ['yellow', 'loreal', 'kerastase', 'garnier', 'nivea', 'loreal', 'alfaparf'];
          for (const pattern of brandPatterns) {
            if (normOpt.includes(pattern) && normalizedTitle.includes(pattern)) {
              score += 10;
            }
          }

          if (score > bestScore) {
            bestScore = score;
            bestMatch = opt;
          }
        }

        // Lower threshold for matching (4 instead of requiring high score)
        if (bestMatch && bestScore >= 4) {
          await setBrandAggressively('#marca', bestMatch.value, bestMatch.text);
          appliedCount++;
          // IMPORTANT: Update draftState so panel shows the brand
          if (typeof draftState !== 'undefined') {
            draftState.marca_text = bestMatch.text;
          }
          // Also update the preview panel (use getPanelElement for Shadow DOM)
          const previewMarca = getPanelElement('#preview-marca');
          if (previewMarca) {
            previewMarca.value = bestMatch.text;
          }
          // Update badge to show it's applied
          const marcaBadge = getPanelElement('.badge[data-field="marca"]');
          if (marcaBadge) {
            marcaBadge.className = 'badge applied';
            marcaBadge.textContent = '✓';
          }
        } else {
          needsReview.push({ field: '#marca', reason: 'No marca_text and could not extract from title. Tried: ' + titleWords.join(', ') });
        }
      }
    }

    if (hasArray(data.tags_text) && data.tags_text.length > 0) {
      const tagsResult = setTags(data.tags_text);
      if (tagsResult) {
        appliedCount++;
      } else {
        needsReview.push({ field: 'tags', reason: 'Não foi possível aplicar Tags de produto' });
      }
    }

    // Pricing is intentionally untouched; price requires explicit user input.
    if (setInputValue('#peso', data.peso || 0)) appliedCount++;
    if (setInputValue('#referencia', data.referencia || '')) appliedCount++;
    if (setInputValue('#barcode', data.barcode || '')) appliedCount++;

    const seoTitleVal = (data.meta_title ?? data.seo?.product_page_title ?? data.seo?.produto_meta_titulo ?? '').trim();
    const trimmedSeoTitle = trimToElementMax('#product_page_title', seoTitleVal, 70, 'Título SEO');
    if (setInputValueFirstWithRetry(['#product_page_title', '#produto_meta_titulo'], trimmedSeoTitle.value, 'Título SEO', 'input', 3)) appliedCount++;
    if (trimmedSeoTitle.trimmed) {
      needsReview.push({ field: '#product_page_title', reason: `Título SEO foi cortado para ${trimmedSeoTitle.maxLength} caracteres` });
    }

    const seoDescVal = data.meta_description ?? data.seo?.product_meta_description ?? data.seo?.produto_meta_descricao ?? '';
    const trimmedSeoDesc = trimToElementMax('#product_meta_description', seoDescVal, 140, 'Meta descrição');
    if (setInputValueFirstWithRetry(['#product_meta_description', '#produto_meta_descricao'], trimmedSeoDesc.value, 'Meta descrição', 'input', 3)) appliedCount++;
    if (trimmedSeoDesc.trimmed) {
      needsReview.push({ field: '#product_meta_description', reason: `Meta descrição foi cortada para ${trimmedSeoDesc.maxLength} caracteres` });
    }

    const metaTagsVal = data.meta_tags ?? data.meta_keywords ?? data.seo?.product_meta_tags ?? data.seo?.product_meta_keywords ?? '';
    const trimmedMetaTags = trimToElementMax('#product_meta_tags', metaTagsVal, null, 'Meta tags');
    if (setInputValueFirstWithRetry(['#product_meta_tags', '#produto_meta_keywords'], trimmedMetaTags.value, 'Meta tags', 'input', 3)) appliedCount++;

    let handleVal = data.handle ?? data.slug ?? data.seo?.product_handle ?? data.seo?.produto_url_amigavel ?? '';
    if (!handleVal && data.titulo) {
      handleVal = slugifyHandle(data.titulo);
    }
    if (!handleVal) {
      needsReview.push({ field: '#product_handle', reason: 'URL: não foi gerado (handle/slug vazio)' });
    } else {
      const trimmedHandle = trimToElementMax('#product_handle', handleVal, 255, 'URL Handle');
      if (setInputValueFirst(['#product_handle', '#produto_url_amigavel'], trimmedHandle.value, 'URL Handle')) {
        appliedCount++;
      } else {
        needsReview.push({ field: '#product_handle', reason: 'URL: campo não encontrado ou não editável' });
      }
      if (trimmedHandle.trimmed) {
        needsReview.push({ field: '#product_handle', reason: `URL Handle foi cortado para ${trimmedHandle.maxLength} caracteres` });
      }
    }

    // Forced settings
    if (document.querySelector('#taxable')) {
      setCheckbox('#taxable', true);
    } else if (document.querySelector('input[name="taxable"]')) {
      setCheckbox('input[name="taxable"]', true);
    }

    const statusHidden = document.querySelector('input[name="estado"][value="2"]');
    if (statusHidden && statusHidden.checked === false) {
      statusHidden.checked = true;
      dispatchEvents(statusHidden, ['change', 'input']);
    } else if (!statusHidden) {
      const statusSelect = document.querySelector('#estado') || document.querySelector('select[name="estado"], select[id*="estado"]');
      if (statusSelect) {
        const opt = Array.from(statusSelect.options || []).find(o => o.value === '2' || normalizeText(o.text) === 'escondido');
        if (opt) {
          statusSelect.value = opt.value;
          dispatchEvents(statusSelect, ['change', 'input']);
        }
      }
    }

    // Uncheck all Atributos checkboxes with force - multiple attempts for stubborn checkboxes
    async function forceUncheckCheckbox(selector, attempts = 0) {
      const el = document.querySelector(selector);
      if (!el) {
        return;
      }

      // Check if already unchecked
      if (!el.checked && !el.hasAttribute('checked')) {
        return;
      }

      // Aggressive uncheck - multiple methods
      el.checked = false;
      el.removeAttribute('checked');

      // Also update value if it's a checkbox with value="1"
      if (el.getAttribute('value') === '1') {
        el.setAttribute('value', '0');
      }

      // Dispatch all possible events
      ['change', 'click', 'input', 'blur'].forEach(eventType => {
        const event = new Event(eventType, { bubbles: true, cancelable: true });
        el.dispatchEvent(event);
      });

      // Also try to find and uncheck any associated hidden input
      const name = el.getAttribute('name');
      if (name) {
        const hiddenInput = document.querySelector(`input[type="hidden"][name="${name}"]`);
        if (hiddenInput) {
          hiddenInput.value = '0';
          hiddenInput.removeAttribute('checked');
        }
      }


      // Retry up to 5 times with increasing delays (more aggressive)
      if (attempts < 5) {
        const delays = [100, 250, 500, 750, 1000];
        setTimeout(() => {
          const reCheck = document.querySelector(selector);
          if (reCheck && (reCheck.checked || reCheck.hasAttribute('checked'))) {
            forceUncheckCheckbox(selector, attempts + 1);
          }
        }, delays[attempts] || 1000);
      }
    }

    // Execute immediately and also after small delays
    const checkboxSelectors = [
      'input[name="destaque"]',
      'input[name="novidade"]',
      'input[name="is_promotion"]',
      'input[name="destaque"][type="checkbox"]',
      'input[name="novidade"][type="checkbox"]',
      'input[name="is_promotion"][type="checkbox"]'
    ];

    // Execute with increasing delays to catch any page re-checking
    [0, 100, 300, 600, 1000].forEach((delay, index) => {
      setTimeout(() => {
        checkboxSelectors.forEach(selector => {
          forceUncheckCheckbox(selector, index > 0 ? index : 0);
        });
      }, delay);
    });

    // Additional safety: set up mutation observer to catch any re-checking
    checkboxSelectors.forEach(selector => {
      const el = document.querySelector(selector);
      if (el) {
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && (mutation.attributeName === 'checked' || el.checked)) {
              el.checked = false;
              el.removeAttribute('checked');
              // Also try unchecking by clicking the label
              const label = document.querySelector(`label[for="${el.id}"]`);
              if (label && el.checked) {
                label.click();
              }
            }
          });
        });
        observer.observe(el, { attributes: true });
      }
    });

    // Display needs review and update summary
      displayNeedsReview();
      updateSummaryStats();
      updateBadgeStatuses();
      return true;
    } catch (error) {
      console.error('[AIPB] Failed to apply product data');
      return false;
    }
  }

  // Display needs review items
  function displayNeedsReview() {
    const reviewList = getPanelElement('#needs-review-list');
    if (!reviewList) return;

    reviewList.innerHTML = '';
    if (!hasGeneratedDraft) {
      reviewList.innerHTML = '<li class="neutral">Gere um rascunho para iniciar a revisão.</li>';
      return;
    }
    if (!needsReview || !Array.isArray(needsReview) || needsReview.length === 0) {
      reviewList.innerHTML = '<li class="success">Sem problemas detetados.</li>';
      return;
    }

    needsReview.forEach(item => {
      const li = document.createElement('li');
      li.className = 'warning';
      li.textContent = `${item.field}: ${item.reason}`;
      reviewList.appendChild(li);
    });
  }

  // Update summary stats header
  function updateSummaryStats() {
    const generatedStat = getPanelElement('.stat.generated');
    const needsReviewStat = getPanelElement('.stat.needs-review');
    const notGeneratedStat = getPanelElement('.stat.not-generated');

    const reviewCount = (!needsReview || !Array.isArray(needsReview)) ? 0 : needsReview.length;

    if (needsReviewStat) needsReviewStat.textContent = `⚠ ${reviewCount} a rever`;

    let generatedCount = 0;
    let notGeneratedCount = 0;
    const valuesToCheck = [
      draftState.titulo,
      draftState.excerpt,
      draftState.descricao_html,
      draftState.marca_text,
      draftState.categorias_text,
      draftState.tags_text,
      draftState.peso,
      draftState.referencia,
      draftState.barcode,
      draftState.seo?.product_page_title,
      draftState.seo?.product_meta_description,
      draftState.seo?.product_meta_tags
    ];
    valuesToCheck.forEach(value => {
      if (value === null || value === undefined || value === '' ||
          (Array.isArray(value) && value.length === 0)) {
        notGeneratedCount++;
      } else {
        generatedCount++;
      }
    });
    if (generatedStat) generatedStat.textContent = `✓ ${generatedCount} gerados`;
    if (notGeneratedStat) notGeneratedStat.textContent = `— ${notGeneratedCount} em falta`;
  }

  // Update badge statuses for preview fields
  function updateBadgeStatuses() {
    const fieldMap = {
      'titulo': '#produto_titulo',
      'excerpt': '#excerpt',
      'descricao': '#descricao',
      'marca': '#marca',
      'categorias': '#categorias',
      'tags': 'input[name="tags_products"]',
      'peso': '#peso',
      'barcode': '#barcode',
      'referencia': '#referencia',
      'seo_title': '#product_page_title',
      'seo_description': '#product_meta_description',
      'seo_tags': '#product_meta_tags'
    };

    Object.entries(fieldMap).forEach(([badgeField, selector]) => {
      const badge = getPanelElement(`.badge[data-field="${badgeField}"]`);
      if (!badge) return;

      // Check if field is in needsReview
      const needsReviewItem = (!needsReview || !Array.isArray(needsReview)) ? undefined : needsReview.find(item => item.field === selector);
      if (needsReviewItem) {
        badge.className = 'badge needs-review';
        badge.textContent = '⚠';
        badge.setAttribute('aria-label', 'Revisão necessária');
        return;
      }

      // Check if field has value in draftState
      let hasValue = false;
      if (badgeField === 'titulo') hasValue = !!draftState.titulo;
      else if (badgeField === 'excerpt') hasValue = !!draftState.excerpt;
      else if (badgeField === 'descricao') hasValue = !!draftState.descricao_html;
      else if (badgeField === 'marca') hasValue = !!draftState.marca_text;
      else if (badgeField === 'categorias') hasValue = hasArray(draftState.categorias_text) && draftState.categorias_text.length > 0;
      else if (badgeField === 'tags') hasValue = hasArray(draftState.tags_text) && draftState.tags_text.length > 0;
      else if (badgeField === 'peso') hasValue = draftState.peso !== null && draftState.peso !== undefined;
      else if (badgeField === 'barcode') hasValue = !!draftState.barcode;
      else if (badgeField === 'referencia') hasValue = !!draftState.referencia;
      else if (badgeField === 'seo_title') hasValue = !!draftState.seo?.product_page_title;
      else if (badgeField === 'seo_description') hasValue = !!draftState.seo?.product_meta_description;
      else if (badgeField === 'seo_tags') hasValue = !!draftState.seo?.product_meta_tags;

      if (hasValue) {
        badge.className = 'badge applied';
        badge.textContent = '✓';
        badge.setAttribute('aria-label', 'Valor disponível');
      } else {
        badge.className = 'badge not-generated';
        badge.textContent = '—';
        badge.setAttribute('aria-label', 'Não gerado');
      }
    });
  }

  // Open media modal and attach files
  async function attachMedia(filenames) {
    // Click "Adicionar" button
    const addBtn = document.querySelector('.add-product-images.btn-global-media-modal');
    if (!addBtn) {
      alert('Media button not found');
      return;
    }
    addBtn.click();

    // Wait for modal
    await sleep(500);

    const modal = document.querySelector('#global-media-modal');
    if (!modal) {
      alert('Media modal not found');
      return;
    }

    // Switch to "Os meus ficheiros" tab
    const myFilesTab = modal.querySelector('a[href="#my-files"]');
    if (myFilesTab) {
      myFilesTab.click();
      await sleep(300);
    }

    // Search and select files
    const searchInput = modal.querySelector('input[name="q"]');
    const mediaGrid = modal.querySelector('.list-media');

    if (!searchInput || !mediaGrid) {
      alert('Search or grid not found');
      return;
    }

    let foundAny = false;
    for (const filename of filenames) {
      searchInput.value = filename;
      dispatchEvents(searchInput, ['input']);
      await sleep(500);

      const items = mediaGrid.querySelectorAll('li');
      items.forEach(item => {
        if (item.textContent.toLowerCase().includes(filename.toLowerCase())) {
          item.click();
          foundAny = true;
        }
      });
    }

    // Show instruction if no match found
    if (!foundAny) {
      const reviewList = getPanelElement('#needs-review-list');
      if (reviewList) {
        const li = document.createElement('li');
        li.className = 'warning';
        li.textContent = 'Sem media encontrado. Faça upload manual ou ajuste os termos de pesquisa.';
        reviewList.appendChild(li);
      }
      return;
    }

    // Wait for .btn-insert to become enabled
    const confirmBtn = modal.querySelector('.btn-insert');
    if (!confirmBtn) {
      alert('Confirm button not found');
      return;
    }

    // Poll for button to become enabled (max 5 seconds)
    let attempts = 0;
    while (confirmBtn.disabled && attempts < 10) {
      await sleep(500);
      attempts++;
    }

    if (confirmBtn.disabled) {
      alert('Confirm button still disabled after 5 seconds');
      return;
    }

    confirmBtn.click();
  }

  function createPanel() {
    if (panelHost) return;

    toggleButton = document.createElement('button');
    toggleButton.id = 'ai-product-builder-toggle';
    toggleButton.className = 'aipb-toggle';
    toggleButton.type = 'button';
    toggleButton.textContent = '✦ Assistente IA';
    toggleButton.setAttribute('aria-controls', 'ai-product-builder-panel');
    toggleButton.setAttribute('aria-expanded', 'false');
    document.body.appendChild(toggleButton);

    panelHost = document.createElement('div');
    panelHost.id = 'ai-product-builder-panel';
    panelHost.setAttribute('data-ai-product-builder', '1');
    panelHost.setAttribute('data-open', 'false');
    panelHost.setAttribute('role', 'complementary');
    panelHost.setAttribute('aria-label', 'Assistente de Produto');
    panelHost.setAttribute('aria-hidden', 'true');
    panelHost.inert = true;
    document.body.appendChild(panelHost);

    shadowRoot = panelHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        --aipb-bg: #f8fafc;
        --aipb-surface: #ffffff;
        --aipb-surface-muted: #f1f5f9;
        --aipb-border: #dbe3ed;
        --aipb-text: #172033;
        --aipb-muted: #64748b;
        --aipb-primary: #2563eb;
        --aipb-primary-hover: #1d4ed8;
        --aipb-success: #15803d;
        --aipb-success-bg: #f0fdf4;
        --aipb-warning: #a16207;
        --aipb-warning-bg: #fffbeb;
        --aipb-danger: #b91c1c;
        --aipb-danger-bg: #fef2f2;
        --aipb-radius: 9px;
        display: block;
        width: min(440px, 100vw);
        height: 100dvh;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: var(--aipb-text);
        position: fixed;
        right: 0;
        top: 0;
        transform: translateX(100%);
        transition: transform 180ms ease;
        z-index: 2147483647;
        pointer-events: none;
      }
      :host([data-open="true"]) {
        transform: translateX(0);
        pointer-events: auto;
      }
      *, *::before, *::after { box-sizing: border-box; }
      button, input, textarea { font: inherit; }
      button:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible {
        outline: 3px solid rgba(37, 99, 235, 0.24);
        outline-offset: 2px;
      }
      .panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background: var(--aipb-bg);
        border-left: 1px solid var(--aipb-border);
        box-shadow: -12px 0 32px rgba(15, 23, 42, 0.14);
      }
      .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        flex: 0 0 auto;
        flex-shrink: 0;
        padding: 17px 18px 15px;
        background: var(--aipb-surface);
        border-bottom: 1px solid var(--aipb-border);
      }
      .panel-header h3 {
        margin: 0;
        font-size: 16px;
        line-height: 1.35;
        letter-spacing: -0.01em;
      }
      .panel-header p {
        margin: 3px 0 0;
        color: var(--aipb-muted);
        font-size: 12px;
        line-height: 1.45;
      }
      .panel-close {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        margin: -4px -5px 0 12px;
        padding: 0;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 8px;
        color: var(--aipb-muted);
        font-size: 23px;
        line-height: 1;
        cursor: pointer;
      }
      .panel-close:hover { background: var(--aipb-surface-muted); color: var(--aipb-text); }
      .panel-content {
        flex: 1 1 auto;
        min-height: 0;
        padding: 18px;
        overflow-y: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
      }
      .panel-content > * + * { margin-top: 18px; }
      .section {
        border-top: 1px solid var(--aipb-border);
        padding-top: 17px;
      }
      .section-title {
        margin: 0 0 12px;
        color: #475569;
        font-size: 11px;
        font-weight: 750;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .generation-card {
        padding: 15px;
        background: var(--aipb-surface);
        border: 1px solid var(--aipb-border);
        border-radius: var(--aipb-radius);
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      }
      .generation-card > * + * { margin-top: 11px; }
      .field-label {
        display: block;
        margin-bottom: 6px;
        color: #334155;
        font-size: 12px;
        font-weight: 650;
      }
      input, textarea {
        width: 100%;
        padding: 9px 10px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        background: var(--aipb-surface);
        color: var(--aipb-text);
        font-size: 12px;
        line-height: 1.5;
      }
      input:hover, textarea:hover { border-color: #94a3b8; }
      input:focus, textarea:focus { border-color: var(--aipb-primary); }
      textarea {
        resize: vertical;
      }
      .textarea-excerpt { min-height: 78px; }
      .textarea-description { min-height: 170px; }
      .textarea-seo { min-height: 92px; }
      .panel-btn {
        min-height: 40px;
        padding: 9px 13px;
        border: 1px solid transparent;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 650;
        cursor: pointer;
      }
      .panel-btn.primary {
        background: var(--aipb-primary);
        color: #fff;
      }
      .panel-btn.primary:hover:not(:disabled) { background: var(--aipb-primary-hover); }
      .panel-btn.secondary {
        background: var(--aipb-surface);
        border-color: var(--aipb-border);
        color: #334155;
      }
      .panel-btn.secondary:hover:not(:disabled) { background: var(--aipb-surface-muted); }
      .panel-btn:disabled { cursor: not-allowed; opacity: 0.5; }
      #generate-draft { width: 100%; margin-top: 13px; }
      .config-status {
        margin: 8px 0 0;
        font-size: 11px;
      }
      .config-status.ready { color: var(--aipb-success); }
      .config-status.warning { color: var(--aipb-warning); }
      .panel-message {
        margin: 12px 0 0;
        padding: 9px 10px;
        border: 1px solid var(--aipb-border);
        border-radius: 8px;
        font-size: 12px;
        line-height: 1.45;
      }
      .panel-message.info, .panel-message.loading { color: #1e40af; background: #eff6ff; border-color: #bfdbfe; }
      .panel-message.success { color: var(--aipb-success); background: var(--aipb-success-bg); border-color: #bbf7d0; }
      .panel-message.error { color: var(--aipb-danger); background: var(--aipb-danger-bg); border-color: #fecaca; }
      .panel-message.loading::before {
        content: '';
        display: inline-block;
        width: 11px;
        height: 11px;
        margin-right: 7px;
        border: 2px solid #93c5fd;
        border-top-color: var(--aipb-primary);
        border-radius: 50%;
        vertical-align: -1px;
        animation: aipb-spin 800ms linear infinite;
      }
      @keyframes aipb-spin { to { transform: rotate(360deg); } }
      .summary-header {
        padding: 11px 12px;
        background: var(--aipb-surface);
        border: 1px solid var(--aipb-border);
        border-radius: var(--aipb-radius);
      }
      .summary-stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }
      .stat {
        font-size: 11px;
        font-weight: 650;
        line-height: 1.35;
        text-align: center;
      }
      .stat.generated { color: var(--aipb-success); }
      .stat.needs-review { color: var(--aipb-warning); }
      .stat.not-generated { color: var(--aipb-muted); }
      .preview-grid {
        display: grid;
        gap: 12px;
      }
      .compact-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .field-block { min-width: 0; }
      .field-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: 24px;
        margin-bottom: 5px;
      }
      .field-name {
        display: inline-flex;
        align-items: center;
        min-width: 0;
        color: #334155;
        font-size: 12px;
        font-weight: 650;
      }
      .badge {
        display: inline-grid;
        place-items: center;
        width: 18px;
        height: 18px;
        margin-left: 6px;
        border-radius: 50%;
        font-size: 10px;
        font-weight: 750;
      }
      .badge:empty { display: none; }
      .badge.applied { background: #dcfce7; color: var(--aipb-success); }
      .badge.needs-review { background: #fef3c7; color: var(--aipb-warning); }
      .badge.not-generated { background: #e2e8f0; color: var(--aipb-muted); }
      .lock-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 28px;
        gap: 0;
        color: #475569;
        background: var(--aipb-surface-muted);
        border: 1px solid var(--aipb-border);
        border-radius: 7px;
        font-size: 0;
        font-weight: 550;
        cursor: pointer;
        white-space: nowrap;
      }
      .lock-toggle:hover { color: var(--aipb-primary); border-color: #93c5fd; background: #eff6ff; }
      .lock-toggle:focus-within { outline: 3px solid rgba(37, 99, 235, 0.24); outline-offset: 2px; }
      .lock-toggle::before { content: '🔒'; font-size: 13px; line-height: 1; }
      .lock-toggle input[type="checkbox"] {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        cursor: pointer;
      }
      .lock-toggle:has(input:not(:checked))::before { content: '🔓'; }
      .category-preview {
        min-height: 40px;
        padding: 7px;
        background: var(--aipb-surface);
        border: 1px solid #cbd5e1;
        border-radius: 8px;
      }
      .category-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .category-chip {
        max-width: 100%;
        padding: 4px 7px;
        overflow: hidden;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-radius: 6px;
        color: #1e40af;
        font-size: 11px;
        line-height: 1.35;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .details-card {
        background: var(--aipb-surface);
        border: 1px solid var(--aipb-border);
        border-radius: var(--aipb-radius);
      }
      .details-card summary {
        padding: 12px 14px;
        color: #334155;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }
      .details-content {
        padding: 0 14px 14px;
        border-top: 1px solid var(--aipb-border);
      }
      .details-content > * + * { margin-top: 13px; }
      .details-content.compact-grid { align-items: start; }
      .details-content.compact-grid > * + * { margin-top: 0; }
      .details-content.compact-grid .field-heading { min-height: 28px; margin-bottom: 7px; }
      .details-content.compact-grid .field-name { line-height: 1.35; }
      .details-content.compact-grid input { min-height: 40px; }
      .subheading {
        margin: 13px 0 7px;
        color: var(--aipb-muted);
        font-size: 11px;
        font-weight: 650;
      }
      .missing-list {
        padding-left: 16px;
        margin: 8px 0 0;
        color: var(--aipb-muted);
        font-size: 11px;
      }
      .needs-review ul {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .needs-review li {
        padding: 9px 10px;
        margin-bottom: 7px;
        border: 1px solid transparent;
        border-radius: 8px;
        font-size: 12px;
        line-height: 1.45;
      }
      .needs-review li.success {
        background: var(--aipb-success-bg);
        border-color: #bbf7d0;
        color: var(--aipb-success);
      }
      .needs-review li.neutral {
        background: var(--aipb-surface-muted);
        border-color: var(--aipb-border);
        color: var(--aipb-muted);
      }
      .needs-review li.warning {
        background: var(--aipb-warning-bg);
        border-color: #fde68a;
        color: var(--aipb-warning);
      }
      .supplier-suggestions {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .group-title {
        font-size: 11px;
        font-weight: 650;
        color: var(--aipb-muted);
        margin-bottom: 5px;
      }
      .suggestion-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .suggestion-chip {
        max-width: 100%;
        padding: 5px 8px;
        overflow: hidden;
        background: var(--aipb-surface-muted);
        border: 1px solid var(--aipb-border);
        border-radius: 7px;
        color: #475569;
        font-size: 10px;
        cursor: pointer;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .suggestion-chip:hover {
        background: #eff6ff;
        color: #1e40af;
        border-color: #bfdbfe;
      }
      .panel-footer {
        flex: 0 0 auto;
        flex-shrink: 0;
        padding: 13px 18px;
        background: var(--aipb-surface);
        border-top: 1px solid var(--aipb-border);
        box-shadow: 0 -8px 20px rgba(15, 23, 42, 0.04);
      }
      .panel-footer .panel-btn { width: 100%; }
      @media (max-width: 420px) {
        .panel-content { padding: 16px; }
        .compact-grid { grid-template-columns: 1fr; }
      }
      @media (max-width: 360px) {
        .panel-content { padding: 12px; }
        .generation-card { padding: 13px; }
        .panel-footer { padding: 12px; }
      }
      @media (prefers-reduced-motion: reduce) {
        :host { transition: none; }
        .panel-message.loading::before { animation: none; }
      }
      .panel-shell {
        height: 100%;
        min-height: 0;
      }
    `;

    shadowRoot.appendChild(style);
    const panelWrapper = document.createElement('div');
    panelWrapper.className = 'panel-shell';
    panelWrapper.innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>✦ Assistente de Produto</h3>
            <p>Gere, reveja e aplique os dados do produto.</p>
          </div>
          <button class="panel-close" type="button" aria-label="Fechar assistente">&times;</button>
        </div>
        <div class="panel-content">
          <div class="generation-card">
            <div>
              <label class="field-label" for="input-titulo">Título do produto</label>
              <input id="input-titulo" type="text" autocomplete="off" />
            </div>
            <div>

            </div>
            <button id="generate-draft" class="panel-btn primary" type="button" disabled>Gerar rascunho</button>
            <p id="config-warning" class="config-status" aria-live="polite"></p>
            <p id="panel-message" class="panel-message info" role="status" aria-live="polite" hidden></p>
          </div>

          <div class="summary-header">
            <div class="summary-stats">
              <span class="stat generated">✓ 0 gerados</span>
              <span class="stat needs-review">⚠ 0 a rever</span>
              <span class="stat not-generated">— 12 em falta</span>
            </div>
          </div>

          <details class="details-card">
            <summary>Pesquisa e Media</summary>
            <div class="details-content">
              <p class="subheading">Sugestões de fornecedores</p>
              <div id="supplier-suggestions" class="supplier-suggestions">
                <div class="suggestion-group" hidden><div class="group-title">Marca oficial</div><div id="supplier-official" class="suggestion-chips"></div></div>
                <div class="suggestion-group" hidden><div class="group-title">Fornecedores e distribuidores</div><div id="supplier-suppliers" class="suggestion-chips"></div></div>
              </div>
              <button id="open-media" class="panel-btn secondary" type="button">Abrir pesquisa de Media</button>
            </div>
          </details>

          <div class="section">
            <h4 class="section-title">Produto</h4>
            <div class="preview-grid">
              <div class="field-block">
                <div class="field-heading"><label class="field-name" for="preview-titulo">Título<span class="badge" data-field="titulo"></span></label></div>
                <input id="preview-titulo" type="text" />
              </div>
              <div class="field-block">
                <div class="field-heading">
                  <label class="field-name" for="preview-excerpt">Excerto<span class="badge" data-field="excerpt"></span></label>
                  <label class="lock-toggle"><input type="checkbox" data-lock="excerpt" aria-label="Manter excerto na próxima geração"> Manter</label>
                </div>
                <textarea id="preview-excerpt" class="textarea-excerpt"></textarea>
              </div>
              <div class="field-block">
                <div class="field-heading">
                  <label class="field-name" for="preview-descricao">Descrição<span class="badge" data-field="descricao"></span></label>
                  <label class="lock-toggle"><input type="checkbox" data-lock="descricao" aria-label="Manter descrição na próxima geração"> Manter</label>
                </div>
                <textarea id="preview-descricao" class="textarea-description"></textarea>
              </div>
              <div class="compact-grid">
                <div class="field-block">
                  <div class="field-heading"><label class="field-name" for="preview-marca">Marca<span class="badge" data-field="marca"></span></label></div>
                  <input id="preview-marca" type="text" />
                </div>
                <div class="field-block">
                  <div class="field-heading"><label class="field-name" for="preview-peso">Peso (g)<span class="badge" data-field="peso"></span></label></div>
                  <input id="preview-peso" type="number" min="0" />
                </div>
              </div>
              <div class="field-block">
                <div class="field-heading"><span class="field-name">Categorias<span class="badge" data-field="categorias"></span></span></div>
                <div id="preview-categorias" class="category-preview" aria-label="Categorias geradas" aria-readonly="true"></div>
              </div>
              <div class="field-block">
                <div class="field-heading"><label class="field-name" for="preview-tags">Tags<span class="badge" data-field="tags"></span></label></div>
                <input id="preview-tags" type="text" placeholder="Separadas por vírgula" />
              </div>
            </div>
          </div>

          <div class="section">
            <h4 class="section-title">SEO</h4>
            <div class="preview-grid">
              <div class="field-block">
                <div class="field-heading">
                  <label class="field-name" for="preview-seo-title">Título SEO<span class="badge" data-field="seo_title"></span></label>
                  <label class="lock-toggle"><input type="checkbox" data-lock="seo_title" aria-label="Manter título SEO na próxima geração"> Manter</label>
                </div>
                <input id="preview-seo-title" type="text" />
              </div>
              <div class="field-block">
                <div class="field-heading">
                  <label class="field-name" for="preview-seo-description">Meta descrição<span class="badge" data-field="seo_description"></span></label>
                  <label class="lock-toggle"><input type="checkbox" data-lock="seo_description" aria-label="Manter meta descrição na próxima geração"> Manter</label>
                </div>
                <textarea id="preview-seo-description" class="textarea-seo"></textarea>
              </div>
              <div class="field-block">
                <div class="field-heading">
                  <label class="field-name" for="preview-seo-tags">Meta tags<span class="badge" data-field="seo_tags"></span></label>
                  <label class="lock-toggle"><input type="checkbox" data-lock="seo_tags" aria-label="Manter meta tags na próxima geração"> Manter</label>
                </div>
                <input id="preview-seo-tags" type="text" />
              </div>
            </div>
          </div>

          <details class="details-card">
            <summary>Detalhes adicionais</summary>
            <div class="details-content compact-grid">
              <div class="field-block">
                <div class="field-heading"><label class="field-name" for="preview-referencia">Referência<span class="badge" data-field="referencia"></span></label></div>
                <input id="preview-referencia" type="text" />
              </div>
              <div class="field-block">
                <div class="field-heading"><label class="field-name" for="preview-barcode">Código de barras<span class="badge" data-field="barcode"></span></label></div>
                <input id="preview-barcode" type="text" />
              </div>
            </div>
          </details>

          <div class="section needs-review">
            <h4 class="section-title">Revisão</h4>
            <ul id="needs-review-list"></ul>
            <p class="subheading">Campos indicados como em falta</p>
            <ul id="preview-missing" class="missing-list"></ul>
          </div>
        </div>
        <div class="panel-footer">
          <button id="apply-form" class="panel-btn primary" type="button" disabled>Aplicar ao formulário</button>
        </div>
      </div>
    `;
    shadowRoot.appendChild(panelWrapper);

    const closeBtn = getPanelElement('.panel-close');
    closeBtn.addEventListener('click', () => closePanel());

    toggleButton.addEventListener('click', () => togglePanel(toggleButton));

    getPanelElement('#generate-draft').addEventListener('click', async () => {
      await generateDraftForPreview();
    });

    getPanelElement('#apply-form').addEventListener('click', async () => {
      if (!hasGeneratedDraft || isGenerating) return;
      updateDraftFromPreview();
      const appliedSuccessfully = await applyProductData(draftState);
      if (!appliedSuccessfully) {
        setPanelMessage('error', 'Não foi possível aplicar o rascunho. Reveja o formulário e tente novamente.');
        return;
      }
      setPanelMessage(needsReview.length > 0 ? 'error' : 'success', needsReview.length > 0
        ? 'Dados aplicados. Reveja os campos assinalados.'
        : 'Dados aplicados ao formulário. Confirme antes de gravar.');

      if (needsReview.length > 0) {
        const firstItem = needsReview[0];
        const fieldEl = document.querySelector(firstItem.field);
        if (fieldEl) {
          const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          fieldEl.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
          fieldEl.classList.add('aipb-review-highlight');
          setTimeout(() => {
            fieldEl.classList.remove('aipb-review-highlight');
          }, 2000);
        }
      }
    });

    getPanelElement('#open-media').addEventListener('click', () => {
      updateDraftFromPreview();
      if (draftState.media && hasArray(draftState.media.attach_existing_by_search)) {
        attachMedia(draftState.media.attach_existing_by_search);
      } else {
        alert('Sem media encontrado');
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && panelHost?.getAttribute('data-open') === 'true') {
        closePanel();
      }
    });

    refreshConfigStatus();
    updatePreviewFromDraft();
    updateSummaryStats();
    updateBadgeStatuses();
    displayNeedsReview();
    updateApplyState();

    ensureInlineGenerateButton();
    setupInlineObserver();
    setTimeout(ensureInlineGenerateButton, 500);
    setTimeout(ensureInlineGenerateButton, 1500);
  }

  // Wait for page to load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createPanel);
  } else {
    createPanel();
  }

})();
