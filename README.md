# Shopkit Product Builder

Create a Portuguese product draft from a Shopkit product title. Review it, apply it to the form, then save the product yourself.

> Experimental Chrome extension. Test with a non-production product first. It never saves or publishes products automatically.

## Download

[Download Shopkit Product Builder v1.0.0](https://github.com/Woddy23/shopkit-product-builder/releases/download/v1.0.0/shopkit-product-builder-v1.0.0.zip)

## Demo

Sanitized screenshot and walkthrough video coming soon.

## Install

1. Download the ZIP above.
2. Extract it. Chrome cannot load the compressed ZIP directly.
3. Open `chrome://extensions/`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted folder that contains `manifest.json`.
7. Confirm **Shopkit Product Builder** appears without an error banner.
8. Click extension icon, add OpenAI API key, then click **Guardar configuração**.

No code editing, cloning, or store URL setup is required. Extension runs only on HTTPS Shopkit product-create pages:

```text
https://YOUR-STORE.shopk.it/admin/products/create
```

## Use It

1. Open Shopkit product-create page.
2. Enter product title.
3. Click `Gerar com IA` or open `✦ Assistente IA`.
4. Review and edit generated fields.
5. Click `Aplicar ao formulário`.
6. Check Shopkit form, select media manually, then save product manually.

**Generate** only creates preview. **Apply** writes reviewed fields. Neither action saves, publishes, changes price, changes tax/status, or changes promotion flags.

## What It Handles

| Generates and applies | Always manual |
|---|---|
| Title, description, excerpt | Final Shopkit save |
| Brand and categories when matched | Price |
| Tags, known weight, reference, barcode | Tax, status, promotion, featured/new flags |
| SEO fields and handle | Media selection |

AI can be wrong. Check factual claims, barcode, reference, weight, and generated content before saving.

## OpenAI Setup

1. Create key at [OpenAI API keys](https://platform.openai.com/api-keys).
2. Check [API billing and limits](https://platform.openai.com/settings/organization/limits). ChatGPT subscription and API billing are separate.
3. In extension Options, paste key and keep recommended model `gpt-5.6-luna`.

Key is stored locally in this Chrome profile and used by extension service worker. It is not encrypted secret storage. Use spending limits, do not share it, and remove it in Options with **Apagar chave guardada** if needed.

Other models can be entered, but `gpt-5.6-luna` is tested and recommended.

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Saves API key and selected model locally |
| `https://api.openai.com/*` | Sends generation request to OpenAI |
| `https://*.shopk.it/admin/products/create` | Shows assistant only on Shopkit product-create pages |

No all-sites access, cookies, history, downloads, or Shopkit authentication tokens are requested.

## Help

| Problem | What to check |
|---|---|
| Assistant missing | URL must end with `/admin/products/create`; reload extension and page |
| Generate disabled | Save OpenAI API key in extension Options |
| HTTP 401 | Key is invalid or revoked |
| HTTP 400 | Model unsupported; try `gpt-5.6-luna` |
| HTTP 429 | API credits, spending limit, or rate limit |
| Form field did not update | Shopkit editor/widget changed; update field manually |

Report reproducible installation or integration issues through [GitHub Issues](https://github.com/Woddy23/shopkit-product-builder/issues). Never include keys, cookies, private product data, or screenshots with client details.

## Technical Notes

OpenAI receives product title plus discovered Shopkit category, brand, and tag labels. Supplier/search suggestions open Google only after a user click. No backend or Shopkit API is used.

Run checks:

```bash
node --check extension/content.js
node --check extension/options.js
node --check extension/background.js
node tests/validate-manifest.js
node tests/regression.test.js
```

See [Shopkit integration details](docs/SHOPKIT_INTEGRATION.md) and [security policy](SECURITY.md).

## Status and Licence

Experimental portfolio project, version `1.0.0`. Best-effort maintenance. Not official Shopkit software. No open-source licence is granted; public visibility does not grant permission to redistribute or modify this code.

<details>
<summary>Install from repository source</summary>

Download repository source with **Code → Download ZIP**, extract it, then load its `extension/` folder in `chrome://extensions/`. Normal users should use release ZIP above.

</details>
