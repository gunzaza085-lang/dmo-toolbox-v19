# GUN SHOP DMO Development Rules

These rules apply to the entire project.

- Preserve the existing architecture: static HTML, CSS, Vanilla JavaScript, Google Apps Script, Google Sheets, GitHub Pages, and PWA.
- Preserve all existing product data and user-facing features.
- Never expose private shop information through public APIs.
- Never expose `costPrice`, API keys, internal notes, sessions, password hashes, backup metadata, private settings, CRM information, security configuration, or reserved-stock internals to customers.
- Treat server-side code as the source of truth for product prices, promotions, order totals, stock, reserved stock, and order status.
- Never trust price, discount, promotion result, or total sent by the browser.
- Never hardcode live credentials or commit secrets.
- Do not create usable default production credentials.
- Do not delete or overwrite production data automatically.
- Order and stock operations must validate before mutation and must not leave partial data after errors. Add rollback or recovery when atomic spreadsheet transactions are unavailable.
- Make order and stock mutations idempotent wherever retries are possible.
- Run relevant tests after important changes and report anything that requires live Google Apps Script separately.
- Preserve backwards compatibility where practical, especially sheet names, existing headers, product records, and deployed frontend behavior.
- Keep the current readable DMO-themed UI. Make targeted readability and responsive fixes instead of redesigning the site.
- Do not change architecture or introduce a new framework, database, hosting platform, or backend without explicit user approval.
- Migrations must be idempotent, additive where possible, documented, and safe for existing values.
- Integrity tools report problems by default and must not rewrite or delete data without explicit confirmation.
- Never deploy, push, modify a live Google Sheet, or rotate live credentials unless the user explicitly requests it.
