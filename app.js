'use strict';

const cfg = window.DMO_CONFIG || {};
const app = document.getElementById('app');
let apiBusyCount = 0;
let publicLoadPromise = null;
let adminLoadPromise = null;
let productSearchCache = new WeakMap();

const state = {
  page: location.hash === '#admin' ? 'admin' : 'shop',
  catalogType: 'SEAL',
  category: 'ALL',
  section: 'ALL',
  search: '',
  selectedSearchKey: '',
  seals: [],
  items: [],
  services: [],
  moneyT: null,
  promotions: [],
  settings: {},
  cart: [],
  customer: { tamer: '', server: 'ลิเวียมอน', contact: '' },
  updatedAt: '',
  loading: true,
  adminToken: sessionStorage.getItem('dmo_admin_token') || '',
  adminData: null,
  adminLoading: false,
  adminLoadedAt: 0,
  loginSubmitting: false,
  adminUser: JSON.parse(sessionStorage.getItem('dmo_admin_user') || 'null'),
  lastAdminActivity: Number(sessionStorage.getItem('dmo_admin_activity') || Date.now()),
  adminView: 'dashboard',
  editRecord: null,
  wikiGallery: null,
  wikiSearch: '',
  inventorySearch: '',
  inventoryFilter: 'ALL',
  inventorySort: 'NAME',
  stockActionPending: '',
  stockActionResult: null,
  stockPendingRequests: {},
  stockConfirmFingerprint: '',
  stockAddDraft: { product: '', amount: '', reason: 'เติมของเข้า' },
  customerSearchAdmin: '',
  customerFilter: 'ALL',
  promoEdit: null,
  adminCatalogSearch: '',
  adminKindFilter: 'ALL',
  adminSelected: [],
  bulkEdit: { field: 'status', value: 'ACTIVE' },
  recentSearches: JSON.parse(localStorage.getItem('dmo_recent_searches') || '[]'),
  favoriteKeys: JSON.parse(localStorage.getItem('dmo_favorites') || '[]'),
  wishlistOnly: false,
  recentOrders: JSON.parse(localStorage.getItem('dmo_recent_orders') || '[]'),
  customerDetailId: '',
  customerInteractionEdit: null,
  reportRange: '30',
  automationTab: 'ALERTS',
  wikiLookup: { query: '', results: [], loading: false, target: null },
  theme: localStorage.getItem('dmo_theme') || 'DARK',
  offline: false,
  installPrompt: null,
  orderSuccess: null,
  copyNotice: '',
  adminOrderFilter: 'ALL',
  adminOrderSearch: '',
  adminOrderMode: 'ACTIVE',
  adminActionPending: '',
  orderSubmitting: false,
  pendingOrderRequestId: '',
  pendingOrderFingerprint: '',
  orderFormStartedAt: Date.now(),
  orderCooldownUntil: Number(localStorage.getItem('dmo_order_cooldown_until') || 0),
  integrityReport: null,
  catalogVisible: 60,
  imageManager: { zipData: '', fileName: '', preview: null, applying: false, allowOverwrite: false },
  facebookBump: { tab: 'POSTS', edit: null, pending: '', loadingModule: false, loadError: '', loadStartedAt: 0, loadDurationMs: 0, connection: { worker: 'UNKNOWN', browser: 'STOPPED', connection: 'UNKNOWN', paired: false, running: false, lastError: '', account: {} } },
  publicLoadedAt: 0,
};

let inputRenderTimer = 0;
function scheduleInputRender(inputId, delay = 100) {
  clearTimeout(inputRenderTimer);
  inputRenderTimer = setTimeout(() => {
    render();
    requestAnimationFrame(() => {
      const input = document.getElementById(inputId);
      if (!input) return;
      input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (error) {}
    });
  }, delay);
}

const money = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const orderStatusThai = (status) => ({NEW:'ใหม่',CHECKING:'กำลังตรวจสอบ',PREPARING:'กำลังจัดของ',READY:'พร้อมส่ง',COMPLETED:'เสร็จสิ้น',CANCELLED:'ยกเลิก'})[String(status||'')] || status || '-';
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[()\-_.\[\]]/g, '');

