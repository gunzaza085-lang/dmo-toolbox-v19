'use strict';

const cfg = window.DMO_CONFIG || {};
const app = document.getElementById('app');
let apiBusyCount = 0;

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
  adminOrderFilter: 'ALL',
  adminOrderSearch: '',
  adminOrderMode: 'ACTIVE',
  adminActionPending: '',
  orderSubmitting: false,
  pendingOrderRequestId: '',
  pendingOrderFingerprint: '',
  integrityReport: null,
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
const searchFields = (product) => [
  product.name, product.wikiName, product.wikiTitle, product.category,
  product.section, product.itemCategory, product.serviceCategory,
  product.tags, product.searchKeywords, ...(product.aliases || []),
].filter(Boolean).map(searchText);
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
  const fields = searchFields(product);
  let best = 0;
  fields.forEach((field, index) => {
    const fCompact = norm(field);
    const primaryBoost = index === 0 ? 24 : index <= 2 ? 12 : 0;
    if (fCompact === compact) best = Math.max(best, 120 + primaryBoost);
    else if (fCompact.startsWith(compact)) best = Math.max(best, 92 + primaryBoost);
    else if (fCompact.includes(compact)) best = Math.max(best, 70 + primaryBoost);
    const matchedTokens = tokens.filter((token) => field.includes(token) || fCompact.includes(norm(token))).length;
    if (matchedTokens) best = Math.max(best, 38 + matchedTokens * 12 + primaryBoost);
    if (compact.length >= 3 && fCompact.length <= 40) {
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
const isVisible = (p) => !['HIDDEN', 'INACTIVE'].includes(String(p.status || 'ACTIVE'));
const availableStock = (p) => p.availableStock !== undefined ? p.availableStock : (p.stock === '' ? '' : Math.max(0, Number(p.stock || 0) - Number(p.reservedStock || 0)));
const canBuy = (p) => isVisible(p) && String(p.status) !== 'OUT_OF_STOCK' && !(availableStock(p) !== '' && availableStock(p) <= 0);
const allProducts = () => [...state.seals, ...state.items, ...state.services];
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

async function loadData(showLoading = true) {
  try {
    if (showLoading) {
      state.loading = true;
      render();
    }
    const data = await apiGet(false);
    state.seals = (data.seals || []).map((product) => ({ ...product, kind: 'SEAL' })).filter(isVisible);
    state.items = (data.gameItems || []).map((product) => ({ ...product, kind: 'ITEM' })).filter(isVisible);
    state.services = (data.services || []).map((product) => ({ ...product, kind: 'SERVICE' })).filter(isVisible);
    state.promotions = data.promotions || [];
    state.settings = data.settings || {};
    state.updatedAt = data.updatedAt || '';
    state.offline = false;
    try{localStorage.setItem('dmo_public_cache',JSON.stringify({savedAt:Date.now(),data}));}catch(e){}
    state.loading = false;
    render();
  } catch (error) {
    let restored=false;
    try{const cached=JSON.parse(localStorage.getItem('dmo_public_cache')||'null');const maxHours=Number(state.settings.offlineCacheHours||12);if(cached&&cached.data&&Date.now()-Number(cached.savedAt||0)<=maxHours*3600000){const data=cached.data;state.seals=(data.seals||[]).map((product)=>({...product,kind:'SEAL'})).filter(isVisible);state.items=(data.gameItems||[]).map((product)=>({...product,kind:'ITEM'})).filter(isVisible);state.services=(data.services||[]).map((product)=>({...product,kind:'SERVICE'})).filter(isVisible);state.promotions=data.promotions||[];state.settings=data.settings||{};state.updatedAt=data.updatedAt||'';state.offline=true;restored=true;}}catch(e){}
    state.loading = false;
    render();
    toast(restored?'ออฟไลน์: ใช้ข้อมูลล่าสุดที่บันทึกไว้':error.message);
  }
}

function customerNav() {
  const types = [
    ['SEAL', '🦖 ซีล'],
    ['ITEM', '🎒 ไอเทม'],
    ['SERVICE', '⚔️ บริการ'],
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
  const adminOnly=['[data-new]','[data-edit]','[data-delete]','#saveRecordBtn','#bulkApplyBtn','#bulkTrashBtn','[data-restore-trash]','[data-delete-trash]','#saveSettingsBtn','#savePromotionBtn','[data-edit-promotion]','[data-delete-promotion]','#wikiGalleryBtn','#wikiCenterRecordBtn','[data-wiki-import]','[data-attach-wiki]'];
  const staffWrite=['[data-save-order]','[data-pick-item]','[data-stock-adjust]','[data-stock-set]','[data-save-customer]','#saveCrmCustomerBtn','#addInteractionBtn'];
  const ownerOnly=['#saveSecurityUserBtn','#toggleBackupTriggerBtn','[data-restore-backup]','[data-delete-backup]'];
  if(!['OWNER','ADMIN'].includes(role))disable(adminOnly);
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
    ${adminMode ? '' : `<nav class="mobile-bottom-nav"><button data-mobile-nav="SEAL">🦖<span>ซีล</span></button><button data-mobile-nav="ITEM">🎒<span>ไอเทม</span></button><button id="mobileCartBtn">🛒<span>ตะกร้า ${state.cart.reduce((s,x)=>s+Number(x.quantity||0),0)}</span></button><button id="mobileAdminBtn">🔒<span>Admin</span></button></nav><footer class="site-footer"><span>GUN SHOP DMO • เจ้าของร้าน Natthananat Kawinwatthanakorn • รูปภาพอ้างอิงจาก <a href="https://dmowiki.com/Seal_Master" target="_blank" rel="noopener">DMO Wiki</a></span><button class="admin-entry" id="adminEntry">🔒 ระบบหลังบ้าน</button></footer>`}
  `;
  bind();
  applyAdminRoleGuards();
}

function catalog() {
  if (state.wishlistOnly) return allProducts();
  if (state.catalogType === 'ITEM') return state.items;
  if (state.catalogType === 'SERVICE') return state.services;
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

function saleUnit(product){return product.kind==='SEAL'?(product.section==='SUSA'?'ใบ':'ชุด'):(product.unit||'ชิ้น');}
function sealSaleNote(product){if(product.kind!=='SEAL')return'';return product.section==='SUSA'?'ราคาต่อ 1 ใบ':`1 ชุด = ${money(product.packSize||1000)} ใบ`;}

function productMeta(product) {
  if (product.kind === 'SEAL') return `${product.category} • ${sectionLabel(product.section)} • ${money(product.price)} บาท/${saleUnit(product)} • ${sealSaleNote(product)}`;
  if (product.kind === 'SERVICE') return `${html(product.serviceCategory || 'บริการ')} • ${money(product.price)} บาท/${html(product.unit || 'ครั้ง')}`;
  return `${html(product.itemCategory || 'ไอเทม')} • ${money(product.price)} บาท/${html(product.unit || 'ชิ้น')}`;
}

function productCard(product) {
  const image = product.imageUrl
    ? `<img class="product-img" src="${html(product.imageUrl)}" alt="${html(product.name)}" loading="lazy" onerror="this.classList.add('image-error');this.removeAttribute('src')">`
    : `<div class="product-img placeholder"><span>${product.kind === 'SEAL' ? '🦖' : product.kind === 'SERVICE' ? '⚔️' : '🎒'}</span></div>`;
  const description = product.description ? `<div class="product-description">${html(product.description)}</div>` : '';
  return `<article class="product-card">
    <div class="image-wrap">${image}${product.badge ? `<span class="sale-badge">${html(product.badge)}</span>` : ''}<button class="favorite-btn ${isFavorite(product) ? 'active' : ''}" data-favorite="${html(productKey(product))}" aria-label="รายการโปรด">${isFavorite(product) ? '♥' : '♡'}</button></div>
    <div class="product-main">
      <div class="product-name">${html(product.name)}</div>
      <div class="product-meta">${productMeta(product)}</div>
      ${product.tags ? `<div class="tag-line">${String(product.tags).split('|').filter(Boolean).slice(0,4).map((tag)=>`<span class="mini-tag">${html(tag)}</span>`).join('')}</div>` : ''}
      ${description}
      <div class="product-status">${stockText(product)}</div>
      ${product.wikiUrl ? `<a class="wiki-link" href="${html(product.wikiUrl)}" target="_blank" rel="noopener">📚 ดูข้อมูล DMO Wiki</a>` : ''}
    </div>
    <div class="product-actions">
      <input class="qty-input" type="number" min="1" step="1" value="1" data-qty="${html(product.id)}" ${canBuy(product) ? '' : 'disabled'}>
      <button class="btn primary small" data-add="${html(product.id)}" ${canBuy(product) ? '' : 'disabled'}>+ เพิ่ม</button>
    </div>
  </article>`;
}

function shopPage() {
  const products = filteredProducts();
  const suggestions = state.search && !state.selectedSearchKey ? searchSuggestions() : [];
  return `<div class="grid-main">
    <section class="panel">
      <div class="shop-heading"><div><h2 class="panel-title">${state.wishlistOnly ? '❤️ รายการโปรด' : state.catalogType === 'SEAL' ? 'รายการซีล' : state.catalogType === 'ITEM' ? 'ไอเทมในเกม' : 'บริการของร้าน'}</h2><p class="product-meta">${state.wishlistOnly ? 'รายการโปรดเก็บอยู่ในอุปกรณ์เครื่องนี้' : 'เลือกจำนวนและเพิ่มลงรายการ จากนั้นส่งให้ร้านตรวจสอบสต๊อก'}</p></div></div>
      <div class="filters">
        <div class="smart-search-wrap"><input class="search" id="searchInput" autocomplete="off" placeholder="ค้นหาชื่อ Alias สาย หรือพิมพ์คลาดเคลื่อนได้..." value="${html(state.search)}">${state.search ? `<button class="search-clear" id="searchClearBtn">×</button>` : ''}${suggestions.length ? `<div class="search-suggestions">${suggestions.map((p)=>`<button data-search-suggestion="${html(p.name)}" data-search-product="${html(productKey(p))}"><b>${html(p.name)}</b><span>${html(productMeta(p))}</span></button>`).join('')}</div>` : ''}</div>
        ${state.recentSearches.length ? `<div class="recent-searches"><span>ค้นหาล่าสุด:</span>${state.recentSearches.map((q)=>`<button data-recent-search="${html(q)}">${html(q)}</button>`).join('')}<button id="clearRecentSearches">ล้าง</button></div>` : ''}
        ${state.catalogType === 'SEAL' ? `<div class="chip-row">${['ALL', 'AT', 'HT', 'CT', 'HP', 'DS', 'DE', 'EV', 'BL'].map((category) => `<button class="filter-chip ${state.category === category ? 'active' : ''}" data-cat="${category}">${category === 'ALL' ? 'ทั้งหมด' : category}</button>`).join('')}</div>
        <div class="chip-row">${[['ALL', 'ทุกประเภท'], ['NORMAL', 'ปกติ'], ['BASE_HARD', 'เบสยาก'], ['SUSA', 'ซูซา']].map(([value, label]) => `<button class="filter-chip ${state.section === value ? 'active' : ''}" data-sec="${value}">${label}</button>`).join('')}</div>` : ''}
      </div>
      <div class="search-summary">พบ ${products.length} รายการ${state.search ? ` สำหรับ “${html(state.search)}”` : ''}</div><div class="products">${products.length ? products.map(productCard).join('') : '<div class="empty">ไม่พบสินค้า ลองตรวจคำสะกดหรือค้นด้วยชื่ออังกฤษ/ชื่อเรียกอื่น</div>'}</div>
    </section>
    ${cartPanel()}
  </div>`;
}

function cartItem(item) {
  return `<div class="cart-item">
    <div><b>${html(item.name)}</b><div class="product-meta">${money(item.quantity)} ${html(item.unit)} × ${money(item.price)} = ${money(item.quantity * item.price)} บาท</div></div>
    <div class="cart-controls"><button class="btn small" data-dec="${html(item.id)}">−</button><b>${money(item.quantity)}</b><button class="btn small" data-inc="${html(item.id)}">+</button><button class="btn danger small" data-remove="${html(item.id)}" style="grid-column:1/-1">ลบ</button></div>
  </div>`;
}


function promoIsActive(p){
  if(String(p.status||'ACTIVE')!=='ACTIVE')return false;
  const now=Date.now(),start=p.startAt?Date.parse(p.startAt):0,end=p.endAt?Date.parse(p.endAt):0;
  return (!start||now>=start)&&(!end||now<=end);
}
function pricingSummary(){
  const subtotal=state.cart.reduce((sum,item)=>sum+item.price*item.quantity,0);
  let discount=0;const messages=[];
  const promos=(state.promotions||[]).filter(promoIsActive).sort((a,b)=>(Number(a.priority)||999)-(Number(b.priority)||999));
  for(const p of promos){
    const min=Number(p.minSpend)||0;if(subtotal<min)continue;
    if(p.type==='DISCOUNT_PERCENT'||p.type==='FLASH_SALE'){const d=subtotal*(Math.max(0,Math.min(100,Number(p.value)||0))/100);discount+=d;messages.push(`${p.name}: ลด ${money(d)} บาท`);}
    else if(p.type==='DISCOUNT_AMOUNT'){const d=Math.min(subtotal,Math.max(0,Number(p.value)||0));discount+=d;messages.push(`${p.name}: ลด ${money(d)} บาท`);}
    else if(p.type==='REWARD_PER_SPEND'){const step=Number(p.minSpend)||100,reward=Number(p.value)||0,count=Math.floor(subtotal/step);if(count>0)messages.push(p.rewardText||`${p.name}: ได้รับ ${money(count*reward)}`);}
    else if(p.rewardText)messages.push(p.rewardText);
    if(String(p.stackable)==='FALSE')break;
  }
  discount=Math.min(subtotal,discount);
  return{subtotal,discount,total:Math.max(0,subtotal-discount),messages};
}

function cartPanel() {
  const pricing = pricingSummary();
  const total = pricing.total;
  const subtotal = pricing.subtotal;
  const threshold = Number(state.settings.promoThreshold) || 100;
  const promotionSets = Math.floor(total / threshold);
  const remaining = total ? threshold - (total % threshold) : threshold;
  return `<aside class="panel cart-panel">
    <h2 class="panel-title">🛒 รายการที่เลือก (${state.cart.length})</h2>
    <div class="checkout-steps"><span class="done"><b>1</b> เลือกสินค้า</span><span class="${state.cart.length ? 'active' : ''}"><b>2</b> กรอกข้อมูล</span><span><b>3</b> รับเลขออเดอร์</span></div>
    <div class="cart-list">${state.cart.length ? state.cart.map(cartItem).join('') : '<div class="empty">ยังไม่มีสินค้า</div>'}</div>
    <div class="total-box"><span>${pricing.discount>0?`ยอดสินค้า ${money(subtotal)} • ส่วนลด ${money(pricing.discount)}`:`รวมทั้งหมด`}</span><span class="total-price">${money(total)} บาท</span></div>${pricing.messages.length?`<div class="promo">${pricing.messages.map(html).join("<br>")}</div>`:""}
    <div class="promo">${promotionSets > 0 ? `🎁 ได้รับโปร D2 ${promotionSets} ชุด (${money(promotionSets * (Number(state.settings.promoReward) || 150))} อัน)` : `ยังไม่ได้รับโปร D2<br>ซื้อเพิ่มอีก ${money(remaining)} บาทเพื่อรับชุดถัดไป`}</div>
    <div class="customer-fields">
      <input id="tamer" placeholder="ชื่อเทมเมอร์" value="${html(state.customer.tamer)}">
      <div class="security-note">🌐 ให้บริการเฉพาะเซิร์ฟเวอร์ ลิเวียมอน</div>
      <input id="contact" placeholder="ชื่อ Facebook" value="${html(state.customer.contact)}">
      <details class="customer-help"><summary>📖 วิธีส่งรายการให้ร้านทาง Facebook</summary><ol><li>เลือกสินค้าและตรวจจำนวนให้ถูกต้อง</li><li>กรอกชื่อเทมเมอร์และชื่อ Facebook</li><li>กด “ส่งรายการให้ร้านตรวจสอบ” และรอเลขออเดอร์</li><li>กด “คัดลอกข้อความ” แล้วเปิด Facebook ของร้าน</li><li>วางข้อความในแชตและส่ง จากนั้นรอร้านยืนยันสต๊อกและยอดก่อนโอนเงิน</li></ol></details>
      ${state.recentOrders.length?`<details class="customer-help"><summary>🕘 รายการล่าสุดของฉัน (${state.recentOrders.length})</summary><div class="recent-order-list">${state.recentOrders.map((o,i)=>`<div><span>${html(o.orderId||'ยังไม่มีเลขออเดอร์')} • ${money(o.total)} บาท</span><button class="btn small" data-repeat-order="${i}">ซื้อซ้ำ</button></div>`).join('')}</div></details>`:''}
      <button class="btn success" id="saveOrderBtn" ${state.cart.length && !state.orderSubmitting ? '' : 'disabled'}>${state.orderSubmitting ? '⏳ กำลังส่งออเดอร์...' : '✅ ส่งรายการให้ร้านตรวจสอบ'}</button>
      <button class="btn primary" id="copyOnlyBtn" ${state.cart.length ? '' : 'disabled'}>📋 คัดลอกข้อความ</button>
      <button class="btn" id="favoriteCartBtn" ${state.cart.length ? '' : 'disabled'}>❤️ บันทึกทั้งหมดเป็นรายการโปรด</button><button class="btn danger" id="clearCartBtn" ${state.cart.length ? '' : 'disabled'}>ล้างรายการ</button>
    </div>
  </aside>`;
}

function addToCart(id, quantity) {
  const product = allProducts().find((entry) => entry.id === id);
  if (!product) return;
  quantity = Math.max(1, Math.floor(Number(quantity) || 1));
  const existing = state.cart.find((entry) => entry.id === id);
  const nextQuantity = (existing ? existing.quantity : 0) + quantity;
  const available = availableStock(product);
  if (available !== '' && nextQuantity > available) {
    toast(`สต๊อกพร้อมขายมี ${available} ${product.unit}`);
    return;
  }
  if (existing) existing.quantity = nextQuantity;
  else state.cart.push({ id: product.id, name: product.name, price: Number(product.price) || 0, unit: saleUnit(product), kind: product.kind, quantity });
  render();
}

function orderText(customer = {}) {
  const pricing = pricingSummary();
  const total = pricing.total;
  const threshold = Number(state.settings.promoThreshold) || 100;
  const promotionSets = Math.floor(total / threshold);
  const remaining = total ? threshold - (total % threshold) : threshold;
  return `🛒 รายการสั่งซื้อ DMO\n\n${state.cart.map((item) => `${item.name} ${money(item.quantity)} ${item.unit} — ${money(item.price * item.quantity)} บาท`).join('\n')}\n\n${pricing.discount>0?`ยอดสินค้า ${money(pricing.subtotal)} บาท\nส่วนลด ${money(pricing.discount)} บาท\n`:''}รวมทั้งหมด ${money(total)} บาท${pricing.messages.length?`\n\nโปรโมชั่นอื่น:\n${pricing.messages.join('\n')}`:''}\n\n${promotionSets > 0 ? `โปรโมชั่น D2: ได้รับ ${promotionSets} ชุด (${money(promotionSets * (Number(state.settings.promoReward) || 150))} อัน)` : `โปรโมชั่น D2: ยังไม่ได้รับ\nยอดที่ต้องซื้อเพิ่มเพื่อรับ D2: ${money(remaining)} บาท`}\n\nชื่อเทมเมอร์: ${customer.tamer || '__________'}\nเซิร์ฟเวอร์: ${customer.server || '__________'}\nช่องทางติดต่อ: ${customer.contact || '__________'}\n\n⚠️ ${state.settings.orderNotice || 'รายการนี้ยังไม่ใช่การยืนยันคำสั่งซื้อ กรุณารอร้านตรวจสอบสต๊อกและยืนยันยอดก่อนโอน'}`;
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
  const views = [['dashboard', '📊 ภาพรวม'], ['catalog', '📦 สินค้า'], ['inventory', '🏬 สต๊อก'], ['analytics', '📈 วิเคราะห์'], ['reports', '📤 รายงาน'], ['orders', '🧾 ออเดอร์'], ['customers', '👥 CRM ลูกค้า'], ['promotions', '🎁 โปรโมชั่น'], ['wiki', '📚 DMO Wiki'], ['trash', '🗑️ ถังขยะ'], ['calculator', '🧮 คำนวณ'], ['settings', '⚙️ ตั้งค่า'], ['security', '🛡️ ความปลอดภัย'], ['integrity', '🧪 ตรวจข้อมูล'], ['automation', '🤖 Automation'], ['logs', '🕘 ประวัติ']];
  return `<div class="admin-toolbar"><div class="chip-row">${views.map(([value, label]) => `<button class="filter-chip ${state.adminView === value ? 'active' : ''}" data-admin-view="${value}">${label}</button>`).join('')}</div><div><span class="badge green">${html((state.adminUser&&state.adminUser.role)||'ADMIN')}</span> <button class="btn" id="backShopBtn">หน้าร้าน</button> <button class="btn danger" id="logoutBtn">ออกจากระบบ</button></div></div>${adminContent()}${state.editRecord !== null ? editModal() : ''}${state.wikiGallery ? wikiGalleryModal() : ''}`;
}

function adminContent() {
  if (state.adminView === 'catalog') return adminCatalog();
  if (state.adminView === 'inventory') return inventoryPage();
  if (state.adminView === 'calculator') return calculatorPage();
  if (state.adminView === 'analytics') return analyticsPage();
  if (state.adminView === 'reports') return reportsPage();
  if (state.adminView === 'orders') return adminOrders();
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

function dashboardPage() {
  const all = [...(state.adminData?.seals || []), ...(state.adminData?.gameItems || []), ...(state.adminData?.services || [])];
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
    const match = line.match(/^(.*?)(?:\s+x?\s*)(\d+(?:\.\d+)?)\s*(?:ชุด|ใบ|ชิ้น|ครั้ง)?$/i);
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
  const lines = parsed.found.map((entry) => `${entry.p.name} ${money(entry.qty)} ${entry.p.unit} — ${money(entry.p.price * entry.qty)} บาท`);
  if (parsed.missing.length) lines.push('', 'ไม่พบ/ชื่อซ้ำ:', ...parsed.missing.map((line) => `• ${line}`));
  lines.push('', `รวม ${money(total)} บาท`);
  return lines.join('\n');
}


function inventoryPage() {
  const products = [...(state.adminData.seals || []), ...(state.adminData.gameItems || [])];
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
    const aRank = av === '' ? 2 : av <= 0 ? 0 : Number(a.lowStockAlert || 0) > 0 && av <= Number(a.lowStockAlert || 0) ? 1 : 3;
    const bRank = bv === '' ? 2 : bv <= 0 ? 0 : Number(b.lowStockAlert || 0) > 0 && bv <= Number(b.lowStockAlert || 0) ? 1 : 3;
    return aRank - bRank || String(a.name).localeCompare(String(b.name), 'th');
  });
  const logs = state.adminData.stockLogs || [];
  return `<div class="inventory-layout">
    <section class="panel">
      <div class="admin-toolbar"><div><h2 class="panel-title">จัดการสต๊อก (${products.length})</h2><p class="product-meta">เพิ่ม ลด กำหนดสต๊อก กันสินค้า และตั้งค่าแจ้งเตือนจากหน้าเดียว</p></div><button class="btn" id="reloadInventoryBtn">🔄 โหลดใหม่</button></div>
      <div class="inventory-filters"><input id="inventorySearch" placeholder="ค้นหาชื่อสินค้า..." value="${html(state.inventorySearch)}"><div class="chip-row">${[['ALL','ทั้งหมด'],['STOCKED','มีสต๊อก'],['LOW','ใกล้หมด'],['OUT','หมด'],['CHECK','ต้องเช็ก']].map(([value,label])=>`<button class="filter-chip ${state.inventoryFilter===value?'active':''}" data-inventory-filter="${value}">${label}</button>`).join('')}</div></div>
      <div class="inventory-list">${filtered.length ? filtered.map(inventoryRow).join('') : '<div class="empty">ไม่พบสินค้า</div>'}</div>
    </section>
    <section class="panel"><h2 class="panel-title">ประวัติสต๊อกล่าสุด</h2><div class="stock-log-list">${logs.length ? logs.slice(0,120).map((log)=>`<div class="stock-log"><div><b>${html(log.productName || log.productId)}</b><div class="product-meta">${html(log.createdAt)} • ${html(log.action)} • ${html(log.reason || '-')}</div></div><div class="stock-change ${Number(log.changeQty)>=0?'plus':'minus'}">${Number(log.changeQty)>0?'+':''}${money(log.changeQty)}</div><div class="product-meta">${money(log.beforeStock)} → ${money(log.afterStock)}</div></div>`).join('') : '<div class="empty">ยังไม่มีประวัติสต๊อก</div>'}</div></section>
  </div>`;
}

function inventoryRow(product) {
  const available = availableStock(product);
  const low = available !== '' && available > 0 && Number(product.lowStockAlert || 0) > 0 && available <= Number(product.lowStockAlert || 0);
  const stateClass = available === '' ? 'check' : available <= 0 ? 'out' : low ? 'low' : 'ok';
  return `<article class="inventory-row ${stateClass}">
    <div class="inventory-info"><b>${html(product.name)}</b><div class="product-meta">${product.kind === 'SEAL' ? `${html(product.category)} • ${sectionLabel(product.section)}` : html(product.itemCategory || 'ไอเทม')} • ${html(product.unit || '')}</div></div>
    <div class="inventory-kpis"><span>ทั้งหมด<b>${product.stock === '' ? '-' : money(product.stock)}</b></span><span>กันไว้<b>${money(product.reservedStock || 0)}</b></span><span>ขายได้<b>${available === '' ? '-' : money(available)}</b></span><span>เตือนที่<b>${money(product.lowStockAlert || 0)}</b></span></div>
    <div class="inventory-actions"><button class="btn small" data-stock-adjust="${html(product.kind)}|${html(product.id)}|-100">-100</button><button class="btn small" data-stock-adjust="${html(product.kind)}|${html(product.id)}|-10">-10</button><button class="btn small" data-stock-adjust="${html(product.kind)}|${html(product.id)}|-1">-1</button><button class="btn success small" data-stock-adjust="${html(product.kind)}|${html(product.id)}|1">+1</button><button class="btn success small" data-stock-adjust="${html(product.kind)}|${html(product.id)}|10">+10</button><button class="btn success small" data-stock-adjust="${html(product.kind)}|${html(product.id)}|100">+100</button><button class="btn primary small" data-stock-set="${html(product.kind)}|${html(product.id)}">กำหนด</button></div>
  </article>`;
}

function adminCatalog() {
  const query = norm(state.adminCatalogSearch);
  const all = [...(state.adminData.seals || []), ...(state.adminData.gameItems || []), ...(state.adminData.services || [])]
    .filter((p) => state.adminKindFilter === 'ALL' || p.kind === state.adminKindFilter)
    .filter((p) => !query || [p.name, p.category, p.section, p.itemCategory, p.serviceCategory, ...(p.aliases || [])].map(norm).some((x) => x.includes(query)))
    .sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || (Number(a.sortOrder) || 9999) - (Number(b.sortOrder) || 9999));
  const selectedCount = state.adminSelected.length;
  return `<section class="panel">
    <div class="admin-toolbar"><div><h2 class="panel-title">Admin 2.0 — จัดการสินค้า (${all.length})</h2><p class="product-meta">ค้นหา เลือกหลายรายการ แก้พร้อมกัน และลบลงถังขยะโดยกู้คืนได้</p></div><div class="chip-row"><button class="btn primary" data-new="SEAL">+ ซีล</button><button class="btn primary" data-new="ITEM">+ ไอเทม</button><button class="btn primary" data-new="SERVICE">+ บริการ</button></div></div>
    <div class="admin-catalog-tools"><input id="adminCatalogSearch" placeholder="ค้นหาชื่อ หมวด Alias..." value="${html(state.adminCatalogSearch)}"><div class="chip-row">${[['ALL','ทั้งหมด'],['SEAL','ซีล'],['ITEM','ไอเทม'],['SERVICE','บริการ']].map(([v,l])=>`<button class="filter-chip ${state.adminKindFilter===v?'active':''}" data-admin-kind="${v}">${l}</button>`).join('')}</div></div>
    <div class="bulk-bar"><label class="select-all"><input id="selectAllProducts" type="checkbox" ${all.length&&all.every((p)=>state.adminSelected.includes(`${p.kind}|${p.id}`))?'checked':''}> เลือกทั้งหมด</label><b>เลือก ${selectedCount} รายการ</b><select id="bulkField"><option value="status">สถานะ</option><option value="price">ราคา</option><option value="category">สายซีล</option><option value="section">ประเภทซีล</option><option value="unit">หน่วย</option><option value="lowStockAlert">จุดแจ้งเตือน</option></select><input id="bulkValue" placeholder="ค่าที่ต้องการ"><button class="btn success" id="bulkApplyBtn" ${selectedCount?'':'disabled'}>ใช้กับที่เลือก</button><button class="btn danger" id="bulkTrashBtn" ${selectedCount?'':'disabled'}>ย้ายลงถังขยะ</button></div>
    <div class="admin-list" id="adminList">${all.length ? all.map(adminProduct).join('') : '<div class="empty">ไม่พบสินค้า</div>'}</div>
  </section>`;
}

function adminProduct(product) {
  const categoryLabel = product.kind === 'SEAL' ? `${product.category} • ${sectionLabel(product.section)}` : product.kind === 'SERVICE' ? product.serviceCategory : product.itemCategory;
  const kindLabel = product.kind === 'SEAL' ? 'ซีล' : product.kind === 'SERVICE' ? 'บริการ' : 'ไอเทม';
  const key = `${product.kind}|${product.id}`;
  return `<div class="admin-card ${state.adminSelected.includes(key)?'selected':''}" data-admin-name="${html(norm(product.name))}"><label class="row-check"><input type="checkbox" data-select-product="${html(key)}" ${state.adminSelected.includes(key)?'checked':''}></label><div class="admin-thumb">${product.imageUrl ? `<img loading="lazy" decoding="async" src="${html(product.imageUrl)}" alt="">` : '<span>ไม่มีรูป</span>'}</div><div><b>${html(product.name)}</b><div class="product-meta"><span class="badge">${kindLabel}</span><span class="badge">${html(categoryLabel || '')}</span><span class="badge ${product.status === 'ACTIVE' ? 'green' : product.status === 'CHECK_STOCK' ? 'amber' : 'red'}">${html(product.status || 'ACTIVE')}</span> ${money(product.price)} บาท/${html(product.unit || '')}</div><div class="product-meta">${stockText(product)}</div></div><div><button class="btn small" data-edit="${html(product.kind)}|${html(product.id)}">แก้ไข</button> <button class="btn danger small" data-delete="${html(product.kind)}|${html(product.id)}">ถังขยะ</button></div></div>`;
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
  [...(state.adminData?.seals || []), ...(state.adminData?.gameItems || []), ...(state.adminData?.services || [])]
    .forEach((product) => map.set(`${product.kind}|${product.id}`, product));
  return map;
}
function analyticsDataset() {
  const orders = reportOrders();
  const valid = orders.filter((o) => !['CANCELLED'].includes(String(o.status || '')));
  const paid = valid.filter((o) => String(o.status || '') === 'COMPLETED');
  const products = [...(state.adminData?.seals || []), ...(state.adminData?.gameItems || []), ...(state.adminData?.services || [])];
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
  const products = [...(state.adminData?.seals || []), ...(state.adminData?.gameItems || []), ...(state.adminData?.services || [])];
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

function adminOrders() {
  const actor=state.adminData?.security?.actor||state.adminUser||{},canManage=['OWNER','ADMIN'].includes(String(actor.role||''));
  const archived=state.adminOrderMode==='ARCHIVED';
  const allOrders = archived?(state.adminData.deletedOrders||[]):(state.adminData.orders||[]);
  const itemRows = state.adminData.orderItems || [];
  const filter=state.adminOrderFilter||'ALL';
  const query=String(state.adminOrderSearch||'').trim().toLowerCase();
  const orders=allOrders.filter(o=>(filter==='ALL'||String(o.status||'NEW')===filter)&&(!query||[o.orderId,o.tamer,o.contact,o.server,o.status,orderStatusThai(o.status)].some(x=>String(x||'').toLowerCase().includes(query))));
  const statuses=['NEW','CHECKING','PREPARING','READY','COMPLETED','CANCELLED'];
  const count=(s)=>allOrders.filter(o=>String(o.status||'NEW')===s).length;
  let cards=orders.map((order)=>{
    let items=itemRows.filter(x=>String(x.orderId)===String(order.orderId));
    if(!items.length){try{items=JSON.parse(order.itemsJson||'[]').map((x,i)=>({orderItemId:`legacy-${i}`,orderId:order.orderId,productId:x.productId||x.id,productName:x.productName||x.name,kind:x.kind,quantity:x.quantity,unit:x.unit,unitPrice:x.unitPrice??x.price,lineTotal:x.lineTotal??Number(x.price||0)*Number(x.quantity||0),pickStatus:x.pickStatus||'UNCHECKED',stockCheck:x.stockCheck||'LEGACY'}));}catch(e){items=[];}}
    const picked=items.filter(x=>String(x.pickStatus)==='PICKED').length;
    const cls=String(order.status||'NEW').toLowerCase();
    const legacy=String(order.legacyOrder||'').toUpperCase()==='TRUE'||order.legacyOrder===true;
    const allowed = legacy?[String(order.status||'NEW')]:allowedOrderStatuses(order.status);
    const nextStatus = allowed.find((status) => status !== order.status && status !== 'CANCELLED');
    const busy=state.adminActionPending===String(order.orderId);
    return `<article class="order-card-v20 ${cls} ${archived?'archived':''}"><div class="order-card-head"><div><div class="order-id-big">${html(order.orderId)}</div><div class="product-meta">สร้างเมื่อ ${html(order.createdAt||'-')}</div></div><div><div class="order-total">${money(order.total)} บาท</div><span class="badge ${order.status==='COMPLETED'?'green':order.status==='CANCELLED'?'red':'amber'}">${html(orderStatusThai(order.status||'NEW'))}</span></div></div><div class="order-summary-grid"><div><span>ลูกค้า/เทมเมอร์</span><b>${html(order.tamer||'-')}</b></div><div><span>เซิร์ฟเวอร์</span><b>${html(order.server||'-')}</b></div><div><span>ชื่อ Facebook</span><b>${html(order.contact||'-')}</b></div><div><span>จัดสินค้า</span><b>${items.length&&picked===items.length?'จัดครบแล้ว':`${picked}/${items.length} รายการ`}</b></div></div>${archived?`<div class="archive-note"><b>เก็บเมื่อ:</b> ${html(order.deletedAt||'-')} • <b>โดย:</b> ${html(order.deletedBy||'-')}<br><b>เหตุผล:</b> ${html(order.deleteReason||'-')}</div>`:`<div class="order-progress"><span class="active">รับออเดอร์</span><span class="${['CHECKING','PREPARING','READY','COMPLETED'].includes(order.status)?'active':''}">ตรวจ</span><span class="${['PREPARING','READY','COMPLETED'].includes(order.status)?'active':''}">จัดของ</span><span class="${['READY','COMPLETED'].includes(order.status)?'active':''}">พร้อมส่ง</span><span class="${order.status==='COMPLETED'?'active':''}">เสร็จสิ้น</span></div>`}<div class="order-items-v20">${items.map(it=>`<div class="pick-row ${String(it.pickStatus)==='PICKED'?'picked':''}"><div>${String(it.pickStatus)==='PICKED'?'✅':'⬜'}</div><div class="pick-name">${html(it.productName||it.name||'-')}<small>${money(it.quantity)} ${html(it.unit||'')} × ${money(it.unitPrice||it.price||0)} บาท • ${html(it.kind||'')}</small></div><div class="${String(it.stockCheck)==='OK'?'stock-ok':'stock-warn'}">${html(it.stockCheck||'รอตรวจ')}</div>${archived?'':`<button class="btn small ${String(it.pickStatus)==='PICKED'?'success':''}" data-pick-item="${html(it.orderItemId||'')}|${String(it.pickStatus)==='PICKED'?'UNCHECKED':'PICKED'}" data-order-id="${html(order.orderId)}" ${busy||String(it.orderItemId||'').startsWith('legacy-')||['COMPLETED','CANCELLED'].includes(order.status)?'disabled':''}>${String(it.pickStatus)==='PICKED'?'ยกเลิกติ๊ก':'✓ จัดแล้ว'}</button>`}</div>`).join('')||'<div class="empty">ไม่พบรายการสินค้า</div>'}</div>${archived?`<div class="order-archive-actions"><div class="security-note">กู้คืนแล้วจะคงสถานะและสต๊อกเดิม ระบบจะไม่จองหรือตัดสต๊อกให้อัตโนมัติ</div><button class="btn success" data-restore-order="${html(order.orderId)}" ${busy?'disabled':''}>${busy?'กำลังดำเนินการ...':'↩ กู้คืนออเดอร์'}</button></div>`:`${nextStatus?`<div class="next-step-hint">ขั้นตอนถัดไป: <b>${orderStatusThai(nextStatus)}</b></div>`:''}<div class="order-actions-v20"><select data-order-status="${html(order.orderId)}" ${busy||allowed.length===1?'disabled':''}>${allowed.map(status=>`<option value="${status}" ${order.status===status?'selected':''}>${orderStatusThai(status)}</option>`).join('')}</select><input data-order-note="${html(order.orderId)}" value="${html(order.adminNote||'')}" placeholder="หมายเหตุร้าน" ${busy?'disabled':''}><button class="btn success" data-save-order="${html(order.orderId)}" ${busy||allowed.length===1?'disabled':''}>${busy?'กำลังบันทึก...':'บันทึกสถานะ'}</button>${canManage?`<button class="btn danger subtle" data-archive-order="${html(order.orderId)}" ${busy?'disabled':''}>เก็บเข้าถัง</button>`:''}</div>`}</article>`;
  }).join('');
  if(orders.some(order=>String(order.legacyOrder||'').toUpperCase()==='TRUE'||order.legacyOrder===true))cards='<div class="security-note">📦 ออเดอร์ที่มีป้าย Legacy เป็นออเดอร์เก่า — ไม่ได้อยู่ในระบบจองสต๊อก V20.1 ปุ่มเปลี่ยนสถานะจึงถูกปิด และการเก็บเข้าถังจะไม่เปลี่ยน Stock/Reserved Stock</div>'+cards;
  return `<section class="panel"><div class="admin-toolbar"><div><h2 class="panel-title">🧾 ศูนย์ออเดอร์และจัดของ</h2><p class="product-meta">ค้นหา ตรวจสต๊อก ติ๊กจัดของ และปิดงานจากหน้าเดียว</p></div><button class="btn" id="reloadOrdersBtn">🔄 โหลดใหม่</button></div><div class="order-mode-tabs"><button class="filter-chip ${!archived?'active':''}" data-order-mode="ACTIVE">ออเดอร์ใช้งาน (${(state.adminData.orders||[]).length})</button>${canManage?`<button class="filter-chip ${archived?'active':''}" data-order-mode="ARCHIVED">ถังออเดอร์ (${(state.adminData.deletedOrders||[]).length})</button>`:''}</div><input id="adminOrderSearch" class="order-search" value="${html(state.adminOrderSearch)}" placeholder="ค้นหาเลขออเดอร์ ชื่อลูกค้า Facebook หรือสถานะ"><div class="order-kpis"><div class="order-kpi"><span>ออเดอร์ใหม่</span><b>${count('NEW')}</b></div><div class="order-kpi"><span>กำลังตรวจ</span><b>${count('CHECKING')}</b></div><div class="order-kpi"><span>กำลังจัด</span><b>${count('PREPARING')}</b></div><div class="order-kpi"><span>พร้อมส่ง</span><b>${count('READY')}</b></div><div class="order-kpi"><span>เสร็จแล้ว</span><b>${count('COMPLETED')}</b></div><div class="order-kpi"><span>ยกเลิก</span><b>${count('CANCELLED')}</b></div></div><div class="admin-order-filter">${['ALL',...statuses].map(s=>`<button class="filter-chip ${filter===s?'active':''}" data-order-filter="${s}">${s==='ALL'?'ทั้งหมด':orderStatusThai(s)}</button>`).join('')}</div><div class="security-note">🔐 ระบบตรวจราคาและสต๊อกที่ Server • เสร็จสิ้นจะตัดสต๊อก • ยกเลิกหรือเก็บออเดอร์ที่ยังจองอยู่จะคืน Reserved Stock เพียงครั้งเดียว</div><div class="order-admin-grid">${cards||'<div class="empty">ไม่พบออเดอร์</div>'}</div></section>`;
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
  return `<section class="panel"><h2 class="panel-title">ตั้งค่าร้าน</h2><div class="form-grid"><label>ชื่อร้าน<input id="setShopName" value="${html(settings.shopName || 'GUN SHOP DMO')}"></label><label>ชื่อเจ้าของร้าน<input id="setOwnerName" value="${html(settings.ownerName || 'Natthananat Kawinwatthanakorn')}"></label><label>ยอดครบโปร D2<input id="setThreshold" type="number" value="${html(settings.promoThreshold || 100)}"></label><label>จำนวน D2 ต่อชุด<input id="setReward" type="number" value="${html(settings.promoReward || 150)}"></label><label>รีเฟรชทุกกี่วินาที<input id="setRefresh" type="number" value="${html(settings.autoRefreshSeconds || 60)}"></label><label>Session (วัน)<input id="setSessionDays" type="number" min="1" max="30" value="${html(settings.sessionDays || 7)}"></label><label>Auto Lock (นาที)<input id="setAutoLock" type="number" min="5" value="${html(settings.autoLockMinutes || 30)}"></label><label>API Key<input id="setApiKey" type="password" value="${html(settings.apiKey || '')}" placeholder="ตั้งได้ตามต้องการ"></label><label>Facebook URL<input id="setFacebook" value="${html(settings.facebookUrl || '')}"></label><label>LINE URL<input id="setLine" value="${html(settings.lineUrl || '')}"></label><label class="full">ข้อความท้ายออเดอร์<textarea id="setNotice">${html(settings.orderNotice || '')}</textarea></label><label><input id="setAllowOrder" type="checkbox" ${settings.allowOrderSave !== false ? 'checked' : ''}> บันทึกออเดอร์ลงชีต</label><label><input id="setShowStock" type="checkbox" ${settings.showStock !== false ? 'checked' : ''}> แสดงสต๊อกแก่ลูกค้า</label><button class="btn success full" id="saveSettingsBtn">บันทึกการตั้งค่า</button></div></section>
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
  return `<div class="modal-backdrop" id="modalBackdrop"><div class="modal"><h2>${record.id ? 'แก้ไข' : 'เพิ่ม'}${seal ? 'ซีล' : service ? 'บริการ' : 'ไอเทม'}</h2><div class="form-grid"><label>ชื่อ<input id="fName" value="${html(record.name || '')}"></label><label>ชื่อค้นหาเพิ่มเติม<input id="fAliases" value="${html(Array.isArray(record.aliases) ? record.aliases.join('|') : record.aliases || '')}" placeholder="คั่นด้วย |"></label>${seal ? `<label>สาย<select id="fCategory">${['AT', 'HT', 'CT', 'HP', 'DS', 'DE', 'EV', 'BL'].map((category) => `<option ${record.category === category ? 'selected' : ''}>${category}</option>`).join('')}</select></label><label>ประเภท<select id="fSection">${['NORMAL', 'BASE_HARD', 'SUSA'].map((section) => `<option value="${section}" ${record.section === section ? 'selected' : ''}>${sectionLabel(section)}</option>`).join('')}</select></label><label>ชื่ออังกฤษ/คำค้น DMO Wiki<input id="fWikiName" value="${html(record.wikiName || '')}" placeholder="เช่น Agumon"></label><label>ชื่อหน้าที่เชื่อม<input id="fWikiTitle" value="${html(record.wikiTitle || '')}" placeholder="เชื่อมผ่าน DMO Wiki Center"></label><label class="full">URL DMO Wiki<input id="fWikiUrl" value="${html(record.wikiUrl || '')}"></label>` : service ? `<label>หมวดบริการ<input id="fServiceCategory" value="${html(record.serviceCategory || '')}" placeholder="เช่น ดันเจียน / เควสต์"></label>` : `<label>หมวดไอเทม<input id="fItemCategory" value="${html(record.itemCategory || '')}"></label>`}<label>ราคา<input id="fPrice" type="number" step="0.01" value="${html(record.price || 0)}"></label><label>หน่วย<input id="fUnit" value="${html(record.unit || (service ? 'ครั้ง' : 'ชิ้น'))}"></label>${seal ? `<label>จำนวนต่อชุด<input id="fPackSize" type="number" value="${html(record.packSize || 1000)}"></label>` : ''}<label>สถานะ<select id="fStatus">${['ACTIVE', 'CHECK_STOCK', 'OUT_OF_STOCK', 'INACTIVE', 'HIDDEN'].map((status) => `<option ${record.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label><label>สต๊อกทั้งหมด (เว้นว่าง = ตรวจสอบ)<input id="fStock" type="number" value="${record.stock === '' ? '' : html(record.stock)}"></label><label>จำนวนที่กันไว้<input id="fReservedStock" type="number" min="0" value="${html(record.reservedStock || 0)}"></label><label>แจ้งเตือนใกล้หมด<input id="fLowStockAlert" type="number" min="0" value="${html(record.lowStockAlert || 0)}"></label><label>ต้นทุนต่อหน่วย<input id="fCostPrice" type="number" step="0.01" min="0" value="${html(record.costPrice || '')}"></label><label>ลำดับแสดง<input id="fSort" type="number" value="${html(record.sortOrder || 10)}"></label><label>ป้ายสินค้า<input id="fBadge" value="${html(record.badge || '')}" placeholder="HOT / NEW / SALE"></label><label>แท็กค้นหา<input id="fTags" value="${html(record.tags || '')}" placeholder="PVP|ขายดี|ดิจิมอน X"></label><label class="full">คำค้นเพิ่มเติม<input id="fSearchKeywords" value="${html(record.searchKeywords || '')}" placeholder="คำสะกดอื่นหรือคำที่ลูกค้ามักใช้"></label><label class="full">หมายเหตุ<input id="fNote" value="${html(record.note || '')}"></label>${seal ? '' : `<label class="full">รายละเอียด<textarea id="fDescription">${html(record.description || '')}</textarea></label>`}<label class="full">URL รูป<input id="fImageUrl" value="${html(record.imageUrl || '')}"></label><label class="full">อัปโหลดรูป<input id="fImageFile" type="file" accept="image/*"></label></div><div class="chip-row" style="margin-top:14px">${seal ? '<button class="btn warning" id="wikiGalleryBtn">🖼 เลือกรูป Seal Master</button><button class="btn primary" id="wikiCenterRecordBtn">📚 ค้นหน้าข้อมูล DMO Wiki</button>' : ''}<button class="btn success" id="saveRecordBtn">บันทึก</button><button class="btn" id="closeModalBtn">ยกเลิก</button></div></div></div>`;
}

function wikiGalleryModal() {
  const filtered = state.wikiGallery.filter((item) => !state.wikiSearch || norm(item.title).includes(norm(state.wikiSearch)));
  return `<div class="modal-backdrop wiki-layer" id="wikiBackdrop"><div class="modal wiki-modal"><div class="admin-toolbar"><div><h2>รูปจาก DMO Wiki — Seal Master</h2><p class="product-meta">เลือกรูปแล้วระบบจะคัดลอกมาเก็บใน Google Drive ของร้าน</p></div><button class="btn" id="closeWikiBtn">ปิด</button></div><input id="wikiSearch" placeholder="ค้นหาชื่ออังกฤษ เช่น Agumon" value="${html(state.wikiSearch)}"><div class="wiki-grid">${filtered.length ? filtered.map((item) => `<button class="wiki-item" data-wiki-import="${html(item.url)}" data-wiki-title="${html(item.title)}"><img src="${html(item.thumb || item.url)}" alt="${html(item.title)}" loading="lazy"><span>${html(item.title.replace(/^File:/, ''))}</span></button>`).join('') : '<div class="empty">ไม่พบรูป</div>'}</div><p class="source-note">แหล่งรูป: <a href="https://dmowiki.com/Seal_Master" target="_blank" rel="noopener">DMO Wiki — Seal Master</a></p></div></div>`;
}

function adminBootstrapData() {
  return {seals:state.seals||[],gameItems:state.items||[],services:state.services||[],settings:state.settings||{},orders:[],deletedOrders:[],orderItems:[],logs:[],stockLogs:[],customers:[],customerInteractions:[],promotions:state.promotions||[],trash:[],security:{actor:state.adminUser||{}},automation:{},databaseVersion:''};
}

async function loadAdmin(force = true) {
  if (state.adminLoading) return;
  if (!force && state.adminData && state.adminLoadedAt && Date.now() - state.adminLoadedAt < 30000) { render(); return; }
  state.adminLoading = true;
  if (!state.adminData) { state.adminData = adminBootstrapData(); render(); }
  try {
    const data = await apiPost({action:'getAdminData',token:state.adminToken});
    state.adminData = { seals: data.seals || [], gameItems: data.gameItems || [], services: data.services || [], settings: data.settings || {}, orders: data.orders || [], deletedOrders:data.deletedOrders||[], orderItems:data.orderItems||[], logs: data.logs || [], stockLogs: data.stockLogs || [], customers: data.customers || [], customerInteractions:data.customerInteractions||[], promotions: data.promotions || [], trash: data.trash || [], security: data.security || {}, automation: data.automation || {}, databaseVersion:data.databaseVersion||'' };
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
    state.adminLoading = false;
  }
}

async function saveRecordAction() {
  try {
    const old = state.editRecord;
    const seal = old.kind === 'SEAL';
    const service = old.kind === 'SERVICE';
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
      facebookUrl: document.getElementById('setFacebook').value,
      lineUrl: document.getElementById('setLine').value,
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
  const product = (kind === 'SEAL' ? state.adminData.seals : state.adminData.gameItems).find((entry) => entry.id === id);
  const reason = prompt(`เหตุผลในการ${delta >= 0 ? 'เพิ่ม' : 'ลด'}สต๊อก ${product ? product.name : ''}`, delta >= 0 ? 'เติมสต๊อก' : 'ขาย/นำออก');
  if (reason === null) return;
  try {
    await apiPost({ action: 'adjustStock', token: state.adminToken, kind, id, delta, reason });
    toast('ปรับสต๊อกแล้ว');
    await loadAdmin();
    await loadData(false);
  } catch (error) { toast(error.message); }
}

async function setStockAction(kind, id) {
  const product = (kind === 'SEAL' ? state.adminData.seals : state.adminData.gameItems).find((entry) => entry.id === id);
  if (!product) return;
  const stockTextValue = prompt(`กำหนดสต๊อกทั้งหมดของ ${product.name}\nเว้นว่าง = ต้องตรวจสอบสต๊อก`, product.stock === '' ? '' : product.stock);
  if (stockTextValue === null) return;
  const reservedText = prompt('จำนวนที่กันไว้', product.reservedStock || 0);
  if (reservedText === null) return;
  const lowText = prompt('แจ้งเตือนเมื่อคงเหลือขายต่ำกว่าหรือเท่าไร', product.lowStockAlert || 0);
  if (lowText === null) return;
  const reason = prompt('เหตุผล', 'กำหนดสต๊อก') ?? 'กำหนดสต๊อก';
  try {
    await apiPost({
      action: 'setStock', token: state.adminToken, kind, id,
      stock: stockTextValue === '' ? '' : Number(stockTextValue),
      reservedStock: Number(reservedText) || 0,
      lowStockAlert: Number(lowText) || 0,
      reason,
    });
    toast('บันทึกสต๊อกแล้ว');
    await loadAdmin();
    await loadData(false);
  } catch (error) { toast(error.message); }
}

function addToCartSilent(product, quantity) {
  const existing = state.cart.find((entry) => entry.id === product.id);
  if (existing) existing.quantity += quantity;
  else state.cart.push({ id: product.id, name: product.name, price: Number(product.price) || 0, unit: saleUnit(product), kind: product.kind, quantity });
}

function bind() {
  document.querySelectorAll('[data-type]').forEach((button) => button.onclick = () => { state.catalogType = button.dataset.type; state.wishlistOnly=false; state.search = ''; state.selectedSearchKey = ''; render(); });
  const favoritesBtn=document.getElementById('favoritesBtn');if(favoritesBtn)favoritesBtn.onclick=()=>{state.wishlistOnly=!state.wishlistOnly;render();};
  const repeatLatestBtn=document.getElementById('repeatLatestBtn');if(repeatLatestBtn)repeatLatestBtn.onclick=()=>repeatOrder(state.recentOrders[0]);
  document.querySelectorAll('[data-repeat-order]').forEach((button)=>button.onclick=()=>repeatOrder(state.recentOrders[Number(button.dataset.repeatOrder)]));
  document.querySelectorAll('[data-favorite]').forEach((button)=>button.onclick=()=>{const [kind,id]=button.dataset.favorite.split('|');const p=allProducts().find((x)=>x.kind===kind&&x.id===id);if(p)toggleFavorite(p);});
  document.querySelectorAll('[data-cat]').forEach((button) => button.onclick = () => { state.category = button.dataset.cat; state.selectedSearchKey = ''; render(); });
  document.querySelectorAll('[data-sec]').forEach((button) => button.onclick = () => { state.section = button.dataset.sec; state.selectedSearchKey = ''; render(); });
  const refresh = document.getElementById('refreshBtn'); if (refresh) refresh.onclick = () => loadData(true);
  const search = document.getElementById('searchInput'); if (search) { search.oninput = (event) => { state.search = event.target.value; state.selectedSearchKey = ''; scheduleInputRender('searchInput', 80); }; search.onkeydown = (event) => { if (event.key === 'Enter') { clearTimeout(inputRenderTimer); state.selectedSearchKey = ''; rememberSearch(state.search); render(); } }; }
  const searchClear = document.getElementById('searchClearBtn'); if (searchClear) searchClear.onclick = () => { state.search = ''; state.selectedSearchKey = ''; render(); };
  document.querySelectorAll('[data-search-suggestion]').forEach((button) => button.onclick = () => { state.search = button.dataset.searchSuggestion; state.selectedSearchKey = button.dataset.searchProduct || ''; rememberSearch(state.search); render(); });
  document.querySelectorAll('[data-recent-search]').forEach((button) => button.onclick = () => { state.search = button.dataset.recentSearch; state.selectedSearchKey = ''; render(); });
  const clearRecent = document.getElementById('clearRecentSearches'); if (clearRecent) clearRecent.onclick = () => { state.recentSearches = []; localStorage.removeItem('dmo_recent_searches'); render(); };
  document.querySelectorAll('[data-add]').forEach((button) => button.onclick = () => { const quantity = document.querySelector(`[data-qty="${CSS.escape(button.dataset.add)}"]`); addToCart(button.dataset.add, quantity && quantity.value); });
  document.querySelectorAll('[data-inc]').forEach((button) => button.onclick = () => { const item = state.cart.find((entry) => entry.id === button.dataset.inc); if (item) item.quantity += 1; render(); });
  document.querySelectorAll('[data-dec]').forEach((button) => button.onclick = () => { const item = state.cart.find((entry) => entry.id === button.dataset.dec); if (item) { item.quantity -= 1; if (item.quantity <= 0) state.cart = state.cart.filter((entry) => entry.id !== item.id); } render(); });
  document.querySelectorAll('[data-remove]').forEach((button) => button.onclick = () => { state.cart = state.cart.filter((entry) => entry.id !== button.dataset.remove); render(); });
  ['tamer', 'contact'].forEach((id) => { const input = document.getElementById(id); if (input) input.oninput = (event) => { state.customer[id] = event.target.value; }; });
  const clear = document.getElementById('clearCartBtn'); if (clear) clear.onclick = () => { state.cart = []; render(); };
  const copy = document.getElementById('copyOnlyBtn'); if (copy) copy.onclick = () => {saveRecentOrderSnapshot();copyText(orderText(customerValues()),'คัดลอกแล้ว กรุณานำข้อความไปวางในแชต Facebook ของร้าน');};
  const favoriteCart=document.getElementById('favoriteCartBtn');if(favoriteCart)favoriteCart.onclick=()=>{state.cart.forEach((item)=>{const p=allProducts().find((x)=>x.id===item.id&&x.kind===item.kind);if(p&&!isFavorite(p))state.favoriteKeys.push(productKey(p));});state.favoriteKeys=[...new Set(state.favoriteKeys)].slice(0,300);localStorage.setItem('dmo_favorites',JSON.stringify(state.favoriteKeys));toast('บันทึกรายการโปรดแล้ว');render();};
  const saveOrder = document.getElementById('saveOrderBtn'); if (saveOrder) saveOrder.onclick = async () => { if(state.orderSubmitting)return;try { const customer = customerValues(); if(!customer.tamer.trim()) throw Error('กรุณากรอกชื่อเทมเมอร์'); if(!customer.contact.trim()) throw Error('กรุณากรอกชื่อ Facebook'); if(!state.cart.length) throw Error('ยังไม่มีสินค้าในรายการ');const fingerprint=JSON.stringify({customer,items:state.cart.map(x=>({id:x.id,kind:x.kind,quantity:x.quantity}))});if(state.pendingOrderFingerprint!==fingerprint){state.pendingOrderFingerprint=fingerprint;state.pendingOrderRequestId=(crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`);}state.orderSubmitting=true;render();const data = await apiPost({ action: 'createOrder', requestId:state.pendingOrderRequestId, customer, items: state.cart }); if(!data.orderId) throw Error('ระบบยังไม่เปิดรับออเดอร์ กรุณาติดต่อร้าน'); saveRecentOrderSnapshot(data.orderId); state.orderSuccess={orderId:data.orderId,total:Number(data.total||0),discount:Number(data.discount||0)}; state.cart=[];state.pendingOrderRequestId='';state.pendingOrderFingerprint='';state.orderSubmitting=false;render(); window.scrollTo({top:0,behavior:'smooth'}); } catch (error) { state.orderSubmitting=false;render();toast(error.message); } };
  const adminEntry = document.getElementById('adminEntry'); if (adminEntry) adminEntry.onclick = () => { state.page = 'admin'; location.hash = 'admin'; if (state.adminToken) loadAdmin(false); else render(); };
  const backShop = document.getElementById('backShopBtn'); if (backShop) backShop.onclick = () => { state.page = 'shop'; location.hash = ''; render(); };
  const login = document.getElementById('loginBtn'); if (login) login.onclick = async () => { if(state.loginSubmitting)return;const adminId=document.getElementById('adminId').value,password=document.getElementById('adminPassword').value;state.loginSubmitting=true;render();try { const data = await apiPost({ action: 'login', adminId, password }); state.loginSubmitting=false;state.adminToken = data.token; state.adminUser=data.user||null;state.adminData=adminBootstrapData();state.adminLoadedAt=0; state.lastAdminActivity=Date.now(); sessionStorage.setItem('dmo_admin_token', data.token); sessionStorage.setItem('dmo_admin_user',JSON.stringify(state.adminUser)); sessionStorage.setItem('dmo_admin_activity',String(state.lastAdminActivity));render();await loadAdmin(true); } catch (error) { state.loginSubmitting=false;render();toast(error.message); } };
  const logout = document.getElementById('logoutBtn'); if (logout) logout.onclick = async () => { try{await apiPost({action:'logout',token:state.adminToken});}catch(e){} state.adminToken = ''; state.adminData = null; state.adminUser=null; sessionStorage.removeItem('dmo_admin_token');sessionStorage.removeItem('dmo_admin_user');sessionStorage.removeItem('dmo_admin_activity'); render(); };
  document.querySelectorAll('[data-admin-view]').forEach((button) => button.onclick = () => { state.adminView = button.dataset.adminView; render(); });
  const runIntegrityBtn=document.getElementById('runIntegrityBtn');if(runIntegrityBtn)runIntegrityBtn.onclick=async()=>{try{runIntegrityBtn.disabled=true;runIntegrityBtn.textContent='กำลังตรวจ...';const data=await apiPost({action:'runIntegrityCheck',token:state.adminToken});state.integrityReport=data.integrity||null;render();}catch(e){toast(e.message);render();}};
  document.querySelectorAll('[data-new]').forEach((button) => button.onclick = () => { const kind = button.dataset.new; state.editRecord = { kind, status: 'ACTIVE', category: 'AT', section: 'NORMAL', unit: kind === 'SEAL' ? 'ชุด' : kind === 'SERVICE' ? 'ครั้ง' : 'ชิ้น', packSize: 1000, sortOrder: 10, stock: '', reservedStock: 0, lowStockAlert: 0, costPrice: '' }; render(); });
  document.querySelectorAll('[data-edit]').forEach((button) => button.onclick = () => { const [kind, id] = button.dataset.edit.split('|'); const list = kind === 'SEAL' ? state.adminData.seals : kind === 'SERVICE' ? state.adminData.services : state.adminData.gameItems; state.editRecord = { ...list.find((entry) => entry.id === id) }; render(); });
  document.querySelectorAll('[data-delete]').forEach((button) => button.onclick = async () => { const [kind, id] = button.dataset.delete.split('|'); if (!confirm('ย้ายรายการนี้ลงถังขยะ?')) return; try { await apiPost({ action: 'softDelete', token: state.adminToken, kind, id }); state.adminSelected=state.adminSelected.filter((x)=>x!==`${kind}|${id}`); toast('ย้ายลงถังขยะแล้ว'); await loadAdmin(); await loadData(false); } catch (error) { toast(error.message); } });
  const adminSearch = document.getElementById('adminSearch'); if (adminSearch) adminSearch.oninput = (event) => document.querySelectorAll('[data-admin-name]').forEach((el) => { el.style.display = el.dataset.adminName.includes(norm(event.target.value)) ? '' : 'none'; });
  const adminCatalogSearch = document.getElementById('adminCatalogSearch'); if (adminCatalogSearch) adminCatalogSearch.oninput = (event) => { state.adminCatalogSearch = event.target.value; scheduleInputRender('adminCatalogSearch', 80); };
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
  document.querySelectorAll('[data-archive-order]').forEach(button=>button.onclick=()=>archiveOrderFromAdmin(button.dataset.archiveOrder));
  document.querySelectorAll('[data-restore-order]').forEach(button=>button.onclick=()=>restoreOrderFromAdmin(button.dataset.restoreOrder));
  const reloadOrdersBtn=document.getElementById('reloadOrdersBtn');if(reloadOrdersBtn)reloadOrdersBtn.onclick=()=>loadAdmin();
  const closeOrderSuccessBtn=document.getElementById('closeOrderSuccessBtn');if(closeOrderSuccessBtn)closeOrderSuccessBtn.onclick=()=>{state.orderSuccess=null;render();};
  const copyOrderSuccessBtn=document.getElementById('copyOrderSuccessBtn');if(copyOrderSuccessBtn)copyOrderSuccessBtn.onclick=()=>copyText(state.orderSuccess?.orderId||'','คัดลอกเลขออเดอร์แล้ว กรุณาส่งให้ร้านทาง Facebook');
  const saveSettings = document.getElementById('saveSettingsBtn'); if (saveSettings) saveSettings.onclick = saveSettingsAction;
  document.querySelectorAll('[data-toggle-password]').forEach((button)=>button.onclick=()=>{const input=document.getElementById(button.dataset.togglePassword);if(!input)return;const show=input.type==='password';input.type=show?'text':'password';button.textContent=show?'ซ่อน':'แสดง';});
  const changeOwnerPasswordBtn=document.getElementById('changeOwnerPasswordBtn');if(changeOwnerPasswordBtn)changeOwnerPasswordBtn.onclick=async()=>{if(state.adminActionPending)return;const currentPassword=document.getElementById('ownerCurrentPassword').value,newPassword=document.getElementById('ownerNewPassword').value,confirmPassword=document.getElementById('ownerConfirmPassword').value;if(newPassword.length<10)return toast('รหัสผ่านใหม่ต้องมีอย่างน้อย 10 ตัวอักษร');if(newPassword!==confirmPassword)return toast('รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน');try{state.adminActionPending='OWNER_PASSWORD';changeOwnerPasswordBtn.disabled=true;changeOwnerPasswordBtn.textContent='กำลังเปลี่ยนรหัสผ่าน...';const data=await apiPost({action:'changeOwnerPassword',token:state.adminToken,currentPassword,newPassword,confirmPassword});state.adminToken='';state.adminData=null;state.adminUser=null;sessionStorage.removeItem('dmo_admin_token');sessionStorage.removeItem('dmo_admin_user');sessionStorage.removeItem('dmo_admin_activity');render();toast(data.message||'เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบอีกครั้ง');}catch(e){toast(e.message);}finally{state.adminActionPending='';}};
  const reloadInventory = document.getElementById('reloadInventoryBtn'); if (reloadInventory) reloadInventory.onclick = () => loadAdmin();
  const inventorySearch = document.getElementById('inventorySearch'); if (inventorySearch) inventorySearch.oninput = (event) => { state.inventorySearch = event.target.value; scheduleInputRender('inventorySearch', 80); };
  document.querySelectorAll('[data-inventory-filter]').forEach((button) => button.onclick = () => { state.inventoryFilter = button.dataset.inventoryFilter; render(); });
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
