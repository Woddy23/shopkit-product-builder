# Shopkit Integration

## Overview

ShopKit Product Builder integrates with one configured Shopkit product-create page through its DOM. It has no Shopkit API access and does not automate final product save.

## Read-Only Discovery

Before Apply, the extension reads native select options for categories and brands. Available tag labels are read only when already present in the page DOM. Discovery must not open native modals or change product fields.

## Apply Behavior

Apply runs only after user review. It writes supported reviewed values to native product fields, dispatches required events, and reports unmatched values for manual handling. Price is excluded. Apply never submits form or triggers `Gravar dados`.

## TinyMCE

Description writes use TinyMCE API when available, then synchronize backing textarea and events. Fallback behavior writes sanitized HTML to the editor DOM or textarea.

## Chosen.js

Category and brand values are written to underlying native selects, followed by native change events and Chosen.js update events. Categories remain backed by option values, not preview text.

## Tags

Tags use Shopkit page controls during explicit Apply. Pre-Apply discovery remains read-only and never opens native tag modal.

## Media Modal

Media stays in Shopkit existing workflow. User opens media modal, uploads or selects library items, confirms selection, then manually saves product. Extension does not upload media or select it automatically.

## Integration Limits

Selectors and widget behavior are Shopkit-page-specific and may change. Manual browser validation is required after Shopkit UI updates.
