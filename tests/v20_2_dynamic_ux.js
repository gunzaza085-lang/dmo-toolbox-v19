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
  assert(app.includes("['categories', '🗂️ หมวดย่อย']")&&app.includes("state.adminView === 'categories'")&&app.includes('data-delete-category'),'category admin UI is missing');
  assert(gas.includes('function productSubcategoryUsage(')&&gas.includes("case'deleteProductSubcategory'"),'safe server-side category deletion is missing');
  assert(!app.slice(app.indexOf('function dynamicEditModalMarkup'),app.indexOf('function adminBootstrapData')).includes("['NORMAL', 'BASE_HARD', 'SUSA'].map"),'dynamic edit wrapper still hard-codes seal categories');
  const categorySource=app.slice(app.indexOf('const DEFAULT_PRODUCT_SUBCATEGORIES'),app.indexOf('function subcategoriesFor'));
  const categoryContext={state:{adminData:{settings:{productSubcategoriesJson:'[]'},seals:[],gameItems:[],services:[]},settings:{}},String,Array,JSON,Set,Number,Object,Math,parseInt};
  vm.createContext(categoryContext);new vm.Script(`${categorySource};globalThis.__categories=productSubcategorySettings;`).runInContext(categoryContext);
  assert(categoryContext.__categories({productSubcategoriesJson:'[]'}).length===0,'an explicitly empty category list resurrects defaults after the last delete');
  assert(categoryContext.__categories({}).length>0,'a missing legacy category setting no longer receives safe defaults');
  assert(app.includes("subcategoriesFor('SEAL')[0]?.value||''")&&app.includes("subcategoryOptions('SEAL',record.section||'')"),'new/blank seals can recreate a deleted default category');
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
  const readAdmin=gas.slice(gas.indexOf('function readAdmin('),gas.indexOf('function normalizeSeal'));
  assert(readAdmin.includes("if(scope==='dashboard')")&&readAdmin.includes('dashboardSummary:dashboardSummary(forceRefresh)'),'compact dashboard summary is not used');
  assert(!readAdmin.includes("needs('dashboard','catalog")&&!readAdmin.includes("needs('dashboard','analytics")&&!readAdmin.includes("needs('dashboard','customers"),'dashboard still loads large lists');
  const summary=gas.slice(gas.indexOf('function dashboardSummary('),gas.indexOf('function readAdmin('));
  assert(summary.includes("rowsFields(SHEETS.orders,['total','status','deletedAt'],600)")&&summary.includes("rowsFields(SHEETS.customers,['orderCount'],1500)"),'dashboard does not use narrow field reads');
  assert(summary.includes("['id','name','category','status','stock','reservedStock','lowStockAlert']")&&(summary.match(/\.filter\(x=>x\.id&&x\.name\)/g)||[]).length===3,'dashboard no longer preserves product identity filtering');
  assert(gas.includes('s=ss().getSheetByName(name)||sheet(name,HEADERS[key]||[])'),'narrow reads still repeat schema validation on every dashboard sheet');
  assert(gas.includes('if(!maxRows||lastRow<=maxRows+1){const all=s.getDataRange().getDisplayValues()'),'small dashboard sheets still split headers and rows into separate Apps Script service calls');
  assert(readAdmin.indexOf("if(scope==='dashboard')")<readAdmin.indexOf('settingRows=fullSettings?existingRows(SHEETS.settings)'),'dashboard still waits for full Settings/Users/System reads');
  assert(gas.includes('function cachedAdminScopedSettings(')&&readAdmin.includes('cachedAdminScopedSettings(false)'),'non-settings scope refresh still rereads unrelated Settings rows');
  assert(gas.includes('const scoped=cachedAdminScopedSettings(forceRefresh)'),'Dashboard and later admin sections do not share the Settings read');
  assert(gas.includes('try{cache.put(ADMIN_SCOPED_SETTINGS_CACHE_KEY')&&gas.includes('catch(ignore){}return all;'),'oversized optional settings cache can still fail an admin read');
  assert(readAdmin.includes("if(scope==='customers'){customers=rowsTail(SHEETS.customers,1500).reverse()")&&!readAdmin.includes("needs('analytics','reports','orders','customers'"),'customer list still loads full order/interaction history');
  assert(readAdmin.includes("if(scope==='customerDetail')")&&readAdmin.includes('targetId'),'customer history is not lazy-loaded by selected customer');
  assert(readAdmin.includes("if(scope==='orders'||all){orders=rows(SHEETS.orders)")&&readAdmin.includes('if(all)result.customerInteractions=rowsTail(SHEETS.customerInteractions,3000).reverse()'),'legacy ALL/order scope no longer preserves full order and CRM compatibility');
  assert(gas.includes("cache.put(ADMIN_DASHBOARD_CACHE_KEY,JSON.stringify(result),180)"),'bounded dashboard summary cache is missing');
  ['archiveOrder','restoreArchivedOrder','restoreBackup'].forEach(action=>assert(gas.slice(gas.indexOf('const PUBLIC_CACHE_MUTATIONS='),gas.indexOf('function doGet(')).includes(`'${action}'`),`dashboard cache is not invalidated by ${action}`));
  const archiveSource=gas.slice(gas.indexOf('function archiveOrder('),gas.indexOf('function uploadImage('));
  assert((archiveSource.match(/invalidatePublicCache\(\);invalidateAdminDashboardCaches\(\)/g)||[]).length>=2,'archive/restore can leave a concurrently repopulated Dashboard cache stale');
  const restoreSource=gas.slice(gas.indexOf('function restoreBackupAction('),gas.indexOf('function deleteBackupAction('));
  assert(restoreSource.includes("deleteProperty('DATABASE_SCHEMA_READY_'")&&restoreSource.includes('ensureDatabase();')&&restoreSource.includes('invalidatePublicCache();invalidateAdminDashboardCaches();'),'backup restore does not revalidate schema and clear post-mutation caches');
  assert(gas.includes('let ACTIVE_SPREADSHEET=null;')&&gas.includes('ACTIVE_SPREADSHEET||(ACTIVE_SPREADSHEET=SpreadsheetApp.getActiveSpreadsheet())'),'one request repeatedly resolves the active spreadsheet');
  assert(gas.includes("const needsUsers=all||scope==='security'")&&!readAdmin.includes('userRows=fullSettings?existingRows(SHEETS.users)'), 'Settings still reads the Security user directory');
  const rowHelpers=gas.slice(gas.indexOf('function rows(name)'),gas.indexOf('function existingRows(name)'));
  assert(rowHelpers.includes('ss().getSheetByName(name)||sheet(name,HEADERS[key]||[])'),'established reads still revalidate the full schema');
  assert(rowHelpers.includes('if(lastRow<=maxRows+1){const all=s.getDataRange().getDisplayValues()'),'small tail reads still split header and rows into extra service calls');
  const startup=app.slice(app.lastIndexOf("window.addEventListener('hashchange'"));
  assert(startup.includes("if(state.page==='admin'){state.loading=false;render();if(state.adminToken)loadAdmin(false);}")&&startup.indexOf("if(state.page==='admin')")<startup.lastIndexOf('loadData(true)'),'direct admin route still waits for storefront data');
  assert(app.includes("const ADMIN_NEUTRAL_SETTINGS = Object.freeze({ shopName: 'SHOP DMO', ownerName: '' })")&&app.includes("loadedAdminSettings&&hasOwn(loadedAdminSettings,'shopName')?loadedAdminSettings:ADMIN_NEUTRAL_SETTINGS"),'direct admin shell can still flash the legacy identity');
  assert(app.includes('ADMIN_SHELL_CACHE_KEY')&&app.includes('saveAdminShellCache(next)'),'reload does not restore a safe dashboard shell immediately');
  assert(app.includes("payload.action === 'getAdminData' || payload.action === 'getFacebookBumpAdminData'")&&app.includes('readDeadline = readOnly ? Date.now() + 30000')&&app.includes('Math.min(26000, readDeadline - Date.now())')&&app.includes('readDeadline-Date.now()<9000')&&app.includes('ระบบหลังบ้านตอบกลับไม่สมบูรณ์'),'bounded read-only retry or readable non-JSON error is missing');
  assert(gas.includes('parts=cache.getAll(keys)'),'public cache still reads every catalog chunk as a separate Apps Script service call');
});

