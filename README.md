# Shopkit Product Builder

Chrome extension that turns a Shopkit product title into an editable Portuguese product draft. Review the draft, apply selected fields to the Shopkit form, then save the product yourself.

> Portfolio/experimental software. Test on non-production products first. AI output can be wrong.

## What It Does

1. Reads the product title and available Shopkit brands, categories, and tags.
2. Sends generation context to OpenAI through the extension service worker.
3. Shows an editable draft inside a Portuguese assistant panel.
4. Lets you review, edit, and lock selected values before regeneration.
5. Applies reviewed content to the Shopkit form only after explicit action.

It does **not** submit, publish, or save the Shopkit product automatically. Media selection and final product save remain manual.

## Requirements

- Desktop Google Chrome with Manifest V3 support.
- Access to a Shopkit admin product-create page: `https://YOUR-STORE.shopk.it/admin/products/create`.
- OpenAI API key with billing/credits and a spending limit.
- Permission to send product titles and Shopkit option lists to OpenAI.

## Download

The repository source is not itself a Chrome extension ZIP. Chrome must load the extracted folder that contains `manifest.json`.

- **Recommended:** download the versioned extension ZIP from the [Releases page](https://github.com/Woddy23/shopkit-product-builder/releases) when available.
- **Source ZIP:** click **Code → Download ZIP**, extract it, then select `shopkit-product-builder-main/extension/` in Chrome.

There is currently no Chrome Web Store listing. The release ZIP is a sideload package for Chrome Developer mode.

## Install

1. Download and extract a release ZIP, or use **Code → Download ZIP** and extract the source archive.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted folder that directly contains `manifest.json`. For a source ZIP, this is `shopkit-product-builder-main/extension/`, not the repository root, ZIP file, or ZIP contents before extraction.
6. Confirm the extension card shows version `1.0.0` without an error banner.
7. Click the extension icon. The Options page opens.
8. Paste your OpenAI API key.
9. Keep recommended model `gpt-5.6-luna`, or enter another model available to your account.
10. Click **Guardar configuração**.
11. Open your Shopkit product-create page.
12. Confirm that `✦ Assistente IA` appears in the bottom-left corner.

No source file needs store URL editing. The extension matches only HTTPS `*.shopk.it/admin/products/create` pages. After changing extension files, click **Reload** in `chrome://extensions/` and refresh Shopkit.

## OpenAI Configuration

`gpt-5.6-luna` is the tested and recommended default. Other compatible model names can be entered, but compatibility and output quality are not guaranteed. GPT-5-prefixed models use OpenAI Responses API Structured Outputs. Other models use a compatibility JSON path and receive stronger runtime validation before Apply.

The API key is stored in `chrome.storage.local` for this Chrome profile and used only by the extension service worker. It is not encrypted secret storage. Use a restricted key with spending limits, never commit it, and never use it on a shared machine. Options page can delete the saved key.

Create an API key in the [OpenAI API keys page](https://platform.openai.com/api-keys). API billing is separate from a ChatGPT subscription. Check [API billing and usage limits](https://platform.openai.com/settings/organization/limits) before generating drafts. Revoke a compromised key from the API keys page, then remove the local copy with **Apagar chave guardada**.

| Model | Status | Request path |
|---|---|---|
| `gpt-5.6-luna` | Tested and recommended | Responses API with strict JSON Schema |
| Other `gpt-5*` models | Expected compatible, not fully tested | Responses API with strict JSON Schema |
| Other model names | Compatibility path; experimental | Chat Completions JSON mode |

The extension accepts another model name because model access varies by OpenAI account. A model must be available to your API project; an unavailable model returns an API error.

## Permissions

| Permission | Why it is requested |
|---|---|
| `storage` | Stores the API key and selected model in this Chrome profile |
| `https://api.openai.com/*` | Lets the service worker send generation requests to OpenAI |
| `https://*.shopk.it/admin/products/create` | Injects the assistant only on Shopkit product-create pages |

The extension does not request all-site access, cookies, browsing history, downloads, Shopkit authentication tokens, or arbitrary external messaging.

## Quick Start

1. Open a Shopkit product-create page.
2. Enter a product title in Shopkit.
3. Click `Gerar com IA` beside the title or open the assistant and click `Gerar rascunho`.
4. Review every generated field and every warning.
5. Edit inaccurate values. Do not trust generated barcode, reference, weight, or factual claims without checking them.
6. Use `Manter` locks only when regenerating the same product.
7. Click `Aplicar ao formulário`.
8. Review the native Shopkit form.
9. Open media search, select assets manually, and confirm them in Shopkit.
10. Save the product manually in Shopkit.

Generate does not change native Shopkit fields. Apply does not save the product. Price, tax, status, featured, new-product, and promotion settings are not generated or changed.

## Fields Applied

| Field | Generated | Previewed | Applied | Notes |
|---|---:|---:|---:|---|
| Title | Yes | Yes | Yes | Review before saving |
| Description | Yes | Yes | Yes | Sanitized HTML |
| Excerpt | Yes | Yes | Yes | Limited to 85 characters |
| Brand | Suggested | Yes | If matched | Existing Shopkit option required |
| Categories | Suggested | Yes | If matched | Replaces stale selections |
| Tags | Suggested | Yes | Yes | Shopkit widget dependent |
| Weight | Suggested | Yes | If known | Unknown value stays untouched |
| Reference | Suggested | Yes | If present | Verify manually |
| Barcode | Suggested | Yes | If present | Never trust generated barcode without checking |
| SEO fields | Yes | Yes | Yes | Native field limits apply |
| Handle | Yes | Details | Yes | Verify URL slug |
| Price | No | No | No | Manual |
| Tax/status/flags | No | No | No | Preserved |
| Media | Search terms | Yes | No | User selects and confirms |
| Final save | No | No | No | Manual Shopkit action |

## Data Flow

```text
Shopkit product page
        |
        | title + discovered option labels
        v
Chrome content script
        |
        | prompt + JSON schema message
        v
Chrome service worker --> OpenAI API
        |
        v
Validated editable draft
        |
        | explicit Apply
        v
Shopkit form --> manual Shopkit save
```

No backend or Shopkit API exists. OpenAI receives the product title and discovered context such as category, brand, and tag labels. Supplier suggestion links are generated for review only. Clicking a supplier/search suggestion opens Google with a product query; Chrome then sends that query to Google. The selected supplier preference is stored locally. Review your organisation's data policy before using client or confidential product information.

## Troubleshooting

| Symptom | Check |
|---|---|
| Assistant does not appear | Confirm URL uses HTTPS and ends with `/admin/products/create`; reload extension and page |
| Generate is disabled | Open extension Options and save a non-empty API key |
| HTTP 401 | Key invalid, revoked, or copied incorrectly |
| HTTP 400 | Model name or API request unsupported; try `gpt-5.6-luna` |
| HTTP 429 | API quota, credits, spending limit, or rate limit |
| Timeout | OpenAI or network response exceeded 60 seconds |
| Network failure | Check Chrome connectivity, proxy, firewall, and service worker errors |
| Brand/category warning | Shopkit selectors or available options changed |
| Description not updated | Shopkit TinyMCE/editor structure changed; review field manually |
| Stale select or tags UI | Shopkit Chosen/tags widget changed; verify native form value |
| Media search fails | Shopkit media modal selectors changed; select media manually |
| Source change has no effect | Reload extension, then refresh Shopkit page |

Never include API keys, cookies, session data, client screenshots, or raw private product data in bug reports.

## Development

No `npm install`, build, bundler, or package manager is required. Chrome loads `extension/` directly. Node 22 is used by CI.

```bash
node --check extension/content.js
node --check extension/options.js
node --check extension/background.js
node tests/regression.test.js
```

The Node checks do not provide full browser coverage. Manually verify extension loading, Options save/delete, OpenAI generation, TinyMCE, Chosen, tags, media search, Apply, and final manual save after Shopkit UI changes.

## Repository Layout

- `extension/manifest.json`: extension match, permissions, service worker, Options page, icons.
- `extension/content.js`: Shopkit discovery, Portuguese panel, prompt, validation, preview, and Apply.
- `extension/background.js`: OpenAI request, API-key use, timeout, and response transport.
- `extension/options.html` / `options.js`: local API configuration.
- `docs/SHOPKIT_INTEGRATION.md`: DOM integration contract and manual validation boundary.
- `SECURITY.md`: API-key, data-flow, and vulnerability-reporting policy.
- `tests/regression.test.js`: dependency-free regression checks.

## Status, Support, and Licence

This is an experimental portfolio and educational repository, not an official Shopkit product. Version `1.0.0` is a reviewed source snapshot; maintenance is best effort and unattended production use is not supported. Shopkit selectors and widgets may change.

- Installation and reproducible integration issues: [GitHub Issues](https://github.com/Woddy23/shopkit-product-builder/issues).
- Security issues: follow [`SECURITY.md`](SECURITY.md) and do not use a public issue for secrets or exploit details.
- No open-source licence is granted. Public visibility does not grant permission to redistribute or modify this code.
