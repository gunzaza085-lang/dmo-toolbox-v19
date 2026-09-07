'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const gas = read('GoogleAppsScript.gs');
const app = read('app.js');
const results = [];

function result(name, status, detail) { results.push({ name, status, detail }); }
function check(name, fn) {
  try { fn(); result(name, 'PASS', 'ตรวจสอบในเครื่องแล้ว'); }
  catch (error) { result(name, 'FAIL', error.message); }
}
function assert(value, message) { if (!value) throw new Error(message); }

check('1. JavaScript syntax', () => {
  ['app.js','config.js','sw.js','GoogleAppsScript.gs'].forEach(file => new vm.Script(read(file), { filename: file }));
});

const context = {
  console,
  Date,
  Map,
  Set,
  JSON,
  Math,
  String,
  Number,
  Error,
  Utilities: {
    getUuid: () => '12345678-abcd-4000-8000-123456789abc',
    formatDate: () => '20260808-120000',
  },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
};
vm.createContext(context);
new vm.Script(`${gas}\n;globalThis.__v201={calculateServerPricing,categoryDiscountPricing,publicProduct,uniqueOrderId,ORDER_TRANSITIONS,PUBLIC_SETTING_FIELDS,PUBLIC_PRODUCT_FIELDS};`).runInContext(context);
const api = context.__v201;

check('5. Promotion calculation', () => {
  const pricing = api.calculateServerPricing(
    [{ lineTotal: 1000 }],
    [
      { promotionId:'P1', name:'10%', type:'DISCOUNT_PERCENT', value:10, minSpend:0, status:'ACTIVE', priority:1, stackable:'TRUE' },
      { promotionId:'P2', name:'ลด 50', type:'DISCOUNT_AMOUNT', value:50, minSpend:0, status:'ACTIVE', priority:2, stackable:'TRUE' },
    ],
  );
  assert(pricing.subtotal === 1000, 'subtotal ไม่ถูกต้อง');
  assert(pricing.discount === 150, 'ส่วนลดไม่ถูกต้อง');
  assert(pricing.total === 850, 'ยอดสุดท้ายไม่ถูกต้อง');
});

check('6. Order ID uniqueness format', () => {
  const id = api.uniqueOrderId(new Set());
  assert(/^GUN-\d{8}-\d{6}-[A-F0-9]{8}$/.test(id), 'รูปแบบเลขออเดอร์ไม่ถูกต้อง');
});

check('9. Invalid status transition', () => {
  assert(api.ORDER_TRANSITIONS.NEW.includes('CHECKING'), 'NEW → CHECKING ต้องทำได้');
  assert(api.ORDER_TRANSITIONS.READY.includes('COMPLETED'), 'READY → COMPLETED ต้องทำได้');
  assert(!api.ORDER_TRANSITIONS.COMPLETED.includes('CANCELLED'), 'COMPLETED → CANCELLED ต้องถูกปฏิเสธ');
  assert(!api.ORDER_TRANSITIONS.CANCELLED.includes('NEW'), 'CANCELLED → NEW ต้องถูกปฏิเสธ');
});

check('14. Public API data leak', () => {
  const dto = api.publicProduct({ id:'A', name:'Test', price:10, stock:20, reservedStock:3, costPrice:8, note:'PRIVATE', lowStockAlert:5, passwordHash:'x' });
  ['costPrice','note','reservedStock','lowStockAlert','passwordHash'].forEach(key => assert(!(key in dto), `public DTO มี ${key}`));
  assert(dto.availableStock === 17, 'availableStock ไม่ถูกต้อง');
  ['apiKey','sessionDays','autoLockMinutes','backupRetention'].forEach(key => assert(!api.PUBLIC_SETTING_FIELDS.includes(key), `public settings มี ${key}`));
});

check('13. Picking Center fields', () => {
  ['productId','productName','unitPrice','stockCheck','pickStatus'].forEach(field => assert(app.includes(field), `ไม่พบ ${field}`));
  assert(app.includes('จัดครบแล้ว'), 'ไม่พบสถานะจัดครบแล้ว');
  assert(gas.includes('orderItemId:x.orderItemId,orderId:id'), 'OrderItems ที่สร้างใหม่ไม่ได้ผูก orderId');
  assert(gas.includes("values[uc-pc]=new Date();s.getRange(i+1,pc+1,1,values.length).setValues([values])"), 'Picking write ไม่ได้เขียนสถานะและเวลาเป็นชุดเดียว');
});