const searchText = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFKC')
  .replace(/[()\-_.\[\]{}\/\\|,:;]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const searchTokens = (s) => searchText(s).split(' ').filter(Boolean);
const searchFields = (product) => {
  if(productSearchCache.has(product))return productSearchCache.get(product);
  const fields=[product.name, product.wikiName, product.wikiTitle, product.category,
    product.section, product.itemCategory, product.serviceCategory,
    product.tags, product.searchKeywords, ...(product.aliases || [])]
    .filter(Boolean).map(searchText).map((text)=>({text,compact:norm(text)}));
  productSearchCache.set(product,fields);return fields;
};
function editDistance(a, b) {
  a = searchText(a); b = searchText(b);
  if (!a) return b.length; if (!b) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}
function smartSearchScore(product, rawQuery) {
  const query = searchText(rawQuery);
  if (!query) return 1;
  const compact = norm(query);
  const tokens = searchTokens(query);
  const hasNumericToken = /\d/.test(compact);
  const fields = searchFields(product);
  let best = 0;
  fields.forEach((indexed, index) => {
    const field=indexed.text,fCompact=indexed.compact;
    const primaryBoost = index === 0 ? 24 : index <= 2 ? 12 : 0;
    if (fCompact === compact) best = Math.max(best, 120 + primaryBoost);
    else if (fCompact.startsWith(compact)) best = Math.max(best, 92 + primaryBoost);
    else if (fCompact.includes(compact)) best = Math.max(best, 70 + primaryBoost);
    const fieldTokens = searchTokens(field);
    const matchedTokens = tokens.filter((token) => /^\d+$/.test(token)
      ? fieldTokens.includes(token)
      : field.includes(token) || fCompact.includes(norm(token))).length;
    if (matchedTokens === tokens.length) best = Math.max(best, 38 + matchedTokens * 12 + primaryBoost);
    else if (tokens.length === 1 && matchedTokens) best = Math.max(best, 38 + primaryBoost);
    if (!hasNumericToken && compact.length >= 3 && fCompact.length <= 40) {
      const distance = editDistance(compact, fCompact);
      const allowance = compact.length <= 5 ? 1 : compact.length <= 10 ? 2 : 3;
      if (distance <= allowance) best = Math.max(best, 52 - distance * 8 + primaryBoost);
    }
  });
  return best;
}
function rememberSearch(value) {
  const clean = String(value || '').trim();
  if (clean.length < 2) return;
  state.recentSearches = [clean, ...state.recentSearches.filter((x) => searchText(x) !== searchText(clean))].slice(0, 6);
  localStorage.setItem('dmo_recent_searches', JSON.stringify(state.recentSearches));
}
function searchSuggestions() {
  if (!state.search.trim()) return [];
  return catalog().map((product) => ({ product, score: smartSearchScore(product, state.search) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.product.name).localeCompare(String(b.product.name), 'th'))
    .slice(0, 6).map((entry) => entry.product);
}
const html = (s) => String(s ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const safeExternalUrl=(value)=>{try{const url=new URL(String(value||''));return ['https:','http:'].includes(url.protocol)?url.toString():'';}catch(error){return'';}};
const isVisible = (p) => !['HIDDEN', 'INACTIVE'].includes(String(p.status || 'ACTIVE'));
const availableStock = (p) => p.availableStock !== undefined ? p.availableStock : (p.stock === '' ? '' : Math.max(0, Number(p.stock || 0) - Number(p.reservedStock || 0)));
const canBuy = (p) => isVisible(p) && String(p.status) !== 'OUT_OF_STOCK' && !(availableStock(p) !== '' && availableStock(p) <= 0);
const productMaxQty = (p) => {
  const available = availableStock(p);
  return available === '' ? 9999 : Math.max(0, Math.floor(Number(available) || 0));
};
const stockLimitMessage = (p) => `มีสินค้าเหลือ ${money(productMaxQty(p))} ${saleUnit(p)}`;
const allProducts = () => [...state.seals, ...state.items, ...state.services, ...(state.moneyT ? [state.moneyT] : [])];
const productKey = (product) => `${product.kind}|${product.id}`;
const isFavorite = (product) => state.favoriteKeys.includes(productKey(product));
function toggleFavorite(product) {
  const key = productKey(product);
  state.favoriteKeys = isFavorite(product) ? state.favoriteKeys.filter((x) => x !== key) : [key, ...state.favoriteKeys].slice(0, 300);
  localStorage.setItem('dmo_favorites', JSON.stringify(state.favoriteKeys));
  render();
}
function saveRecentOrderSnapshot(orderId = '') {
  if (!state.cart.length) return;
  const snapshot = { orderId, createdAt: new Date().toISOString(), customer: customerValues(), items: state.cart.map((x) => ({ ...x })), total: pricingSummary().total };
  state.recentOrders = [snapshot, ...state.recentOrders].slice(0, 10);
  localStorage.setItem('dmo_recent_orders', JSON.stringify(state.recentOrders));
}
function repeatOrder(snapshot) {
  const products = allProducts();
  let added = 0;
  (snapshot.items || []).forEach((item) => {
    const product = products.find((p) => p.id === item.id && p.kind === item.kind) || products.find((p) => p.id === item.id);
    if (!product || !canBuy(product)) return;
    addToCartSilent(product, Math.max(1, Number(item.quantity) || 1));
    added++;
  });
  if (snapshot.customer) state.customer = { ...state.customer, ...snapshot.customer };
  toast(added ? `เพิ่มรายการเดิม ${added} รายการแล้ว` : 'ไม่พบสินค้าที่พร้อมขายจากรายการเดิม');
  render();
}

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
}

async function apiGet(admin = false, extra = {}) {
  const base = cfg.sheetsUrl;
  if (!base || base.includes('PASTE_')) throw Error('ยังไม่ได้ตั้งค่า URL ของ Google Apps Script');
  const url = new URL(base);
  url.searchParams.set('_', Date.now());
  Object.entries(extra).forEach(([key, value]) => url.searchParams.set(key, value));
  if (admin) {
    url.searchParams.set('admin', '1');
    url.searchParams.set('token', state.adminToken);
  }
  const response = await fetch(url.toString(), { cache: 'no-store' });
  const data = await response.json();
  if (!data.ok) throw Error(data.error || 'โหลดข้อมูลไม่สำเร็จ');
  return data;
}

async function apiPost(payload) {
  const sourceButton=document.activeElement&&document.activeElement.closest?document.activeElement.closest('button'):null;
  const busyMessages={login:'กำลังตรวจสอบบัญชี กรุณารอสักครู่…',createOrder:'กำลังส่งและจัดเตรียมรายการเข้าหลังร้าน…',updateOrder:'กำลังบันทึกสถานะออเดอร์…',updateOrderItemPick:'กำลังบันทึกรายการจัดของ…',setStock:'กำลังบันทึกสต๊อก…',adjustStock:'กำลังปรับสต๊อก…',upsert:'กำลังบันทึกสินค้า…',getAdminData:'กำลังโหลดข้อมูลหลังร้าน…'};
  if(sourceButton&&!sourceButton.disabled){sourceButton.dataset.originalText=sourceButton.innerHTML;sourceButton.disabled=true;sourceButton.innerHTML='<span class="loading"></span> กำลังดำเนินการ…';}
  apiBusyCount += 1;document.body.dataset.busyMessage=busyMessages[payload.action]||'กำลังดำเนินการ กรุณารอสักครู่…';document.body.classList.add('api-busy');
  try {
    const response = await fetch(cfg.sheetsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!data.ok) throw Error(data.error || 'ทำรายการไม่สำเร็จ');
    return data;
  } finally {
    if(sourceButton&&sourceButton.isConnected){sourceButton.disabled=false;if(sourceButton.dataset.originalText)sourceButton.innerHTML=sourceButton.dataset.originalText;delete sourceButton.dataset.originalText;}
    apiBusyCount=Math.max(0,apiBusyCount-1);if(!apiBusyCount){document.body.classList.remove('api-busy');delete document.body.dataset.busyMessage;}
  }
}

function applyPublicData(data,offline=false){
  state.seals=(data.seals||[]).map(product=>({...product,kind:'SEAL'})).filter(isVisible);
  state.items=(data.gameItems||[]).map(product=>({...product,kind:'ITEM'})).filter(isVisible);
  state.services=(data.services||[]).map(product=>({...product,kind:'SERVICE'})).filter(isVisible);
  state.moneyT=data.moneyT?{...data.moneyT,kind:'TMONEY',unit:'T'}:null;
  state.promotions=data.promotions||[];state.settings=data.settings||{};state.updatedAt=data.updatedAt||data.stockUpdatedAt||'';state.offline=offline;productSearchCache=new WeakMap();
}
function restorePublicCache(){
  try{const cached=JSON.parse(localStorage.getItem('dmo_public_cache')||'null'),maxHours=Number((cached&&cached.data&&cached.data.settings&&cached.data.settings.offlineCacheHours)||state.settings.offlineCacheHours||12);if(cached&&cached.data&&Date.now()-Number(cached.savedAt||0)<=maxHours*3600000){applyPublicData(cached.data,true);return true;}}catch(error){}return false;
}
async function loadData(showLoading = true) {
  if(publicLoadPromise)return publicLoadPromise;
  const restored=showLoading&&restorePublicCache();
  if(showLoading&&!restored){state.loading=true;render();}else if(restored){state.loading=false;render();}
  publicLoadPromise=(async()=>{try{
    const data=await apiGet(false);applyPublicData(data,false);state.publicLoadedAt=Date.now();
    try{localStorage.setItem('dmo_public_cache',JSON.stringify({savedAt:Date.now(),data}));}catch(error){}
    state.loading=false;render();
  }catch(error){const cacheAvailable=restored||restorePublicCache();state.loading=false;render();toast(cacheAvailable?'ออฟไลน์: ใช้ข้อมูลล่าสุดที่บันทึกไว้':error.message);}finally{publicLoadPromise=null;}})();
  return publicLoadPromise;
}

function customerNav() {
  const types = [
    ['SEAL', '🦖 ซีล'],
    ['ITEM', '🎒 ไอเทม'],
    ['SERVICE', '⚔️ บริการ'],
    ['TMONEY', '💰 เงิน T'],
  ];
  return `<nav class="nav customer-nav">
    ${types.map(([value, label]) => `<button class="tab ${state.catalogType === value && !state.wishlistOnly ? 'active' : ''}" data-type="${value}">${label}</button>`).join('')}
    <button class="tab ${state.wishlistOnly ? 'active' : ''}" id="favoritesBtn">❤️ รายการโปรด (${state.favoriteKeys.length})</button>
    <button class="btn" id="refreshBtn">🔄 โหลดล่าสุด</button>
  </nav>`;
}


function applyTheme(){const theme=String(state.theme||state.settings.themeDefault||'DARK').toUpperCase();document.documentElement.dataset.theme=theme;localStorage.setItem('dmo_theme',theme);}
function toggleTheme(){state.theme=String(state.theme).toUpperCase()==='LIGHT'?'DARK':'LIGHT';applyTheme();render();}
async function installPwa(){if(!state.installPrompt)return toast('อุปกรณ์นี้ยังไม่แสดงตัวเลือกติดตั้ง');state.installPrompt.prompt();try{await state.installPrompt.userChoice;}catch(e){}state.installPrompt=null;render();}

function applyAdminRoleGuards(){
  if(state.page!=='admin'||!state.adminToken)return;
  const role=String(state.adminUser?.role||'VIEWER').toUpperCase();
  const disable=(selectors)=>document.querySelectorAll(selectors.join(',')).forEach((el)=>{el.disabled=true;el.setAttribute('aria-disabled','true');el.title='บัญชี '+role+' ไม่มีสิทธิ์แก้ไขส่วนนี้';});
  const adminOnly=['[data-new]','[data-edit]','[data-delete]','#saveRecordBtn','#bulkApplyBtn','#bulkTrashBtn','[data-restore-trash]','[data-delete-trash]','#saveSettingsBtn','#savePromotionBtn','[data-edit-promotion]','[data-delete-promotion]','#wikiGalleryBtn','#wikiCenterRecordBtn','[data-wiki-import]','[data-attach-wiki]','#imageZipInput','#previewImageZipBtn','#applyImageZipBtn'];
  const staffWrite=['[data-save-order]','[data-pick-item]','[data-save-customer]','#saveCrmCustomerBtn','#addInteractionBtn'];
  const stockAdminOnly=['[data-stock-adjust]','[data-stock-set]','#stockAddBtn','#syncStockBtn'];
  const ownerOnly=['#saveSecurityUserBtn','#toggleBackupTriggerBtn','[data-restore-backup]','[data-delete-backup]'];
  if(!['OWNER','ADMIN'].includes(role))disable(adminOnly);
  if(!['OWNER','ADMIN'].includes(role))disable(stockAdminOnly);
  if(!['OWNER','ADMIN','STAFF'].includes(role))disable(staffWrite);
  if(role!=='OWNER')disable(ownerOnly);
}

function render() {
  applyTheme();
  const shopName = cfg.shopName || state.settings.shopName || 'GUN SHOP DMO';
  const ownerName = cfg.ownerName || state.settings.ownerName || 'Natthananat Kawinwatthanakorn';
  const adminMode = state.page === 'admin';
  app.innerHTML = `
    <section class="hero">
      <div>
        <h1>📦 ${html(shopName)}</h1>
        <p>${adminMode ? 'ระบบจัดการร้านสำหรับเจ้าของร้าน' : 'เลือกสินค้า • ส่งออเดอร์เข้าหลังบ้าน • รอร้านตรวจสอบก่อนชำระเงิน'}</p>
        <div class="brand-owner"><span class="owner-badge">👤 เจ้าของร้าน <strong>${html(ownerName)}</strong></span><span>GUN SHOP DMO • ระบบสั่งซื้อและตรวจสต๊อก</span></div>
      </div>
      <div class="hero-actions"><div class="data-badge">${state.loading ? '<span class="loading"></span>' : (state.offline?'Offline Cache':'Google Sheets')}<br>${state.updatedAt ? new Date(state.updatedAt).toLocaleString('th-TH') : ''}</div><button class="icon-btn" id="themeToggleBtn" title="สลับธีม">${String(state.theme).toUpperCase()==='LIGHT'?'🌙':'☀️'}</button>${state.installPrompt?'<button class="btn small" id="installPwaBtn">📲 ติดตั้ง</button>':''}</div>
    </section>
    ${adminMode ? '' : customerNav()}
    ${state.orderSuccess && !adminMode ? orderSuccessPanel() : ''}
    ${state.loading ? '<section class="panel empty"><span class="loading"></span> กำลังโหลดข้อมูล...</section>' : (adminMode ? adminPage() : shopPage())}
    ${adminMode ? '' : `<nav class="mobile-bottom-nav"><button data-mobile-nav="SEAL">🦖<span>ซีล</span></button><button data-mobile-nav="ITEM">🎒<span>ไอเทม</span></button><button data-mobile-nav="SERVICE">⚔️<span>บริการ</span></button><button data-mobile-nav="TMONEY">💰<span>เงิน T</span></button><button id="mobileCartBtn">🛒<span>ตะกร้า ${state.cart.reduce((s,x)=>s+Number(x.quantity||0),0)}</span></button></nav><footer class="site-footer"><span>GUN SHOP DMO • เจ้าของร้าน Natthananat Kawinwatthanakorn • รูปภาพอ้างอิงจาก <a href="https://dmowiki.com/Seal_Master" target="_blank" rel="noopener">DMO Wiki</a></span><button class="admin-entry" id="adminEntry">🔒 ระบบหลังบ้าน</button></footer>`}
  `;
  bind();
  applyAdminRoleGuards();
}

function catalog() {
  if (state.wishlistOnly) return allProducts();
  if (state.catalogType === 'ITEM') return state.items;
  if (state.catalogType === 'SERVICE') return state.services;
  if (state.catalogType === 'TMONEY') return state.moneyT ? [state.moneyT] : [];
  return state.seals;
}

function filteredProducts() {
  const query = state.search.trim();
  return catalog().map((product) => ({ product, score: query ? smartSearchScore(product, query) : 1 })).filter(({ product, score }) => {
    if (state.selectedSearchKey && productKey(product) !== state.selectedSearchKey) return false;
    if (state.wishlistOnly && !isFavorite(product)) return false;
    if (state.catalogType === 'SEAL' && state.category !== 'ALL' && product.category !== state.category) return false;
    if (state.catalogType === 'SEAL' && state.section !== 'ALL' && product.section !== state.section) return false;
    return score > 0;
  }).sort((a, b) => query
    ? b.score - a.score || (Number(a.product.sortOrder) || 9999) - (Number(b.product.sortOrder) || 9999)
    : (Number(a.product.sortOrder) || 9999) - (Number(b.product.sortOrder) || 9999) || String(a.product.name).localeCompare(String(b.product.name), 'th'))
    .map(({ product }) => product);
}

function stockText(product) {
  if (product.status === 'CHECK_STOCK') return '⚠️ ต้องตรวจสอบสต๊อก';
  const available = availableStock(product);
  if (product.status === 'OUT_OF_STOCK' || (available !== '' && available <= 0)) return '❌ หมด';
  if (product.status === 'CHECK_STOCK' || available === '') return '⚠️ ต้องตรวจสอบสต๊อก';
  const low = product.lowStockAlert !== undefined && Number(product.lowStockAlert || 0) > 0 && available <= Number(product.lowStockAlert || 0);
  return `${low ? '⚠️ ใกล้หมด • ' : ''}เหลือ ${money(available)} ${html(product.unit || '')}`;
}

function sectionLabel(section) {
  return ({ NORMAL: 'ปกติ', BASE_HARD: 'เบสยาก', SUSA: 'ซูซา' })[section] || section || '';
}

function saleUnit(product){return String(product.unit||(product.kind==='SEAL'?'ชุด':product.kind==='SERVICE'?'ครั้ง':product.kind==='TMONEY'?'T':'ชิ้น'));}
function formatProductPrice(product){const unit=saleUnit(product),pack=Number(product.packSize)||1000;return `${money(product.price)} บาท/${html(unit)}${unit==='ชุด'?` (${money(pack)} ใบ)`:''}`;}
function sealSaleNote(product){if(product.kind!=='SEAL')return'';return saleUnit(product)==='ชุด'?`1 ชุด = ${money(product.packSize||1000)} ใบ`:'ราคาต่อ 1 ใบ';}

function productMeta(product) {
  if (product.kind === 'SEAL') return `${product.category} • ${sectionLabel(product.section)} • ${formatProductPrice(product)}`;
  if (product.kind === 'SERVICE') return `${html(product.serviceCategory || 'บริการ')} • ${formatProductPrice(product)}`;
  if (product.kind === 'TMONEY') return `กำหนดจำนวน T ที่ต้องการ • Rate ${formatProductPrice(product)}`;
  return `${html(product.itemCategory || 'ไอเทม')} • ${formatProductPrice(product)}`;
}

function productFallbackIcon(product){return product.kind==='SEAL'?'🦖':product.kind==='SERVICE'?'⚔️':product.kind==='TMONEY'?'💰':'🎒';}
function productImageMarkup(product,className='product-img'){
  const fallback=`<span class="image-fallback" aria-hidden="true">${productFallbackIcon(product)}</span>`;
  return product.imageUrl?`<span class="product-image-frame">${fallback}<img class="${className}" src="${html(product.imageUrl)}" alt="${html(product.name)}" loading="lazy" decoding="async" fetchpriority="low" onerror="this.hidden=true;this.parentElement.classList.add('is-broken')"></span>`:`<span class="product-image-frame is-empty">${fallback}</span>`;
}

function productCard(product) {
  const image=productImageMarkup(product);
  const description = product.description ? `<div class="product-description">${html(product.description)}</div>` : '';
  return `<article class="product-card">
    <div class="image-wrap">${image}<button class="favorite-btn ${isFavorite(product) ? 'active' : ''}" data-favorite="${html(productKey(product))}" aria-label="รายการโปรด">${isFavorite(product) ? '♥' : '♡'}</button></div>
    <div class="product-main">
      <div class="product-name">${html(product.name)}</div>
      <div class="product-meta">${productMeta(product)}</div>
      ${product.tags ? `<div class="tag-line">${String(product.tags).split('|').filter(Boolean).slice(0,4).map((tag)=>`<span class="mini-tag">${html(tag)}</span>`).join('')}</div>` : ''}
      ${description}
      <div class="product-status">${stockText(product)}</div>
      ${product.wikiUrl ? `<a class="wiki-link" href="${html(product.wikiUrl)}" target="_blank" rel="noopener">📚 ดูข้อมูล DMO Wiki</a>` : ''}
    </div>
    <div class="product-actions">
      <input class="qty-input" type="number" min="1" max="${productMaxQty(product)}" step="1" value="1" data-qty="${html(product.id)}" aria-label="${product.kind==='TMONEY'?'จำนวน T':'จำนวนสินค้า'}" ${canBuy(product) ? '' : 'disabled'}>
      <button class="btn primary small" data-add="${html(product.id)}" ${canBuy(product) ? '' : 'disabled'}>+ เพิ่ม</button>
    </div>
  </article>`;
}

function shopPage() {
  const products = filteredProducts();
  const visibleProducts=products.slice(0,state.catalogVisible);
  const suggestions = state.search && !state.selectedSearchKey ? searchSuggestions() : [];
  const servicePosterUrl=state.catalogType==='SERVICE'?safeExternalUrl(state.settings.servicePosterUrl):'';
  return `<div class="grid-main">
    <section class="panel">
      <div class="shop-heading"><div><h2 class="panel-title">${state.wishlistOnly ? '❤️ รายการโปรด' : state.catalogType === 'SEAL' ? 'รายการซีล' : state.catalogType === 'ITEM' ? 'ไอเทมในเกม' : state.catalogType === 'TMONEY' ? 'เงิน T' : 'บริการของร้าน'}</h2><p class="product-meta">${state.wishlistOnly ? 'รายการโปรดเก็บอยู่ในอุปกรณ์เครื่องนี้' : state.catalogType==='TMONEY'?'กรอกจำนวน T ที่ต้องการ ระบบคำนวณจาก Rate ปัจจุบันและตรวจ Stock จริงอีกครั้งที่ Server':'เลือกจำนวนและเพิ่มลงรายการ จากนั้นส่งให้ร้านตรวจสอบสต๊อก'}</p></div></div>
      <div class="commerce-flow" aria-label="ขั้นตอนสั่งซื้อ"><b>1 เลือกสินค้า</b><i>→</i><b>2 ตรวจตะกร้า</b><i>→</i><b>3 Copy/ส่งให้ร้าน</b><i>→</i><b>4 ร้านตรวจและจัดของ</b><i>→</i><b>5 เสร็จสิ้น</b></div>
      <div class="filters">
        <div class="smart-search-wrap"><input class="search" id="searchInput" autocomplete="off" placeholder="ค้นหาชื่อ Alias สาย หรือพิมพ์คลาดเคลื่อนได้..." value="${html(state.search)}">${state.search ? `<button class="search-clear" id="searchClearBtn">×</button>` : ''}${suggestions.length ? `<div class="search-suggestions">${suggestions.map((p)=>`<button data-search-suggestion="${html(p.name)}" data-search-product="${html(productKey(p))}"><b>${html(p.name)}</b><span>${html(productMeta(p))}</span></button>`).join('')}</div>` : ''}</div>
        ${state.recentSearches.length ? `<div class="recent-searches"><span>ค้นหาล่าสุด:</span>${state.recentSearches.map((q)=>`<button data-recent-search="${html(q)}">${html(q)}</button>`).join('')}<button id="clearRecentSearches">ล้าง</button></div>` : ''}
        ${state.catalogType === 'SEAL' ? `<div class="chip-row">${['ALL', 'AT', 'HT', 'CT', 'HP', 'DS', 'DE', 'EV', 'BL'].map((category) => `<button class="filter-chip ${state.category === category ? 'active' : ''}" data-cat="${category}">${category === 'ALL' ? 'ทั้งหมด' : category}</button>`).join('')}</div>
        <div class="chip-row">${[['ALL', 'ทุกประเภท'], ['NORMAL', 'ปกติ'], ['BASE_HARD', 'เบสยาก'], ['SUSA', 'ซูซา']].map(([value, label]) => `<button class="filter-chip ${state.section === value ? 'active' : ''}" data-sec="${value}">${label}</button>`).join('')}</div>` : ''}
      </div>
      ${servicePosterUrl?`<div class="service-poster"><img src="${html(servicePosterUrl)}" alt="โปสเตอร์บริการ GUN SHOP DMO" loading="lazy" decoding="async" onerror="this.closest('.service-poster').hidden=true"></div>`:''}
      <div class="search-summary">พบ ${products.length} รายการ${state.search ? ` สำหรับ “${html(state.search)}”` : ''}${products.length>visibleProducts.length?` • แสดง ${visibleProducts.length} รายการแรก`:''}</div><div class="products">${products.length ? visibleProducts.map(productCard).join('') : '<div class="empty"><b>ไม่พบสินค้า</b><span>ลองตรวจคำสะกด เปลี่ยนหมวด หรือค้นด้วยชื่อเรียกอื่น</span><button class="btn small" id="emptyResetBtn">ล้างการค้นหา</button></div>'}</div>${products.length>visibleProducts.length?`<button class="btn load-more" id="loadMoreProductsBtn">แสดงเพิ่มอีก ${Math.min(60,products.length-visibleProducts.length)} รายการ</button>`:''}
    </section>
    ${cartPanel()}
  </div>`;
}

function cartItem(item) {
  const product = allProducts().find((entry) => entry.id === item.id && entry.kind === item.kind);
  const atLimit = product && item.quantity >= productMaxQty(product);
  const displayProduct=product||item;
  return `<div class="cart-item">
    <div><b>${html(item.name)}</b><div class="product-meta">${money(item.quantity)} ${html(saleUnit(displayProduct))} × ${formatProductPrice(displayProduct)} = ${money(item.quantity * item.price)} บาท</div></div>
    <div class="cart-controls"><button class="btn small" data-dec="${html(item.id)}">−</button><b>${money(item.quantity)}</b><button class="btn small" data-inc="${html(item.id)}" ${atLimit ? 'disabled' : ''}>+</button><button class="btn danger small" data-remove="${html(item.id)}" style="grid-column:1/-1">ลบ</button></div>
  </div>`;
}


function promoIsActive(p){
  if(String(p.status||'ACTIVE')!=='ACTIVE')return false;
  const now=Date.now(),start=p.startAt?Date.parse(p.startAt):0,end=p.endAt?Date.parse(p.endAt):0;
  return (!start||now>=start)&&(!end||now<=end);
}
function pricingSummary(){
  const subtotal=state.cart.reduce((sum,item)=>sum+item.price*item.quantity,0);
  const sealSubtotal=state.cart.filter(item=>item.kind==='SEAL').reduce((sum,item)=>sum+item.price*item.quantity,0);
  let discount=0;const messages=[];
  const promos=(state.promotions||[]).filter(promoIsActive).sort((a,b)=>(Number(a.priority)||999)-(Number(b.priority)||999));
  for(const p of promos){
    const min=Number(p.minSpend)||0;if(subtotal<min)continue;
    if(p.type==='DISCOUNT_PERCENT'||p.type==='FLASH_SALE'){const d=subtotal*(Math.max(0,Math.min(100,Number(p.value)||0))/100);discount+=d;messages.push(`${p.name}: ลด ${money(d)} บาท`);}
    else if(p.type==='DISCOUNT_AMOUNT'){const d=Math.min(subtotal,Math.max(0,Number(p.value)||0));discount+=d;messages.push(`${p.name}: ลด ${money(d)} บาท`);}
    else if(p.type==='REWARD_PER_SPEND')continue;
    else if(p.rewardText)messages.push(p.rewardText);
    if(String(p.stackable)==='FALSE')break;
  }
  discount=Math.min(subtotal,discount);
  return{subtotal,sealSubtotal,discount,total:Math.max(0,subtotal-discount),messages};
}

function cartPanel() {
  const pricing = pricingSummary();
  const total = pricing.total;
  const subtotal = pricing.subtotal;
  const threshold = Number(state.settings.promoThreshold) || 100;
  const promotionSets = Math.floor(pricing.sealSubtotal / threshold);
  const remaining = pricing.sealSubtotal ? threshold - (pricing.sealSubtotal % threshold) : threshold;
  const submitCooldown=Math.max(0,Math.ceil((Number(state.orderCooldownUntil||0)-Date.now())/1000));
  return `<aside class="panel cart-panel">
    <h2 class="panel-title">🛒 รายการที่เลือก (${state.cart.length})</h2>
    <div class="checkout-steps"><span class="done"><b>1</b> เลือกสินค้า</span><span class="${state.cart.length ? 'active' : ''}"><b>2</b> กรอกข้อมูล</span><span><b>3</b> รับเลขออเดอร์</span></div>
    <div class="cart-list">${state.cart.length ? state.cart.map(cartItem).join('') : '<div class="empty">ยังไม่มีสินค้า</div>'}</div>
    <div class="total-box"><span>${pricing.discount>0?`ยอดสินค้า ${money(subtotal)} • ส่วนลด ${money(pricing.discount)}`:`รวมทั้งหมด`}</span><span class="total-price">${money(total)} บาท</span></div>${pricing.messages.length?`<div class="promo">${pricing.messages.map(html).join("<br>")}</div>`:""}
    <div class="promo">${promotionSets > 0 ? `🎁 โปร D2 คิดจากยอดซีลเท่านั้น: ${money(pricing.sealSubtotal)} บาท<br>ได้รับ D2 ${money(promotionSets * (Number(state.settings.promoReward) || 150))} อัน` : `โปร D2 คิดจากยอดซีลเท่านั้น<br>ซื้อซีลเพิ่มอีก ${money(remaining)} บาทเพื่อรับ D2`}</div>
    <div class="customer-fields">
      <input id="tamer" placeholder="ชื่อเทมเมอร์" value="${html(state.customer.tamer)}">
      <div class="security-note">🌐 ให้บริการเฉพาะเซิร์ฟเวอร์ ลิเวียมอน</div>
      <input id="contact" placeholder="ชื่อ Facebook" value="${html(state.customer.contact)}">
      <input class="order-honeypot" id="orderWebsite" name="website" autocomplete="off" tabindex="-1" aria-hidden="true">
      <details class="customer-help"><summary>📖 วิธีส่งรายการให้ร้านทาง Facebook</summary><ol><li>เลือกสินค้าและตรวจจำนวนให้ถูกต้อง</li><li>กรอกชื่อเทมเมอร์และชื่อ Facebook</li><li>กด “คัดลอกรายการเพื่อส่งให้ร้าน”</li><li>เปิด Facebook/Messenger ของร้าน แล้ววางข้อความในแชต</li><li>รอร้านตรวจสอบสต๊อกและยืนยันยอดก่อนโอนเงิน</li></ol></details>
      ${state.recentOrders.length?`<details class="customer-help"><summary>🕘 รายการล่าสุดของฉัน (${state.recentOrders.length})</summary><div class="recent-order-list">${state.recentOrders.map((o,i)=>`<div><span>${html(o.orderId||'ยังไม่มีเลขออเดอร์')} • ${money(o.total)} บาท</span><button class="btn small" data-repeat-order="${i}">ซื้อซ้ำ</button></div>`).join('')}</div></details>`:''}
      <button class="btn success copy-order-primary" id="copyOnlyBtn" ${state.cart.length ? '' : 'disabled'}>📋 คัดลอกรายการเพื่อส่งให้ร้าน</button>
      ${state.copyNotice?`<div class="copy-success" role="status">${html(state.copyNotice)}</div>`:''}
      ${safeExternalUrl(state.settings.facebookUrl)?`<a class="btn facebook-btn" href="${html(safeExternalUrl(state.settings.facebookUrl))}" target="_blank" rel="noopener">💬 เปิด Facebook / Messenger ของร้าน</a>`:''}
      <button class="btn" id="saveOrderBtn" ${state.cart.length && !state.orderSubmitting && !submitCooldown ? '' : 'disabled'}>${state.orderSubmitting ? '⏳ กำลังส่งออเดอร์...' : submitCooldown?`รอ ${submitCooldown} วินาทีก่อนส่งออเดอร์ใหม่`:'ส่งรายการเข้าระบบหลังร้าน'}</button>
      <button class="btn" id="favoriteCartBtn" ${state.cart.length ? '' : 'disabled'}>❤️ บันทึกทั้งหมดเป็นรายการโปรด</button><button class="btn danger" id="clearCartBtn" ${state.cart.length ? '' : 'disabled'}>ล้างรายการ</button>
    </div>
  </aside>`;
}

function addToCart(id, quantity) {
  const product = allProducts().find((entry) => entry.id === id);
  if (!product) return;
  state.copyNotice='';
  quantity = Math.max(1, Math.floor(Number(quantity) || 1));
  const existing = state.cart.find((entry) => entry.id === id);
  const nextQuantity = (existing ? existing.quantity : 0) + quantity;
  const available = availableStock(product);
  if (available !== '' && nextQuantity > available) {
    toast(stockLimitMessage(product));
    return;
  }
  if (existing) existing.quantity = nextQuantity;
  else state.cart.push(cartProductSnapshot(product,quantity));
  render();
}

function cartProductSnapshot(product,quantity){return{id:product.id,name:product.name,price:Number(product.price)||0,unit:saleUnit(product),kind:product.kind,category:product.category||'',section:product.section||'',packSize:Number(product.packSize)||0,quantity};}

function orderText(customer = {}) {
  const pricing = pricingSummary();
  const total = pricing.total;
  const threshold = Number(state.settings.promoThreshold) || 100;
  const promotionSets = Math.floor(pricing.sealSubtotal / threshold);
  const remaining = pricing.sealSubtotal ? threshold - (pricing.sealSubtotal % threshold) : threshold;
  const productByKey=new Map(allProducts().map(p=>[productKey(p),p])),groups={SERVICE:[],ITEM:[],SEAL:[],TMONEY:[]},sealOrder={AT:0,HT:1,CT:2,HP:3,DS:4,DE:5,EV:6,BL:7};
  state.cart.forEach(item=>{const product=productByKey.get(`${item.kind}|${item.id}`)||item;(groups[item.kind]||groups.ITEM).push({...item,...product,quantity:item.quantity,price:item.price});});
  groups.SEAL.sort((a,b)=>(sealOrder[a.category]??99)-(sealOrder[b.category]??99)||String(a.name).localeCompare(String(b.name),'th'));
  const lines=['🛒 รายการสั่งซื้อ DMO'];
  const normalLine=item=>`${item.name} ${money(item.quantity)} ${saleUnit(item)} — ${money(item.price*item.quantity)} บาท`;
  if(groups.SERVICE.length)lines.push('', '⚔️ บริการ',...groups.SERVICE.map(normalLine));
  if(groups.ITEM.length)lines.push('', '🎒 ไอเทม',...groups.ITEM.map(normalLine));
  if(groups.SEAL.length){lines.push('', '🦖 ซีล');let last='';groups.SEAL.forEach(item=>{if(item.category!==last){lines.push('',item.category||'ไม่ระบุสาย');last=item.category;}lines.push(normalLine(item));});}
  if(groups.TMONEY.length)lines.push('', '💰 เงิน T',...groups.TMONEY.map(item=>`${money(item.quantity)}T × ${money(item.price)} บาท — ${money(item.price*item.quantity)} บาท`));
  lines.push('',...(pricing.discount>0?[`ยอดสินค้า ${money(pricing.subtotal)} บาท`,`ส่วนลด ${money(pricing.discount)} บาท`]:[]),`รวมทั้งหมด ${money(total)} บาท`);
  if(pricing.messages.length)lines.push('', 'โปรโมชั่นอื่น:',...pricing.messages);
  lines.push('', '🎁 โปรโมชั่น D2 (คิดเฉพาะซีล)',`ยอดซีลที่ร่วมโปร D2: ${money(pricing.sealSubtotal)} บาท`,promotionSets>0?`ได้รับ D2: ${money(promotionSets*(Number(state.settings.promoReward)||150))} อัน`:`ซื้อซีลเพิ่มอีก ${money(remaining)} บาทเพื่อรับ D2`,'',`ชื่อเทมเมอร์: ${customer.tamer||'__________'}`,`เซิร์ฟเวอร์: ${customer.server||'ลิเวียมอน'}`,`ช่องทางติดต่อ: ${customer.contact||'__________'}`,'',`⚠️ ${state.settings.orderNotice||'รายการนี้ยังไม่ใช่การยืนยันคำสั่งซื้อ กรุณารอร้านตรวจสอบสต๊อกและยืนยันยอดก่อนโอน'}`);
  return lines.join('\n');
}

async function copyText(text,message='คัดลอกข้อความแล้ว') {
  await navigator.clipboard.writeText(text);
  toast(message);
}

function customerValues() {
  return { ...state.customer, server: 'ลิเวียมอน' };
}


function orderSuccessPanel(){
  const o=state.orderSuccess||{};
  return `<section class="panel order-success-card"><div class="check">✅</div><h2>ส่งรายการให้ทางร้านเรียบร้อยแล้ว</h2><div class="order-code">${html(o.orderId||'')}</div><p>ระบบหลังบ้านได้รับรายการของคุณแล้ว ทางร้านจะตรวจสอบสต๊อกและจัดรายการให้<br>ยอดที่ระบบรับไว้: <b>${money(o.total||0)} บาท</b></p><details class="customer-help"><summary>ขั้นตอนต่อไปทำอย่างไร?</summary><ol><li>กดคัดลอกเลขออเดอร์</li><li>เปิด Facebook ของร้านแล้ววางเลขออเดอร์ในแชต</li><li>แจ้งชื่อ Facebook และรอร้านยืนยันรายการ</li><li>ชำระเงินเมื่อร้านยืนยันยอดเท่านั้น</li></ol></details><div class="order-success-actions"><button class="btn success" id="closeOrderSuccessBtn">เลือกสินค้าต่อ</button><button class="btn" id="copyOrderSuccessBtn">📋 คัดลอกเลขออเดอร์</button></div></section>`;
}

// ---------------- Admin ----------------
function adminPage() {
  if (!state.adminToken) return `<section class="panel login-box"><h2 class="panel-title">เข้าสู่ระบบร้าน</h2><p class="product-meta">ข้อมูลหลังบ้านทั้งหมดอยู่ภายในหน้านี้</p><div class="stack"><input id="adminId" placeholder="ไอดี" ${state.loginSubmitting?'disabled':''}><input id="adminPassword" type="password" placeholder="รหัสผ่าน" ${state.loginSubmitting?'disabled':''}><button class="btn primary" id="loginBtn" ${state.loginSubmitting?'disabled':''}>${state.loginSubmitting?'<span class="loading"></span> กำลังตรวจสอบบัญชี...':'เข้าสู่ระบบ'}</button>${state.loginSubmitting?'<div class="product-meta">รับคำขอแล้ว กรุณารอสักครู่ ไม่ต้องกดซ้ำ</div>':''}<button class="btn" id="backShopBtn" ${state.loginSubmitting?'disabled':''}>← กลับหน้าร้าน</button></div></section>`;
  if (!state.adminData) return `<section class="panel empty"><span class="loading"></span> เข้าสู่ระบบสำเร็จ กำลังโหลดข้อมูลหลังร้าน...</section>`;
  const views = [['dashboard', '📊 ภาพรวม'], ['catalog', '📦 สินค้า'], ['images', '🖼️ จัดการรูป'], ['inventory', '🏬 สต๊อก'], ['analytics', '📈 วิเคราะห์'], ['reports', '📤 รายงาน'], ['orders', '🧾 ออเดอร์'], ['marketing', '📣 สร้างโพสต์'], ['facebookBump', '📣 ดันโพสต์ Facebook'], ['customers', '👥 CRM ลูกค้า'], ['promotions', '🎁 โปรโมชั่น'], ['wiki', '📚 DMO Wiki'], ['trash', '🗑️ ถังขยะ'], ['calculator', '🧮 คำนวณ'], ['settings', '⚙️ ตั้งค่า'], ['security', '🛡️ ความปลอดภัย'], ['integrity', '🧪 ตรวจข้อมูล'], ['automation', '🤖 Automation'], ['logs', '🕘 ประวัติ']];
  return `<div class="admin-toolbar"><div class="chip-row">${views.map(([value, label]) => `<button class="filter-chip ${state.adminView === value ? 'active' : ''}" data-admin-view="${value}">${label}</button>`).join('')}</div><div><span class="badge green">${html((state.adminUser&&state.adminUser.role)||'ADMIN')}</span> <button class="btn" id="backShopBtn">หน้าร้าน</button> <button class="btn danger" id="logoutBtn">ออกจากระบบ</button></div></div>${adminContent()}${state.editRecord !== null ? editModal() : ''}${state.wikiGallery ? wikiGalleryModal() : ''}`;
}

function adminContent() {
  if (state.adminView === 'catalog') return adminCatalog();
  if (state.adminView === 'images') return imageManagementPage();
  if (state.adminView === 'inventory') return inventoryPage();
  if (state.adminView === 'calculator') return calculatorPage();
  if (state.adminView === 'analytics') return analyticsPage();
  if (state.adminView === 'reports') return reportsPage();
  if (state.adminView === 'orders') return adminOrders();
  if (state.adminView === 'marketing') return facebookPostGenerator();
  if (state.adminView === 'facebookBump') return facebookBumpPage();
  if (state.adminView === 'customers') return adminCustomers();
  if (state.adminView === 'promotions') return adminPromotions();
  if (state.adminView === 'settings') return adminSettings();
  if (state.adminView === 'security') return adminSecurity();
  if (state.adminView === 'integrity') return integrityPage();
  if (state.adminView === 'automation') return automationPage();
  if (state.adminView === 'wiki') return wikiCenterPage();
  if (state.adminView === 'trash') return adminTrash();
  if (state.adminView === 'logs') return adminLogs();
  return dashboardPage();
}

function facebookBumpDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? html(value) : date.toLocaleString('th-TH');
}

const FACEBOOK_WORKER_URL='http://127.0.0.1:17821';
async function facebookWorkerRequest(path,payload){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),60000);try{const response=await fetch(FACEBOOK_WORKER_URL+path,{method:payload?'POST':'GET',headers:{'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined,signal:controller.signal,targetAddressSpace:'local'});const data=await response.json();if(!data.ok)throw Error(data.error||'LOCAL_WORKER_ERROR');state.facebookBump.connection=data;return data;}catch(error){if(error?.name==='AbortError')throw Error('LOCAL_WORKER_TIMEOUT');throw error;}finally{clearTimeout(timeout);}}
async function refreshFacebookWorker(){try{return await facebookWorkerRequest('/status');}catch(error){state.facebookBump.connection={worker:'OFFLINE',browser:'STOPPED',connection:'OFFLINE',paired:false,running:false,lastError:'ไม่พบ Local Facebook Worker กรุณาเปิด Worker แล้วลองใหม่'};return state.facebookBump.connection;}}
async function recoverFacebookWorkerPair(){
  const current=state.facebookBump.connection||{};
  if(current.worker!=='ONLINE'||current.paired||!state.adminToken)return current;
  try{
    const checked=await facebookWorkerRequest('/connect',{});
    if(checked.connection!=='CONNECTED')return checked;
    return await facebookWorkerRequest('/pair',{apiUrl:cfg.sheetsUrl,token:state.adminToken});
  }catch(error){return state.facebookBump.connection;}
}
function facebookPending(key){return state.facebookBump.pending===key;}
function facebookDisabled(){return state.facebookBump.pending?'disabled':'';}
function facebookFriendlyError(error){const code=String(error?.message||error||'');if(/FAILED_TO_FETCH|NETWORK|OFFLINE/i.test(code))return'ไม่พบ Local Facebook Worker กรุณาเปิด Worker แล้วลองใหม่';if(/LOCAL_WORKER_TIMEOUT/i.test(code))return'Local Facebook Worker ไม่ตอบกลับภายในเวลาที่กำหนด กรุณาตรวจ Worker แล้วลองใหม่';if(/BACKEND_TIMEOUT/i.test(code))return'เชื่อมต่อ BackOffice ใช้เวลานานเกินไป ระบบจะลองใหม่อัตโนมัติ';if(/LOGIN_REQUIRED/i.test(code))return'กรุณา Login Facebook ในหน้าต่าง Worker';return code||'ดำเนินการไม่สำเร็จ กรุณาลองใหม่';}
function facebookWorkingMessage(key){if(/^NOW_/.test(key))return'กำลังส่งงานเข้าคิว กรุณารอสักครู่...';if(/^TOGGLE_|PAUSE_ALL|RESUME_ALL/.test(key))return'กำลังบันทึกสถานะ กรุณารอสักครู่...';if(key==='SAVE_SETTINGS'||key==='SAVE_POST')return'กำลังบันทึก กรุณารอสักครู่...';if(key==='TRIGGER'||key==='TRIGGER_OFF')return'กำลังตั้งค่า Scheduler กรุณารอสักครู่...';return'กำลังดำเนินการ กรุณารอสักครู่...';}
async function facebookWorkerAction(key,path,payload,successMessage){if(state.facebookBump.pending)return null;state.facebookBump.pending=key;render();toast(facebookWorkingMessage(key));try{const result=await facebookWorkerRequest(path,payload);if(successMessage)toast(typeof successMessage==='function'?successMessage(result):successMessage);return result;}catch(error){toast(facebookFriendlyError(error));await refreshFacebookWorker();return null;}finally{state.facebookBump.pending='';render();}}
function facebookConnectionPanel(){const connection=state.facebookBump.connection||{},status=connection.connection||'UNKNOWN',worker=connection.worker||((status==='OFFLINE')?'OFFLINE':'ONLINE'),browser=connection.browser||(status==='DISCONNECTED'||status==='OFFLINE'?'STOPPED':'RUNNING'),connected=status==='CONNECTED',disabled=facebookDisabled(),connectLabel=facebookPending('WORKER_CONNECT')?'กำลังเชื่อมต่อ...':facebookPending('WORKER_PAIR')?'กำลัง Pair BackOffice...':'เชื่อมต่อ Facebook',account=connection.account||{},accountLabel=account.name?html(account.name):account.identifier?'บัญชี Facebook เชื่อมแล้ว':connected?'กำลังตรวจชื่อบัญชี...':'ยังไม่พบบัญชี Facebook';return `<div class="fb-connection"><div><h3>Facebook Connection</h3><div class="chip-row fb-live-status"><span class="badge ${worker==='ONLINE'?'green':'red'}">Worker ${html(worker)}</span><span class="badge ${browser==='RUNNING'?'green':'amber'}">Browser ${html(browser)}</span><span class="badge ${connected?'green':status==='CHECKPOINT'?'red':'amber'}">Facebook ${html(status)}</span><span class="badge ${connection.paired?'green':'amber'}">${connection.paired?'BackOffice PAIRED':'ยังไม่ Pair'}</span>${connection.running?'<span class="badge amber">กำลังประมวลผลคิว</span>':''}</div><div class="fb-account-identity"><b>${accountLabel}</b>${account.identifier?`<span>ID: ${html(account.identifier)}</span>`:''}<span>Profile: ${html(connection.browserProfile||'-')} • Worker PID: ${html(connection.workerPid||'-')}</span><span>ตรวจล่าสุด: ${connection.lastChecked?facebookBumpDate(connection.lastChecked):'-'}</span></div>${connection.lastError?`<div class="error-text">${html(connection.lastError)}</div>`:''}<p class="product-meta">Session อยู่ใน Chrome profile บนเครื่องนี้เท่านั้น ระบบไม่อ่านหรือส่ง cookie/password ไป Google Sheets</p></div><div class="chip-row"><button class="btn primary" id="fbConnectWorkerBtn" ${disabled}>${connectLabel}</button><button class="btn" id="fbTestWorkerBtn" ${disabled}>${facebookPending('WORKER_TEST')?'กำลังทดสอบ...':'ทดสอบการเชื่อมต่อ'}</button><button class="btn" id="fbOpenFacebookBtn" ${disabled}>${facebookPending('WORKER_OPEN')?'กำลังเปิด...':'เปิด Facebook'}</button><button class="btn danger" id="fbDisconnectWorkerBtn" ${disabled}>${facebookPending('WORKER_DISCONNECT')?'กำลังตัดการเชื่อมต่อ...':'ตัดการเชื่อมต่อ'}</button></div></div>`;}

function facebookBumpPage() {
  const data = state.adminData?.facebookBump;
  const role=String(state.adminUser?.role||state.adminData?.security?.actor?.role||'');
  if (!['OWNER','ADMIN'].includes(role)) return `<section class="panel empty"><h2>ไม่มีสิทธิ์ใช้งานโมดูลนี้</h2><p>เฉพาะ OWNER และ ADMIN เท่านั้น</p></section>`;
  if (!data) return `${facebookConnectionPanel()}<section class="panel empty"><span class="loading"></span> ${state.facebookBump.loadError?html(state.facebookBump.loadError):'กำลังโหลด Facebook Module...'}<p>หน้าเมนูพร้อมแล้ว ระบบกำลังอ่าน Posts / Queue / History แยกจากข้อมูลร้าน</p></section>`;
  const manager = state.facebookBump;
  const posts = data.posts || [], queue = data.queue || [], history = data.history || [], settings = data.settings || {};
  const activeQueue = queue.filter((job) => ['PENDING', 'PROCESSING'].includes(String(job.status))).length;
  const tabs = [['POSTS','รายการโพสต์'],['QUEUE','คิว'],['HISTORY','ประวัติ'],['SETTINGS','ตั้งค่า']];
  const queueCounts={PENDING:0,PROCESSING:0,COMPLETED:0};queue.forEach((job)=>{if(Object.prototype.hasOwnProperty.call(queueCounts,String(job.status)))queueCounts[String(job.status)]+=1;});
  const disabled=facebookDisabled();
  return `<section class="panel facebook-bump-module">
    ${facebookConnectionPanel()}
    <div class="admin-toolbar"><div><h2 class="panel-title">📣 ดันโพสต์ Facebook</h2><p class="product-meta">จัดคิวหลายโพสต์ทีละงาน แยกจากระบบร้าน</p></div><div class="chip-row"><span class="badge ${data.mode==='REAL'?'red':'amber'}">${data.mode==='REAL'?'REAL FACEBOOK':'DRY RUN'}</span><span class="badge">${data.triggerActive?'Scheduler พร้อม':'ยังไม่ติดตั้ง Scheduler'}</span></div></div>
    <div class="security-note"><b>ค่าเริ่มต้นปลอดภัยเป็น DRY RUN</b> • REAL FACEBOOK ใช้ Local Worker และ Chrome profile บนเครื่องเท่านั้น เมื่อ Facebook ขอ Login/2FA/CAPTCHA/checkpoint ระบบจะหยุดให้ผู้ใช้ดำเนินการเอง</div>
    <div class="metrics fb-metrics"><div class="metric">โพสต์ทั้งหมด<b>${posts.length}</b></div><div class="metric ready">เปิดใช้งาน<b>${posts.filter((post)=>String(post.enabled).toUpperCase()==='TRUE').length}</b></div><div class="metric warning">งานในคิว<b>${activeQueue}</b></div><div class="metric ${settings.paused?'danger':'sales'}">สถานะรวม<b>${settings.paused?'พักทั้งหมด':'ทำงาน'}</b></div></div>
    <div class="fb-queue-status"><span class="badge amber">PENDING ${queueCounts.PENDING}</span><span class="badge amber">PROCESSING ${queueCounts.PROCESSING}</span><span class="badge green">COMPLETED ${queueCounts.COMPLETED}</span></div>
    <div class="admin-toolbar"><div class="chip-row">${tabs.map(([value,label])=>`<button class="filter-chip ${manager.tab===value?'active':''}" data-fb-tab="${value}" ${disabled}>${label}</button>`).join('')}</div><div class="chip-row"><button class="btn warning" id="fbPauseAllBtn" ${settings.paused||state.facebookBump.pending?'disabled':''}>${facebookPending('PAUSE_ALL')?'กำลังพัก...':'พักทั้งหมด'}</button><button class="btn success" id="fbResumeAllBtn" ${!settings.paused||state.facebookBump.pending?'disabled':''}>${facebookPending('RESUME_ALL')?'กำลังเปิด...':'ทำงานต่อทั้งหมด'}</button><button class="btn" id="fbEnsureTriggerBtn" data-trigger-active="${data.triggerActive?'TRUE':'FALSE'}" ${disabled}>${facebookPending('TRIGGER')?'กำลังเปิด Scheduler...':facebookPending('TRIGGER_OFF')?'กำลังปิด Scheduler...':data.triggerActive?'ปิด Scheduler':'เปิด Scheduler'}</button></div></div>
    ${manager.tab==='QUEUE'?facebookBumpQueueView(queue):manager.tab==='HISTORY'?facebookBumpHistoryView(history):manager.tab==='SETTINGS'?facebookBumpSettingsView(settings):facebookBumpPostsView(posts,settings)}
  </section>`;
}

function facebookBumpPostsView(posts, settings) {
  const manager=state.facebookBump,edit=manager.edit||{name:'',postUrl:'',bumpMessage:settings.defaultMessage||'+',intervalMinutes:settings.defaultInterval||60,enabled:false};
  return `<div class="fb-layout"><form class="fb-editor" id="fbPostForm"><h3>${edit.id?'แก้ไขโพสต์':'เพิ่ม Facebook Post URL'}</h3>
    <label>ชื่อโพสต์<input id="fbPostName" maxlength="120" value="${html(edit.name||'')}" placeholder="เช่น โพสต์ขายซีลหลัก"></label>
    <label>Facebook Post URL<input id="fbPostUrl" type="url" value="${html(edit.postUrl||'')}" placeholder="https://www.facebook.com/..."></label>
    <div class="form-grid"><label>ข้อความดัน<input id="fbPostMessage" maxlength="500" value="${html(edit.bumpMessage||'+')}"></label><label>รอบ (นาที)<input id="fbPostInterval" type="number" min="5" max="10080" step="1" value="${html(edit.intervalMinutes||60)}"></label></div>
    <label class="toggle-row"><input id="fbPostEnabled" type="checkbox" ${String(edit.enabled).toUpperCase()==='TRUE'||edit.enabled===true?'checked':''}> เปิดใช้งานหลังบันทึก</label>
    <div class="chip-row"><button class="btn primary" id="fbSavePostBtn" type="submit" ${manager.pending?'disabled':''}>${manager.pending==='SAVE_POST'?'กำลังบันทึก...':'บันทึกโพสต์'}</button>${edit.id?'<button class="btn" id="fbCancelEditBtn" type="button">ยกเลิกแก้ไข</button>':''}</div>
    <p class="product-meta">ขั้นตอน: URL → Save → Enable • ค่าเริ่มต้นข้อความ + และรอบ 60 นาที</p></form>
    <div class="fb-post-list"><h3>รายการโพสต์</h3>${posts.length?posts.map((post)=>`<article class="fb-post-card"><div><div class="chip-row"><b>${html(post.name)}</b><span class="badge ${String(post.enabled).toUpperCase()==='TRUE'?'green':'amber'}">${String(post.enabled).toUpperCase()==='TRUE'?'ENABLED':'PAUSED'}</span><span class="badge">${html(post.lastStatus||'READY')}</span></div><a href="${html(post.postUrl)}" target="_blank" rel="noopener">${html(post.postUrl)}</a><div class="product-meta">ข้อความ: ${html(post.bumpMessage||'+')} • ทุก ${money(post.intervalMinutes||60)} นาที</div><div class="product-meta">ล่าสุด ${facebookBumpDate(post.lastRunAt)} • รอบถัดไป ${facebookBumpDate(post.nextRunAt)}</div></div><div class="chip-row"><button class="btn primary small" data-fb-now="${html(post.id)}" ${facebookDisabled()}>${facebookPending('NOW_'+post.id)?'กำลังส่งงาน...':'ดันตอนนี้'}</button><button class="btn small" data-fb-toggle="${html(post.id)}|${String(post.enabled).toUpperCase()==='TRUE'?'FALSE':'TRUE'}" ${facebookDisabled()}>${facebookPending('TOGGLE_'+post.id)?'กำลังบันทึก...':String(post.enabled).toUpperCase()==='TRUE'?'Pause':'Resume'}</button><button class="btn small" data-fb-edit="${html(post.id)}" ${facebookDisabled()}>Edit</button><button class="btn danger small" data-fb-delete="${html(post.id)}" ${facebookDisabled()}>${facebookPending('DELETE_'+post.id)?'กำลังลบ...':'Delete'}</button></div></article>`).join(''):'<div class="empty">ยังไม่มีโพสต์ เริ่มจากวาง URL ด้านซ้าย</div>'}</div></div>`;
}

function facebookBumpQueueView(queue) {
  return `<div class="fb-table"><div class="fb-table-head"><b>Post</b><b>กำหนดเวลา</b><b>Status</b><b>Attempts</b><b>จัดการ</b></div>${queue.length?queue.map((job)=>`<div class="fb-table-row"><div><b>${html(job.postName||job.targetPostId)}</b><small>${html(job.message||'')}</small></div><span>${facebookBumpDate(job.scheduledAt)}</span><span class="badge ${job.status==='COMPLETED'?'green':job.status==='FAILED'?'red':'amber'}">${html(job.status)}</span><span>${money(job.attempts||0)}${job.error?`<small>${html(job.error)}</small>`:''}</span><div>${job.status==='PENDING'?`<button class="btn danger small" data-fb-cancel-job="${html(job.jobId)}" ${facebookDisabled()}>${facebookPending('CANCEL_'+job.jobId)?'กำลังยกเลิก...':'Cancel'}</button>`:job.status==='FAILED'?`<button class="btn warning small" data-fb-retry-job="${html(job.jobId)}" ${facebookDisabled()}>${facebookPending('RETRY_'+job.jobId)?'กำลังส่งกลับคิว...':'Retry'}</button>`:'-'}</div></div>`).join(''):'<div class="empty">คิวยังว่าง</div>'}</div>`;
}

function facebookBumpHistoryView(history) {
  return `<div class="fb-history">${history.length?history.map((item)=>`<article class="fb-history-row"><div><b>${html(item.postName||item.targetPostId)}</b><div class="product-meta">${facebookBumpDate(item.createdAt)} • ${html(item.action||'BUMP')}</div></div><div><span class="badge ${item.result==='COMPLETED'?'green':'red'}">${html(item.result||'-')}</span><div class="product-meta">Comment: ${html(item.commentId||'-')}</div><div class="product-meta">Cleanup: ${html(item.cleanupResult||'-')}</div>${item.error?`<div class="error-text">${html(item.error)}</div>`:''}</div></article>`).join(''):'<div class="empty">ยังไม่มีประวัติ Dry Run</div>'}</div>`;
}

function facebookBumpSettingsView(settings) {
  const real=settings.mode==='REAL';
  return `<div class="fb-settings"><h3>ตั้งค่า Facebook Bump</h3><div class="form-grid"><label>Mode<select id="fbMode"><option value="DRY_RUN" ${real?'':'selected'}>DRY RUN</option><option value="REAL" ${real?'selected':''}>REAL FACEBOOK</option></select></label><label>Default Bump Interval (นาที)<input id="fbDefaultInterval" type="number" min="5" max="10080" value="${html(settings.defaultInterval||60)}"></label><label>Default Bump Message<input id="fbDefaultMessage" maxlength="500" value="${html(settings.defaultMessage||'+')}"></label><label>Delay Between Jobs (วินาที)<input id="fbDelaySeconds" type="number" min="0" max="3600" value="${html(settings.delaySeconds||0)}"></label><label class="toggle-row"><input id="fbCleanupOld" type="checkbox" ${settings.cleanupOld?'checked':''}> จัดการ Comment ดันเก่าของระบบ หลัง Comment ใหม่สำเร็จ</label></div><div class="security-note">ค่าเริ่มต้นคือ <b>DRY RUN</b> • REAL FACEBOOK เปิดได้โดย OWNER หลัง Local Worker เชื่อมต่อแล้วเท่านั้น • ถ้ายืนยัน ownership ของ Comment เก่าไม่ได้ ระบบจะไม่ลบ</div><button class="btn success" id="fbSaveSettingsBtn" ${state.facebookBump.pending?'disabled':''}>${state.facebookBump.pending==='SAVE_SETTINGS'?'กำลังบันทึก...':'บันทึกการตั้งค่า'}</button></div>`;
}

function dashboardPage() {
  const all = [...(state.adminData?.seals || []), ...(state.adminData?.gameItems || []), ...(state.adminData?.services || []), ...(state.adminData?.moneyT ? [state.adminData.moneyT] : [])];
  const active = all.filter((x) => x.status === 'ACTIVE').length;
  const check = all.filter((x) => x.status === 'CHECK_STOCK').length;
  const out = all.filter((x) => x.status === 'OUT_OF_STOCK' || (x.stock !== '' && Number(x.stock) <= 0)).length;
  const newOrders = (state.adminData?.orders || []).filter((x) => x.status === 'NEW').length;
  const customerCount = (state.adminData?.customers || []).length;
  const activePromos = (state.adminData?.promotions || []).filter((x) => x.status === 'ACTIVE').length;
  const stocked = all.filter((x) => availableStock(x) !== '' && availableStock(x) > 0).length;
  const lowStock = all.filter((x) => availableStock(x) !== '' && availableStock(x) > 0 && Number(x.lowStockAlert || 0) > 0 && availableStock(x) <= Number(x.lowStockAlert || 0)).length;
  const orders = state.adminData?.orders || [];
  const preparingOrders = orders.filter((x) => ['CHECKING', 'PREPARING'].includes(String(x.status))).length;
  const readyOrders = orders.filter((x) => x.status === 'READY').length;
  const completedOrders = orders.filter((x) => x.status === 'COMPLETED');
  const salesTotal = completedOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const repeatCustomers = (state.adminData?.customers || []).filter((x) => Number(x.orderCount || 0) >= 2).length;
  const categoryCounts = ['AT', 'HT', 'CT', 'HP', 'DS', 'DE', 'EV', 'BL'].map((category) => [category, (state.adminData?.seals || []).filter((x) => x.category === category).length]);
  const max = Math.max(1, ...categoryCounts.map(([, count]) => count));
  return `<section class="panel"><div class="admin-toolbar"><div><h2 class="panel-title">ภาพรวมร้านวันนี้</h2><p class="product-meta">ออเดอร์ งานจัดของ ยอดขาย และสิ่งที่ต้องจัดการในหน้าเดียว</p></div><button class="btn primary" data-admin-view="orders">เปิดศูนย์ออเดอร์</button></div><div class="metrics commerce-metrics"><div class="metric urgent">ออเดอร์ใหม่<b>${newOrders}</b><small>รอตรวจสอบ</small></div><div class="metric">กำลังจัดการ<b>${preparingOrders}</b><small>ตรวจและจัดของ</small></div><div class="metric ready">พร้อมส่ง<b>${readyOrders}</b><small>รอส่งลูกค้า</small></div><div class="metric sales">ยอดขายสำเร็จ<b>${money(salesTotal)} บาท</b><small>${completedOrders.length} ออเดอร์</small></div><div class="metric warning">สินค้าใกล้หมด<b>${lowStock}</b><small>ควรเติมสต๊อก</small></div><div class="metric danger">สินค้าหมด/ต้องเช็ก<b>${check + out}</b><small>ต้องตรวจสอบ</small></div><div class="metric">ลูกค้าซื้อซ้ำ<b>${repeatCustomers}</b><small>จาก ${customerCount} คน</small></div><div class="metric">โปรที่เปิดใช้<b>${activePromos}</b><small>กำลังทำงาน</small></div></div><div class="dashboard-sections"><div><h3>สรุปสินค้า</h3><div class="category-bars">${categoryCounts.map(([category, count]) => `<div class="bar-row"><b>${category}</b><div class="bar-track"><div class="bar-fill" style="width:${(count / max) * 100}%"></div></div><span>${count}</span></div>`).join('')}</div></div><div class="attention-card"><h3>สิ่งที่ควรทำก่อน</h3><ol><li>ตรวจออเดอร์ใหม่ ${newOrders} รายการ</li><li>จัดออเดอร์ที่กำลังดำเนินการ ${preparingOrders} รายการ</li><li>ส่งมอบออเดอร์พร้อมส่ง ${readyOrders} รายการ</li><li>ตรวจสินค้าสต๊อกต่ำ/หมด ${lowStock + check + out} รายการ</li></ol></div></div></section>`;
}

function calculatorPage() {
  return `<div class="calculator-grid"><section class="panel"><h2 class="panel-title">คำนวณแบบพิมพ์รายการ</h2><p class="product-meta">เครื่องมือนี้อยู่เฉพาะหลังร้าน ลูกค้าจะไม่เห็น</p><textarea id="calcInput" placeholder="จูเรย์มอน 3\nทาเนมอน 3"></textarea><div class="stack" style="margin-top:10px"><button class="btn primary" id="calcBtn">คำนวณ</button><button class="btn success" id="calcAddBtn">เพิ่มรายการที่หาเจอลงตะกร้า</button></div></section><section class="panel"><h2 class="panel-title">ผลลัพธ์</h2><div id="calcResult" class="result-box">ยังไม่ได้คำนวณ</div></section></div>`;
}

function parseCalculator(text) {
  const found = [], missing = [];
  String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const match = line.match(/^(.*?)(?:\s+x?\s*)(\d+(?:\.\d+)?)\s*(?:ชุด|ใบ|ชิ้น|ครั้ง|T)?$/i);
    const name = match ? match[1].trim() : line;
    const quantity = match ? Number(match[2]) : 1;
    const search = norm(name);
    const ranked = allProducts().map((product) => ({ product, score: smartSearchScore(product, name) })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const second = ranked[1];
    if (best && best.score >= 55 && (!second || best.score - second.score >= 8)) found.push({ p: best.product, qty: quantity });
    else missing.push(line);
  });
  return { found, missing };
}

function calcText(parsed) {
  const total = parsed.found.reduce((sum, entry) => sum + Number(entry.p.price) * entry.qty, 0);
  const lines = parsed.found.map((entry) => `${entry.p.name} ${money(entry.qty)} ${saleUnit(entry.p)} × ${formatProductPrice(entry.p)} — ${money(entry.p.price * entry.qty)} บาท`);
  if (parsed.missing.length) lines.push('', 'ไม่พบ/ชื่อซ้ำ:', ...parsed.missing.map((line) => `• ${line}`));
  lines.push('', `รวม ${money(total)} บาท`);
  return lines.join('\n');
}


function inventoryPage() {
  const products = [...(state.adminData.seals || []), ...(state.adminData.gameItems || []), ...(state.adminData.moneyT ? [state.adminData.moneyT] : [])];
  const role=String(state.adminData?.security?.actor?.role||state.adminUser?.role||'VIEWER').toUpperCase(),canEdit=['OWNER','ADMIN'].includes(role);
  const query = norm(state.inventorySearch);
  const filtered = products.filter((product) => {
    if (query && ![product.name, ...(product.aliases || [])].some((value) => norm(value).includes(query))) return false;
    const available = availableStock(product);
    if (state.inventoryFilter === 'LOW') return available !== '' && available > 0 && Number(product.lowStockAlert || 0) > 0 && available <= Number(product.lowStockAlert || 0);
    if (state.inventoryFilter === 'OUT') return product.status === 'OUT_OF_STOCK' || (available !== '' && available <= 0);
    if (state.inventoryFilter === 'CHECK') return product.stock === '' || product.status === 'CHECK_STOCK';
    if (state.inventoryFilter === 'STOCKED') return available !== '' && available > 0;
    return true;
  }).sort((a, b) => {
    const av = availableStock(a), bv = availableStock(b);
    if(state.inventorySort==='STOCK_ASC')return (av===''?Number.MAX_SAFE_INTEGER:Number(av))-(bv===''?Number.MAX_SAFE_INTEGER:Number(bv))||String(a.name).localeCompare(String(b.name),'th');
    if(state.inventorySort==='STOCK_DESC')return (bv===''?-1:Number(bv))-(av===''?-1:Number(av))||String(a.name).localeCompare(String(b.name),'th');
    if(state.inventorySort==='UPDATED')return new Date(b.updatedAt||0)-new Date(a.updatedAt||0)||String(a.name).localeCompare(String(b.name),'th');
    const aRank = av === '' ? 2 : av <= 0 ? 0 : Number(a.lowStockAlert || 0) > 0 && av <= Number(a.lowStockAlert || 0) ? 1 : 3;
    const bRank = bv === '' ? 2 : bv <= 0 ? 0 : Number(b.lowStockAlert || 0) > 0 && bv <= Number(b.lowStockAlert || 0) ? 1 : 3;
    return state.inventorySort==='NAME'?String(a.name).localeCompare(String(b.name),'th'):aRank-bRank||String(a.name).localeCompare(String(b.name),'th');
  });
  const logs = state.adminData.stockLogs || [];
  const busy=!!state.stockActionPending,lastUpdated=state.adminData.stockUpdatedAt||'';
  return `<div class="inventory-layout">
    <section class="panel">
      <div class="admin-toolbar"><div><h2 class="panel-title">จัดการสต๊อก (${products.length})</h2><p class="product-meta">Google Sheet เป็นข้อมูลหลัก • อัปเดตล่าสุด: ${lastUpdated?html(new Date(lastUpdated).toLocaleString('th-TH')):'-'}</p></div><div class="chip-row"><button class="btn" id="syncStockBtn" ${busy?'disabled':''}>${state.stockActionPending==='SYNC'?'<span class="loading"></span> กำลังซิงก์...':'🔄 ซิงก์จาก Google Sheet'}</button><button class="btn" id="reloadInventoryBtn" ${busy?'disabled':''}>โหลดใหม่</button></div></div>
      ${canEdit?`<div class="stock-add-form"><label>สินค้า<select id="stockAddProduct"><option value="">เลือกสินค้า</option>${products.map(p=>`<option value="${html(p.kind+'|'+p.id)}" ${state.stockAddDraft.product===p.kind+'|'+p.id?'selected':''}>${html(p.name)} (${p.stock===''?'-':money(p.stock)})</option>`).join('')}</select></label><label>จำนวนที่เพิ่ม<input id="stockAddAmount" type="number" min="1" step="1" placeholder="เช่น 500" value="${html(state.stockAddDraft.amount)}"></label><label>เหตุผล<input id="stockAddReason" value="${html(state.stockAddDraft.reason)}" maxlength="250"></label><button class="btn success" id="stockAddBtn" ${busy?'disabled':''}>${state.stockActionPending==='ADD_FORM'?'<span class="loading"></span> กำลังอัปเดต...':state.stockConfirmFingerprint?'ยืนยันเพิ่ม Stock':'เพิ่ม Stock'}</button></div>`:`<div class="security-note">บัญชี ${html(role)} ดู Stock ได้อย่างเดียว เฉพาะ OWNER/ADMIN เท่านั้นที่แก้ไขได้</div>`}
      ${state.stockActionResult?`<div class="security-note stock-result"><b>${html(state.stockActionResult.message)}</b><br>${html(state.stockActionResult.detail||'')}</div>`:''}
      <div class="inventory-filters"><input id="inventorySearch" placeholder="ค้นหาชื่อสินค้า..." value="${html(state.inventorySearch)}"><select id="inventorySort"><option value="NAME" ${state.inventorySort==='NAME'?'selected':''}>เรียงตามชื่อ</option><option value="STOCK_ASC" ${state.inventorySort==='STOCK_ASC'?'selected':''}>จำนวนน้อย → มาก</option><option value="STOCK_DESC" ${state.inventorySort==='STOCK_DESC'?'selected':''}>จำนวนมาก → น้อย</option><option value="UPDATED" ${state.inventorySort==='UPDATED'?'selected':''}>อัปเดตล่าสุด</option></select><div class="chip-row">${[['ALL','ทั้งหมด'],['STOCKED','มีสต๊อก'],['LOW','ใกล้หมด'],['OUT','หมด'],['CHECK','ต้องเช็ก']].map(([value,label])=>`<button class="filter-chip ${state.inventoryFilter===value?'active':''}" data-inventory-filter="${value}">${label}</button>`).join('')}</div></div>
      <div class="inventory-list">${filtered.length ? filtered.map(inventoryRow).join('') : '<div class="empty">ไม่พบสินค้า</div>'}</div>
    </section>
    <section class="panel"><h2 class="panel-title">ประวัติสต๊อกล่าสุด</h2><div class="stock-log-list">${logs.length ? logs.slice(0,120).map((log)=>`<div class="stock-log"><div><b>${html(log.productName || log.productId)}</b><div class="product-meta">${html(log.createdAt)} • ${html(log.action)} • ${html(log.reason || '-')}</div></div><div class="stock-change ${Number(log.changeQty)>=0?'plus':'minus'}">${Number(log.changeQty)>0?'+':''}${money(log.changeQty)}</div><div class="product-meta">${money(log.beforeStock)} → ${money(log.afterStock)}</div></div>`).join('') : '<div class="empty">ยังไม่มีประวัติสต๊อก</div>'}</div></section>
  </div>`;
}

function inventoryRow(product) {
  const available = availableStock(product);
  const low = available !== '' && available > 0 && Number(product.lowStockAlert || 0) > 0 && available <= Number(product.lowStockAlert || 0);
  const stateClass = available === '' ? 'check' : available <= 0 ? 'out' : low ? 'low' : 'ok';
  const busy=!!state.stockActionPending;
  return `<article class="inventory-row ${stateClass}">
    <div class="inventory-info"><b>${html(product.name)}</b><div class="product-meta">${product.kind === 'SEAL' ? `${html(product.category)} • ${sectionLabel(product.section)}` : html(product.itemCategory || 'ไอเทม')} • ${html(product.unit || '')}</div></div>
    <div class="inventory-kpis"><span>ทั้งหมด<b>${product.stock === '' ? '-' : money(product.stock)}</b></span><span>กันไว้<b>${money(product.reservedStock || 0)}</b></span><span>ขายได้<b>${available === '' ? '-' : money(available)}</b></span><span>เตือนที่<b>${money(product.lowStockAlert || 0)}</b></span></div>
    <div class="inventory-actions"><button class="btn small" data-stock-adjust="${html(product.kind)}|${html(product.id)}|-100" ${busy?'disabled':''}>-100</button><button class="btn small" data-stock-adjust="${html(product.kind)}|${html(product.id)}|-10" ${busy?'disabled':''}>-10</button><button class="btn small" data-stock-adjust="${html(product.kind)}|${html(product.id)}|-1" ${busy?'disabled':''}>-1</button><button class="btn success small" data-stock-adjust="${html(product.kind)}|${html(product.id)}|1" ${busy?'disabled':''}>+1</button><button class="btn success small" data-stock-adjust="${html(product.kind)}|${html(product.id)}|10" ${busy?'disabled':''}>+10</button><button class="btn success small" data-stock-adjust="${html(product.kind)}|${html(product.id)}|100" ${busy?'disabled':''}>+100</button><button class="btn primary small" data-stock-set="${html(product.kind)}|${html(product.id)}" ${busy?'disabled':''}>กำหนด</button></div>
  </article>`;
}

function adminCatalog() {
  const query = norm(state.adminCatalogSearch);
  const all = [...(state.adminData.seals || []), ...(state.adminData.gameItems || []), ...(state.adminData.services || []), ...(state.adminData.moneyT ? [state.adminData.moneyT] : [])]
    .filter((p) => state.adminKindFilter === 'ALL' || p.kind === state.adminKindFilter)
    .filter((p) => !query || [p.name, p.category, p.section, p.itemCategory, p.serviceCategory, ...(p.aliases || [])].map(norm).some((x) => x.includes(query)))
    .sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || (Number(a.sortOrder) || 9999) - (Number(b.sortOrder) || 9999));
  const selectedCount = state.adminSelected.length;
  return `<section class="panel">
    <div class="admin-toolbar"><div><h2 class="panel-title">Admin 2.0 — จัดการสินค้า (${all.length})</h2><p class="product-meta">ค้นหา เลือกหลายรายการ แก้พร้อมกัน และลบลงถังขยะโดยกู้คืนได้</p></div><div class="chip-row"><button class="btn primary" data-new="SEAL">+ ซีล</button><button class="btn primary" data-new="ITEM">+ ไอเทม</button><button class="btn primary" data-new="SERVICE">+ บริการ</button></div></div>
    <div class="admin-catalog-tools"><input id="adminCatalogSearch" placeholder="ค้นหาชื่อ หมวด Alias..." value="${html(state.adminCatalogSearch)}"><div class="chip-row">${[['ALL','ทั้งหมด'],['SEAL','ซีล'],['ITEM','ไอเทม'],['SERVICE','บริการ'],['TMONEY','เงิน T']].map(([v,l])=>`<button class="filter-chip ${state.adminKindFilter===v?'active':''}" data-admin-kind="${v}">${l}</button>`).join('')}</div></div>
    <div class="bulk-bar"><label class="select-all"><input id="selectAllProducts" type="checkbox" ${all.length&&all.every((p)=>state.adminSelected.includes(`${p.kind}|${p.id}`))?'checked':''}> เลือกทั้งหมด</label><b>เลือก ${selectedCount} รายการ</b><select id="bulkField"><option value="status">สถานะ</option><option value="price">ราคา</option><option value="category">สายซีล</option><option value="section">ประเภทซีล</option><option value="unit">หน่วย</option><option value="lowStockAlert">จุดแจ้งเตือน</option></select><input id="bulkValue" placeholder="ค่าที่ต้องการ"><button class="btn success" id="bulkApplyBtn" ${selectedCount?'':'disabled'}>ใช้กับที่เลือก</button><button class="btn danger" id="bulkTrashBtn" ${selectedCount?'':'disabled'}>ย้ายลงถังขยะ</button></div>
    <div class="admin-list" id="adminList">${all.length ? all.map(adminProduct).join('') : '<div class="empty">ไม่พบสินค้า</div>'}</div>
  </section>`;
}

function adminProduct(product) {
  const categoryLabel = product.kind === 'SEAL' ? `${product.category} • ${sectionLabel(product.section)}` : product.kind === 'SERVICE' ? product.serviceCategory : product.kind === 'TMONEY' ? 'Rate และ Stock' : product.itemCategory;
  const kindLabel = product.kind === 'SEAL' ? 'ซีล' : product.kind === 'SERVICE' ? 'บริการ' : product.kind === 'TMONEY' ? 'เงิน T' : 'ไอเทม';
  const key = `${product.kind}|${product.id}`;
  return `<div class="admin-card ${state.adminSelected.includes(key)?'selected':''}" data-admin-name="${html(norm(product.name))}"><label class="row-check"><input type="checkbox" data-select-product="${html(key)}" ${state.adminSelected.includes(key)?'checked':''}></label><div class="admin-thumb"><span>${productFallbackIcon(product)}</span>${product.imageUrl ? `<img loading="lazy" decoding="async" fetchpriority="low" src="${html(product.imageUrl)}" alt="" onerror="this.hidden=true">` : ''}</div><div><b>${html(product.name)}</b><div class="product-meta"><span class="badge">${kindLabel}</span><span class="badge">${html(categoryLabel || '')}</span><span class="badge ${product.status === 'ACTIVE' ? 'green' : product.status === 'CHECK_STOCK' ? 'amber' : 'red'}">${html(product.status || 'ACTIVE')}</span> ${formatProductPrice(product)}</div><div class="product-meta">${stockText(product)}</div></div><div><button class="btn small" data-edit="${html(product.kind)}|${html(product.id)}">แก้ไข</button> <button class="btn danger small" data-delete="${html(product.kind)}|${html(product.id)}" ${product.kind==='TMONEY'?'disabled title="เงิน T เป็นสินค้าระบบหนึ่งรายการ"':''}>ถังขยะ</button></div></div>`;
}

function imageManagementPage(){
  const manager=state.imageManager,preview=manager.preview,summary=preview&&preview.summary;
  const matchRows=preview?(preview.matches||[]):[],conflictRows=preview?(preview.conflicts||[]):[],unmatched=preview?(preview.unmatched||[]):[];
  return `<section class="panel image-manager">
    <div class="admin-toolbar"><div><h2 class="panel-title">🖼️ Image Management</h2><p class="product-meta">นำเข้า ZIP รูป Seal / Item / Service โดยจับคู่ Product ID ก่อน แล้วจึงชื่อหรือ Alias</p></div><button class="btn" id="downloadMissingImagesBtn" ${preview&&preview.missingProducts&&preview.missingProducts.length?'':'disabled'}>📄 Missing Image Report</button></div>
    ${manager.lastResult?`<div class="notice success"><b>Apply สำเร็จ ${manager.lastResult.applied} รายการ</b><span>Backup mapping: ${html(manager.lastResult.backupFileName||'-')} • ข้ามรูปเดิม ${manager.lastResult.skippedExisting||0}</span></div>`:''}
    <div class="image-import-guide"><b>ตั้งชื่อไฟล์ที่แนะนำ</b><span><code>Product-ID.png</code> แม่นยำที่สุด หรือใช้ชื่อ/Alias ที่ตรงกันทุกตัว</span><small>รองรับ PNG, JPG, WEBP, GIF • ZIP ไม่เกิน 8 MB • รูปละไม่เกิน 2 MB • ไม่เก็บ binary ลง Google Sheet</small></div>
    <div class="image-upload-row"><label class="file-drop">เลือก ZIP รูป<input id="imageZipInput" type="file" accept=".zip,application/zip" ${manager.applying?'disabled':''}></label><div><b>${html(manager.fileName||'ยังไม่ได้เลือกไฟล์')}</b><div class="product-meta">${manager.zipData?'พร้อมตรวจสอบการจับคู่':'ระบบจะ Preview mapping ก่อน Apply เสมอ'}</div></div><button class="btn primary" id="previewImageZipBtn" ${manager.zipData&&!manager.applying?'':'disabled'}>${manager.applying?'<span class="loading"></span> กำลังทำงาน...':'ตรวจสอบและ Preview'}</button></div>
    ${summary?`<div class="image-summary"><div class="metric ready">Match<b>${summary.match}</b></div><div class="metric warning">ไฟล์ไม่ตรง<b>${summary.missingFile}</b></div><div class="metric danger">Conflict<b>${summary.conflict}</b></div><div class="metric">สินค้ายังไม่มีรูป<b>${summary.missingProductImage}</b></div><div class="metric warning">มีรูปเดิม<b>${summary.overwrite}</b></div></div>
      ${conflictRows.length?`<div class="notice danger"><b>ยัง Apply ไม่ได้: พบ Conflict</b><span>แก้ชื่อไฟล์ให้เป็น Product ID ที่ไม่ซ้ำ แล้ว Preview ใหม่</span></div>`:''}
      <div class="image-preview-grid"><div><h3>รายการจับคู่ (${matchRows.length})</h3><div class="image-map-list">${matchRows.length?matchRows.slice(0,250).map(item=>`<div class="image-map-row"><span class="badge green">MATCH</span><b>${html(item.fileName)}</b><span>→ ${html(item.kind)} / ${html(item.id)} / ${html(item.name)}</span><small>${item.matchBy==='PRODUCT_ID'?'Product ID':'ชื่อ/Alias'}${item.overwriteRequired?' • มีรูปเดิม':''}</small></div>`).join(''):'<div class="empty">ไม่มีไฟล์ที่จับคู่ได้</div>'}</div></div><div><h3>ต้องตรวจสอบ (${unmatched.length+conflictRows.length})</h3><div class="image-map-list">${unmatched.map(item=>`<div class="image-map-row"><span class="badge amber">MISSING</span><b>${html(item.fileName)}</b><span>ไม่พบ Product ID/ชื่อ/Alias ที่ตรงกัน</span></div>`).join('')}${conflictRows.map(item=>`<div class="image-map-row"><span class="badge red">CONFLICT</span><b>${html(item.fileName)}</b><span>${html(item.reason||'ตรงกับสินค้ามากกว่า 1 รายการ')}</span></div>`).join('')||'<div class="empty">ไม่พบปัญหา</div>'}</div></div></div>
      <label class="overwrite-confirm"><input id="allowImageOverwrite" type="checkbox" ${manager.allowOverwrite?'checked':''}> อนุญาตเขียนทับรูปเดิม (${summary.overwrite} รายการ) — ระบบจะถามยืนยันอีกครั้ง</label>
      <button class="btn success image-apply" id="applyImageZipBtn" ${matchRows.length&&!conflictRows.length&&!manager.applying?'':'disabled'}>${manager.applying?'<span class="loading"></span> กำลัง Backup และ Apply...':'Backup mapping แล้ว Apply รูปที่ Match'}</button>`:''}
  </section>`;
}

function parseDateValue(value) {
  const d = new Date(value || '');
  return Number.isNaN(d.getTime()) ? null : d;
}
function reportStartDate(range = state.reportRange) {
  if (range === 'ALL') return null;
  const days = Math.max(1, Number(range) || 30);
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days + 1);
  return d;
}
function reportOrders(range = state.reportRange) {
  const start = reportStartDate(range);
  return (state.adminData?.orders || []).filter((order) => {
    const d = parseDateValue(order.createdAt);
    return !start || (d && d >= start);
  });
}
function orderItems(order) {
  try { return Array.isArray(order.itemsJson) ? order.itemsJson : JSON.parse(order.itemsJson || '[]'); }
  catch (_) { return []; }
}
function reportProductMap() {
  const map = new Map();
  [...(state.adminData?.seals || []), ...(state.adminData?.gameItems || []), ...(state.adminData?.services || []), ...(state.adminData?.moneyT ? [state.adminData.moneyT] : [])]
    .forEach((product) => map.set(`${product.kind}|${product.id}`, product));
  return map;
}
function analyticsDataset() {
  const orders = reportOrders();
  const valid = orders.filter((o) => !['CANCELLED'].includes(String(o.status || '')));
  const paid = valid.filter((o) => String(o.status || '') === 'COMPLETED');
  const products = [...(state.adminData?.seals || []), ...(state.adminData?.gameItems || []), ...(state.adminData?.services || []), ...(state.adminData?.moneyT ? [state.adminData.moneyT] : [])];
  const productMap = reportProductMap();
  const daily = {};
  const top = {};
  let estimatedCost = 0;
  paid.forEach((order) => {
    const date = parseDateValue(order.createdAt);
    const day = date ? date.toISOString().slice(0, 10) : 'ไม่ทราบวัน';
    daily[day] = (daily[day] || 0) + Number(order.total || 0);
    orderItems(order).forEach((item) => {
      const key = item.productName || item.name || item.productId || item.id || 'ไม่ทราบสินค้า';
      const qty = Number(item.quantity || 0);
      top[key] = (top[key] || 0) + qty;
      const productId=item.productId||item.id,productName=item.productName||item.name;
      const product = productMap.get(`${item.kind || ''}|${productId || ''}`) || products.find((p) => p.id === productId) || products.find((p) => p.name === productName);
      estimatedCost += Number(product?.costPrice || 0) * qty;
    });
  });
  const revenue = paid.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const paidRevenue = paid.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const customers = new Set(paid.map((o) => norm(o.contact || o.tamer)).filter(Boolean)).size;
  const topRows = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const dailyRows = Object.entries(daily).sort((a, b) => a[0].localeCompare(b[0]));
  return { orders, valid, paid, products, revenue, paidRevenue, customers, topRows, dailyRows, estimatedCost, estimatedProfit: revenue - estimatedCost };
}
function rangeButtons() {
  return [['7','7 วัน'],['30','30 วัน'],['90','90 วัน'],['ALL','ทั้งหมด']]
    .map(([value, label]) => `<button class="filter-chip ${state.reportRange === value ? 'active' : ''}" data-report-range="${value}">${label}</button>`).join('');
}
function analyticsPage() {
  const data = analyticsDataset();
  const stockProducts = [...(state.adminData?.seals || []), ...(state.adminData?.gameItems || [])];
  const stockValue = stockProducts.reduce((sum, p) => sum + Math.max(0, Number(availableStock(p) || 0)) * Number(p.costPrice || 0), 0);
  const maxTop = Math.max(1, ...data.topRows.map(([, qty]) => qty));
  const maxDaily = Math.max(1, ...data.dailyRows.map(([, amount]) => amount));
  const avgOrder = data.paid.length ? data.revenue / data.paid.length : 0;
  return `<section class="panel"><div class="admin-toolbar"><div><h2 class="panel-title">V15 — Analytics Pro</h2><p class="product-meta">วิเคราะห์ยอดขาย กำไรโดยประมาณ ลูกค้า และแนวโน้มตามช่วงเวลา</p></div><div class="chip-row">${rangeButtons()}<button class="btn" id="reloadAnalyticsBtn">🔄 โหลดใหม่</button></div></div>
    <div class="metrics report-metrics"><div class="metric">ยอดขายสำเร็จ<b>${money(data.revenue)} ฿</b></div><div class="metric">ยอด COMPLETED<b>${money(data.paidRevenue)} ฿</b></div><div class="metric">ออเดอร์สำเร็จ<b>${data.paid.length}</b></div><div class="metric">เฉลี่ยต่อออเดอร์<b>${money(avgOrder)} ฿</b></div><div class="metric">ลูกค้าไม่ซ้ำ<b>${data.customers}</b></div><div class="metric">กำไรโดยประมาณ<b>${money(data.estimatedProfit)} ฿</b></div><div class="metric">มูลค่าต้นทุนสต๊อก<b>${money(stockValue)} ฿</b></div></div>
    <div class="analytics-pro-grid"><div class="report-card"><h3>ยอดขายรายวัน</h3><div class="daily-bars">${data.dailyRows.length ? data.dailyRows.map(([day, amount]) => `<div class="daily-bar-row"><span>${html(day)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, amount / maxDaily * 100)}%"></div></div><b>${money(amount)}</b></div>`).join('') : '<div class="empty">ยังไม่มีข้อมูลในช่วงนี้</div>'}</div></div>
    <div class="report-card"><h3>Top 10 สินค้าที่ถูกสั่ง</h3><div class="category-bars">${data.topRows.length ? data.topRows.map(([name, qty]) => `<div class="bar-row analytics-row"><span>${html(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, qty / maxTop * 100)}%"></div></div><b>${money(qty)}</b></div>`).join('') : '<div class="empty">ยังไม่มีข้อมูลออเดอร์</div>'}</div></div></div>
    <div class="analytics-pro-grid"><div class="report-card"><h3>สถานะออเดอร์</h3><div class="status-summary">${['NEW','CHECKING','PREPARING','READY','COMPLETED','CANCELLED'].map(st => `<div><span>${st}</span><b>${data.orders.filter(o => String(o.status) === st).length}</b></div>`).join('')}</div></div><div class="report-card"><h3>หมายเหตุการคำนวณ</h3><p class="product-meta">รายได้และกำไรใช้เฉพาะออเดอร์ COMPLETED และจับคู่ต้นทุนด้วย productId รายการที่ไม่ใส่ต้นทุนจะถือว่าต้นทุนเป็น 0</p></div></div>
  </section>`;
}
function csvCell(value) {
  const text = String(value ?? '').replace(/"/g, '""');
  return `"${text}"`;
}
function downloadTextFile(name, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function csvDownload(name, headers, rows) {
  const csv = '\ufeff' + [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  downloadTextFile(name, csv, 'text/csv;charset=utf-8');
}
function exportOrdersCsv() {
  const rows = reportOrders().map((o) => [o.orderId, o.createdAt, o.tamer, o.server, o.contact, o.total, o.promoSets, o.status, o.adminNote, orderItems(o).map((i) => `${i.productName||i.name||i.productId||i.id} x${i.quantity}`).join(' | ')]);
  csvDownload(`DMO-orders-${new Date().toISOString().slice(0,10)}.csv`, ['orderId','createdAt','tamer','server','contact','total','promoSets','status','adminNote','items'], rows);
  toast('ส่งออกออเดอร์สำหรับ Excel แล้ว');
}
function exportProductsCsv() {
  const products = [...(state.adminData?.seals || []), ...(state.adminData?.gameItems || []), ...(state.adminData?.services || []), ...(state.adminData?.moneyT ? [state.adminData.moneyT] : [])];
  const rows = products.map((p) => [p.kind,p.id,p.name,(p.aliases||[]).join('|'),p.category||p.itemCategory||p.serviceCategory||'',p.section||'',p.price,p.unit,p.status,p.stock,p.reservedStock,p.lowStockAlert,p.costPrice,p.badge,p.imageUrl]);
  csvDownload(`DMO-products-${new Date().toISOString().slice(0,10)}.csv`, ['kind','id','name','aliases','category','section','price','unit','status','stock','reservedStock','lowStockAlert','costPrice','badge','imageUrl'], rows);
  toast('ส่งออกสินค้าแล้ว');
}
function exportCustomersCsv() {
  const rows = (state.adminData?.customers || []).map((c) => [c.customerId,c.createdAt,c.tamer,c.server,c.contact,c.orderCount,c.totalSpent,c.vipLevel,c.status,c.tags,c.preferredContact,c.followUpAt,c.note,c.lastOrderAt]);
  csvDownload(`DMO-customers-${new Date().toISOString().slice(0,10)}.csv`, ['customerId','createdAt','tamer','server','contact','orderCount','totalSpent','vipLevel','status','tags','preferredContact','followUpAt','note','lastOrderAt'], rows);
  toast('ส่งออกลูกค้าแล้ว');
}
function exportBackupJson() {
  const payload = { exportedAt: new Date().toISOString(), version: cfg.appVersion || '', data: state.adminData };
  downloadTextFile(`DMO-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  toast('ดาวน์โหลดข้อมูลสำรอง JSON แล้ว');
}
function printableReportHtml() {
  const d = analyticsDataset();
  const avg = d.paid.length ? d.revenue / d.paid.length : 0;
  const rows = d.topRows.map(([name, qty]) => `<tr><td>${html(name)}</td><td>${money(qty)}</td></tr>`).join('');
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>GUN SHOP DMO Report</title><style>body{font-family:Arial,Tahoma,sans-serif;color:#172b4d;padding:28px}h1{margin:0 0 6px}.muted{color:#667085}.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0}.kpi{border:1px solid #ccd5e0;border-radius:10px;padding:12px}.kpi b{display:block;font-size:22px;margin-top:5px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #d5dde7;padding:8px;text-align:left}@media print{button{display:none}}</style></head><body><h1>${html(state.settings.shopName || 'GUN SHOP DMO')}</h1><div class="muted">รายงานช่วง ${html(state.reportRange === 'ALL' ? 'ทั้งหมด' : state.reportRange + ' วัน')} • สร้างเมื่อ ${new Date().toLocaleString('th-TH')}</div><div class="kpis"><div class="kpi">ยอดรวม<b>${money(d.revenue)} บาท</b></div><div class="kpi">ออเดอร์<b>${d.paid.length}</b></div><div class="kpi">เฉลี่ย/ออเดอร์<b>${money(avg)} บาท</b></div><div class="kpi">ลูกค้าไม่ซ้ำ<b>${d.customers}</b></div><div class="kpi">ต้นทุนประมาณ<b>${money(d.estimatedCost)} บาท</b></div><div class="kpi">กำไรประมาณ<b>${money(d.estimatedProfit)} บาท</b></div></div><h2>Top 10 สินค้า</h2><table><thead><tr><th>สินค้า</th><th>จำนวน</th></tr></thead><tbody>${rows || '<tr><td colspan="2">ไม่มีข้อมูล</td></tr>'}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`;
}
function printReportPdf() {
  const w = window.open('', '_blank');
  if (!w) return toast('เบราว์เซอร์บล็อกหน้าต่าง กรุณาอนุญาต Pop-up');
  w.document.open(); w.document.write(printableReportHtml()); w.document.close();
}
function reportsPage() {
  return `<section class="panel"><div class="admin-toolbar"><div><h2 class="panel-title">V16 — Report & Export Center</h2><p class="product-meta">ส่งออกข้อมูลสำหรับ Excel พิมพ์เป็น PDF และสำรองข้อมูลระบบ</p></div><div class="chip-row">${rangeButtons()}</div></div><div class="export-grid"><article class="export-card"><span>🧾</span><h3>ออเดอร์</h3><p>ข้อมูลออเดอร์ในช่วงเวลาที่เลือก พร้อมรายการสินค้า</p><button class="btn primary" id="exportOrdersCsvBtn">ดาวน์โหลด CSV / Excel</button></article><article class="export-card"><span>📦</span><h3>สินค้า</h3><p>ซีล ไอเทม บริการ ราคา สต๊อก และต้นทุน</p><button class="btn primary" id="exportProductsCsvBtn">ดาวน์โหลด CSV / Excel</button></article><article class="export-card"><span>👥</span><h3>ลูกค้า</h3><p>ยอดสะสม VIP แท็ก และข้อมูล CRM</p><button class="btn primary" id="exportCustomersCsvBtn">ดาวน์โหลด CSV / Excel</button></article><article class="export-card"><span>📄</span><h3>รายงาน PDF</h3><p>สรุป KPI และ Top 10 สำหรับพิมพ์หรือบันทึก PDF</p><button class="btn success" id="printReportPdfBtn">พิมพ์ / บันทึก PDF</button></article><article class="export-card"><span>💾</span><h3>สำรอง JSON</h3><p>ดาวน์โหลดข้อมูลหลังบ้านทั้งหมดที่เว็บโหลดได้ในครั้งนี้</p><button class="btn warning" id="exportBackupJsonBtn">ดาวน์โหลด Backup</button></article></div><div class="source-note">ไฟล์ CSV เปิดด้วย Microsoft Excel หรือ Google Sheets ได้ทันที ส่วน PDF ใช้หน้าต่างพิมพ์ของเบราว์เซอร์แล้วเลือก “บันทึกเป็น PDF”</div></section>`;
}

function wikiCenterPage() {
  const results = state.wikiLookup.results || [];
  return `<section class="panel"><div class="admin-toolbar"><div><h2 class="panel-title">V12 — DMO Wiki Center</h2><p class="product-meta">ค้นหาหน้า DMO Wiki แล้วเชื่อมชื่ออังกฤษ ลิงก์ และภาพตัวอย่างเข้ากับสินค้า</p></div><a class="btn" href="https://dmowiki.com/Seal_Master" target="_blank" rel="noopener">เปิด Seal Master</a></div><div class="wiki-search-bar"><input id="wikiPageQuery" placeholder="ค้นหา เช่น Guilmon, Omegamon X, Seal Master" value="${html(state.wikiLookup.query)}"><button class="btn primary" id="wikiPageSearchBtn">🔎 ค้นหา DMO Wiki</button></div>${state.wikiLookup.loading ? '<div class="empty"><span class="loading"></span> กำลังค้นหา...</div>' : `<div class="wiki-page-results">${results.length ? results.map((item)=>`<article class="wiki-page-card">${item.thumbnail ? `<img src="${html(item.thumbnail)}" alt="${html(item.title)}" loading="lazy">` : '<div class="wiki-page-placeholder">📚</div>'}<div><h3>${html(item.title)}</h3><p>${html(item.extract || 'ไม่มีคำอธิบายย่อ')}</p><div class="chip-row"><a class="btn small" href="${html(item.url)}" target="_blank" rel="noopener">เปิดหน้า</a>${state.wikiLookup.target ? `<button class="btn success small" data-attach-wiki="${html(item.title)}" data-wiki-url="${html(item.url)}" data-wiki-thumb="${html(item.thumbnail || '')}">เชื่อมกับ ${html(state.wikiLookup.target.name)}</button>` : ''}</div></div></article>`).join('') : '<div class="empty">พิมพ์ชื่ออังกฤษหรือชื่อหน้าเพื่อค้นหา</div>'}</div>`}<div class="source-note">ใช้ MediaWiki Action API สำหรับค้นหาหน้าและภาพตัวอย่าง ข้อมูลต้นทางอาจต่างจากเซิร์ฟเวอร์ไทย</div></section>`;
}

async function searchWikiPages() {
  const input = document.getElementById('wikiPageQuery');
  const query = (input ? input.value : state.wikiLookup.query).trim();
  if (!query) return toast('กรุณาพิมพ์คำค้นหา');
  state.wikiLookup.query = query;
  state.wikiLookup.loading = true;
  render();
  try {
    const data = await apiPost({ action: 'wikiSearchPages', token: state.adminToken, query });
    state.wikiLookup.results = data.results || [];
  } catch (error) { toast(error.message); }
  state.wikiLookup.loading = false;
  render();
}

async function attachWikiResult(button) {
  if (!state.wikiLookup.target) return toast('กรุณาเปิดสินค้าในหน้าแก้ไขก่อน');
  try {
    const target = state.wikiLookup.target;
    const data = await apiPost({ action: 'attachWikiMetadata', token: state.adminToken, kind: target.kind, id: target.id, title: button.dataset.attachWiki, wikiUrl: button.dataset.wikiUrl, thumbnail: button.dataset.wikiThumb });
    toast('เชื่อมข้อมูล DMO Wiki แล้ว');
    state.wikiLookup.target = null;
    state.wikiLookup.results = [];
    await loadAdmin();
    await loadData(false);
    state.adminView = 'catalog';
    render();
  } catch (error) { toast(error.message); }
}

function openWikiCenterForRecord(record) {
  if (!record || !record.id) return toast('กรุณาบันทึกสินค้าก่อน แล้วจึงเชื่อมข้อมูล DMO Wiki');
  state.wikiLookup.target = { kind: record.kind, id: record.id, name: record.name };
  state.wikiLookup.query = record.wikiTitle || record.wikiName || record.name || '';
  state.wikiLookup.results = [];
  state.editRecord = null;
  state.adminView = 'wiki';
  render();
}

function adminTrash() {
  const trash = state.adminData.trash || [];
  return `<section class="panel"><div class="admin-toolbar"><div><h2 class="panel-title">ถังขยะ (${trash.length})</h2><p class="product-meta">รายการที่ลบสามารถกู้คืนได้ จนกว่าจะลบถาวร</p></div></div><div class="admin-list">${trash.length?trash.map((x)=>`<div class="trash-row"><div><b>${html(x.name||x.id)}</b><div class="product-meta">${html(x.kind)} • ลบเมื่อ ${html(x.deletedAt||'')}</div></div><div><button class="btn success small" data-restore-trash="${html(x.id)}">กู้คืน</button> <button class="btn danger small" data-delete-trash="${html(x.id)}">ลบถาวร</button></div></div>`).join(''):'<div class="empty">ถังขยะว่าง</div>'}</div></section>`;
}

function allowedOrderStatuses(current) {
  const transitions = {
    NEW: ['NEW', 'CHECKING', 'CANCELLED'],
    CHECKING: ['CHECKING', 'PREPARING', 'CANCELLED'],
    PREPARING: ['PREPARING', 'READY', 'CANCELLED'],
    READY: ['READY', 'COMPLETED', 'CANCELLED'],
    COMPLETED: ['COMPLETED'],
    CANCELLED: ['CANCELLED'],
  };
  return transitions[String(current || 'NEW')] || ['NEW'];
}

function adminCatalogProducts() {
  return [
    ...(state.adminData?.seals || []).map((x) => ({ ...x, kind: 'SEAL' })),
    ...(state.adminData?.gameItems || []).map((x) => ({ ...x, kind: x.kind || 'ITEM' })),
    ...(state.adminData?.services || []).map((x) => ({ ...x, kind: 'SERVICE' })),
    ...(state.adminData?.moneyT ? [{ ...state.adminData.moneyT, kind: 'TMONEY' }] : []),
  ];
}

function pickingProduct(item) {
  return adminCatalogProducts().find((product) => String(product.id) === String(item.productId || item.id) && String(product.kind) === String(item.kind)) || null;
}

function pickingCategory(item, product) {
  if (String(item.kind) === 'SEAL') return `ซีล • ${product?.category || '-'} • ${sectionLabel(product?.section || '')}`;
  if (String(item.kind) === 'SERVICE') return `บริการ • ${product?.serviceCategory || '-'}`;
  if (String(item.kind) === 'TMONEY') return 'เงิน T';
  return `ไอเทม • ${product?.itemCategory || '-'}`;
}

function pickingStockText(item, product) {
  if (String(item.kind) === 'SERVICE') return 'บริการ • ไม่ตัดสต๊อก';
  if (!product || product.stock === '' || product.stock === null || product.stock === undefined) return 'ต้องตรวจสต๊อก';
  return `Stock ${money(product.stock)} • พร้อมขาย ${money(availableStock(product))} ${saleUnit(product)}`;
}

function facebookPostText() {
  const data = state.adminData || {};
  const active = (list) => (list || []).filter((x) => String(x.status || 'ACTIVE') === 'ACTIVE');
  const order = ['AT', 'HT', 'CT', 'HP', 'DS', 'DE', 'EV', 'BL'];
  const lines = ['🛒 สินค้าและบริการ GUN SHOP DMO', ''];
  const seals = active(data.seals).slice().sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || String(a.name).localeCompare(String(b.name), 'th'));
  if (seals.length) {
    lines.push('🦖 ซีล');
    order.forEach((category) => {
      const rows = seals.filter((x) => x.category === category);
      if (rows.length) lines.push('', category, ...rows.map((x) => `• ${x.name} — ${formatProductPrice(x)}`));
    });
    lines.push('');
  }
  const items = active(data.gameItems).filter((x) => String(x.kind || 'ITEM') !== 'TMONEY');
  if (items.length) lines.push('🎒 ไอเทม', ...items.map((x) => `• ${x.name} — ${formatProductPrice(x)}`), '');
  const services = active(data.services);
  if (services.length) lines.push('⚔️ บริการ', ...services.map((x) => `• ${x.name} — ${formatProductPrice(x)}`), '');
  const moneyT = data.moneyT;
  if (moneyT && String(moneyT.status) === 'ACTIVE' && Number(moneyT.price) > 0 && Number(availableStock(moneyT)) > 0) lines.push('💰 เงิน T', `• ${moneyT.name || 'เงิน T'} — ${formatProductPrice(moneyT)}`, '');
  const promos = active(data.promotions);
  const threshold = Number(data.settings?.promoThreshold || state.settings?.promoThreshold || 0);
  const reward = Number(data.settings?.promoReward || state.settings?.promoReward || 0);
  if (threshold > 0 && reward > 0) lines.push('🎁 โปรโมชั่น D2', `ซื้อซีลครบทุก ${money(threshold)} บาท รับ D2 ${money(reward)} อัน (คิดเฉพาะซีล)`, '');
  promos.filter((x) => String(x.type) !== 'REWARD_PER_SPEND').forEach((x) => lines.push(`🎁 ${x.name}${x.rewardText ? ` — ${x.rewardText}` : ''}`));
  lines.push('', 'สนใจสินค้า คัดลอกรายการจากหน้าร้านแล้วส่งมาให้ร้านตรวจสต๊อกได้เลย');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function facebookPostGenerator() {
  const text = facebookPostText();
  return `<section class="panel marketing-generator"><div class="admin-toolbar"><div><h2 class="panel-title">📣 สร้างโพสต์ Facebook</h2><p class="product-meta">สร้างข้อความจากสินค้าและโปรโมชั่นที่เปิดใช้งานอยู่ ไม่มีการโพสต์อัตโนมัติ</p></div></div><div class="security-note">ข้อมูลมาจากแคตตาล็อกปัจจุบัน • ซีลเรียง AT → HT → CT → HP → DS → DE → EV → BL • ราคาใช้หน่วยจริง</div><label class="full"><b>ตัวอย่างโพสต์</b><textarea id="facebookPostPreview" class="marketing-preview" readonly>${html(text)}</textarea></label><div class="chip-row"><button class="btn primary" id="copyFacebookPostBtn">📋 คัดลอกโพสต์</button>${state.adminData?.settings?.facebookUrl ? `<a class="btn" href="${html(state.adminData.settings.facebookUrl)}" target="_blank" rel="noopener">เปิด Facebook ร้าน</a>` : ''}</div></section>`;
}

function pickingRowHtml(item, order, archived, busy) {
  const product = pickingProduct(item);
  const picked = String(item.pickStatus) === 'PICKED';
  const disabled = busy || String(item.orderItemId || '').startsWith('legacy-') || ['COMPLETED', 'CANCELLED'].includes(order.status);
  return `<div class="pick-row ${picked ? 'picked' : ''}"><div class="pick-check">${picked ? '✅' : '⬜'}</div><div class="pick-category">${html(pickingCategory(item, product))}</div><div class="pick-name"><b>${html(item.productName || item.name || '-')}</b><small>${formatProductPrice({ price:item.unitPrice ?? item.price, unit:item.unit, packSize:item.packSize, kind:item.kind })}</small></div><div class="pick-quantity"><b>${money(item.quantity)} ${html(item.unit || '')}</b><small>จำนวนที่ต้องจัด</small></div><div class="pick-stock ${String(item.stockCheck) === 'OK' ? 'stock-ok' : 'stock-warn'}">${html(pickingStockText(item, product))}<small>${html(item.stockCheck || 'รอตรวจ')}</small></div>${archived ? '' : `<button class="btn small ${picked ? 'success' : ''}" data-pick-item="${html(item.orderItemId || '')}|${picked ? 'UNCHECKED' : 'PICKED'}" data-order-id="${html(order.orderId)}" ${disabled ? 'disabled' : ''}>${picked ? 'ยกเลิกติ๊ก' : '✓ จัดแล้ว'}</button>`}</div>`;
}

function adminOrders() {
  const actor=state.adminData?.security?.actor||state.adminUser||{},canManage=['OWNER','ADMIN'].includes(String(actor.role||''));
  const archived=state.adminOrderMode==='ARCHIVED';
  const allOrders = archived?(state.adminData.deletedOrders||[]):(state.adminData.orders||[]);
  const itemRows = state.adminData.orderItems || [];
  const filter=state.adminOrderFilter||'ALL';
  const query=String(state.adminOrderSearch||'').trim().toLowerCase();
  const orders=allOrders.filter(o=>(filter==='ALL'||(filter==='SPAM'?String(o.spamStatus)==='SPAM':String(o.status||'NEW')===filter))&&(!query||[o.orderId,o.tamer,o.contact,o.server,o.status,o.spamStatus,orderStatusThai(o.status)].some(x=>String(x||'').toLowerCase().includes(query))));
  const statuses=['NEW','CHECKING','PREPARING','READY','COMPLETED','CANCELLED'];
  const count=(s)=>allOrders.filter(o=>s==='SPAM'?String(o.spamStatus)==='SPAM':String(o.status||'NEW')===s).length;
  let cards=orders.map((order)=>{
    let items=itemRows.filter(x=>String(x.orderId)===String(order.orderId));
    if(!items.length){try{items=JSON.parse(order.itemsJson||'[]').map((x,i)=>({orderItemId:`legacy-${i}`,orderId:order.orderId,productId:x.productId||x.id,productName:x.productName||x.name,kind:x.kind,quantity:x.quantity,unit:x.unit,unitPrice:x.unitPrice??x.price,lineTotal:x.lineTotal??Number(x.price||0)*Number(x.quantity||0),packSize:x.packSize||'',pickStatus:x.pickStatus||'UNCHECKED',stockCheck:x.stockCheck||'LEGACY'}));}catch(e){items=[];}}
    const picked=items.filter(x=>String(x.pickStatus)==='PICKED').length;
    const cls=String(order.status||'NEW').toLowerCase();
    const legacy=String(order.legacyOrder||'').toUpperCase()==='TRUE'||order.legacyOrder===true;
    const allowed = legacy?[String(order.status||'NEW')]:allowedOrderStatuses(order.status);
    const nextStatus = allowed.find((status) => status !== order.status && status !== 'CANCELLED');
    const busy=state.adminActionPending===String(order.orderId);
    const isSpam=String(order.spamStatus||'')==='SPAM';
    return `<article class="order-card-v20 ${cls} ${archived?'archived':''} ${isSpam?'spam-order':''}"><div class="order-card-head"><div><div class="order-id-big">${html(order.orderId)}</div><div class="product-meta">สร้างเมื่อ ${html(order.createdAt||'-')}</div></div><div><div class="order-total">${money(order.total)} บาท</div><span class="badge ${order.status==='COMPLETED'?'green':order.status==='CANCELLED'?'red':'amber'}">${html(orderStatusThai(order.status||'NEW'))}</span>${isSpam?'<span class="badge red">SPAM</span>':''}</div></div><div class="order-summary-grid"><div><span>ลูกค้า/เทมเมอร์</span><b>${html(order.tamer||'-')}</b></div><div><span>เซิร์ฟเวอร์</span><b>${html(order.server||'-')}</b></div><div><span>ชื่อ Facebook</span><b>${html(order.contact||'-')}</b></div><div><span>จัดสินค้า</span><b>${items.length&&picked===items.length?'จัดครบแล้ว':`${picked}/${items.length} รายการ`}</b></div></div>${isSpam?`<div class="spam-note"><b>ทำเครื่องหมาย Spam:</b> ${html(order.spamNote||'-')} • ${html(order.spamUpdatedAt||'')}</div>`:''}${archived?`<div class="archive-note"><b>เก็บเมื่อ:</b> ${html(order.deletedAt||'-')} • <b>โดย:</b> ${html(order.deletedBy||'-')}<br><b>เหตุผล:</b> ${html(order.deleteReason||'-')}</div>`:`<div class="order-progress"><span class="active">รับออเดอร์</span><span class="${['CHECKING','PREPARING','READY','COMPLETED'].includes(order.status)?'active':''}">ตรวจ</span><span class="${['PREPARING','READY','COMPLETED'].includes(order.status)?'active':''}">จัดของ</span><span class="${['READY','COMPLETED'].includes(order.status)?'active':''}">พร้อมส่ง</span><span class="${order.status==='COMPLETED'?'active':''}">เสร็จสิ้น</span></div>`}<div class="order-items-v20">${items.map((item)=>pickingRowHtml(item,order,archived,busy)).join('')||'<div class="empty">ไม่พบรายการสินค้า</div>'}</div>${archived?`<div class="order-archive-actions"><div class="security-note">กู้คืนแล้วจะคงสถานะและสต๊อกเดิม ระบบจะไม่จองหรือตัดสต๊อกให้อัตโนมัติ</div><button class="btn success" data-restore-order="${html(order.orderId)}" ${busy?'disabled':''}>${busy?'กำลังดำเนินการ...':'↩ กู้คืนออเดอร์'}</button></div>`:`${nextStatus?`<div class="next-step-hint">ขั้นตอนถัดไป: <b>${orderStatusThai(nextStatus)}</b></div>`:''}<div class="order-actions-v20"><select data-order-status="${html(order.orderId)}" ${busy||allowed.length===1?'disabled':''}>${allowed.map(status=>`<option value="${status}" ${order.status===status?'selected':''}>${orderStatusThai(status)}</option>`).join('')}</select><input data-order-note="${html(order.orderId)}" value="${html(order.adminNote||'')}" placeholder="หมายเหตุร้าน" ${busy?'disabled':''}><button class="btn success" data-save-order="${html(order.orderId)}" ${busy||allowed.length===1?'disabled':''}>${busy?'กำลังบันทึก...':'บันทึกสถานะ'}</button>${canManage?`<button class="btn ${isSpam?'warning':'danger'} subtle" data-spam-order="${html(order.orderId)}|${isSpam?'CLEARED':'SPAM'}" ${busy?'disabled':''}>${isSpam?'ยกเลิก Spam':'ทำเครื่องหมาย Spam'}</button><button class="btn danger subtle" data-archive-order="${html(order.orderId)}" ${busy?'disabled':''}>เก็บเข้าถัง</button>`:''}</div>`}</article>`;
  }).join('');
  if(orders.some(order=>String(order.legacyOrder||'').toUpperCase()==='TRUE'||order.legacyOrder===true))cards='<div class="security-note">📦 ออเดอร์ที่มีป้าย Legacy เป็นออเดอร์เก่า — ไม่ได้อยู่ในระบบจองสต๊อก V20.1 ปุ่มเปลี่ยนสถานะจึงถูกปิด และการเก็บเข้าถังจะไม่เปลี่ยน Stock/Reserved Stock</div>'+cards;
  return `<section class="panel"><div class="admin-toolbar"><div><h2 class="panel-title">🧾 ศูนย์ออเดอร์และจัดของ</h2><p class="product-meta">ค้นหา ตรวจสต๊อก ติ๊กจัดของ และปิดงานจากหน้าเดียว</p></div><button class="btn" id="reloadOrdersBtn">🔄 โหลดใหม่</button></div><div class="order-mode-tabs"><button class="filter-chip ${!archived?'active':''}" data-order-mode="ACTIVE">ออเดอร์ใช้งาน (${(state.adminData.orders||[]).length})</button>${canManage?`<button class="filter-chip ${archived?'active':''}" data-order-mode="ARCHIVED">ถังออเดอร์ (${(state.adminData.deletedOrders||[]).length})</button>`:''}</div><input id="adminOrderSearch" class="order-search" value="${html(state.adminOrderSearch)}" placeholder="ค้นหาเลขออเดอร์ ชื่อลูกค้า Facebook หรือสถานะ"><div class="order-kpis"><div class="order-kpi"><span>ออเดอร์ใหม่</span><b>${count('NEW')}</b></div><div class="order-kpi"><span>กำลังตรวจ</span><b>${count('CHECKING')}</b></div><div class="order-kpi"><span>กำลังจัด</span><b>${count('PREPARING')}</b></div><div class="order-kpi"><span>พร้อมส่ง</span><b>${count('READY')}</b></div><div class="order-kpi"><span>เสร็จแล้ว</span><b>${count('COMPLETED')}</b></div><div class="order-kpi"><span>ยกเลิก</span><b>${count('CANCELLED')}</b></div><div class="order-kpi spam"><span>Spam</span><b>${count('SPAM')}</b></div></div><div class="admin-order-filter">${['ALL',...statuses,'SPAM'].map(s=>`<button class="filter-chip ${filter===s?'active':''}" data-order-filter="${s}">${s==='ALL'?'ทั้งหมด':s==='SPAM'?'Spam':orderStatusThai(s)}</button>`).join('')}</div><div class="security-note">🔐 ระบบตรวจราคาและสต๊อกที่ Server • เสร็จสิ้นจะตัดสต๊อก • ยกเลิกหรือเก็บออเดอร์ที่ยังจองอยู่จะคืน Reserved Stock เพียงครั้งเดียว • ป้าย Spam ไม่เปลี่ยน Stock หรือ Reserved</div><div class="order-admin-grid">${cards||'<div class="empty">ไม่พบออเดอร์</div>'}</div></section>`;
}

function integrityPage(){
  const r=state.integrityReport,issues=r?.issues||[];
  return `<section class="panel"><div class="admin-toolbar"><div><h2 class="panel-title">🧪 Data Integrity Checker</h2><p class="product-meta">ตรวจหาความผิดปกติโดยไม่แก้ไขหรือลบข้อมูลอัตโนมัติ</p></div><button class="btn primary" id="runIntegrityBtn">เริ่มตรวจสอบ</button></div>${!r?'<div class="empty">ยังไม่ได้ตรวจสอบข้อมูล</div>':`<div class="metrics compact"><div class="metric">ปัญหาทั้งหมด<b>${money(r.summary?.issues||0)}</b></div><div class="metric">Error<b>${money(r.summary?.errors||0)}</b></div><div class="metric">Warning<b>${money(r.summary?.warnings||0)}</b></div><div class="metric">ออเดอร์<b>${money(r.summary?.orders||0)}</b></div></div><div class="admin-list">${issues.length?issues.map(x=>`<div class="admin-card"><span class="badge ${x.severity==='ERROR'?'red':'amber'}">${html(x.severity)}</span><div><b>${html(x.code)}</b><div class="product-meta">${html(x.message)} ${x.orderId?'• '+html(x.orderId):''} ${x.productId?'• '+html(x.productId):''}</div></div></div>`).join(''):'<div class="security-note">✅ ไม่พบความผิดปกติจากรายการที่ตรวจสอบ</div>'}</div>`}</section>`;
}


function customerOrders(customer) {
  const key = norm(customer.contact || customer.tamer || '');
  return (state.adminData.orders || []).filter((order) => key && [order.contact, order.tamer].some((v) => norm(v) === key));
}
function customerInteractions(customerId) {
  return (state.adminData.customerInteractions || []).filter((x) => String(x.customerId) === String(customerId));
}
function adminCustomers() {
  const customers = state.adminData.customers || [];
  const q = norm(state.customerSearchAdmin);
  const filtered = customers.filter((c) => {
    if (q && ![c.tamer, c.server, c.contact, c.customerId, c.tags].some((v) => norm(v).includes(q))) return false;
    if (state.customerFilter !== 'ALL' && c.status !== state.customerFilter && c.vipLevel !== state.customerFilter) return false;
    return true;
  });
  const repeat = customers.filter((c) => Number(c.orderCount || 0) >= 2).length;
  const vip = customers.filter((c) => ['GOLD','PLATINUM','VIP'].includes(c.vipLevel)).length;
  const followUps = customers.filter((c) => c.followUpAt && Date.parse(c.followUpAt) <= Date.now() + 86400000 * 7).length;
  const detail = customers.find((c) => String(c.customerId) === String(state.customerDetailId));
  const detailOrders = detail ? customerOrders(detail) : [];
  const interactions = detail ? customerInteractions(detail.customerId) : [];
  return `<section class="panel"><div class="admin-toolbar"><div><h2 class="panel-title">CRM ลูกค้า (${customers.length})</h2><p class="product-meta">ติดตามลูกค้าประจำ ยอดสะสม ประวัติออเดอร์ แท็ก และวันติดตาม</p></div><button class="btn" id="reloadCustomersBtn">🔄 โหลดใหม่</button></div>
  <div class="metrics compact"><div class="metric">ลูกค้าซื้อซ้ำ<b>${repeat}</b></div><div class="metric">Gold ขึ้นไป<b>${vip}</b></div><div class="metric">ติดตามใน 7 วัน<b>${followUps}</b></div><div class="metric">Blacklist<b>${customers.filter((c)=>c.status==='BLACKLIST').length}</b></div></div>
  <div class="inventory-filters"><input id="customerSearchAdmin" placeholder="ค้นหาชื่อ เทมเมอร์ เซิร์ฟเวอร์ ติดต่อ หรือแท็ก..." value="${html(state.customerSearchAdmin)}"><div class="chip-row">${['ALL','ACTIVE','BLACKLIST','NORMAL','SILVER','GOLD','PLATINUM','VIP'].map((v)=>`<button class="filter-chip ${state.customerFilter===v?'active':''}" data-customer-filter="${v}">${v==='ALL'?'ทั้งหมด':v}</button>`).join('')}</div></div>
  <div class="crm-layout"><div style="overflow:auto"><table class="order-table"><thead><tr><th>ลูกค้า</th><th>ซื้อ</th><th>ยอด/เฉลี่ย</th><th>ระดับ</th><th>ติดตาม</th><th></th></tr></thead><tbody>${filtered.map((c)=>{const avg=Number(c.orderCount||0)?Number(c.totalSpent||0)/Number(c.orderCount):0;return `<tr class="${String(c.customerId)===String(state.customerDetailId)?'selected-row':''}"><td><b>${html(c.tamer||'-')}</b><br><span class="product-meta">${html(c.server||'-')} • ${html(c.contact||'-')}</span>${c.tags?`<div class="tag-line">${String(c.tags).split('|').filter(Boolean).map((t)=>`<span class="mini-tag">${html(t)}</span>`).join('')}</div>`:''}</td><td>${money(c.orderCount||0)} ครั้ง<br><span class="product-meta">ล่าสุด ${html(c.lastOrderAt||'-')}</span></td><td>${money(c.totalSpent||0)} บาท<br><span class="product-meta">เฉลี่ย ${money(avg)} บาท</span></td><td><span class="badge green">${html(c.vipLevel||'NORMAL')}</span><br><span class="product-meta">${html(c.status||'ACTIVE')}</span></td><td>${html(c.followUpAt||'-')}</td><td><button class="btn small" data-open-customer="${html(c.customerId)}">เปิด</button></td></tr>`}).join('')}</tbody></table></div>
  <aside class="crm-detail">${detail ? `<h3>${html(detail.tamer||'ลูกค้า')}</h3><div class="form-grid"><label>ชื่อเทมเมอร์<input id="crmTamer" value="${html(detail.tamer||'')}"></label><label>เซิร์ฟเวอร์<input id="crmServer" value="${html(detail.server||'')}"></label><label class="full">ช่องทางติดต่อ<input id="crmContact" value="${html(detail.contact||'')}"></label><label>ระดับ<select id="crmVip">${['NORMAL','SILVER','GOLD','PLATINUM','VIP'].map(v=>`<option ${detail.vipLevel===v?'selected':''}>${v}</option>`).join('')}</select></label><label>สถานะ<select id="crmStatus">${['ACTIVE','BLACKLIST','INACTIVE'].map(v=>`<option ${detail.status===v?'selected':''}>${v}</option>`).join('')}</select></label><label>ช่องทางที่ชอบ<input id="crmPreferred" value="${html(detail.preferredContact||'')}"></label><label>วันติดตาม<input id="crmFollowUp" type="datetime-local" value="${html(String(detail.followUpAt||'').slice(0,16))}"></label><label class="full">แท็ก (คั่นด้วย |)<input id="crmTags" value="${html(detail.tags||'')}"></label><label class="full">หมายเหตุ<textarea id="crmNote">${html(detail.note||'')}</textarea></label></div><div class="chip-row"><button class="btn success" id="saveCrmCustomerBtn">บันทึกลูกค้า</button><button class="btn" id="copyCrmContactBtn">คัดลอกติดต่อ</button></div><hr><h4>บันทึกการติดต่อล่าสุด</h4><div class="interaction-form"><select id="interactionType"><option>MESSAGE</option><option>CALL</option><option>FOLLOW_UP</option><option>NOTE</option></select><input id="interactionChannel" placeholder="ช่องทาง"><textarea id="interactionNote" placeholder="บันทึกการพูดคุย"></textarea><input id="interactionNext" type="datetime-local"><button class="btn primary" id="addInteractionBtn">เพิ่มบันทึก</button></div><div class="interaction-list">${interactions.slice(0,20).map((x)=>`<div><b>${html(x.type)}</b> • ${html(x.channel||'-')}<br><span>${html(x.note||'')}</span><small>${html(x.createdAt||'')}</small></div>`).join('')||'<div class="empty">ยังไม่มีบันทึก</div>'}</div><hr><h4>ประวัติออเดอร์ (${detailOrders.length})</h4><div class="interaction-list">${detailOrders.slice(0,20).map((o)=>`<div><b>${html(o.orderId)}</b> • ${money(o.total)} บาท<br><span>${html(o.status)} • ${html(o.createdAt)}</span></div>`).join('')||'<div class="empty">ยังไม่มีออเดอร์</div>'}</div>` : '<div class="empty">เลือกลูกค้าเพื่อดูรายละเอียด</div>'}</aside></div></section>`;
}

function adminPromotions() {
  const promos = state.adminData.promotions || [];
  return `<section class="panel"><div class="admin-toolbar"><div><h2 class="panel-title">ศูนย์โปรโมชั่น (${promos.length})</h2><p class="product-meta">รองรับ D2 ลดเปอร์เซ็นต์ ลดจำนวนเงิน ซื้อ X แถม Y ของแถม และ Flash Sale</p></div><button class="btn primary" id="newPromoBtn">+ เพิ่มโปรโมชั่น</button></div>
  <div class="admin-list">${promos.length ? promos.sort((a,b)=>(Number(a.priority)||999)-(Number(b.priority)||999)).map((p)=>`<div class="admin-card"><div><span class="badge ${p.status==='ACTIVE'?'green':'amber'}">${html(p.status)}</span></div><div><b>${html(p.name)}</b><div class="product-meta">${html(p.type)} • scope ${html(p.scope||'ALL')} • priority ${money(p.priority||0)}</div><div class="product-meta">${html(p.rewardText||p.note||'')}</div></div><div><button class="btn small" data-edit-promo="${html(p.promotionId)}">แก้ไข</button> <button class="btn danger small" data-delete-promo="${html(p.promotionId)}">ลบ</button></div></div>`).join('') : '<div class="empty">ยังไม่มีโปรโมชั่น</div>'}</div></section>${state.promoEdit!==null?promoModal():''}`;
}

function promoModal() {
  const p = state.promoEdit || {status:'ACTIVE',type:'REWARD_PER_SPEND',scope:'ALL',priority:10,stackable:'TRUE'};
  return `<div class="modal-backdrop" id="promoBackdrop"><div class="modal"><h2>${p.promotionId?'แก้ไข':'เพิ่ม'}โปรโมชั่น</h2><div class="form-grid"><label>ชื่อ<input id="pName" value="${html(p.name||'')}"></label><label>ประเภท<select id="pType">${['REWARD_PER_SPEND','DISCOUNT_PERCENT','DISCOUNT_AMOUNT','BUY_X_GET_Y','FREE_GIFT','FLASH_SALE'].map(v=>`<option ${p.type===v?'selected':''}>${v}</option>`).join('')}</select></label><label>ค่าโปร<input id="pValue" type="number" step="0.01" value="${html(p.value||0)}"></label><label>ยอดขั้นต่ำ<input id="pMinSpend" type="number" step="0.01" value="${html(p.minSpend||0)}"></label><label>ซื้อจำนวน<input id="pBuyQty" type="number" value="${html(p.buyQty||'')}"></label><label>แถมจำนวน<input id="pFreeQty" type="number" value="${html(p.freeQty||'')}"></label><label>สถานะ<select id="pStatus">${['ACTIVE','INACTIVE','DRAFT'].map(v=>`<option ${p.status===v?'selected':''}>${v}</option>`).join('')}</select></label><label>ขอบเขต<select id="pScope">${['ALL','SEAL','ITEM','SERVICE','SELECTED'].map(v=>`<option ${p.scope===v?'selected':''}>${v}</option>`).join('')}</select></label><label>ลำดับความสำคัญ<input id="pPriority" type="number" value="${html(p.priority||10)}"></label><label>ซ้อนกับโปรอื่น<select id="pStackable"><option ${String(p.stackable)==='TRUE'?'selected':''}>TRUE</option><option ${String(p.stackable)==='FALSE'?'selected':''}>FALSE</option></select></label><label>เริ่ม<input id="pStartAt" type="datetime-local" value="${html(p.startAt||'')}"></label><label>สิ้นสุด<input id="pEndAt" type="datetime-local" value="${html(p.endAt||'')}"></label><label class="full">ข้อความโปร<input id="pRewardText" value="${html(p.rewardText||'')}"></label><label class="full">หมายเหตุ<input id="pNote" value="${html(p.note||'')}"></label></div><div class="chip-row" style="margin-top:14px"><button class="btn success" id="savePromoBtn">บันทึกโปรโมชั่น</button><button class="btn" id="closePromoBtn">ยกเลิก</button></div></div></div>`;
}

async function saveCustomerAction(id){
  try{
    await apiPost({action:'updateCustomer',token:state.adminToken,customerId:id,vipLevel:document.querySelector(`[data-customer-vip="${CSS.escape(id)}"]`)?.value,status:document.querySelector(`[data-customer-status="${CSS.escape(id)}"]`)?.value,note:document.querySelector(`[data-customer-note="${CSS.escape(id)}"]`)?.value});
    toast('บันทึกลูกค้าแล้ว'); await loadAdmin();
  }catch(e){toast(e.message);}
}
async function saveCrmDetail(){
  const id=state.customerDetailId;if(!id)return;
  try{await apiPost({action:'updateCustomer',token:state.adminToken,customerId:id,tamer:document.getElementById('crmTamer').value,server:document.getElementById('crmServer').value,contact:document.getElementById('crmContact').value,vipLevel:document.getElementById('crmVip').value,status:document.getElementById('crmStatus').value,preferredContact:document.getElementById('crmPreferred').value,followUpAt:document.getElementById('crmFollowUp').value,tags:document.getElementById('crmTags').value,note:document.getElementById('crmNote').value});toast('บันทึกข้อมูล CRM แล้ว');await loadAdmin();}catch(e){toast(e.message);}
}
async function addCustomerInteraction(){
  const customer=(state.adminData.customers||[]).find((c)=>String(c.customerId)===String(state.customerDetailId));if(!customer)return;
  try{await apiPost({action:'addCustomerInteraction',token:state.adminToken,customerId:customer.customerId,customerName:customer.tamer,type:document.getElementById('interactionType').value,channel:document.getElementById('interactionChannel').value,note:document.getElementById('interactionNote').value,nextFollowUpAt:document.getElementById('interactionNext').value});toast('เพิ่มบันทึกการติดต่อแล้ว');await loadAdmin();}catch(e){toast(e.message);}
}

async function savePromoAction(){
  try{
    const p=state.promoEdit||{};
    await apiPost({action:'upsertPromotion',token:state.adminToken,promotion:{promotionId:p.promotionId||'',name:document.getElementById('pName').value,type:document.getElementById('pType').value,value:Number(document.getElementById('pValue').value)||0,minSpend:Number(document.getElementById('pMinSpend').value)||0,buyQty:document.getElementById('pBuyQty').value,freeQty:document.getElementById('pFreeQty').value,rewardText:document.getElementById('pRewardText').value,startAt:document.getElementById('pStartAt').value,endAt:document.getElementById('pEndAt').value,status:document.getElementById('pStatus').value,priority:Number(document.getElementById('pPriority').value)||10,stackable:document.getElementById('pStackable').value,scope:document.getElementById('pScope').value,note:document.getElementById('pNote').value}});
    state.promoEdit=null; toast('บันทึกโปรโมชั่นแล้ว'); await loadAdmin(); await loadData(false);
  }catch(e){toast(e.message);}
}


function automationPage() {
  const automation=state.adminData?.automation||{},alerts=automation.alerts||{},counts=alerts.counts||{},backups=automation.backups||[],actor=state.adminData?.security?.actor||state.adminUser||{};
  const alertRows=[
    ...(alerts.newOrders||[]).map(x=>({level:'green',icon:'🧾',title:`ออเดอร์ใหม่ ${x.orderId||''}`,meta:`${x.tamer||'-'} • ${money(x.total)} บาท`,view:'orders'})),
    ...(alerts.lowStock||[]).map(x=>({level:'amber',icon:'⚠️',title:`สต๊อกต่ำ: ${x.name}`,meta:`พร้อมขาย ${money(availableStock(x))} • เตือนที่ ${money(x.lowStockAlert)}`,view:'inventory'})),
    ...(alerts.outOfStock||[]).map(x=>({level:'red',icon:'⛔',title:`สินค้าหมด: ${x.name}`,meta:`${x.category||x.itemCategory||''}`,view:'inventory'})),
    ...(alerts.followUps||[]).map(x=>({level:'amber',icon:'👥',title:`ถึงเวลาติดตาม: ${x.tamer||x.contact||x.customerId}`,meta:`${x.followUpAt||''} • ${x.contact||''}`,view:'customers'})),
  ];
  return `<section class="panel"><div class="admin-toolbar"><div><h2 class="panel-title">🤖 V18 — Automation & Backup Center</h2><p class="product-meta">แจ้งเตือนงานสำคัญ สำรองข้อมูลบน Google Drive และกู้คืนเมื่อจำเป็น</p></div><span class="badge ${automation.triggerActive?'green':'amber'}">Auto Backup ${automation.triggerActive?'ON':'OFF'}</span></div>
  <div class="automation-kpis"><div class="stat-card"><span>ออเดอร์ใหม่</span><strong>${money(counts.newOrders||0)}</strong></div><div class="stat-card"><span>ใกล้หมด</span><strong>${money(counts.lowStock||0)}</strong></div><div class="stat-card"><span>หมด</span><strong>${money(counts.outOfStock||0)}</strong></div><div class="stat-card"><span>ต้องติดตาม</span><strong>${money(counts.followUps||0)}</strong></div><div class="stat-card"><span>Backup</span><strong>${money(backups.length)}</strong></div></div>
  <div class="automation-grid"><div><h3>ศูนย์แจ้งเตือน</h3><div class="alert-list">${alertRows.length?alertRows.slice(0,80).map(a=>`<button class="alert-row ${a.level}" data-jump-view="${a.view}"><span>${a.icon}</span><div><b>${html(a.title)}</b><small>${html(a.meta)}</small></div></button>`).join(''):'<div class="empty">ไม่มีรายการที่ต้องจัดการตอนนี้</div>'}</div></div>
  <div><h3>Backup บน Google Drive</h3><div class="backup-toolbar"><button class="btn success" id="createBackupBtn">💾 Backup ตอนนี้</button>${actor.role==='OWNER'?`<button class="btn" id="toggleBackupTriggerBtn">${automation.triggerActive?'⏸ ปิด Auto Backup':'▶ เปิด Auto Backup'}</button>`:''}</div><div class="product-meta">เวลาอัตโนมัติประมาณ ${money(automation.backupHour||3)}:00 • เก็บล่าสุด ${money(automation.retention||14)} ชุด</div><div class="backup-list">${backups.length?backups.map(b=>`<div class="backup-row"><div><b>${html(b.fileName||b.backupId)}</b><div class="product-meta">${html(b.createdAt||'')} • ${html(b.createdBy||'')} • ${html(b.reason||'')}</div></div><div class="backup-actions"><a class="btn small" href="${html(b.fileUrl||'#')}" target="_blank" rel="noopener">เปิด</a>${actor.role==='OWNER'?`<button class="btn warning small" data-restore-backup="${html(b.backupId)}">Restore</button><button class="btn danger small" data-delete-backup="${html(b.backupId)}">ลบ</button>`:''}</div></div>`).join(''):'<div class="empty">ยังไม่มี Backup บน Drive</div>'}</div></div></div>
  <div class="warning-box"><strong>ก่อน Restore ระบบจะสร้าง PRE_RESTORE Backup ให้อัตโนมัติ</strong><br><span class="product-meta">Restore จะกู้ข้อมูลร้านและไม่เขียนทับ Users / Sessions / ประวัติ Backup ปัจจุบัน</span></div></section>`;
}

function adminSecurity() {
  const security=state.adminData?.security||{},actor=security.actor||state.adminUser||{},users=security.users||[];
  return `<section class="panel"><div class="admin-toolbar"><div><h2 class="panel-title">🛡️ V17 — Security Center</h2><p class="product-meta">บัญชีปัจจุบัน: ${html(actor.userId||'')} • สิทธิ์ ${html(actor.role||'')}</p></div><span class="badge green">Session ${money(security.sessionDays||7)} วัน</span></div>
  <div class="stat-grid"><div class="stat-card"><span>ล็อกอัตโนมัติ</span><strong>${money(security.autoLockMinutes||30)} นาที</strong></div><div class="stat-card"><span>API Key</span><strong>${security.apiKeyConfigured?'ตั้งค่าแล้ว':'ยังไม่ตั้ง'}</strong></div><div class="stat-card"><span>ผู้ใช้</span><strong>${money(users.length||1)}</strong></div></div>
  ${actor.role==='OWNER'?`<h3>จัดการผู้ใช้</h3><div class="form-grid"><label>User ID<input id="secUserId" placeholder="เช่น staff01"></label><label>ชื่อแสดง<input id="secDisplayName" placeholder="ชื่อพนักงาน"></label><label>รหัสผ่าน<input id="secPassword" type="password" placeholder="เว้นว่างเมื่อไม่เปลี่ยน"></label><label>Role<select id="secRole"><option>ADMIN</option><option>STAFF</option><option>VIEWER</option><option>OWNER</option></select></label><label>สถานะ<select id="secStatus"><option>ACTIVE</option><option>DISABLED</option></select></label><button class="btn success" id="saveSecurityUserBtn">บันทึกผู้ใช้</button></div><div class="admin-list">${users.map(u=>`<div class="admin-card"><div><span class="badge">${html(u.role)}</span></div><div><b>${html(u.displayName||u.userId)}</b><div class="product-meta">${html(u.userId)} • ${html(u.status||'ACTIVE')} • Login ล่าสุด ${html(u.lastLoginAt||'-')}</div></div><button class="btn small" data-security-user="${html(u.userId)}">เลือก</button></div>`).join('')}</div>`:'<div class="warning-box"><strong>บัญชีนี้ดู Security Center ได้ แต่การจัดการผู้ใช้สงวนไว้สำหรับ OWNER</strong></div>'}
  <div class="source-note">สิทธิ์: OWNER = ทั้งหมด • ADMIN/STAFF = จัดการร้าน • VIEWER = ดูข้อมูลอย่างเดียว</div></section>`;
}

function adminSettings() {
  const settings = state.adminData.settings || {};
  const security=state.adminData.security||{},account=security.account||security.actor||{},owner=String(account.role||'')==='OWNER',environment=security.environment||'ไม่ทราบ';
  return `<section class="panel"><h2 class="panel-title">ตั้งค่าร้าน</h2><div class="form-grid"><label>ชื่อร้าน<input id="setShopName" value="${html(settings.shopName || 'GUN SHOP DMO')}"></label><label>ชื่อเจ้าของร้าน<input id="setOwnerName" value="${html(settings.ownerName || 'Natthananat Kawinwatthanakorn')}"></label><label>ยอดครบโปร D2<input id="setThreshold" type="number" value="${html(settings.promoThreshold || 100)}"></label><label>จำนวน D2 ต่อชุด<input id="setReward" type="number" value="${html(settings.promoReward || 150)}"></label><label>รีเฟรชทุกกี่วินาที<input id="setRefresh" type="number" value="${html(settings.autoRefreshSeconds || 60)}"></label><label>พักหลังส่งออเดอร์ (วินาที)<input id="setOrderCooldown" type="number" min="5" max="120" value="${html(settings.orderSubmitCooldownSeconds || 30)}"></label><label>ช่วงตรวจ Rate limit (วินาที)<input id="setOrderRateWindow" type="number" min="60" max="3600" value="${html(settings.orderRateWindowSeconds || 300)}"></label><label>ออเดอร์สูงสุดต่อช่วง<input id="setOrderRateMax" type="number" min="1" max="10" value="${html(settings.orderRateMax || 3)}"></label><label>Session (วัน)<input id="setSessionDays" type="number" min="1" max="30" value="${html(settings.sessionDays || 7)}"></label><label>Auto Lock (นาที)<input id="setAutoLock" type="number" min="5" value="${html(settings.autoLockMinutes || 30)}"></label><label>API Key<input id="setApiKey" type="password" value="${html(settings.apiKey || '')}" placeholder="ตั้งได้ตามต้องการ"></label><label>Facebook URL<input id="setFacebook" value="${html(settings.facebookUrl || '')}"></label><label>LINE URL<input id="setLine" value="${html(settings.lineUrl || '')}"></label><label class="full">โปสเตอร์หน้าบริการ (URL รูปจริง)<input id="setServicePoster" value="${html(settings.servicePosterUrl || '')}" placeholder="เว้นว่างเพื่อซ่อนโปสเตอร์อย่างสะอาด"><small class="product-meta">ใช้รูปโปสเตอร์จริงเท่านั้น หากไม่มีให้เว้นว่าง</small></label><label class="full">ข้อความท้ายออเดอร์<textarea id="setNotice">${html(settings.orderNotice || '')}</textarea></label><label><input id="setAllowOrder" type="checkbox" ${settings.allowOrderSave !== false ? 'checked' : ''}> บันทึกออเดอร์ลงชีต</label><label><input id="setShowStock" type="checkbox" ${settings.showStock !== false ? 'checked' : ''}> แสดงสต๊อกแก่ลูกค้า</label><button class="btn success full" id="saveSettingsBtn">บันทึกการตั้งค่า</button></div></section>
  <section class="panel"><div class="admin-toolbar"><div><h2 class="panel-title">🔐 บัญชีและความปลอดภัย</h2><p class="product-meta">เปลี่ยนรหัสผ่านจากหน้านี้เป็นวิธีหลักสำหรับการใช้งานประจำ</p></div><span class="badge ${environment==='PRODUCTION'?'red':environment==='TEST'?'amber':''}">${html(environment)}</span></div><div class="stat-grid"><div class="stat-card"><span>User ID</span><strong>${html(account.userId||'-')}</strong></div><div class="stat-card"><span>Role</span><strong>${html(account.role||'-')}</strong></div><div class="stat-card"><span>สถานะบัญชี</span><strong>${html(account.status||'ACTIVE')}</strong></div></div>${owner?`<div class="form-grid owner-password-form"><label>รหัสผ่านปัจจุบัน<div class="password-field"><input id="ownerCurrentPassword" type="password" autocomplete="current-password"><button type="button" class="btn small" data-toggle-password="ownerCurrentPassword">แสดง</button></div></label><label>รหัสผ่านใหม่<div class="password-field"><input id="ownerNewPassword" type="password" minlength="10" autocomplete="new-password"><button type="button" class="btn small" data-toggle-password="ownerNewPassword">แสดง</button></div></label><label>ยืนยันรหัสผ่านใหม่<div class="password-field"><input id="ownerConfirmPassword" type="password" minlength="10" autocomplete="new-password"><button type="button" class="btn small" data-toggle-password="ownerConfirmPassword">แสดง</button></div></label><button class="btn success" id="changeOwnerPasswordBtn">เปลี่ยนรหัสผ่าน</button></div><div class="security-note">รหัสผ่านใหม่ต้องมีอย่างน้อย 10 ตัวอักษร เมื่อเปลี่ยนสำเร็จ ระบบจะออกจากทุก Session และให้เข้าสู่ระบบใหม่</div>`:`<div class="warning-box"><strong>เฉพาะ OWNER เท่านั้นที่เปลี่ยนรหัสผ่าน OWNER ได้</strong></div>`}</section>`;
}

function adminLogs() {
  const logs = state.adminData.logs || [];
  return `<section class="panel"><h2 class="panel-title">ประวัติการแก้ไข</h2><div style="overflow:auto"><table class="order-table"><thead><tr><th>เวลา</th><th>การทำงาน</th><th>ประเภท</th><th>รายการ</th><th>รายละเอียด</th></tr></thead><tbody>${logs.map((log) => `<tr><td>${html(log.createdAt)}</td><td>${html(log.action)}</td><td>${html(log.kind)}</td><td>${html(log.name || log.id)}</td><td>${html(log.details)}</td></tr>`).join('')}</tbody></table></div></section>`;
}

function editModal() {
  const record = state.editRecord || { kind: 'SEAL', status: 'ACTIVE', category: 'AT', section: 'NORMAL', unit: 'ชุด', packSize: 1000, sortOrder: 10 };
  const seal = record.kind === 'SEAL';
  const service = record.kind === 'SERVICE';
  const tMoney=record.kind==='TMONEY';
  return `<div class="modal-backdrop" id="modalBackdrop"><div class="modal"><h2>${record.id ? 'แก้ไข' : 'เพิ่ม'}${seal ? 'ซีล' : service ? 'บริการ' : tMoney ? 'เงิน T' : 'ไอเทม'}</h2><div class="form-grid"><label>ชื่อ<input id="fName" value="${html(record.name || '')}" ${tMoney?'readonly':''}></label><label>ชื่อค้นหาเพิ่มเติม<input id="fAliases" value="${html(Array.isArray(record.aliases) ? record.aliases.join('|') : record.aliases || '')}" placeholder="คั่นด้วย |"></label>${seal ? `<label>สาย<select id="fCategory">${['AT', 'HT', 'CT', 'HP', 'DS', 'DE', 'EV', 'BL'].map((category) => `<option ${record.category === category ? 'selected' : ''}>${category}</option>`).join('')}</select></label><label>ประเภท<select id="fSection">${['NORMAL', 'BASE_HARD', 'SUSA'].map((section) => `<option value="${section}" ${record.section === section ? 'selected' : ''}>${sectionLabel(section)}</option>`).join('')}</select></label><label>ชื่ออังกฤษ/คำค้น DMO Wiki<input id="fWikiName" value="${html(record.wikiName || '')}" placeholder="เช่น Agumon"></label><label>ชื่อหน้าที่เชื่อม<input id="fWikiTitle" value="${html(record.wikiTitle || '')}" placeholder="เชื่อมผ่าน DMO Wiki Center"></label><label class="full">URL DMO Wiki<input id="fWikiUrl" value="${html(record.wikiUrl || '')}"></label>` : service ? `<label>หมวดบริการ<input id="fServiceCategory" value="${html(record.serviceCategory || '')}" placeholder="เช่น ดันเจียน / เควสต์"></label>` : tMoney ? '<div class="security-note">สินค้าเงิน T มีได้หนึ่งรายการ ระบบใช้ Rate × จำนวน T และตรวจ Stock ฝั่ง Server</div>' : `<label>หมวดไอเทม<input id="fItemCategory" value="${html(record.itemCategory || '')}"></label>`}<label>${tMoney?'Rate (บาท/T)':'ราคา'}<input id="fPrice" type="number" step="0.01" min="0" value="${html(record.price || 0)}"></label><label>หน่วย<input id="fUnit" value="${html(record.unit || (service ? 'ครั้ง' : tMoney ? 'T' : 'ชิ้น'))}" ${tMoney?'readonly':''}></label>${seal ? `<label>จำนวนต่อชุด<input id="fPackSize" type="number" value="${html(record.packSize || 1000)}"></label>` : ''}<label>สถานะ<select id="fStatus">${['ACTIVE', 'CHECK_STOCK', 'OUT_OF_STOCK', 'INACTIVE', 'HIDDEN'].map((status) => `<option ${record.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label><label>สต๊อกทั้งหมด (เว้นว่าง = ตรวจสอบ)<input id="fStock" type="number" value="${record.stock === '' ? '' : html(record.stock)}"></label><label>จำนวนที่กันไว้<input id="fReservedStock" type="number" min="0" value="${html(record.reservedStock || 0)}"></label><label>แจ้งเตือนใกล้หมด<input id="fLowStockAlert" type="number" min="0" value="${html(record.lowStockAlert || 0)}"></label><label>ต้นทุนต่อหน่วย<input id="fCostPrice" type="number" step="0.01" min="0" value="${html(record.costPrice || '')}"></label><label>ลำดับแสดง<input id="fSort" type="number" value="${html(record.sortOrder || 10)}"></label><label>ป้ายสินค้า<input id="fBadge" value="${html(record.badge || '')}" placeholder="HOT / NEW / SALE"></label><label>แท็กค้นหา<input id="fTags" value="${html(record.tags || '')}" placeholder="PVP|ขายดี|ดิจิมอน X"></label><label class="full">คำค้นเพิ่มเติม<input id="fSearchKeywords" value="${html(record.searchKeywords || '')}" placeholder="คำสะกดอื่นหรือคำที่ลูกค้ามักใช้"></label><label class="full">หมายเหตุ<input id="fNote" value="${html(record.note || '')}"></label>${seal ? '' : `<label class="full">รายละเอียด<textarea id="fDescription">${html(record.description || '')}</textarea></label>`}<label class="full">URL รูป<input id="fImageUrl" value="${html(record.imageUrl || '')}"></label><label class="full">อัปโหลดรูป<input id="fImageFile" type="file" accept="image/*"></label></div><div class="chip-row" style="margin-top:14px">${seal ? '<button class="btn warning" id="wikiGalleryBtn">🖼 เลือกรูป Seal Master</button><button class="btn primary" id="wikiCenterRecordBtn">📚 ค้นหน้าข้อมูล DMO Wiki</button>' : ''}<button class="btn success" id="saveRecordBtn">บันทึก</button><button class="btn" id="closeModalBtn">ยกเลิก</button></div></div></div>`;
}

function wikiGalleryModal() {
  const filtered = state.wikiGallery.filter((item) => !state.wikiSearch || norm(item.title).includes(norm(state.wikiSearch)));
  return `<div class="modal-backdrop wiki-layer" id="wikiBackdrop"><div class="modal wiki-modal"><div class="admin-toolbar"><div><h2>รูปจาก DMO Wiki — Seal Master</h2><p class="product-meta">เลือกรูปแล้วระบบจะคัดลอกมาเก็บใน Google Drive ของร้าน</p></div><button class="btn" id="closeWikiBtn">ปิด</button></div><input id="wikiSearch" placeholder="ค้นหาชื่ออังกฤษ เช่น Agumon" value="${html(state.wikiSearch)}"><div class="wiki-grid">${filtered.length ? filtered.map((item) => `<button class="wiki-item" data-wiki-import="${html(item.url)}" data-wiki-title="${html(item.title)}"><img src="${html(item.thumb || item.url)}" alt="${html(item.title)}" loading="lazy"><span>${html(item.title.replace(/^File:/, ''))}</span></button>`).join('') : '<div class="empty">ไม่พบรูป</div>'}</div><p class="source-note">แหล่งรูป: <a href="https://dmowiki.com/Seal_Master" target="_blank" rel="noopener">DMO Wiki — Seal Master</a></p></div></div>`;
}

function adminBootstrapData() {
  return {seals:state.seals||[],gameItems:state.items||[],services:state.services||[],moneyT:state.moneyT||null,settings:state.settings||{},orders:[],deletedOrders:[],orderItems:[],logs:[],stockLogs:[],stockUpdatedAt:'',customers:[],customerInteractions:[],promotions:state.promotions||[],trash:[],security:{actor:state.adminUser||{}},automation:{},facebookBump:null,databaseVersion:''};
}

async function loadAdmin(force = true) {
  if (state.adminLoading) return adminLoadPromise;
  if (!force && state.adminData && state.adminLoadedAt && Date.now() - state.adminLoadedAt < 30000) { render(); return; }
  state.adminLoading = true;
  if (!state.adminData) { state.adminData = adminBootstrapData(); render(); }
  adminLoadPromise=(async()=>{try {
    const data = await apiPost({action:'getAdminData',token:state.adminToken});
    state.adminData = { seals: data.seals || [], gameItems: data.gameItems || [], services: data.services || [], moneyT:data.moneyT||null, settings: data.settings || {}, orders: data.orders || [], deletedOrders:data.deletedOrders||[], orderItems:data.orderItems||[], logs: data.logs || [], stockLogs: data.stockLogs || [], stockUpdatedAt:data.stockUpdatedAt||'', customers: data.customers || [], customerInteractions:data.customerInteractions||[], promotions: data.promotions || [], trash: data.trash || [], security: data.security || {}, automation: data.automation || {}, facebookBump:data.facebookBump||state.adminData?.facebookBump||null, databaseVersion:data.databaseVersion||'' };
    state.adminLoadedAt = Date.now();
    if(data.security&&data.security.actor){state.adminUser={...(state.adminUser||{}),...data.security.actor};sessionStorage.setItem('dmo_admin_user',JSON.stringify(state.adminUser));}
    render();
  } catch (error) {
    if (/เข้าสู่ระบบ/.test(error.message)) {
      state.adminToken = '';
      sessionStorage.removeItem('dmo_admin_token');
    }
    toast(error.message);
    render();
  } finally {
    state.adminLoading = false;adminLoadPromise=null;
  }})();
  return adminLoadPromise;
}

async function loadFacebookBumpAdminData() {
  if (state.facebookBump.loadingModule) return;
  state.facebookBump.loadingModule = true;state.facebookBump.loadError='';state.facebookBump.loadStartedAt=performance.now();
  render();
  try {
    const [backend]=await Promise.all([apiPost({action:'getFacebookBumpAdminData',token:state.adminToken}),refreshFacebookWorker()]);
    state.adminData.facebookBump = backend.facebookBump || null;
    await recoverFacebookWorkerPair();
  } catch (error) {
    state.facebookBump.loadError=error.message||'โหลด Facebook Module ไม่สำเร็จ';toast(state.facebookBump.loadError);
  } finally {
    state.facebookBump.loadingModule = false;state.facebookBump.loadDurationMs=Math.round(performance.now()-state.facebookBump.loadStartedAt);
    render();
  }
}

async function saveRecordAction() {
  try {
    const old = state.editRecord;
    const seal = old.kind === 'SEAL';
    const service = old.kind === 'SERVICE';
    const tMoney = old.kind === 'TMONEY';
    let imageUrl = document.getElementById('fImageUrl').value.trim();
    const file = document.getElementById('fImageFile').files[0];
    if (file) {
      toast('กำลังอัปโหลดรูป...');
      imageUrl = await uploadFile(file);
    }
    const record = {
      ...old,
      name: document.getElementById('fName').value.trim(),
      aliases: document.getElementById('fAliases').value.split('|').map((x) => x.trim()).filter(Boolean),
      price: Number(document.getElementById('fPrice').value) || 0,
      unit: document.getElementById('fUnit').value.trim(),
      status: document.getElementById('fStatus').value,
      stock: document.getElementById('fStock').value === '' ? '' : Number(document.getElementById('fStock').value),
      reservedStock: Number(document.getElementById('fReservedStock').value) || 0,
      lowStockAlert: Number(document.getElementById('fLowStockAlert').value) || 0,
      costPrice: document.getElementById('fCostPrice').value === '' ? '' : Number(document.getElementById('fCostPrice').value),
      sortOrder: Number(document.getElementById('fSort').value) || 10,
      badge: document.getElementById('fBadge').value.trim(),
      note: document.getElementById('fNote').value.trim(),
      tags: document.getElementById('fTags').value.trim(),
      searchKeywords: document.getElementById('fSearchKeywords').value.trim(),
      imageUrl,
    };
    if (seal) {
      record.category = document.getElementById('fCategory').value;
      record.section = document.getElementById('fSection').value;
      record.packSize = Number(document.getElementById('fPackSize').value) || 1000;
      record.wikiName = document.getElementById('fWikiName').value.trim();
      record.wikiTitle = document.getElementById('fWikiTitle').value.trim();
      record.wikiUrl = document.getElementById('fWikiUrl').value.trim();
    } else {
      record.description = document.getElementById('fDescription').value.trim();
      if (service) record.serviceCategory = document.getElementById('fServiceCategory').value.trim();
      else if(tMoney){record.name='เงิน T';record.itemCategory='MONEY_T';record.unit='T';}
      else record.itemCategory = document.getElementById('fItemCategory').value.trim();
    }
    await apiPost({ action: 'upsert', token: state.adminToken, record });
    state.editRecord = null;
    toast('บันทึกสินค้าแล้ว');
    await loadAdmin();
    await loadData(false);
  } catch (error) {
    toast(error.message);
  }
}

function uploadFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = String(reader.result).split(',')[1];
        const data = await apiPost({ action: 'uploadImage', token: state.adminToken, data: base64, mimeType: file.type, fileName: file.name });
        resolve(data.imageUrl);
      } catch (error) { reject(error); }
    };
    reader.onerror = () => reject(Error('อ่านไฟล์รูปไม่สำเร็จ'));
    reader.readAsDataURL(file);
  });
}

function fileAsBase64(file,errorMessage='อ่านไฟล์ไม่สำเร็จ'){
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(Error(errorMessage));reader.readAsDataURL(file);});
}
async function selectImageZip(file){
  if(!file)return;
  if(!/\.zip$/i.test(file.name))return toast('กรุณาเลือกไฟล์ .zip');
  if(file.size>8*1024*1024)return toast('ZIP ต้องมีขนาดไม่เกิน 8 MB');
  try{state.imageManager={zipData:await fileAsBase64(file,'อ่านไฟล์ ZIP ไม่สำเร็จ'),fileName:file.name,preview:null,applying:false,allowOverwrite:false,lastResult:null,requestId:''};render();toast('อ่าน ZIP แล้ว กรุณากด Preview');}catch(error){toast(error.message);}
}
async function previewImageZipAction(){
  const manager=state.imageManager;if(manager.applying||!manager.zipData)return;
  try{manager.applying=true;manager.preview=null;render();const preview=await apiPost({action:'previewImageZip',token:state.adminToken,zipData:manager.zipData,fileName:manager.fileName});manager.preview=preview;manager.requestId=crypto.randomUUID?crypto.randomUUID():`IMG-${Date.now()}-${Math.random().toString(16).slice(2)}`;toast(`Preview สำเร็จ: Match ${preview.summary.match} รูป`);}catch(error){toast(error.message);}finally{manager.applying=false;render();}
}
async function applyImageZipAction(){
  const manager=state.imageManager,preview=manager.preview;if(manager.applying||!preview)return;
  if((preview.conflicts||[]).length)return toast('กรุณาแก้ Conflict ก่อน Apply');
  if(manager.allowOverwrite&&Number(preview.summary.overwrite||0)>0&&!confirm(`ยืนยันเขียนทับรูปเดิม ${preview.summary.overwrite} รายการ?\nระบบจะ Backup mapping ก่อนทุกครั้ง`))return;
  if(!confirm(`ยืนยัน Apply รูปที่ Match ${preview.summary.match} รายการ?\nไฟล์ที่ไม่ตรงจะไม่ถูกนำเข้า`))return;
  try{manager.applying=true;render();const result=await apiPost({action:'applyImageZip',token:state.adminToken,zipData:manager.zipData,fileName:manager.fileName,zipHash:preview.zipHash,requestId:manager.requestId,allowOverwrite:manager.allowOverwrite,overwriteConfirmation:manager.allowOverwrite?'OVERWRITE_CONFIRMED':''});state.imageManager={zipData:'',fileName:'',preview:null,applying:false,allowOverwrite:false,lastResult:result,requestId:''};await loadAdmin(true);state.publicLoadedAt=0;await loadData(false);toast(`Apply รูปสำเร็จ ${result.applied} รายการ`);}catch(error){manager.applying=false;toast(error.message);render();}
}
function downloadMissingImageReport(){
  const rows=(state.imageManager.preview&&state.imageManager.preview.missingProducts)||[];if(!rows.length)return toast('ไม่มีรายการสินค้าที่ขาดรูป');csvDownload(`missing-images-${new Date().toISOString().slice(0,10)}.csv`,['kind','productId','productName'],rows.map(x=>[x.kind,x.id,x.name]));
}

async function openWikiGallery() {
  try {
    toast('กำลังโหลดรูปจาก DMO Wiki...');
    const data = await apiPost({ action: 'wikiGallery', token: state.adminToken });
    state.wikiGallery = data.images || [];
    state.wikiSearch = (document.getElementById('fWikiName') || {}).value || '';
    render();
  } catch (error) { toast(error.message); }
}

async function importWikiImage(url, title) {
  try {
    toast('กำลังนำเข้ารูปไปยัง Google Drive...');
    const data = await apiPost({ action: 'importWikiImage', token: state.adminToken, imageUrl: url, fileName: title });
    state.editRecord.imageUrl = data.imageUrl;
    if (!state.editRecord.wikiName) state.editRecord.wikiName = String(title).replace(/^File:/, '').replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
    state.wikiGallery = null;
    render();
    toast('เลือกรูปแล้ว กดบันทึกสินค้าอีกครั้ง');
  } catch (error) { toast(error.message); }
}

async function saveOrderStatus(id) {
  if(state.adminActionPending)return;
  try {
    const status = document.querySelector(`[data-order-status="${CSS.escape(id)}"]`).value;
    const adminNote = document.querySelector(`[data-order-note="${CSS.escape(id)}"]`).value;
    state.adminActionPending=id;render();
    await apiPost({ action: 'updateOrder', token: state.adminToken, orderId: id, status, adminNote });
    toast('อัปเดตออเดอร์แล้ว');
    await loadAdmin();
  } catch (error) { toast(error.message); } finally {state.adminActionPending='';render();}
}

async function archiveOrderFromAdmin(id){
  if(state.adminActionPending)return;
  const order=[...(state.adminData?.orders||[]),...(state.adminData?.deletedOrders||[])].find(x=>String(x.orderId)===String(id));
  const legacy=String(order?.legacyOrder||'').toUpperCase()==='TRUE'||order?.legacyOrder===true;
  const detail=legacy?'ออเดอร์เก่านี้จะถูกเก็บเข้าถังโดยไม่เปลี่ยน Stock หรือ Reserved Stock':'ถ้าออเดอร์ยังจองสต๊อก ระบบจะยกเลิกและคืน Reserved Stock เพียงครั้งเดียว';
  if(!confirm(`ยืนยันเก็บออเดอร์ ${id} เข้าถัง?\n\n${detail}`))return;
  const reason=prompt(`ระบุเหตุผลที่เก็บออเดอร์\n${id}`,'เก็บออเดอร์จากหน้าจัดการ');
  if(reason===null)return;
  if(!String(reason).trim()){toast('กรุณาระบุเหตุผล');return;}
  try{state.adminActionPending=id;render();await apiPost({action:'archiveOrder',token:state.adminToken,orderId:id,reason:String(reason).trim()});toast('เก็บออเดอร์เข้าถังแล้ว');await loadAdmin();}catch(error){toast(error.message);}finally{state.adminActionPending='';render();}
}
async function restoreOrderFromAdmin(id){if(state.adminActionPending)return;if(!confirm(`ยืนยันกู้คืนออเดอร์ ${id}?\n\nระบบจะไม่จองหรือตัดสต๊อกอัตโนมัติ`))return;try{state.adminActionPending=id;render();await apiPost({action:'restoreArchivedOrder',token:state.adminToken,orderId:id});toast('กู้คืนออเดอร์แล้ว โดยคงสถานะสต๊อกเดิม');await loadAdmin();}catch(error){toast(error.message);}finally{state.adminActionPending='';render();}}

async function saveSettingsAction() {
  try {
    const settings = {
      shopName: document.getElementById('setShopName').value,
      ownerName: document.getElementById('setOwnerName').value,
      promoThreshold: Number(document.getElementById('setThreshold').value) || 100,
      promoReward: Number(document.getElementById('setReward').value) || 150,
      autoRefreshSeconds: Number(document.getElementById('setRefresh').value) || 60,
      orderSubmitCooldownSeconds: Math.max(5,Math.min(120,Number(document.getElementById('setOrderCooldown').value)||30)),
      orderRateWindowSeconds: Math.max(60,Math.min(3600,Number(document.getElementById('setOrderRateWindow').value)||300)),
      orderRateMax: Math.max(1,Math.min(10,Number(document.getElementById('setOrderRateMax').value)||3)),
      facebookUrl: document.getElementById('setFacebook').value,
      lineUrl: document.getElementById('setLine').value,
      servicePosterUrl: document.getElementById('setServicePoster').value,
      orderNotice: document.getElementById('setNotice').value,
      allowOrderSave: document.getElementById('setAllowOrder').checked ? 'TRUE' : 'FALSE',
      showStock: document.getElementById('setShowStock').checked ? 'TRUE' : 'FALSE',
      sessionDays: Number(document.getElementById('setSessionDays').value) || 7,
      autoLockMinutes: Number(document.getElementById('setAutoLock').value) || 30,
      apiKey: document.getElementById('setApiKey').value,
    };
    await apiPost({ action: 'saveSettings', token: state.adminToken, settings });
    toast('บันทึกการตั้งค่าแล้ว');
    await loadAdmin();
    await loadData(false);
  } catch (error) { toast(error.message); }
}


async function adjustStockAction(kind, id, delta) {
  if(state.stockActionPending)return;
  const product = (kind === 'SEAL' ? state.adminData.seals : kind==='TMONEY'?[state.adminData.moneyT]:state.adminData.gameItems).find((entry) => entry&&entry.id === id);
  if(!product)return toast('ไม่พบสินค้า');
  const reason = prompt(`เหตุผลในการ${delta >= 0 ? 'เพิ่ม' : 'ลด'}สต๊อก ${product.name}`, delta >= 0 ? 'เติมของเข้า' : 'ขาย/นำออก');
  if (reason === null) return;
  if(!String(reason).trim())return toast('กรุณาระบุเหตุผล');
  if(!confirm(`ยืนยัน${delta>=0?'เพิ่ม':'ลด'} ${product.name} ${Math.abs(delta).toLocaleString('th-TH')} ${product.unit||'ชิ้น'}?`))return;
  const fingerprint=`ADJUST|${kind}|${id}|${delta}|${String(reason).trim()}`,requestId=state.stockPendingRequests[fingerprint]||(state.stockPendingRequests[fingerprint]=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    state.stockActionPending=fingerprint;state.stockActionResult={message:'กำลังอัปเดต Stock กรุณารอสักครู่...',detail:product.name};render();
    const data=await apiPost({ action: 'adjustStock', token: state.adminToken, kind, id, delta, reason:String(reason).trim(),requestId });
    delete state.stockPendingRequests[fingerprint];state.stockActionResult={message:data.duplicate?'คำขอนี้สำเร็จแล้ว ระบบไม่เพิ่มซ้ำ':'เพิ่ม Stock สำเร็จ',detail:`${data.productName}: ${money(data.beforeStock)} → ${Number(data.changeAmount)>0?'+':''}${money(data.changeAmount)} → ${money(data.stock)} • ${new Date(data.updatedAt).toLocaleString('th-TH')}`};
    toast(state.stockActionResult.message);await loadAdmin(true);await loadData(false);
  } catch (error) { state.stockActionResult={message:'ไม่สามารถอัปเดต Stock ได้ กรุณาลองใหม่',detail:error.message};toast(error.message); }
  finally{state.stockActionPending='';render();}
}

async function setStockAction(kind, id) {
  if(state.stockActionPending)return;
  const product = (kind === 'SEAL' ? state.adminData.seals : kind==='TMONEY'?[state.adminData.moneyT]:state.adminData.gameItems).find((entry) => entry&&entry.id === id);
  if (!product) return;
  const stockTextValue = prompt(`กำหนดสต๊อกทั้งหมดของ ${product.name}\nเว้นว่าง = ต้องตรวจสอบสต๊อก`, product.stock === '' ? '' : product.stock);
  if (stockTextValue === null) return;
  const reservedText = prompt('จำนวนที่กันไว้', product.reservedStock || 0);
  if (reservedText === null) return;
  const lowText = prompt('แจ้งเตือนเมื่อคงเหลือขายต่ำกว่าหรือเท่าไร', product.lowStockAlert || 0);
  if (lowText === null) return;
  const reason = prompt('เหตุผล', 'กำหนดสต๊อก') ?? 'กำหนดสต๊อก';
  const fingerprint=`SET|${kind}|${id}|${stockTextValue}|${reservedText}|${lowText}|${reason}`,requestId=state.stockPendingRequests[fingerprint]||(state.stockPendingRequests[fingerprint]=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    state.stockActionPending=fingerprint;state.stockActionResult={message:'กำลังอัปเดต Stock กรุณารอสักครู่...',detail:product.name};render();
    await apiPost({
      action: 'setStock', token: state.adminToken, kind, id,
      stock: stockTextValue === '' ? '' : Number(stockTextValue),
      reservedStock: Number(reservedText) || 0,
      lowStockAlert: Number(lowText) || 0,
      reason,requestId,
    });
    delete state.stockPendingRequests[fingerprint];
    toast('บันทึกสต๊อกแล้ว');
    state.stockActionResult={message:'บันทึก Stock สำเร็จ',detail:product.name};await loadAdmin(true);
    await loadData(false);
  } catch (error) {state.stockActionResult={message:'ไม่สามารถอัปเดต Stock ได้ กรุณาลองใหม่',detail:error.message};toast(error.message);}
  finally{state.stockActionPending='';render();}
}

async function addStockFromForm(){
  if(state.stockActionPending)return;const selected=document.getElementById('stockAddProduct')?.value||'',amount=Number(document.getElementById('stockAddAmount')?.value),reason=String(document.getElementById('stockAddReason')?.value||'').trim();
  if(!selected)return toast('กรุณาเลือกสินค้า');if(!Number.isFinite(amount)||amount<=0)return toast('จำนวนที่เพิ่มต้องมากกว่า 0');if(!Number.isInteger(amount))return toast('จำนวนที่เพิ่มต้องเป็นจำนวนเต็ม');if(!reason)return toast('กรุณาระบุเหตุผล');
  const [kind,id]=selected.split('|'),list=kind==='SEAL'?state.adminData.seals:kind==='TMONEY'?[state.adminData.moneyT]:state.adminData.gameItems,product=list.find(x=>x&&String(x.id)===String(id));if(!product)return toast('ไม่พบสินค้า');
  const fingerprint=`ADD|${kind}|${id}|${amount}|${reason}`;if(state.stockConfirmFingerprint!==fingerprint){state.stockConfirmFingerprint=fingerprint;state.stockActionResult={message:`ยืนยันเพิ่ม ${product.name} ${money(amount)} ${product.unit||'ชิ้น'}?`,detail:'ตรวจสอบข้อมูล แล้วกด “ยืนยันเพิ่ม Stock” อีกครั้ง'};render();return;}
  const requestId=state.stockPendingRequests[fingerprint]||(state.stockPendingRequests[fingerprint]=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try{state.stockConfirmFingerprint='';state.stockActionPending='ADD_FORM';state.stockActionResult={message:'กำลังอัปเดต Stock กรุณารอสักครู่...',detail:product.name};render();const data=await apiPost({action:'adjustStock',token:state.adminToken,kind,id,delta:amount,reason,requestId});delete state.stockPendingRequests[fingerprint];state.stockAddDraft={product:'',amount:'',reason:'เติมของเข้า'};state.stockActionResult={message:data.duplicate?'คำขอนี้สำเร็จแล้ว ระบบไม่เพิ่มซ้ำ':'เพิ่ม Stock สำเร็จ',detail:`${data.productName}: เดิม ${money(data.beforeStock)} • เพิ่ม ${money(data.changeAmount)} • ใหม่ ${money(data.stock)} • ${new Date(data.updatedAt).toLocaleString('th-TH')}`};toast(state.stockActionResult.message);await loadAdmin(true);await loadData(false);}catch(error){state.stockActionResult={message:'ไม่สามารถอัปเดต Stock ได้ กรุณาลองใหม่',detail:error.message};toast(error.message);}finally{state.stockActionPending='';render();}
}

function addToCartSilent(product, quantity) {
  quantity = Math.max(1, Math.floor(Number(quantity) || 1));
  const existing = state.cart.find((entry) => entry.id === product.id);
  const nextQuantity = (existing ? existing.quantity : 0) + quantity;
  const max = productMaxQty(product);
  if (nextQuantity > max) {
    if (existing) existing.quantity = max;
    else if (max > 0) state.cart.push(cartProductSnapshot(product,max));
    toast(stockLimitMessage(product));
    return false;
  }
  if (existing) existing.quantity = nextQuantity;
  else state.cart.push(cartProductSnapshot(product,quantity));
  return true;
}

async function facebookBumpRequest(pendingKey, payload, successMessage) {
  if (state.facebookBump.pending) return;
  try {
    state.facebookBump.pending = pendingKey;
    render();
    toast(facebookWorkingMessage(pendingKey));
    const result = await apiPost({ ...payload, token: state.adminToken });
    if (successMessage) toast(result.message || successMessage);
    const refreshed = await apiPost({action:'getFacebookBumpAdminData',token:state.adminToken});
    state.adminData.facebookBump = refreshed.facebookBump || null;
    await refreshFacebookWorker();
    render();
    return result;
  } catch (error) {
    toast(facebookFriendlyError(error));
    return null;
  } finally {
    state.facebookBump.pending = '';
    render();
  }
}

async function saveFacebookBumpPostFromForm(event) {
  event?.preventDefault();
  const current=state.facebookBump.edit||{};
  const post={id:current.id||'',name:document.getElementById('fbPostName')?.value||'',postUrl:document.getElementById('fbPostUrl')?.value||'',bumpMessage:document.getElementById('fbPostMessage')?.value||'+',intervalMinutes:Number(document.getElementById('fbPostInterval')?.value||60),enabled:!!document.getElementById('fbPostEnabled')?.checked};
  const result=await facebookBumpRequest('SAVE_POST',{action:'saveFacebookBumpPost',post},'บันทึกโพสต์แล้ว');
  if(result)state.facebookBump.edit=null;
}

async function saveFacebookBumpSettingsFromForm() {
  const mode=document.getElementById('fbMode')?.value||'DRY_RUN',connection=state.facebookBump.connection||{};
  if(mode==='REAL'&&(connection.connection!=='CONNECTED'||!connection.paired))throw Error('กรุณาเปิด Local Worker และเชื่อมต่อ Facebook ให้สำเร็จก่อน');
  const realConfirmed=mode==='REAL'&&confirm('ยืนยันเปิด REAL FACEBOOK? ระบบจะส่ง Comment จริงตาม Queue ทีละโพสต์')?'ENABLE_REAL_FACEBOOK':'';if(mode==='REAL'&&!realConfirmed)return;
  const settings={mode,realConfirmed,defaultInterval:Number(document.getElementById('fbDefaultInterval')?.value||60),defaultMessage:document.getElementById('fbDefaultMessage')?.value||'+',delaySeconds:Number(document.getElementById('fbDelaySeconds')?.value||0),cleanupOld:!!document.getElementById('fbCleanupOld')?.checked};
  await facebookBumpRequest('SAVE_SETTINGS',{action:'saveFacebookBumpSettings',settings},'บันทึกการตั้งค่าแล้ว');
}

function bind() {
  document.querySelectorAll('[data-type]').forEach((button) => button.onclick = () => { state.catalogType = button.dataset.type; state.wishlistOnly=false; state.search = ''; state.selectedSearchKey = '';state.catalogVisible=60; render(); });
  const favoritesBtn=document.getElementById('favoritesBtn');if(favoritesBtn)favoritesBtn.onclick=()=>{state.wishlistOnly=!state.wishlistOnly;state.catalogVisible=60;render();};
  const repeatLatestBtn=document.getElementById('repeatLatestBtn');if(repeatLatestBtn)repeatLatestBtn.onclick=()=>repeatOrder(state.recentOrders[0]);
  document.querySelectorAll('[data-repeat-order]').forEach((button)=>button.onclick=()=>repeatOrder(state.recentOrders[Number(button.dataset.repeatOrder)]));
  document.querySelectorAll('[data-favorite]').forEach((button)=>button.onclick=()=>{const [kind,id]=button.dataset.favorite.split('|');const p=allProducts().find((x)=>x.kind===kind&&x.id===id);if(p)toggleFavorite(p);});
  document.querySelectorAll('[data-cat]').forEach((button) => button.onclick = () => { state.category = button.dataset.cat; state.selectedSearchKey = '';state.catalogVisible=60; render(); });
  document.querySelectorAll('[data-sec]').forEach((button) => button.onclick = () => { state.section = button.dataset.sec; state.selectedSearchKey = '';state.catalogVisible=60; render(); });
  const refresh = document.getElementById('refreshBtn'); if (refresh) refresh.onclick = () => loadData(true);
  const search = document.getElementById('searchInput'); if (search) { search.oninput = (event) => { state.search = event.target.value; state.selectedSearchKey = '';state.catalogVisible=60; scheduleInputRender('searchInput', 120); }; search.onkeydown = (event) => { if (event.key === 'Enter') { clearTimeout(inputRenderTimer); state.selectedSearchKey = ''; rememberSearch(state.search); render(); } }; }
  const searchClear = document.getElementById('searchClearBtn'); if (searchClear) searchClear.onclick = () => { state.search = ''; state.selectedSearchKey = '';state.catalogVisible=60; render(); };
  document.querySelectorAll('[data-search-suggestion]').forEach((button) => button.onclick = () => { state.search = button.dataset.searchSuggestion; state.selectedSearchKey = button.dataset.searchProduct || ''; rememberSearch(state.search); render(); });
  document.querySelectorAll('[data-recent-search]').forEach((button) => button.onclick = () => { state.search = button.dataset.recentSearch; state.selectedSearchKey = ''; render(); });
  const clearRecent = document.getElementById('clearRecentSearches'); if (clearRecent) clearRecent.onclick = () => { state.recentSearches = []; localStorage.removeItem('dmo_recent_searches'); render(); };
  const loadMoreProductsBtn=document.getElementById('loadMoreProductsBtn');if(loadMoreProductsBtn)loadMoreProductsBtn.onclick=()=>{state.catalogVisible+=60;render();};
  const emptyResetBtn=document.getElementById('emptyResetBtn');if(emptyResetBtn)emptyResetBtn.onclick=()=>{state.search='';state.selectedSearchKey='';state.category='ALL';state.section='ALL';state.catalogVisible=60;render();};
  document.querySelectorAll('[data-add]').forEach((button) => button.onclick = () => { const quantity = document.querySelector(`[data-qty="${CSS.escape(button.dataset.add)}"]`); addToCart(button.dataset.add, quantity && quantity.value); });
  document.querySelectorAll('[data-inc]').forEach((button) => button.onclick = () => { const item = state.cart.find((entry) => entry.id === button.dataset.inc); const product=item&&allProducts().find((entry)=>entry.id===item.id&&entry.kind===item.kind); if(item&&product){if(item.quantity>=productMaxQty(product))toast(stockLimitMessage(product));else item.quantity+=1;} render(); });
  document.querySelectorAll('[data-dec]').forEach((button) => button.onclick = () => { const item = state.cart.find((entry) => entry.id === button.dataset.dec); if (item) { item.quantity -= 1; if (item.quantity <= 0) state.cart = state.cart.filter((entry) => entry.id !== item.id); } render(); });
  document.querySelectorAll('[data-remove]').forEach((button) => button.onclick = () => { state.cart = state.cart.filter((entry) => entry.id !== button.dataset.remove); render(); });
  ['tamer', 'contact'].forEach((id) => { const input = document.getElementById(id); if (input) input.oninput = (event) => { state.customer[id] = event.target.value; }; });
  const clear = document.getElementById('clearCartBtn'); if (clear) clear.onclick = () => { state.cart = []; render(); };
  const copy = document.getElementById('copyOnlyBtn'); if (copy) copy.onclick = async () => {if(copy.disabled)return;copy.disabled=true;try{saveRecentOrderSnapshot();await copyText(orderText(customerValues()),'คัดลอกแล้ว นำรายการไปวางในแชต Facebook ของร้านได้เลย');state.copyNotice='คัดลอกแล้ว นำรายการไปวางในแชต Facebook ของร้านได้เลย';render();}catch(error){toast('คัดลอกไม่สำเร็จ กรุณาลองใหม่');}finally{if(copy.isConnected)copy.disabled=false;}};
  const favoriteCart=document.getElementById('favoriteCartBtn');if(favoriteCart)favoriteCart.onclick=()=>{state.cart.forEach((item)=>{const p=allProducts().find((x)=>x.id===item.id&&x.kind===item.kind);if(p&&!isFavorite(p))state.favoriteKeys.push(productKey(p));});state.favoriteKeys=[...new Set(state.favoriteKeys)].slice(0,300);localStorage.setItem('dmo_favorites',JSON.stringify(state.favoriteKeys));toast('บันทึกรายการโปรดแล้ว');render();};
  const saveOrder = document.getElementById('saveOrderBtn'); if (saveOrder) saveOrder.onclick = async () => { if(state.orderSubmitting)return;try { const remaining=Math.ceil((state.orderCooldownUntil-Date.now())/1000);if(remaining>0)throw Error(`กรุณารอ ${remaining} วินาทีก่อนส่งออเดอร์ใหม่`);const customer = customerValues(); if(!customer.tamer.trim()) throw Error('กรุณากรอกชื่อเทมเมอร์'); if(!customer.contact.trim()) throw Error('กรุณากรอกชื่อ Facebook'); if(!state.cart.length) throw Error('ยังไม่มีสินค้าในรายการ');const fingerprint=JSON.stringify({customer,items:state.cart.map(x=>({id:x.id,kind:x.kind,quantity:x.quantity}))});if(state.pendingOrderFingerprint!==fingerprint){state.pendingOrderFingerprint=fingerprint;state.pendingOrderRequestId=(crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`);}const website=document.getElementById('orderWebsite')?.value||'';state.orderSubmitting=true;render();const data = await apiPost({ action: 'createOrder', requestId:state.pendingOrderRequestId, customer, items: state.cart, website, startedAt:state.orderFormStartedAt }); if(!data.orderId) throw Error('ระบบยังไม่เปิดรับออเดอร์ กรุณาติดต่อร้าน'); saveRecentOrderSnapshot(data.orderId); state.orderSuccess={orderId:data.orderId,total:Number(data.total||0),discount:Number(data.discount||0)};const cooldown=Math.max(5,Math.min(120,Number(state.settings.orderSubmitCooldownSeconds)||30));state.orderCooldownUntil=Date.now()+cooldown*1000;localStorage.setItem('dmo_order_cooldown_until',String(state.orderCooldownUntil));state.orderFormStartedAt=Date.now();state.cart=[];state.pendingOrderRequestId='';state.pendingOrderFingerprint='';state.orderSubmitting=false;render();setTimeout(()=>{if(state.page==='shop')render();},cooldown*1000+100);window.scrollTo({top:0,behavior:'smooth'}); } catch (error) { state.orderSubmitting=false;render();toast(error.message); } };
  const adminEntry = document.getElementById('adminEntry'); if (adminEntry) adminEntry.onclick = () => { state.page = 'admin'; location.hash = 'admin'; if (state.adminToken) loadAdmin(false); else render(); };
  const backShop = document.getElementById('backShopBtn'); if (backShop) backShop.onclick = () => { state.page = 'shop'; location.hash = ''; render(); };
  const login = document.getElementById('loginBtn'); if (login) login.onclick = async () => { if(state.loginSubmitting)return;const adminId=document.getElementById('adminId').value,password=document.getElementById('adminPassword').value;state.loginSubmitting=true;render();try { const data = await apiPost({ action: 'login', adminId, password }); state.loginSubmitting=false;state.adminToken = data.token; state.adminUser=data.user||null;state.adminData=adminBootstrapData();state.adminLoadedAt=0; state.lastAdminActivity=Date.now(); sessionStorage.setItem('dmo_admin_token', data.token); sessionStorage.setItem('dmo_admin_user',JSON.stringify(state.adminUser)); sessionStorage.setItem('dmo_admin_activity',String(state.lastAdminActivity));render();await loadAdmin(true); } catch (error) { state.loginSubmitting=false;render();toast(error.message); } };
  const logout = document.getElementById('logoutBtn'); if (logout) logout.onclick = async () => { try{await apiPost({action:'logout',token:state.adminToken});}catch(e){} state.adminToken = ''; state.adminData = null; state.adminUser=null; sessionStorage.removeItem('dmo_admin_token');sessionStorage.removeItem('dmo_admin_user');sessionStorage.removeItem('dmo_admin_activity'); render(); };
  document.querySelectorAll('[data-admin-view]').forEach((button) => button.onclick = async () => {
    state.adminView = button.dataset.adminView;
    render();
    if (state.adminView === 'facebookBump' && !state.adminData?.facebookBump) await loadFacebookBumpAdminData();
  });
  document.querySelectorAll('[data-fb-tab]').forEach((button)=>button.onclick=()=>{state.facebookBump.tab=button.dataset.fbTab;state.facebookBump.edit=null;render();});
  const fbPostForm=document.getElementById('fbPostForm');if(fbPostForm)fbPostForm.onsubmit=saveFacebookBumpPostFromForm;
  const fbCancelEditBtn=document.getElementById('fbCancelEditBtn');if(fbCancelEditBtn)fbCancelEditBtn.onclick=()=>{state.facebookBump.edit=null;render();};
  document.querySelectorAll('[data-fb-edit]').forEach((button)=>button.onclick=()=>{const post=(state.adminData.facebookBump?.posts||[]).find((item)=>String(item.id)===String(button.dataset.fbEdit));state.facebookBump.edit=post?{...post}:null;render();});
  document.querySelectorAll('[data-fb-toggle]').forEach((button)=>button.onclick=async()=>{const [id,enabled]=button.dataset.fbToggle.split('|');await facebookBumpRequest('TOGGLE_'+id,{action:'toggleFacebookBumpPost',id,enabled:enabled==='TRUE'},enabled==='TRUE'?'เปิดใช้งานโพสต์แล้ว':'พักโพสต์แล้ว');});
  document.querySelectorAll('[data-fb-now]').forEach((button)=>button.onclick=async()=>{await facebookBumpRequest('NOW_'+button.dataset.fbNow,{action:'queueFacebookBumpNow',id:button.dataset.fbNow},'เพิ่มงานเข้าคิวแล้ว ระบบจะทำทีละโพสต์');});
  document.querySelectorAll('[data-fb-delete]').forEach((button)=>button.onclick=async()=>{if(!confirm('ย้ายโพสต์นี้ออกจากรายการ? ประวัติเดิมจะยังอยู่'))return;await facebookBumpRequest('DELETE_'+button.dataset.fbDelete,{action:'deleteFacebookBumpPost',id:button.dataset.fbDelete},'นำโพสต์ออกแล้ว');});
  document.querySelectorAll('[data-fb-cancel-job]').forEach((button)=>button.onclick=async()=>{await facebookBumpRequest('CANCEL_'+button.dataset.fbCancelJob,{action:'cancelFacebookBumpJob',jobId:button.dataset.fbCancelJob},'ยกเลิกงานแล้ว');});
  document.querySelectorAll('[data-fb-retry-job]').forEach((button)=>button.onclick=async()=>{await facebookBumpRequest('RETRY_'+button.dataset.fbRetryJob,{action:'retryFacebookBumpJob',jobId:button.dataset.fbRetryJob},'ส่งงานกลับเข้าคิวแล้ว');});
  const fbPauseAllBtn=document.getElementById('fbPauseAllBtn');if(fbPauseAllBtn)fbPauseAllBtn.onclick=()=>facebookBumpRequest('PAUSE_ALL',{action:'pauseAllFacebookBumps'},'พักทุกโพสต์แล้ว');
  const fbResumeAllBtn=document.getElementById('fbResumeAllBtn');if(fbResumeAllBtn)fbResumeAllBtn.onclick=()=>facebookBumpRequest('RESUME_ALL',{action:'resumeAllFacebookBumps'},'ระบบจะดำเนินคิวต่อทีละงาน');
  const fbEnsureTriggerBtn=document.getElementById('fbEnsureTriggerBtn');if(fbEnsureTriggerBtn)fbEnsureTriggerBtn.onclick=()=>{const active=fbEnsureTriggerBtn.dataset.triggerActive==='TRUE';return facebookBumpRequest(active?'TRIGGER_OFF':'TRIGGER',{action:active?'disableFacebookBumpTrigger':'ensureFacebookBumpTrigger'},active?'ปิด Scheduler แล้ว':'เปิด Scheduler แล้ว');};
  const fbConnectWorkerBtn=document.getElementById('fbConnectWorkerBtn');if(fbConnectWorkerBtn)fbConnectWorkerBtn.onclick=async()=>{const result=await facebookWorkerAction('WORKER_CONNECT','/connect',{},null);if(!result)return;if(result.connection==='CONNECTED'){const paired=await facebookWorkerAction('WORKER_PAIR','/pair',{apiUrl:cfg.sheetsUrl,token:state.adminToken},'เชื่อมต่อ Facebook และ BackOffice สำเร็จ');if(paired)await refreshFacebookWorker();}else toast('เปิด Facebook Worker แล้ว กรุณา Login Facebook จากนั้นกดทดสอบการเชื่อมต่อ');render();};
  const fbTestWorkerBtn=document.getElementById('fbTestWorkerBtn');if(fbTestWorkerBtn)fbTestWorkerBtn.onclick=async()=>{const result=await facebookWorkerAction('WORKER_TEST','/test',{},null);if(!result)return;if(result.connection==='CONNECTED'&&!result.paired){const paired=await facebookWorkerAction('WORKER_PAIR','/pair',{apiUrl:cfg.sheetsUrl,token:state.adminToken},'Facebook พร้อมใช้งานและ Pair สำเร็จ');if(paired)await refreshFacebookWorker();}else toast(result.connection==='CONNECTED'?'Facebook พร้อมใช้งาน':'ยังไม่ได้ Login Facebook กรุณา Login ในหน้าต่าง Worker');render();};
  const fbOpenFacebookBtn=document.getElementById('fbOpenFacebookBtn');if(fbOpenFacebookBtn)fbOpenFacebookBtn.onclick=()=>facebookWorkerAction('WORKER_OPEN','/open',{url:'https://www.facebook.com/'},(result)=>result.connection==='CONNECTED'?'เปิดหรือโฟกัส Facebook Worker แล้ว':'เปิด Facebook Worker แล้ว กรุณา Login Facebook');
  const fbDisconnectWorkerBtn=document.getElementById('fbDisconnectWorkerBtn');if(fbDisconnectWorkerBtn)fbDisconnectWorkerBtn.onclick=()=>facebookWorkerAction('WORKER_DISCONNECT','/disconnect',{},'ตัดการเชื่อมต่อ Worker แล้ว');
  const fbSaveSettingsBtn=document.getElementById('fbSaveSettingsBtn');if(fbSaveSettingsBtn)fbSaveSettingsBtn.onclick=saveFacebookBumpSettingsFromForm;
  const runIntegrityBtn=document.getElementById('runIntegrityBtn');if(runIntegrityBtn)runIntegrityBtn.onclick=async()=>{try{runIntegrityBtn.disabled=true;runIntegrityBtn.textContent='กำลังตรวจ...';const data=await apiPost({action:'runIntegrityCheck',token:state.adminToken});state.integrityReport=data.integrity||null;render();}catch(e){toast(e.message);render();}};
  document.querySelectorAll('[data-new]').forEach((button) => button.onclick = () => { const kind = button.dataset.new; state.editRecord = { kind, status: 'ACTIVE', category: 'AT', section: 'NORMAL', unit: kind === 'SEAL' ? 'ชุด' : kind === 'SERVICE' ? 'ครั้ง' : 'ชิ้น', packSize: 1000, sortOrder: 10, stock: '', reservedStock: 0, lowStockAlert: 0, costPrice: '' }; render(); });
  document.querySelectorAll('[data-edit]').forEach((button) => button.onclick = () => { const [kind, id] = button.dataset.edit.split('|'); const list = kind === 'SEAL' ? state.adminData.seals : kind === 'SERVICE' ? state.adminData.services : kind === 'TMONEY' ? [state.adminData.moneyT] : state.adminData.gameItems; state.editRecord = { ...list.find((entry) => entry&&entry.id === id) }; render(); });
  document.querySelectorAll('[data-delete]').forEach((button) => button.onclick = async () => { const [kind, id] = button.dataset.delete.split('|'); if (!confirm('ย้ายรายการนี้ลงถังขยะ?')) return; try { await apiPost({ action: 'softDelete', token: state.adminToken, kind, id }); state.adminSelected=state.adminSelected.filter((x)=>x!==`${kind}|${id}`); toast('ย้ายลงถังขยะแล้ว'); await loadAdmin(); await loadData(false); } catch (error) { toast(error.message); } });
  const adminSearch = document.getElementById('adminSearch'); if (adminSearch) adminSearch.oninput = (event) => document.querySelectorAll('[data-admin-name]').forEach((el) => { el.style.display = el.dataset.adminName.includes(norm(event.target.value)) ? '' : 'none'; });
  const adminCatalogSearch = document.getElementById('adminCatalogSearch'); if (adminCatalogSearch) adminCatalogSearch.oninput = (event) => { state.adminCatalogSearch = event.target.value; scheduleInputRender('adminCatalogSearch', 80); };
  const imageZipInput=document.getElementById('imageZipInput');if(imageZipInput)imageZipInput.onchange=()=>selectImageZip(imageZipInput.files&&imageZipInput.files[0]);
  const previewImageZipBtn=document.getElementById('previewImageZipBtn');if(previewImageZipBtn)previewImageZipBtn.onclick=previewImageZipAction;
  const applyImageZipBtn=document.getElementById('applyImageZipBtn');if(applyImageZipBtn)applyImageZipBtn.onclick=applyImageZipAction;
  const allowImageOverwrite=document.getElementById('allowImageOverwrite');if(allowImageOverwrite)allowImageOverwrite.onchange=()=>{state.imageManager.allowOverwrite=allowImageOverwrite.checked;};
  const downloadMissingImagesBtn=document.getElementById('downloadMissingImagesBtn');if(downloadMissingImagesBtn)downloadMissingImagesBtn.onclick=downloadMissingImageReport;
  document.querySelectorAll('[data-admin-kind]').forEach((button)=>button.onclick=()=>{state.adminKindFilter=button.dataset.adminKind;state.adminSelected=[];render();});
  document.querySelectorAll('[data-select-product]').forEach((box)=>box.onchange=()=>{const key=box.dataset.selectProduct;if(box.checked&&!state.adminSelected.includes(key))state.adminSelected.push(key);if(!box.checked)state.adminSelected=state.adminSelected.filter((x)=>x!==key);render();});
  const selectAllProducts=document.getElementById('selectAllProducts');if(selectAllProducts)selectAllProducts.onchange=()=>{const keys=[...document.querySelectorAll('[data-select-product]')].map((x)=>x.dataset.selectProduct);state.adminSelected=selectAllProducts.checked?keys:state.adminSelected.filter((x)=>!keys.includes(x));render();};
  const bulkApply=document.getElementById('bulkApplyBtn');if(bulkApply)bulkApply.onclick=async()=>{const field=document.getElementById('bulkField').value,value=document.getElementById('bulkValue').value;if(!value)return toast('กรุณากรอกค่าที่ต้องการ');try{const records=state.adminSelected.map((x)=>{const [kind,id]=x.split('|');return{kind,id};});const changes={};changes[field]=['price','packSize','sortOrder','lowStockAlert'].includes(field)?Number(value):value;const data=await apiPost({action:'bulkUpdate',token:state.adminToken,records,changes});toast(`แก้ไข ${data.updated||0} รายการแล้ว`);state.adminSelected=[];await loadAdmin();await loadData(false);}catch(e){toast(e.message);}};
  const bulkTrash=document.getElementById('bulkTrashBtn');if(bulkTrash)bulkTrash.onclick=async()=>{if(!confirm(`ย้าย ${state.adminSelected.length} รายการลงถังขยะ?`))return;try{for(const key of [...state.adminSelected]){const [kind,id]=key.split('|');await apiPost({action:'softDelete',token:state.adminToken,kind,id});}state.adminSelected=[];toast('ย้ายรายการลงถังขยะแล้ว');await loadAdmin();await loadData(false);}catch(e){toast(e.message);}};
  document.querySelectorAll('[data-restore-trash]').forEach((button)=>button.onclick=async()=>{try{await apiPost({action:'restoreTrash',token:state.adminToken,trashId:button.dataset.restoreTrash});toast('กู้คืนแล้ว');await loadAdmin();await loadData(false);}catch(e){toast(e.message);}});
  document.querySelectorAll('[data-delete-trash]').forEach((button)=>button.onclick=async()=>{if(!confirm('ลบถาวรแล้วกู้คืนไม่ได้ ยืนยันหรือไม่?'))return;try{await apiPost({action:'permanentDelete',token:state.adminToken,trashId:button.dataset.deleteTrash});toast('ลบถาวรแล้ว');await loadAdmin();}catch(e){toast(e.message);}});
  const reloadAnalytics=document.getElementById('reloadAnalyticsBtn');if(reloadAnalytics)reloadAnalytics.onclick=()=>loadAdmin();
  const closeModal = document.getElementById('closeModalBtn'); if (closeModal) closeModal.onclick = () => { state.editRecord = null; render(); };
  const modalBackdrop = document.getElementById('modalBackdrop'); if (modalBackdrop) modalBackdrop.onclick = (event) => { if (event.target === modalBackdrop) { state.editRecord = null; render(); } };
  const saveRecord = document.getElementById('saveRecordBtn'); if (saveRecord) saveRecord.onclick = saveRecordAction;
  const wikiButton = document.getElementById('wikiGalleryBtn'); if (wikiButton) wikiButton.onclick = openWikiGallery;
  const wikiCenterRecordBtn = document.getElementById('wikiCenterRecordBtn'); if (wikiCenterRecordBtn) wikiCenterRecordBtn.onclick = () => openWikiCenterForRecord(state.editRecord);
  const wikiPageSearchBtn = document.getElementById('wikiPageSearchBtn'); if (wikiPageSearchBtn) wikiPageSearchBtn.onclick = searchWikiPages;
  const wikiPageQuery = document.getElementById('wikiPageQuery'); if (wikiPageQuery) wikiPageQuery.onkeydown = (event) => { if (event.key === 'Enter') searchWikiPages(); };
  document.querySelectorAll('[data-attach-wiki]').forEach((button) => button.onclick = () => attachWikiResult(button));
  const closeWiki = document.getElementById('closeWikiBtn'); if (closeWiki) closeWiki.onclick = () => { state.wikiGallery = null; render(); };
  const wikiSearch = document.getElementById('wikiSearch'); if (wikiSearch) wikiSearch.oninput = (event) => { state.wikiSearch = event.target.value; scheduleInputRender('wikiSearch', 100); };
  document.querySelectorAll('[data-wiki-import]').forEach((button) => button.onclick = () => importWikiImage(button.dataset.wikiImport, button.dataset.wikiTitle));
  document.querySelectorAll('[data-save-order]').forEach((button) => button.onclick = () => saveOrderStatus(button.dataset.saveOrder));
  document.querySelectorAll('[data-order-filter]').forEach((button)=>button.onclick=()=>{state.adminOrderFilter=button.dataset.orderFilter;render();});
  document.querySelectorAll('[data-order-mode]').forEach((button)=>button.onclick=()=>{state.adminOrderMode=button.dataset.orderMode;state.adminOrderFilter='ALL';render();});
  const adminOrderSearch=document.getElementById('adminOrderSearch');if(adminOrderSearch)adminOrderSearch.oninput=(event)=>{state.adminOrderSearch=event.target.value;scheduleInputRender('adminOrderSearch',100);};
  document.querySelectorAll('[data-pick-item]').forEach((button)=>button.onclick=async()=>{if(state.adminActionPending)return;const [orderItemId,pickStatus]=button.dataset.pickItem.split('|'),orderId=button.dataset.orderId||orderItemId;try{state.adminActionPending=orderId;render();await apiPost({action:'updateOrderItemPick',token:state.adminToken,orderItemId,pickStatus});toast('อัปเดตรายการจัดของแล้ว');await loadAdmin();}catch(e){toast(e.message);}finally{state.adminActionPending='';render();}});
  document.querySelectorAll('[data-spam-order]').forEach((button)=>button.onclick=async()=>{if(state.adminActionPending)return;const [orderId,spamStatus]=button.dataset.spamOrder.split('|');let spamNote='';if(spamStatus==='SPAM'){spamNote=prompt('ระบุเหตุผลที่ทำเครื่องหมาย Spam','ส่งซ้ำ/ข้อความผิดปกติ')||'';if(!spamNote.trim())return;}if(!confirm(spamStatus==='SPAM'?'ทำเครื่องหมายออเดอร์นี้เป็น Spam?\nระบบจะไม่เปลี่ยน Stock หรือ Reserved':'ยกเลิกเครื่องหมาย Spam?'))return;try{state.adminActionPending=orderId;render();await apiPost({action:'markOrderSpam',token:state.adminToken,orderId,spamStatus,spamNote});toast(spamStatus==='SPAM'?'ทำเครื่องหมาย Spam แล้ว':'ยกเลิก Spam แล้ว');await loadAdmin();}catch(e){toast(e.message);}finally{state.adminActionPending='';render();}});
  document.querySelectorAll('[data-archive-order]').forEach(button=>button.onclick=()=>archiveOrderFromAdmin(button.dataset.archiveOrder));
  document.querySelectorAll('[data-restore-order]').forEach(button=>button.onclick=()=>restoreOrderFromAdmin(button.dataset.restoreOrder));
  const reloadOrdersBtn=document.getElementById('reloadOrdersBtn');if(reloadOrdersBtn)reloadOrdersBtn.onclick=()=>loadAdmin();
  const closeOrderSuccessBtn=document.getElementById('closeOrderSuccessBtn');if(closeOrderSuccessBtn)closeOrderSuccessBtn.onclick=()=>{state.orderSuccess=null;render();};
  const copyOrderSuccessBtn=document.getElementById('copyOrderSuccessBtn');if(copyOrderSuccessBtn)copyOrderSuccessBtn.onclick=()=>copyText(state.orderSuccess?.orderId||'','คัดลอกเลขออเดอร์แล้ว กรุณาส่งให้ร้านทาง Facebook');
  const saveSettings = document.getElementById('saveSettingsBtn'); if (saveSettings) saveSettings.onclick = saveSettingsAction;
  const copyFacebookPostBtn=document.getElementById('copyFacebookPostBtn');if(copyFacebookPostBtn)copyFacebookPostBtn.onclick=()=>copyText(document.getElementById('facebookPostPreview')?.value||facebookPostText(),'คัดลอกข้อความโพสต์ Facebook แล้ว');
  document.querySelectorAll('[data-toggle-password]').forEach((button)=>button.onclick=()=>{const input=document.getElementById(button.dataset.togglePassword);if(!input)return;const show=input.type==='password';input.type=show?'text':'password';button.textContent=show?'ซ่อน':'แสดง';});
  const changeOwnerPasswordBtn=document.getElementById('changeOwnerPasswordBtn');if(changeOwnerPasswordBtn)changeOwnerPasswordBtn.onclick=async()=>{if(state.adminActionPending)return;const currentPassword=document.getElementById('ownerCurrentPassword').value,newPassword=document.getElementById('ownerNewPassword').value,confirmPassword=document.getElementById('ownerConfirmPassword').value;if(newPassword.length<10)return toast('รหัสผ่านใหม่ต้องมีอย่างน้อย 10 ตัวอักษร');if(newPassword!==confirmPassword)return toast('รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน');try{state.adminActionPending='OWNER_PASSWORD';changeOwnerPasswordBtn.disabled=true;changeOwnerPasswordBtn.textContent='กำลังเปลี่ยนรหัสผ่าน...';const data=await apiPost({action:'changeOwnerPassword',token:state.adminToken,currentPassword,newPassword,confirmPassword});state.adminToken='';state.adminData=null;state.adminUser=null;sessionStorage.removeItem('dmo_admin_token');sessionStorage.removeItem('dmo_admin_user');sessionStorage.removeItem('dmo_admin_activity');render();toast(data.message||'เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบอีกครั้ง');}catch(e){toast(e.message);}finally{state.adminActionPending='';}};
  const reloadInventory = document.getElementById('reloadInventoryBtn'); if (reloadInventory) reloadInventory.onclick = () => loadAdmin();
  const inventorySearch = document.getElementById('inventorySearch'); if (inventorySearch) inventorySearch.oninput = (event) => { state.inventorySearch = event.target.value; scheduleInputRender('inventorySearch', 80); };
  const inventorySort=document.getElementById('inventorySort');if(inventorySort)inventorySort.onchange=()=>{state.inventorySort=inventorySort.value;render();};
  document.querySelectorAll('[data-inventory-filter]').forEach((button) => button.onclick = () => { state.inventoryFilter = button.dataset.inventoryFilter; render(); });
  const stockAddBtn=document.getElementById('stockAddBtn');if(stockAddBtn)stockAddBtn.onclick=addStockFromForm;
  const stockAddProduct=document.getElementById('stockAddProduct'),stockAddAmount=document.getElementById('stockAddAmount'),stockAddReason=document.getElementById('stockAddReason');
  if(stockAddProduct)stockAddProduct.onchange=()=>{state.stockAddDraft.product=stockAddProduct.value;state.stockConfirmFingerprint='';};
  if(stockAddAmount)stockAddAmount.oninput=()=>{state.stockAddDraft.amount=stockAddAmount.value;state.stockConfirmFingerprint='';};
  if(stockAddReason)stockAddReason.oninput=()=>{state.stockAddDraft.reason=stockAddReason.value;state.stockConfirmFingerprint='';};
  const syncStockBtn=document.getElementById('syncStockBtn');if(syncStockBtn)syncStockBtn.onclick=async()=>{if(state.stockActionPending)return;try{state.stockActionPending='SYNC';state.stockActionResult={message:'กำลังซิงก์ Stock จาก Google Sheet...',detail:''};render();const data=await apiPost({action:'syncStock',token:state.adminToken});await loadAdmin(true);await loadData(false);state.stockActionResult={message:'ซิงก์ Stock สำเร็จ',detail:data.stockUpdatedAt?new Date(data.stockUpdatedAt).toLocaleString('th-TH'):''};toast('ซิงก์ Stock สำเร็จ');}catch(error){state.stockActionResult={message:'ซิงก์ Stock ไม่สำเร็จ',detail:error.message};toast(error.message);}finally{state.stockActionPending='';render();}};
  document.querySelectorAll('[data-stock-adjust]').forEach((button) => button.onclick = () => { const [kind, id, delta] = button.dataset.stockAdjust.split('|'); adjustStockAction(kind, id, Number(delta)); });
  document.querySelectorAll('[data-stock-set]').forEach((button) => button.onclick = () => { const [kind, id] = button.dataset.stockSet.split('|'); setStockAction(kind, id); });

  const reloadCustomers=document.getElementById('reloadCustomersBtn'); if(reloadCustomers) reloadCustomers.onclick=()=>loadAdmin();
  const customerSearchAdmin=document.getElementById('customerSearchAdmin'); if(customerSearchAdmin) customerSearchAdmin.oninput=(event)=>{state.customerSearchAdmin=event.target.value;scheduleInputRender('customerSearchAdmin',80);};
  document.querySelectorAll('[data-customer-filter]').forEach((button)=>button.onclick=()=>{state.customerFilter=button.dataset.customerFilter;render();});
  document.querySelectorAll('[data-save-customer]').forEach((button)=>button.onclick=()=>saveCustomerAction(button.dataset.saveCustomer));

  document.querySelectorAll('[data-open-customer]').forEach((button)=>button.onclick=()=>{state.customerDetailId=button.dataset.openCustomer;render();});
  const saveCrmCustomerBtn=document.getElementById('saveCrmCustomerBtn');if(saveCrmCustomerBtn)saveCrmCustomerBtn.onclick=saveCrmDetail;
  const addInteractionBtn=document.getElementById('addInteractionBtn');if(addInteractionBtn)addInteractionBtn.onclick=addCustomerInteraction;
  const copyCrmContactBtn=document.getElementById('copyCrmContactBtn');if(copyCrmContactBtn)copyCrmContactBtn.onclick=()=>{const c=(state.adminData.customers||[]).find((x)=>String(x.customerId)===String(state.customerDetailId));if(c)copyText(`${c.tamer||''} ${c.server||''} ${c.contact||''}`.trim());};
  const newPromo=document.getElementById('newPromoBtn'); if(newPromo)newPromo.onclick=()=>{state.promoEdit={status:'ACTIVE',type:'REWARD_PER_SPEND',scope:'ALL',priority:10,stackable:'TRUE'};render();};
  document.querySelectorAll('[data-edit-promo]').forEach((button)=>button.onclick=()=>{state.promoEdit={...(state.adminData.promotions||[]).find((p)=>p.promotionId===button.dataset.editPromo)};render();});
  document.querySelectorAll('[data-delete-promo]').forEach((button)=>button.onclick=async()=>{if(!confirm('ยืนยันลบโปรโมชั่น?'))return;try{await apiPost({action:'deletePromotion',token:state.adminToken,promotionId:button.dataset.deletePromo});toast('ลบโปรโมชั่นแล้ว');await loadAdmin();await loadData(false);}catch(e){toast(e.message);}});
  const closePromo=document.getElementById('closePromoBtn'); if(closePromo)closePromo.onclick=()=>{state.promoEdit=null;render();};
  const promoBackdrop=document.getElementById('promoBackdrop'); if(promoBackdrop)promoBackdrop.onclick=(e)=>{if(e.target===promoBackdrop){state.promoEdit=null;render();}};
  const savePromo=document.getElementById('savePromoBtn'); if(savePromo)savePromo.onclick=savePromoAction;

  const saveSecurityUserBtn=document.getElementById('saveSecurityUserBtn');if(saveSecurityUserBtn)saveSecurityUserBtn.onclick=async()=>{try{await apiPost({action:'saveSecurityUser',token:state.adminToken,user:{userId:document.getElementById('secUserId').value,displayName:document.getElementById('secDisplayName').value,password:document.getElementById('secPassword').value,role:document.getElementById('secRole').value,status:document.getElementById('secStatus').value}});toast('บันทึกผู้ใช้แล้ว');await loadAdmin();}catch(e){toast(e.message);}};
  document.querySelectorAll('[data-security-user]').forEach(btn=>btn.onclick=()=>{const u=(state.adminData.security?.users||[]).find(x=>String(x.userId)===String(btn.dataset.securityUser));if(!u)return;document.getElementById('secUserId').value=u.userId||'';document.getElementById('secDisplayName').value=u.displayName||'';document.getElementById('secRole').value=u.role||'VIEWER';document.getElementById('secStatus').value=u.status||'ACTIVE';document.getElementById('secPassword').value='';});


  const themeToggleBtn=document.getElementById('themeToggleBtn');if(themeToggleBtn)themeToggleBtn.onclick=toggleTheme;
  const installPwaBtn=document.getElementById('installPwaBtn');if(installPwaBtn)installPwaBtn.onclick=installPwa;
  document.querySelectorAll('[data-mobile-nav]').forEach(btn=>btn.onclick=()=>{state.catalogType=btn.dataset.mobileNav;state.wishlistOnly=false;state.page='shop';location.hash='';window.scrollTo({top:0,behavior:'smooth'});render();});
  const mobileCartBtn=document.getElementById('mobileCartBtn');if(mobileCartBtn)mobileCartBtn.onclick=()=>{const cart=document.querySelector('.cart-panel');if(cart)cart.scrollIntoView({behavior:'smooth',block:'start'});};
  const mobileAdminBtn=document.getElementById('mobileAdminBtn');if(mobileAdminBtn)mobileAdminBtn.onclick=()=>{location.hash='#admin';};

  const createBackupBtn=document.getElementById('createBackupBtn');if(createBackupBtn)createBackupBtn.onclick=async()=>{try{createBackupBtn.disabled=true;createBackupBtn.textContent='กำลัง Backup...';await apiPost({action:'createBackup',token:state.adminToken,reason:'MANUAL'});toast('สร้าง Backup บน Google Drive แล้ว');await loadAdmin();}catch(e){toast(e.message);}finally{if(createBackupBtn)createBackupBtn.disabled=false;}};
  const toggleBackupTriggerBtn=document.getElementById('toggleBackupTriggerBtn');if(toggleBackupTriggerBtn)toggleBackupTriggerBtn.onclick=async()=>{try{const active=!!state.adminData?.automation?.triggerActive;await apiPost({action:'setupBackupTrigger',token:state.adminToken,enabled:!active,hour:Number(state.adminData?.automation?.backupHour||3)});toast(active?'ปิด Auto Backup แล้ว':'เปิด Auto Backup แล้ว');await loadAdmin();}catch(e){toast(e.message);}};
  document.querySelectorAll('[data-restore-backup]').forEach(btn=>btn.onclick=async()=>{const confirmText=prompt('การ Restore จะเขียนทับข้อมูลร้าน\nพิมพ์ RESTORE เพื่อยืนยัน');if(confirmText!=='RESTORE')return;try{await apiPost({action:'restoreBackup',token:state.adminToken,backupId:btn.dataset.restoreBackup,confirm:'RESTORE'});toast('Restore สำเร็จ กำลังโหลดข้อมูลใหม่');await loadAdmin();await loadData(false);}catch(e){toast(e.message);}});
  document.querySelectorAll('[data-delete-backup]').forEach(btn=>btn.onclick=async()=>{if(!confirm('ลบ Backup นี้ออกจาก Google Drive หรือไม่?'))return;try{await apiPost({action:'deleteBackup',token:state.adminToken,backupId:btn.dataset.deleteBackup});toast('ลบ Backup แล้ว');await loadAdmin();}catch(e){toast(e.message);}});
  document.querySelectorAll('[data-jump-view]').forEach(btn=>btn.onclick=()=>{state.adminView=btn.dataset.jumpView;render();});

  document.querySelectorAll('[data-report-range]').forEach((button) => button.onclick = () => { state.reportRange = button.dataset.reportRange; render(); });
  const exportOrdersCsvBtn = document.getElementById('exportOrdersCsvBtn'); if (exportOrdersCsvBtn) exportOrdersCsvBtn.onclick = exportOrdersCsv;
  const exportProductsCsvBtn = document.getElementById('exportProductsCsvBtn'); if (exportProductsCsvBtn) exportProductsCsvBtn.onclick = exportProductsCsv;
  const exportCustomersCsvBtn = document.getElementById('exportCustomersCsvBtn'); if (exportCustomersCsvBtn) exportCustomersCsvBtn.onclick = exportCustomersCsv;
  const printReportPdfBtn = document.getElementById('printReportPdfBtn'); if (printReportPdfBtn) printReportPdfBtn.onclick = printReportPdf;
  const exportBackupJsonBtn = document.getElementById('exportBackupJsonBtn'); if (exportBackupJsonBtn) exportBackupJsonBtn.onclick = exportBackupJson;

  const calc = document.getElementById('calcBtn'); if (calc) calc.onclick = () => { const parsed = parseCalculator(document.getElementById('calcInput').value); document.getElementById('calcResult').textContent = calcText(parsed); };
  const calcAdd = document.getElementById('calcAddBtn'); if (calcAdd) calcAdd.onclick = () => { const parsed = parseCalculator(document.getElementById('calcInput').value); parsed.found.forEach((entry) => addToCartSilent(entry.p, entry.qty)); state.page = 'shop'; location.hash = ''; render(); };
}

