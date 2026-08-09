# GUN SHOP DMO V20.1 — Stability & Security Final

Owner: Natthananat Kawinwatthanakorn

## V20.1 Release Candidate — Order operations safety

- ปรับศูนย์ออเดอร์ให้อ่านง่ายขึ้น พร้อมค้นหาจาก Order ID ลูกค้า Facebook เซิร์ฟเวอร์ และสถานะ
- แปลตัวเลือกสถานะในหน้าจอเป็นภาษาไทย โดยคงรหัสสถานะภายในเดิม
- เพิ่ม soft archive สำหรับออเดอร์ พร้อมเหตุผล ผู้ดำเนินการ และวันเวลา
- จำกัดการเก็บและกู้คืนออเดอร์ไว้ที่ OWNER/ADMIN ทั้งหน้าเว็บและ API
- ออเดอร์ที่ยัง RESERVED จะถูกยกเลิกและคืน Reserved Stock ก่อนเก็บเพียงครั้งเดียว
- ออเดอร์ CANCELLED/RELEASED และ COMPLETED/DEDUCTED จะไม่เปลี่ยนสต๊อกซ้ำ
- การกู้คืนออเดอร์ไม่จอง คืน หรือตัดสต๊อกอัตโนมัติ
- เพิ่มการป้องกันกดคำสั่งออเดอร์ซ้ำระหว่างรอผลจาก Server
- เพิ่มหัวคอลัมน์ Orders: deletedAt, deletedBy, deleteReason แบบ additive

## Security

- Added explicit public product/settings/promotion DTO allow-lists.
- Public API no longer returns cost price, private notes, reserved-stock internals, low-stock settings, API keys, sessions, security data, CRM, or backup metadata.
- Admin data now loads by authenticated POST instead of a token-bearing GET URL.
- Removed automatic default OWNER credential creation.
- Known V20 default OWNER hash is migrated to `RESET_REQUIRED`.
- Added salted iterative HMAC-SHA256 password storage and legacy-hash migration after a successful non-default login.
- Added failed-login counters, temporary account lock, unknown-user throttling, and public-order throttling.
- Added safe public error responses.

## Orders and stock

- Server is authoritative for price, promotion, discount, final total, stock, and status.
- Added request IDs and `OrderRequests` for retry/idempotency protection.
- Order IDs now use `GUN-YYYYMMDD-HHMMSS-XXXXXXXX` and are checked for uniqueness.
- Order creation validates and groups items before mutation and rolls back local writes on failure.
- Added strict state flow: `NEW → CHECKING → PREPARING → READY → COMPLETED`; cancellation is allowed only before completion.
- Completion requires every OrderItem to be marked `PICKED`.
- Stock reserve/release/deduction is idempotent through status and `inventoryState` controls.
- Customer revenue totals are recalculated from `COMPLETED` orders only.

## Admin and reporting

- Added read-only Data Integrity Checker.
- Fixed current V20.1 statuses in Analytics.
- Fixed product matching through `productId` and `productName`.
- Revenue, cost, profit, CSV, and PDF data now use completed sales.
- Improved Picking Center completeness display.
- Added targeted Dark/Light contrast, dropdown, overflow, and small-screen fixes.

## Database

- Database version: `3.1.0`.
- Added `OrderRequests` sheet.
- Added `requestId`, `pricingJson`, and `inventoryState` to Orders.
- Added salted-password and login-lock fields to Users.
- Existing product records and formulas are preserved.
