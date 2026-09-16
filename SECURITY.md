# Security Policy

## Supported Version

This policy covers reviewed repository version `1.0.0`. Modified copies and private deployments are outside this support boundary.

## Private Reporting

Do not publish credentials, private product data, or exploit details in a public issue. Use the repository's private GitHub security-reporting feature when enabled. If it is unavailable, contact the maintainer through the private contact method on the repository owner's GitHub profile.

Include:

- Affected version or commit.
- Affected file and browser context.
- Reproduction steps using dummy data.
- Security impact.
- Minimal proof of concept without real credentials or client data.

Do not expect support for production incidents, private forks, or modified deployments. No response-time guarantee is offered for this portfolio project.

## API Key

The user supplies an OpenAI API key. The service worker reads it from `chrome.storage.local` and uses it for OpenAI requests. The content script does not read the key. The key is not stored in this repository, but browser local storage is not an encrypted secrets vault.

- Use a restricted key with spending limits.
- Do not use keys on shared machines or shared Chrome profiles.
- Never place keys in screenshots, issues, commits, logs, or screen recordings.
- Use the Options page's `Apagar chave guardada` action when removing local configuration.
- Revoke or rotate the key immediately if exposure is possible.

Moving requests to a service worker improves request isolation and cross-origin reliability. It does not make a browser-held API key equivalent to server-side secret storage.

## Data Sent to OpenAI

When generation runs, the extension sends product title and generation context directly to OpenAI. Context can include Shopkit category, brand, and tag labels discovered from the page. Generated content can include product claims, descriptions, SEO text, and media search terms.

No backend or Shopkit API is used. This extension does not claim that OpenAI or Shopkit retains no data. Review current provider terms, account settings, and organisational policy before sending confidential information.

## Content and DOM Risk

AI output can be inaccurate, incomplete, or maliciously formatted. Generated description HTML is sanitized before editor writes, but users must still review rendered and saved content. Never treat generated barcode, reference, compatibility, ingredient, legal, or health claims as verified facts.

The extension writes to a Shopkit page through DOM selectors and page widgets. Shopkit UI changes can cause partial application or stale visual state. Verify native fields before manual save.

The extension matches only HTTPS `*.shopk.it/admin/products/create` pages. It does not request all-site access, cookies, Shopkit authentication tokens, or arbitrary external messaging.

## Safe Testing

Use dummy products and test keys with spending limits. Do not include client exports, authenticated page captures, cookies, session values, or raw API responses in reports.
