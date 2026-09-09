const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const app=read('app.js'),gas=read('GoogleAppsScript.gs'),facebookModule=read('FacebookBumpModule.gs'),worker=read('facebook-worker/worker.js');
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
  assert(summary.includes("rowsFields(SHEETS.orders,['total','status','deletedAt'],600)")&&summary.includes("rowsFields(SHEETS.customers,['orderCount'],1500)"),'dashboard does not use narrow field reads');
  assert(summary.includes("['id','name','category','status','stock','reservedStock','lowStockAlert']")&&(summary.match(/\.filter\(x=>x\.id&&x\.name\)/g)||[]).length===3,'dashboard no longer preserves product identity filtering');
  assert(gas.includes('s=ss().getSheetByName(name)||sheet(name,HEADERS[key]||[])'),'narrow reads still repeat schema validation on every dashboard sheet');
  assert(readAdmin.includes('settingRows=existingRows(SHEETS.settings)')&&readAdmin.includes('userRows=existingRows(SHEETS.users)')&&readAdmin.includes('systemRows=existingRows(SHEETS.system)'),'admin base data still repeats schema validation reads');
  assert(app.includes("if(state.page==='admin'){state.loading=false;render();if(state.adminToken)loadAdmin(false);}else loadData(true)"),'direct admin route still waits for storefront data');
  assert(app.includes("state.adminToken?state.settings:{shopName:'GUN SHOP DMO',ownerName:''}"),'direct admin login leaks the legacy fallback owner identity');
});

test('storefront subcategory navigation is prominent and accessible',()=>{
  ['subcategory-filter','subcategory-filter-title','subcategory-chip','aria-pressed'].forEach(marker=>assert(app.includes(marker)||read('app.css').includes(marker),`subcategory UX marker missing: ${marker}`));
  const css=read('app.css');
  assert(css.includes('.subcategory-chip{min-height:44px')&&css.includes('.subcategory-chip.active::before'),'subcategory touch target or active state is unclear');
  assert(css.includes('@media(max-width:760px)')&&css.includes('.subcategory-filter-options{overflow-x:auto'),'mobile subcategory layout is missing');
});

test('theme settings are public-safe, validated and previewable',()=>{
  ['themePrimaryColor','themeAccentColor','themeBackgroundColor','themeButtonColor','themeImportantColor'].forEach(key=>assert(gas.includes(key)&&app.includes(key),`theme setting missing: ${key}`));
  assert(app.includes('function previewThemeFromForm()')&&app.includes('restoreThemeDefaultsBtn'),'theme preview or restore default is missing');
  assert(gas.includes("if(!/^#[0-9A-F]{6}$/.test(value))value=DEFAULT_SETTINGS[k]"),'server does not reject invalid theme colors safely');
  const themeSource=app.slice(app.indexOf('const DEFAULT_THEME_COLORS'),app.indexOf('function settingEnabled'));
  const context={state:{adminData:null,settings:{}},document:{documentElement:{style:{setProperty(){}}},querySelector(){return null;}},String,Object,Math,parseInt};vm.createContext(context);
  new vm.Script(`${themeSource};globalThis.__theme={themePalette,themeContrast,readableThemeText};`).runInContext(context);
  const unsafeLight=context.__theme.themePalette({themeDefault:'LIGHT',themeAccentColor:'#FFFFFF',themeImportantColor:'#FFFFFF'},'LIGHT');
  assert(context.__theme.themeContrast(unsafeLight.important,'#FFFFFF')>=4.5,'important text can disappear on a light surface');
  assert(context.__theme.themeContrast(unsafeLight.accent,'#FFFFFF')>=3,'accent can disappear on a light surface');
  assert(context.__theme.readableThemeText('#FFFFFF')==='#071426'&&context.__theme.readableThemeText('#000000')==='#FFFFFF','button text contrast selection is unsafe');
  const css=read('app.css');
  assert(css.includes('body{background:var(--bg);background:')&&css.includes(':root[data-theme="LIGHT"] .btn.primary'),'custom background or LIGHT theme cascade is incomplete');
  assert(css.includes('background:var(--blue);border-color:var(--cyan);color:var(--primary-text'),'active buttons do not use the validated palette');
});

test('worker heartbeat avoids redundant database work and timer collisions',()=>{
  assert(gas.includes("if(body.action!=='reportFacebookWorkerStatus')ensureDatabase()"),'heartbeat still performs full database readiness work');
  assert(worker.includes('FACEBOOK_WORKER_HEARTBEAT_MS || 60000')&&worker.includes('reportRemoteHeartbeat().catch(() => {}), 15000'),'worker heartbeat remains aligned with the 30-second poll');
  assert(facebookModule.includes('FACEBOOK_WORKER_HEARTBEAT_TTL_MS=90000'),'backend online safety window changed unexpectedly');
  assert(facebookModule.includes('settingRows||existingRows(SHEETS.settings)'),'idle claim still repeats Settings schema validation every 30 seconds');
  assert(facebookModule.includes('FACEBOOK_BUMP_IDLE_CLAIM_AUDIT_SECONDS=300')&&facebookModule.includes("idleReason&&!facebookBumpIdleClaimAuditDue()"),'idle Worker claims still rescan Queue/Posts every 30 seconds');
  assert(worker.includes("WORKER_VERSION = '20.2.2-performance'"),'worker package version was not advanced for PC2 verification');
});

test('pair bridge supports old and proposed origins without wildcarding',()=>{
  assert(app.includes("['appOrigin',location.origin]"),'frontend does not send its exact origin');
  assert(worker.includes("DEFAULT_ALLOWED_ORIGINS = ['https://gunzaza085-lang.github.io', 'https://shop-dmo.github.io']"),'dual origin allowlist is missing');
  assert(worker.includes('ALLOWED_ORIGINS.has(appOrigin)')&&worker.includes('pairBridgeResponse(res,await connectionStatus(),appOrigin)'),'pair target origin is not validated');
  assert(!worker.includes("Access-Control-Allow-Origin', '*'"),'worker uses wildcard CORS');
});

test('order calculation and snapshot source of truth remain intact',()=>{
  assert(gas.includes('function calculateServerPricing(')&&gas.includes('pricingJson:JSON.stringify(pricing)'),'server pricing snapshot is missing');
  assert(gas.includes("const raw=Array.isArray(b.items)?b.items:[]")&&gas.includes('const catalog=catalogSnapshot(),normalized=[]')&&gas.includes('const price=Math.max(0,number(p.price))'),'server no longer rebuilds item prices');
});

if(!process.exitCode)console.log(`TOTAL ${pass}/${pass} PASS`);