test('admin navigation is not serialized behind a slow scope and refresh stays usable',()=>{
  const source=app.slice(app.indexOf('async function loadAdmin('),app.indexOf('async function loadFacebookBumpAdminData('));
  assert(app.includes('const adminLoadPromises = new Map()')&&source.includes('adminLoadPromises.get(scope)')&&source.includes('adminLoadPromises.set(scope,{promise:request,force:!!force})'),'admin requests are still serialized through one global promise');
  assert(source.includes('state.adminLoadingScopes.add(scope)')&&app.includes("state.adminLoadingScopes.has('dashboard')"),'loading feedback is not scoped to the selected admin section');
  assert(!source.includes('if(force)state.adminLoadedScopes.delete(scope)'),'manual refresh still blanks already-loaded data while waiting');
  assert(source.includes('const tokenAtStart=state.adminToken')&&source.includes('state.adminToken!==tokenAtStart'),'a late response can overwrite a newer login/logout state');
  assert(source.includes('state.adminLoadedAtByScope[scope]'),'scope freshness still depends on the timestamp of an unrelated section');
  assert(app.includes('function applyAdminSettings(')&&app.includes('function applyAdminSecurity(')&&app.includes('adminFieldAppliedSequence'),'late overlapping settings/security fields can overwrite a newer scope response');
  assert(app.includes("if(scope!=='dashboard')scalarKeys.push('sessionDays')")&&app.includes("if(scope==='settings'||scope==='security'||scope==='ALL')scalarKeys.push('apiKeyConfigured')"),'a partial Dashboard response can overwrite authoritative Security settings');
  assert(source.includes("current&&current.promise===request){adminLoadPromises.delete(scope);state.adminLoadingScopes.delete(scope)"),'an obsolete request can clear the loading state of a newer request');
});

