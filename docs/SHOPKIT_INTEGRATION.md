# Shopkit Integration Contract

## Supported Page

The extension injects only on HTTPS URLs matching:

```text
https://*.shopk.it/admin/products/create
```

The content script uses the page DOM. It does not use a Shopkit API, submit the form, click the final save action, or publish products.

## Read-Only Discovery

Before generation, the extension reads:

- Product title from `#produto_titulo`.
- Brand options from `#marca` or compatible select names/IDs.
- Category options from `#categorias` or compatible select names/IDs.
- Existing tag labels when already present in the page DOM.

Discovery must not open native modals or change product fields.

## Generate

Generate sends title and discovered option labels to the extension service worker. The service worker calls OpenAI using the locally stored key. The content script validates the returned draft, matches brand/category values against available Shopkit options, and displays the result in a Shadow DOM panel.

Generate does not write native Shopkit fields.

## Apply

Apply requires explicit user action after preview review. It can write:

- Title.
- Sanitized description HTML.
- Excerpt.
- Matched brand.
- Matched categories.
- Tags.
- Known weight.
- Reference and barcode when present.
- SEO title, description, and tags.
- Handle.

Apply intentionally does not write price, tax setting, product status, featured/new/promotion flags, media selections, or the final save action. Unknown values remain untouched and appear as review items.

Categories are replaced with the matched reviewed set rather than added to stale selections. Existing page widgets may still require manual visual verification.

## Rich Text and Widgets

TinyMCE, Chosen, tags, and Shopkit selectors are page-owned integrations. The extension uses native values/events and optional widget hooks where available. If Shopkit changes widget markup, the native field and final saved form must be checked manually.

## Media

The assistant only opens Shopkit media search and pre-fills one AI-suggested search term. It does not click media items, upload files, or confirm selection. User selects assets and confirms them in Shopkit.

## Manual Validation Checklist

After a Shopkit UI update, test with dummy data:

1. Assistant appears on product-create route only.
2. Generation stays in preview.
3. Description reaches the correct editor and is sanitized.
4. Brand and categories match native options.
5. Tags reach native input and widget.
6. Unknown values remain untouched.
7. Price/status/tax/flags remain unchanged.
8. Media search opens without automatic selection.
9. Apply reports missing or failed fields.
10. Final Shopkit save remains a user action.
