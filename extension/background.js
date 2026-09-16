'use strict';

const MODEL_DEFAULT = 'gpt-5.6-luna';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 60000;

function getConfig() {
  return chrome.storage.local.get(['apiKey', 'model']).then(({ apiKey = '', model = MODEL_DEFAULT }) => ({
    apiKey: String(apiKey || '').trim(),
    model: String(model || '').trim() || MODEL_DEFAULT
  }));
}

function responseError(response, apiError) {
  return {
    ok: false,
    status: response.status,
    apiError: apiError || null
  };
}

async function readApiError(response) {
  try {
    const body = await response.json();
    return body?.error || null;
  } catch (_) {
    return null;
  }
}

async function fetchOpenAI(url, body, apiKey, deadline) {
  const controller = new AbortController();
  const remaining = Math.max(1, deadline - Date.now());
  const timeoutId = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, remaining));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      return responseError(response, await readApiError(response));
    }

    return { ok: true, body: await response.json() };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    const networkError = new Error('OpenAI network request failed.');
    networkError.name = 'NetworkError';
    throw networkError;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildRequest(model, prompt, schema) {
  const isGpt5 = model.trim().toLowerCase().startsWith('gpt-5');
  if (isGpt5) {
    return {
      url: OPENAI_RESPONSES_URL,
      body: {
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
            schema
          }
        }
      }
    };
  }

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 3500,
    response_format: { type: 'json_object' },
    temperature: 0.2
  };
  return { url: OPENAI_CHAT_URL, body };
}

function extractResponseText(result, isGpt5) {
  if (isGpt5) {
    const output = Array.isArray(result?.output) ? result.output : [];
    const message = output.find(item => item?.type === 'message' && item?.role === 'assistant');
    if (Array.isArray(message?.content)) {
      const text = message.content.map(item => {
        if (typeof item === 'string') return item;
        if (typeof item?.text === 'string') return item.text;
        if (typeof item?.text?.value === 'string') return item.text.value;
        if (typeof item?.content === 'string') return item.content;
        return '';
      }).join('').trim();
      if (text) return text;
    }
    return output.map(item => typeof item?.text === 'string' ? item.text : '').join('').trim();
  }

  const choice = result?.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw new Error('Model output truncated.');
  }
  if (choice?.message?.refusal) {
    throw new Error('Model refused to generate a draft.');
  }
  if (typeof choice?.message?.content === 'string') return choice.message.content.trim();
  if (Array.isArray(choice?.message?.content)) {
    return choice.message.content.map(item => typeof item === 'string' ? item : item?.text || '').join('').trim();
  }
  return '';
}

async function generateDraft(prompt, model, schema) {
  const config = await getConfig();
  if (!config.apiKey) return { ok: false, error: { message: 'API key not configured' } };

  const selectedModel = String(model || config.model).trim() || config.model;
  if (selectedModel.length > 100 || !/^[a-zA-Z0-9._:-]+$/.test(selectedModel)) {
    return { ok: false, error: { message: 'Invalid model name.' } };
  }
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  const request = buildRequest(selectedModel, prompt, schema);
  const isGpt5 = selectedModel.toLowerCase().startsWith('gpt-5');
  let result = await fetchOpenAI(request.url, request.body, config.apiKey, deadline);

  if (!result.ok) return result;

  let rawText = extractResponseText(result.body, isGpt5);
  if (!rawText && !isGpt5) {
    const retryBody = { ...request.body };
    delete retryBody.response_format;
    result = await fetchOpenAI(request.url, retryBody, config.apiKey, deadline);
    if (!result.ok) return result;
    rawText = extractResponseText(result.body, false);
  }

  if (!rawText) return { ok: false, error: { message: 'Model returned empty response content.' } };
  return { ok: true, rawText };
}

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return undefined;

  if (message.type === 'open-options') {
    chrome.runtime.openOptionsPage();
    return false;
  }

  if (message.type === 'get-config') {
    getConfig()
      .then(config => sendResponse({ ready: Boolean(config.apiKey), model: config.model }))
      .catch(() => sendResponse({ ready: false, model: MODEL_DEFAULT }));
    return true;
  }

  if (message.type === 'generate-draft') {
    if (!sender.tab || !sender.tab.url || !/^https:\/\/[^/]+\.shopk\.it\/admin\/products\/create(?:[?#].*)?$/.test(sender.tab.url)) {
      sendResponse({ ok: false, error: { message: 'Unsupported Shopkit page.' } });
      return false;
    }
    if (typeof message.prompt !== 'string' || !message.prompt.trim() || message.prompt.length > 100000 || typeof message.model !== 'string' || message.model.length > 100 || !message.schema || typeof message.schema !== 'object' || Array.isArray(message.schema) || JSON.stringify(message.schema).length > 100000) {
      sendResponse({ ok: false, error: { message: 'Invalid generation request.' } });
      return false;
    }
    generateDraft(message.prompt, message.model, message.schema)
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: { name: error?.name, message: error?.message } }));
    return true;
  }

  return undefined;
});