check('15-18. Role permission guards', () => {
  assert(gas.includes("requireRole(b.token,['OWNER'])"), 'OWNER guard ไม่ครบ');
  assert(gas.includes("requireRole(body.token,['OWNER','ADMIN'])"), 'Integrity OWNER/ADMIN guard ไม่ครบ');
  assert(gas.includes("case'saveSettings': requireRole(body.token,['OWNER','ADMIN'])"), 'Settings OWNER/ADMIN guard ใช้ token ไม่ถูกต้อง');
  assert(gas.includes("requireRole(body.token,['OWNER','ADMIN','STAFF'])"), 'Write role guard ไม่ครบ');
  assert(gas.includes("role||'VIEWER'"), 'VIEWER handling ไม่ครบ');
  assert(!gas.includes("requireRole(actor,"), 'พบการส่ง actor object เข้า requireRole แทน token');
  assert(gas.includes("String(x.key)!=='apiKey'||(actor&&['OWNER','ADMIN'].includes(actor.role))"), 'apiKey ยังอาจถูกส่งให้ STAFF/VIEWER');
});

check('19. Wrong login protection', () => {
  assert(gas.includes('failedLoginCount'), 'ไม่มี failed login counter');
  assert(gas.includes('lockedUntil'), 'ไม่มี temporary lock');
  assert(gas.includes('CacheService.getScriptCache()'), 'ไม่มี unknown-user throttling');
  assert(!gas.includes("sha256('6395')"), 'ยังมีรหัสผ่านเดิมใน source');
});

check('20. Customer totals source', () => {
  assert(gas.includes("String(o.status)==='COMPLETED'"), 'totalSpent ไม่ได้อิง COMPLETED');
  assert(app.includes("String(o.status || '') === 'COMPLETED'"), 'Analytics ไม่ได้อิง COMPLETED');
});

check('21. Analytics status compatibility', () => {
  ['NEW','CHECKING','PREPARING','READY','COMPLETED','CANCELLED'].forEach(status => assert(app.includes(`'${status}'`), `ไม่พบสถานะ ${status}`));
  ['CHECKED','WAITING_PAYMENT'].forEach(status => assert(!app.includes(`'${status}'`), `ยังมีสถานะเก่า ${status}`));
});

check('22. Integrity reconciliation', () => {
  ['ORDER_WITHOUT_ITEMS','ITEM_WITHOUT_ORDER','NEGATIVE_STOCK','NEGATIVE_RESERVED','RESERVED_OVER_STOCK','DUPLICATE_ORDER_ID'].forEach(code => assert(gas.includes(code), `Integrity checker ขาด ${code}`));
  assert(gas.includes("String(oldInventory)!=='RESERVED'"), 'ไม่มี guard ป้องกันตัดหรือคืนสต๊อกจากสถานะที่ไม่ RESERVED');
});

check('23. Order archive and restore safety', () => {
  ['deletedAt','deletedBy','deleteReason'].forEach(field => assert(gas.includes(field), `Orders schema missing ${field}`));
  assert(gas.includes("case'archiveOrder': requireRole(body.token,['OWNER','ADMIN'])"), 'archiveOrder is not limited to OWNER/ADMIN');
  assert(gas.includes("case'restoreArchivedOrder': requireRole(body.token,['OWNER','ADMIN'])"), 'restoreArchivedOrder is not limited to OWNER/ADMIN');
  assert(gas.includes("if(!legacy&&inventoryState==='RESERVED')"), 'archive does not release active reservation');
  assert(gas.includes("status==='CANCELLED'&&inventoryState==='RELEASED'"), 'archive does not guard released cancellation');
  assert(gas.includes("status==='COMPLETED'&&inventoryState==='DEDUCTED'"), 'archive does not preserve completed deduction');
  assert(gas.includes("'กู้คืนโดยไม่เปลี่ยนสต๊อก"), 'restore audit does not state no stock mutation');
  assert(!/function restoreArchivedOrder[\s\S]*?applyInventoryTransition/.test(gas), 'restore unexpectedly changes inventory');
  assert(gas.includes("if(legacy)throw Error('ออเดอร์เก่าไม่อยู่ในระบบจองสต๊อก V20.1"), 'legacy status mutation is not blocked');
  assert(gas.includes("legacy?'LEGACY_NO_STOCK_ACTION"), 'legacy archive is not explicitly audited without stock mutation');
  assert(app.includes('data-archive-order') && app.includes('data-restore-order'), 'archive/restore controls missing');
});

