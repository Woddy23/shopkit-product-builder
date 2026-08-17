# Security Policy

## Supported Version

This policy covers reviewed portfolio exports of this codebase. It is not a security guarantee for private deployments or modified copies.

## Reporting A Vulnerability

Do not publish secrets or exploit details in a public issue. Open a private GitHub security report if enabled for the repository. Otherwise contact the maintainer through the private contact method listed in the repository owner profile and include:

- Affected file or version
- Reproduction steps
- Impact
- Minimal proof of concept without real credentials or client data

## API-Key Handling

The user supplies an OpenAI API key. The extension stores it in `chrome.storage.local`, which is local browser extension storage and not an encrypted secrets vault. The key is not bundled in the repository. Do not use keys on shared machines, and prefer restricted keys with spending limits and regular rotation.

If a credential may have been exposed, revoke or rotate it immediately. Never commit credentials, tokens, session values, private keys, `.env` files, database URLs, or private client captures.

## Data Sent To OpenAI

When generation is requested, the extension sends product title and generation context, including selected or discovered store options such as categories, brands, and tags, directly to OpenAI. Review your organisation's data policy before sending confidential product, customer, supplier, or client information.

The extension does not include a backend or claim that OpenAI or the host store retains no data. Consult current provider terms and settings for retention questions.

## Generated Content

Generated product information can be inaccurate, incomplete, or inappropriate. Review every field before applying or publishing it. The extension does not guarantee SEO quality, legal compliance, factual accuracy, or production suitability.

## Scope

The public version targets one developer-configured Shopkit hostname. It is not an official Shopkit product and is not guaranteed to support every Shopkit store. Host permissions must remain narrow.