function touchAdminActivity(){if(!state.adminToken)return;state.lastAdminActivity=Date.now();sessionStorage.setItem('dmo_admin_activity',String(state.lastAdminActivity));}
['click','keydown','touchstart'].forEach(evt=>window.addEventListener(evt,()=>{if(state.page==='admin')touchAdminActivity();},{passive:true}));
setInterval(()=>{if(state.page!=='admin'||!state.adminToken)return;const mins=Number(state.adminData?.settings?.autoLockMinutes||30);if(Date.now()-Number(state.lastAdminActivity||0)>mins*60000){state.adminToken='';state.adminData=null;state.adminUser=null;sessionStorage.removeItem('dmo_admin_token');sessionStorage.removeItem('dmo_admin_user');sessionStorage.removeItem('dmo_admin_activity');render();toast('ล็อกระบบอัตโนมัติเนื่องจากไม่มีการใช้งาน');}},30000);

window.addEventListener('beforeinstallprompt',(event)=>{event.preventDefault();state.installPrompt=event;render();});
window.addEventListener('appinstalled',()=>{state.installPrompt=null;toast('ติดตั้ง GUN SHOP DMO แล้ว');render();});
document.addEventListener('click',(event)=>{const button=event.target.closest('button');if(!button||button.disabled)return;button.classList.add('clicked');setTimeout(()=>button.classList.remove('clicked'),350);},true);
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));}
applyTheme();

window.addEventListener('hashchange', () => { state.page = location.hash === '#admin' ? 'admin' : 'shop'; if (state.page === 'admin' && state.adminToken) loadAdmin(false); else render(); });
loadData(true).then(()=>{if(state.page==='admin'&&state.adminToken)loadAdmin(false);});
setInterval(() => { if (state.page !== 'admin') loadData(false); }, Number(cfg.refreshMs) || 60000);