check('24. OWNER password management security', () => {
  assert(gas.includes("case'changeOwnerPassword': return changeOwnerPassword(body,actor)"), 'ไม่พบ API เปลี่ยนรหัส OWNER');
  assert(gas.includes("requireRole(b.token,['OWNER'])"), 'ไม่มี OWNER-only server guard');
  assert(gas.includes('passwordMatches(current'), 'ไม่ได้ตรวจรหัสผ่านปัจจุบันฝั่ง Server');
  assert(gas.includes('const rec=securePasswordRecord(next)'), 'ไม่ได้สร้าง salted hash ใหม่');
  assert(gas.includes("set('passwordSalt',rec.salt)"), 'ไม่ได้บันทึก salt ใหม่');
  assert(gas.includes('invalidateUserSessions(actor.userId)'), 'ไม่ได้ invalidate session หลังเปลี่ยนรหัส');
  assert(gas.includes("environment:id===PRODUCTION_SPREADSHEET_ID?'PRODUCTION':id===TEST_SPREADSHEET_ID?'TEST':'BACKUP'"), 'ไม่มี environment guard');
  assert(gas.includes("if(!env.ownerSetupAllowed)throw Error('ไม่อนุญาตให้ตั้ง OWNER บนฐานข้อมูล BACKUP')"), 'Backup ยังตั้ง OWNER ได้');
  assert(app.includes('บัญชีและความปลอดภัย') && app.includes('ownerCurrentPassword'), 'ไม่มีฟอร์มเปลี่ยนรหัสใน Admin Settings');
  assert(!/console\.log\([^\n]*(?:currentPassword|newPassword|confirmPassword|passwordHash|passwordSalt)/.test(app+gas), 'พบการ log credential');
});

check('25. Shop identity settings and blank values', () => {
  assert(app.includes("if (hasOwn(settings, key)) return String(settings[key] ?? '').trim();"), 'Settings ยังไม่มาก่อน config หรือไม่รองรับค่าว่าง');
  assert(!app.includes("cfg.shopName || state.settings.shopName"), 'config ยังทับชื่อร้านจาก Settings');
  assert(!app.includes("settings.ownerName || 'Natthananat Kawinwatthanakorn'"), 'ชื่อเจ้าของว่างยังถูกแทนด้วยค่าเดิม');
  assert(app.includes('เว้นว่างเพื่อไม่แสดงชื่อร้าน') && app.includes('เว้นว่างเพื่อไม่แสดงชื่อเจ้าของ'), 'ฟอร์มไม่ได้แจ้งว่าซ่อนชื่อได้');
  assert(app.includes("shopName: document.getElementById('setShopName').value.trim()"), 'ชื่อร้านไม่ได้บันทึกค่าที่ตัดช่องว่างแล้ว');
  assert(app.includes("ownerName: document.getElementById('setOwnerName').value.trim()"), 'ชื่อเจ้าของไม่ได้บันทึกค่าที่ตัดช่องว่างแล้ว');
  const saveSettingsSource = app.slice(app.indexOf('async function saveSettingsAction()'), app.indexOf('async function adjustStockAction'));
  assert(saveSettingsSource.includes('await loadAdmin(true);') && saveSettingsSource.includes('await loadData(false);'), 'หลังบันทึก Settings ยังใช้ Admin cache เก่า');
  const identitySource = app.slice(app.indexOf('const hasOwn ='), app.indexOf('const safeExternalUrl'));
  const identityContext = { cfg:{shopName:'Config Shop',ownerName:'Config Owner'}, state:{settings:{}} };
  vm.createContext(identityContext);
  new vm.Script(`${identitySource};globalThis.__identity=shopIdentity;`).runInContext(identityContext);
  assert(identityContext.__identity({shopName:'ร้านใหม่',ownerName:'เจ้าของใหม่'}).shopName === 'ร้านใหม่', 'ชื่อจาก Settings ไม่ชนะ config');
  assert(identityContext.__identity({shopName:'',ownerName:''}).shopName === '', 'ชื่อร้านว่างถูกแทนด้วยค่าเริ่มต้น');
  assert(identityContext.__identity({shopName:'',ownerName:''}).ownerName === '', 'ชื่อเจ้าของว่างถูกแทนด้วยค่าเริ่มต้น');
  assert(identityContext.__identity({}).shopName === 'Config Shop', 'ค่าเริ่มต้นจาก config ใช้ไม่ได้เมื่อ Settings ยังไม่มี key');
});

check('26. Category discount 0%', () => {
  const pricing=api.calculateServerPricing([{kind:'SEAL',lineTotal:100},{kind:'ITEM',lineTotal:200},{kind:'SERVICE',lineTotal:300}],[],{});
  assert(pricing.categoryDiscountTotal===0,'0% ต้องไม่มีส่วนลด');
  assert(pricing.subtotal===600&&pricing.total===600,'ยอด 0% ไม่ถูกต้อง');
});

check('27. Seal category discount 5%', () => {
  const pricing=api.calculateServerPricing([{kind:'SEAL',lineTotal:1000}],[],{categoryDiscountSealPercent:5});
  assert(pricing.categoryDiscounts.find(x=>x.category==='SEAL').amount===50,'ส่วนลดซีล 5% ไม่ถูกต้อง');
  assert(pricing.total===950,'ยอดสุทธิซีล 5% ไม่ถูกต้อง');
});

check('28. Item category discount 10% including T Money', () => {
  const pricing=api.calculateServerPricing([{kind:'ITEM',lineTotal:500},{kind:'TMONEY',lineTotal:100}],[],{categoryDiscountItemPercent:10});
  const item=pricing.categoryDiscounts.find(x=>x.category==='ITEM');
  assert(item.subtotal===600&&item.amount===60,'ไอเทมและเงิน T ต้องรวมหมวดเดียวกันที่ 10%');
  assert(pricing.total===540,'ยอดสุทธิไอเทม 10% ไม่ถูกต้อง');
});

check('29. Mixed category discounts', () => {
  const pricing=api.calculateServerPricing([{kind:'SEAL',lineTotal:1000},{kind:'ITEM',lineTotal:500},{kind:'SERVICE',lineTotal:2000}],[],{categoryDiscountSealPercent:5,categoryDiscountItemPercent:10,categoryDiscountServicePercent:0});
  assert(pricing.categoryDiscountTotal===100,'ส่วนลดรวมแบบ mixed ไม่ถูกต้อง');
  assert(pricing.discount===100&&pricing.total===3400,'ยอดสุทธิ mixed category ไม่ถูกต้อง');
  const pricingSource=app.slice(app.indexOf('function promoIsActive'),app.indexOf('function cartPanel'));
  const clientContext={Date,Math,Number,Object,state:{cart:[{kind:'SEAL',price:1000,quantity:1},{kind:'ITEM',price:500,quantity:1},{kind:'SERVICE',price:2000,quantity:1}],settings:{categoryDiscountSealPercent:5,categoryDiscountItemPercent:10,categoryDiscountServicePercent:0},promotions:[]},html:value=>String(value),money:value=>String(value)};
  vm.createContext(clientContext);
  new vm.Script(`${pricingSource};globalThis.__pricingSummary=pricingSummary;`).runInContext(clientContext);
  const clientPricing=clientContext.__pricingSummary();
  assert(clientPricing.categoryDiscountTotal===pricing.categoryDiscountTotal&&clientPricing.total===pricing.total,'ยอดฝั่งหน้าเว็บไม่ตรงกับ Server');
});

check('30. Old order pricing snapshot remains unchanged', () => {
  const created=api.calculateServerPricing([{kind:'SEAL',lineTotal:1000}],[],{categoryDiscountSealPercent:5});
  const stored=JSON.parse(JSON.stringify(created));
  const current=api.calculateServerPricing([{kind:'SEAL',lineTotal:1000}],[],{categoryDiscountSealPercent:10});
  assert(stored.categoryDiscounts[0].percent===5&&stored.total===950,'snapshot เดิมเปลี่ยนตาม Settings ใหม่');
  assert(current.categoryDiscounts[0].percent===10&&current.total===900,'Settings ใหม่ไม่ถูกนำไปใช้กับออเดอร์ใหม่');
  assert(gas.includes('pricingJson:JSON.stringify(pricing)'),'Order ไม่ได้บันทึก pricing snapshot');
  assert(app.includes('orderPricingSnapshot(order)'),'หน้าหลังร้านไม่ได้อ่าน pricing snapshot ของ Order');
});

check('31. Category discount settings UI and additive migration', () => {
  ['categoryDiscountSealPercent','categoryDiscountItemPercent','categoryDiscountServicePercent'].forEach(key=>{
    assert(gas.includes(`${key}:0`),`DEFAULT_SETTINGS ขาด ${key}`);
    assert(api.PUBLIC_SETTING_FIELDS.includes(key),`Public settings ขาด ${key}`);
  });
  assert(gas.includes("DATABASE_VERSION+'-gate-a-4'"),'schema gate ไม่ได้บังคับ seed Settings ใหม่แบบ additive');
  assert(gas.includes("setNumberFormat('0.##')"),'เซลล์ส่วนลดอาจสืบรูปแบบวันที่จาก Settings แถวก่อนหน้า');
  const settingsSource=app.slice(app.indexOf('function adminSettingsBase'),app.indexOf('function adminLogs'));
  const settingsContext={state:{adminData:{settings:{categoryDiscountSealPercent:5,categoryDiscountItemPercent:10,categoryDiscountServicePercent:0},security:{actor:{role:'OWNER'}}}},shopIdentity:()=>({shopName:'',ownerName:''}),html:value=>String(value),String};
  vm.createContext(settingsContext);
  new vm.Script(`${settingsSource};globalThis.__settingsHtml=adminSettings();`).runInContext(settingsContext);
  ['setCategoryDiscountSeal','setCategoryDiscountItem','setCategoryDiscountService'].forEach(id=>assert(settingsContext.__settingsHtml.includes(`id="${id}"`),`ฟอร์มขาด ${id}`));
  assert((settingsContext.__settingsHtml.match(/id="saveSettingsBtn"/g)||[]).length===1,'ปุ่มบันทึก Settings ต้องมีหนึ่งปุ่ม');
});

check('32. Admin scoped loading and large-list performance', () => {
  assert(gas.includes("readAdmin(actor,body.scope)"), 'getAdminData ไม่ส่ง scope ไป Server');
  assert(gas.includes("requestedScope||'ALL'"), 'Client รุ่นเก่าไม่ได้ fallback เป็น ALL');
  assert(gas.includes("needs('inventory')") && gas.includes("needs('customers')"), 'Server ยังไม่แยกโหลดข้อมูลตามเมนู');
  assert(app.includes("action:'getAdminData',token:state.adminToken,scope"), 'Client ไม่ได้ขอข้อมูลตามเมนู');
  assert(app.includes('state.adminLoadedScopes.add(scope)'), 'ไม่มี cache ของ scope ที่โหลดแล้ว');
  assert(app.includes("state.adminView !== 'facebookBump' && !state.adminLoadedScopes.has(state.adminView)"), 'หน้า Admin ยังแสดงข้อมูล bootstrap เป็นศูนย์ก่อน scope โหลดเสร็จ');
  assert(app.includes('id="retryAdminScopeBtn"'), 'หน้า Admin ไม่มีทาง retry เมื่อโหลด scope ไม่สำเร็จ');
  assert(app.includes('state.adminLoading = false;adminLoadPromise=null;render();'), 'สถานะโหลด Admin ไม่ render ใหม่หลัง request ล้มเหลว');
  const ordersSource=app.slice(app.indexOf('function adminOrders()'),app.indexOf('function integrityPage'));
  assert(ordersSource.includes('itemsByOrder=new Map()'), 'หน้าออเดอร์ยังไม่มีดัชนี Order Items');
  assert(!ordersSource.includes('itemRows.filter('), 'หน้าออเดอร์ยัง scan Order Items ซ้ำต่อออเดอร์');
  ['adminOrderVisible','adminCatalogVisible','inventoryVisible','customerVisible'].forEach(key=>assert(app.includes(key),`ไม่มี batch limit: ${key}`));
  ['loadMoreOrdersBtn','loadMoreAdminCatalogBtn','loadMoreInventoryBtn','loadMoreCustomersBtn'].forEach(id=>assert(app.includes(id),`ไม่มีปุ่มแสดงเพิ่ม: ${id}`));
  assert(read('index.html').includes('20260908-v20.2-longrun-performance-2')&&read('sw.js').includes('gun-shop-dmo-v20-2-longrun-performance-2'),'PWA cache version ยังไม่ตรงกับ combined long-run/performance build');
});

[
  '2. Normal order',
  '3. Insufficient-stock order',
  '4. Duplicate submission/retry end-to-end',
  '7. Cancel/release reservation end-to-end',
  '8. Complete/deduct stock end-to-end',
  '10. Stock reservation exactly once',
  '11. Picking write end-to-end',
  '12. Live role behavior end-to-end',
].forEach(name => result(name, 'NOT TESTED / REQUIRES LIVE GOOGLE APPS SCRIPT', 'ต้องทดสอบกับสำเนา Google Sheet หลัง Deploy test environment'));

results.sort((a,b) => Number(a.name.split('.')[0]) - Number(b.name.split('.')[0]));
results.forEach(r => console.log(`${r.status}: ${r.name} — ${r.detail}`));
const failed = results.filter(r => r.status === 'FAIL');
console.log(`\nSummary: PASS ${results.filter(r=>r.status==='PASS').length}, FAIL ${failed.length}, LIVE ${results.filter(r=>r.status.startsWith('NOT TESTED')).length}`);
if (failed.length) process.exit(1);