test('public auto refresh is foreground-only and shared across tabs',()=>{
  assert(app.includes("const PUBLIC_REFRESH_GATE_KEY = 'dmo_public_refresh_gate_v1'")&&app.includes('localStorage.setItem(PUBLIC_REFRESH_GATE_KEY'),'cross-tab public refresh gate is missing');
  const source=app.slice(app.indexOf('function publicRefreshIntervalMs()'),app.indexOf('function customerNav()'));
  assert(source.includes("document.visibilityState==='hidden'")&&source.includes("state.page==='admin'")&&source.includes('publicLoadPromise'),'hidden/admin/in-flight tabs can still poll public data');
  assert(source.indexOf('markPublicRefreshGate();')<source.indexOf('await loadData(false)'),'a tab does not claim the refresh window before starting its request');
  assert(source.includes("sharedPublicRefreshAt()>Number(state.publicLoadedAt||0)&&restorePublicCache(false))render()"),'fresh data received through another tab is not rendered immediately');
  assert(source.includes("navigator.locks.request(PUBLIC_REFRESH_GATE_KEY,{mode:'exclusive',ifAvailable:true}"),'simultaneous foreground tabs can still pass the timestamp gate together');
  assert(app.includes("document.addEventListener('visibilitychange'")&&app.includes('setInterval(autoRefreshPublic,15000)'),'foreground resume or gated interval refresh is missing');
  assert(source.includes('state.settings?.autoRefreshSeconds'),'the Admin refresh interval setting is ignored by the foreground gate');
  assert(app.includes("refresh.onclick = () => loadData(true)"),'manual refresh no longer bypasses the automatic gate');
});

test('session verification uses a revalidated location cache and one-range cold fallback',()=>{
  const source=gas.slice(gas.indexOf('function sessionLocationCacheKey'),gas.indexOf('function validToken'));
  assert(source.includes("'session-location-'+sha256")&&source.includes("String(v[h.indexOf('token')])===String(token)"),'cached session rows are not hashed or token-revalidated');
  assert(source.includes('const all=s.getDataRange().getValues()')&&!source.includes('createTextFinder'),'cold session lookup still performs multiple finder/header/row calls');
  assert(gas.includes('clearSessionLocation(token);return output({ok:true})')&&gas.includes('clearSessionLocation(v[i][token])'),'logout or password revocation leaves stale location entries');
});

test('PWA navigation prefers the current online shell',()=>{
  const index=read('index.html'),config=read('config.js'),manifest=read('manifest.webmanifest'),serviceWorker=read('sw.js');
  assert(index.includes('<title>SHOP DMO</title>')&&!index.includes('<title>GUN SHOP DMO</title>'),'static page title can still flash the legacy name');
  assert(config.includes('shopName: "SHOP DMO"')&&config.includes('ownerName: ""'),'config still contains the legacy identity');
  assert(manifest.includes('"name": "SHOP DMO"')&&!manifest.includes('"name": "GUN SHOP DMO"'),'installed PWA still uses the legacy name');
  assert(serviceWorker.includes("request.mode==='navigate'")&&serviceWorker.includes('Promise.race([network,timeout])'),'online navigation does not use a bounded network-first strategy');
  assert(serviceWorker.includes('NAVIGATION_NETWORK_TIMEOUT_MS=4000')&&serviceWorker.includes("cache.put('./index.html',response.clone())"),'stalled-navigation fallback or late cache refresh is missing');
  assert(index.includes('20260911-v20.2-admin-performance-6')&&serviceWorker.includes('gun-shop-dmo-v20-2-admin-performance-6'),'PWA cache version is not advanced');
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
