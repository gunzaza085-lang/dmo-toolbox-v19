const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const app=read('app.js'),gas=read('GoogleAppsScript.gs'),worker=read('facebook-worker/worker.js');
let pass=0;
function assert(value,message){if(!value)throw Error(message);}
function test(name,fn){try{fn();pass++;console.log(`PASS ${name}`);}catch(error){console.error(`FAIL ${name} — ${error.message}`);process.exitCode=1;}}

test('important modals close only by explicit controls and warn when dirty',()=>{
  assert(app.includes("bindModalDirty('modalBackdrop','record')")&&app.includes("bindModalDirty('promoBackdrop','promo')")&&app.includes("bindModalDirty('categoryBackdrop','category')"),'dirty tracking is incomplete');
  assert(app.includes("confirm('มีข้อมูลที่แก้ไขแล้วยังไม่ได้บันทึก"),'unsaved close warning is missing');
  assert(app.includes("window.addEventListener('beforeunload'")&&app.includes("window.addEventListener('keydown'"),'navigation/Escape handling is missing');
  assert(!/Backdrop\.onclick\s*=/.test(app)&&!/(event|e)\.target\s*===\s*(modalBackdrop|promoBackdrop)/.test(app),'a backdrop can still close a modal');
  ['closeModalXBtn','closePromoXBtn','closeCategoryXBtn','closeWikiBtn'].forEach(id=>assert(app.includes(id),`explicit close control missing: ${id}`));
});

test('cart mutations preserve page and inner-list scroll',()=>{
  assert(app.includes('function renderPreservingScroll()')&&app.includes('window.scrollTo(windowX,windowY)'),'scroll restore helper is missing');
  const bind=app.slice(app.indexOf('function bind()'),app.indexOf('function touchAdminActivity'));
  ['data-add','data-inc','data-dec','data-remove','clearCartBtn'].forEach(marker=>assert(bind.includes(marker),`cart binding missing ${marker}`));
  assert((bind.match(/renderPreservingScroll\(\)/g)||[]).length>=4,'not all cart mutations preserve scroll');
});

test('dynamic subcategories are additive, future-kind safe and admin managed',()=>{
  ['productSubcategoriesJson','normalizeProductSubcategories','productCategoriesPage','saveProductCategoryAction','subcategoryOptions'].forEach(marker=>assert(gas.includes(marker)||app.includes(marker),`dynamic category marker missing: ${marker}`));
  assert(gas.includes("replace(/[^A-Z0-9_-]/g,'')")&&gas.includes('list.slice(0,500)'),'future kind validation or safety limit is missing');
  assert(app.includes("['categories', '🗂️ หมวดย่อย']")&&app.includes("state.adminView === 'categories'")&&app.includes('เปิด-ปิดหมวด'),'category admin UI is missing');
  assert(!app.slice(app.indexOf('function dynamicEditModalMarkup'),app.indexOf('function adminBootstrapData')).includes("['NORMAL', 'BASE_HARD', 'SUSA'].map"),'dynamic edit wrapper still hard-codes seal categories');
});

test('order copy template is presentation-only and hides zero-percent details',()=>{
  ['orderCopyTemplate','orderCopyShowItems','orderCopyShowPricing','orderCopyShowCategoryDiscounts','orderCopyShowPromotions','orderCopyShowD2','orderCopyShowCustomer','orderCopyShowNotice'].forEach(key=>assert(gas.includes(key)&&app.includes(key),`copy setting missing: ${key}`));
  assert(app.includes("row.subtotal>0&&row.percent>0&&row.amount>0"),'0% discount details are not hidden');
  assert(app.includes("const pricing = pricingSummary()")&&app.includes("const template=configuredSettingText"),'copy output is not derived from calculated pricing/template');
  assert(!gas.includes('orderCopyTemplate:pricing'),'template unexpectedly participates in pricing');
});

test('website messages are editable and public-safe',()=>{
  ['websiteIntroText','websiteAnnouncement','websitePromotionText','websiteImportantNotice'].forEach(key=>assert(gas.includes(key)&&app.includes(key),`website setting missing: ${key}`));
  ['costPrice','apiKey','passwordHash','internalNotes'].forEach(secret=>assert(!gas.slice(gas.indexOf('const PUBLIC_SETTING_FIELDS'),gas.indexOf('const PUBLIC_PROMOTION_FIELDS')).includes(secret),`private setting leaked: ${secret}`));
});

test('dashboard scope avoids large order/customer payloads',()=>{
  const readAdmin=gas.slice(gas.indexOf('function readAdmin('),gas.indexOf('function readPublicAction'));
  assert(readAdmin.includes("if(scope==='dashboard')result.dashboardSummary=dashboardSummary()"),'compact dashboard summary is not used');
  assert(!readAdmin.includes("needs('dashboard','catalog")&&!readAdmin.includes("needs('dashboard','analytics")&&!readAdmin.includes("needs('dashboard','customers"),'dashboard still loads large lists');
  const summary=gas.slice(gas.indexOf('function dashboardSummary()'),gas.indexOf('function readAdmin('));
  assert(summary.includes('rowsTail(SHEETS.orders,600)')&&summary.includes('rowsTail(SHEETS.customers,1500)'),'dashboard backend still scans full order/customer sheets');
});

test('pair bridge supports old and proposed origins without wildcarding',()=>{
  assert(app.includes("['appOrigin',location.origin]"),'frontend does not send its exact origin');
  assert(worker.includes('https://gunzaza085-lang.github.io,https://shop-dmo.github.io'),'dual origin allowlist is missing');
  assert(worker.includes('ALLOWED_ORIGINS.has(appOrigin)')&&worker.includes('pairBridgeResponse(res,await connectionStatus(),appOrigin)'),'pair target origin is not validated');
  assert(!worker.includes("Access-Control-Allow-Origin', '*'"),'worker uses wildcard CORS');
});

test('order calculation and snapshot source of truth remain intact',()=>{
  assert(gas.includes('function calculateServerPricing(')&&gas.includes('pricingJson:JSON.stringify(pricing)'),'server pricing snapshot is missing');
  assert(gas.includes("const raw=Array.isArray(b.items)?b.items:[]")&&gas.includes('const catalog=catalogSnapshot(),normalized=[]')&&gas.includes('const price=Math.max(0,number(p.price))'),'server no longer rebuilds item prices');
});

if(!process.exitCode)console.log(`TOTAL ${pass}/${pass} PASS`);
