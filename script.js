// ==========================
// CONFIG (GitHub Pages)
// ==========================
const BASE_URL = "https://ferreteriauniversal45-sudo.github.io/ferreteria-inventario-app";

// Inventarios por bodega (catálogos distintos)
const INVENTARIO_URLS = {
  PRINCIPAL: `${BASE_URL}/inventario.json`,
  ANEXO: `${BASE_URL}/inventarioanexo.json` // ⚠️ debes crear este archivo
};

// Versión general (cuando cambies cualquiera, actualiza esto)
const VERSION_URL = `${BASE_URL}/inventario_version.json`;

// ==========================
// STORAGE KEYS
// ==========================
const K = {
  BASE: "fu_base_inv",
  VER: "fu_base_ver",
  MOV: "fu_movimientos",
  DEL: "fu_eliminaciones",
  BOD: "fu_bodega_activa",
  PINOK_P: "fu_pinok_principal",
  PINOK_A: "fu_pinok_anexo"
};

// ==========================
// BODEGAS + PIN
// ==========================
const BODEGA = {
  PRINCIPAL: "PRINCIPAL",
  ANEXO: "ANEXO"
};

const PIN = {
  [BODEGA.PRINCIPAL]: "2025",
  [BODEGA.ANEXO]: "2026"
};

const $ = (id) => document.getElementById(id);

let activeBodega = localStorage.getItem(K.BOD) || BODEGA.PRINCIPAL;

function otherBodega(bod){
  return bod === BODEGA.PRINCIPAL ? BODEGA.ANEXO : BODEGA.PRINCIPAL;
}

function pinOkKey(bodega){
  return bodega === BODEGA.ANEXO ? K.PINOK_A : K.PINOK_P;
}

function isPinVerified(bodega){
  return localStorage.getItem(pinOkKey(bodega)) === "1";
}

function setPinVerified(bodega){
  localStorage.setItem(pinOkKey(bodega), "1");
}

function setActiveBodega(bodega){
  activeBodega = bodega;
  localStorage.setItem(K.BOD, bodega);

  // reset filtros al cambiar bodega
  filtroDepartamento = "";
  filtroCategoria = "";
  filtroStock = false;

  const selDep = $("filterDepartamento");
  const selCat = $("filterCategoria");
  const btnStock = $("btnFilterStock");
  if(selDep) selDep.value = "";
  if(selCat) selCat.value = "";
  if(btnStock) btnStock.classList.remove("active");

  updateBodegaUI();

  cargarDepartamentos();
  cargarCategorias("");
  updateFilterChips();

  refreshHome();

  // si catálogo/buscador está abierto, re-render
  const cat = $("catalogScreen");
  if(cat && !cat.classList.contains("hidden")){
    $("catalogSearch").value = "";
    renderCatalog("");
  }

  const search = $("searchScreen");
  if(search && !search.classList.contains("hidden")){
    $("searchInput").value = "";
    renderSearch("");
  }

  // actualizar hints si estaban en memoria
  updateSalidaStockHint();
  updateTransferStockHint();
}

function updateBodegaUI(){
  const btnP = $("btnBodegaPrincipal");
  const btnA = $("btnBodegaAnexo");
  const note = $("bodegaNote");

  if(btnP){
    btnP.classList.toggle("active", activeBodega === BODEGA.PRINCIPAL);
    btnP.classList.remove("anexo");
  }
  if(btnA){
    btnA.classList.toggle("active", activeBodega === BODEGA.ANEXO);
    btnA.classList.add("anexo");
  }

 if(note){
  const ver = isPinVerified(activeBodega)
    ? "✅ acceso autorizado en este teléfono"
    : "🔒 acceso protegido";

  note.textContent = `Bodega activa: ${activeBodega} · ${ver}`;
}

}

// ==========================
// PIN MODAL
// ==========================
function uiPinPrompt(bodega){
  return new Promise(resolve => {
    const overlay = $("pinOverlay");
    const msg = $("pinMessage");
    const inp = $("pinInput");
    const btnOk = $("pinOk");
    const btnCancel = $("pinCancel");

    if(!overlay || !msg || !inp || !btnOk || !btnCancel){
      const entered = prompt(`PIN para ${bodega}:`);
      resolve(String(entered || "") === PIN[bodega]);
      return;
    }

    msg.textContent = `Ingresa el PIN para entrar a ${bodega}`;
    inp.value = "";

    overlay.classList.remove("hidden");

    const cleanup = (result) => {
      overlay.classList.add("hidden");
      btnOk.onclick = null;
      btnCancel.onclick = null;
      overlay.onclick = null;
      inp.onkeydown = null;
      resolve(result);
    };

    const check = () => {
      const val = String(inp.value || "").trim();
      if(val === PIN[bodega]){
        setPinVerified(bodega);
        updateBodegaUI();
        cleanup(true);
      }else{
        toast("❌ PIN incorrecto");
        inp.value = "";
        inp.focus();
      }
    };

    btnOk.onclick = check;
    btnCancel.onclick = () => cleanup(false);

    overlay.onclick = (e) => {
      if(e.target === overlay) cleanup(false);
    };

    inp.onkeydown = (e) => {
      if(e.key === "Enter") check();
    };

    setTimeout(() => inp.focus(), 50);
  });
}

async function ensurePinForBodega(bodega){
  if(isPinVerified(bodega)) return true;
  return await uiPinPrompt(bodega);
}

// ==========================
// STATE
// ==========================
let currentSearchContext = null; // "entrada" | "salida" | "transfer"
let historialTab = "mov";        // "mov" | "trf" | "del"

// Inventarios por bodega
let baseCache = {
  [BODEGA.PRINCIPAL]: {},
  [BODEGA.ANEXO]: {}
};

let deltaDirty = true;
let deltaCache = { entP:{}, salP:{}, entA:{}, salA:{} };

// ==========================
// CATALOGO FILTERS (UI STATE)
// ==========================
let filtroDepartamento = "";
let filtroCategoria = "";
let filtroStock = false;

const CATALOG_INITIAL_LIMIT = 80;
const CATALOG_MAX_RENDER = 250;

// ==========================
// FACTURAS MULTI-ITEM (DRAFTS)
// ==========================
let entradaItems = [];  // [{codigo, cantidad}]
let salidaItems  = [];  // [{codigo, cantidad}]
let transferItems = []; // [{codigo, cantidad}]

function sumItems(items, code){
  const c = String(code || "").trim().toUpperCase();
  return items.reduce((acc, it) => acc + (it.codigo === c ? Number(it.cantidad || 0) : 0), 0);
}

function clearEntradaDraft(){
  entradaItems = [];
  renderEntradaItems();
}

function clearSalidaDraft(){
  salidaItems = [];
  renderSalidaItems();
  updateSalidaStockHint();
}

function clearTransferDraft(){
  transferItems = [];
  renderTransferItems();
  updateTransferStockHint();
}

// ==========================
// HELPERS
// ==========================
function readJSON(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch{
    return fallback;
  }
}

function writeJSON(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

function todayISO(){
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function nowISO(){
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

let toastTimer = null;
function toast(msg){
  const t = $("toast");
  if(!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1600);
}

function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function makeId(){
  return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

function formatFechaHora(ts){
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ✅ Descarga compatible con Android WebView
function downloadBlob(blob, filename){
  try{
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 400);
    return true;
  }catch(e){
    console.warn("downloadBlob error", e);
    return false;
  }
}

// ==========================
// AUTO "-" DESPUÉS DE 2 DÍGITOS (CÓDIGOS)
// ==========================
function digitsToCodigo(digits){
  const d = String(digits || "").replace(/\D/g, "");
  if(d.length === 0) return "";
  if(d.length === 1) return d;
  if(d.length === 2) return `${d}-`;
  return `${d.slice(0,2)}-${d.slice(2)}`;
}

function hasLetters(str){
  return /[a-zA-Z\u00C0-\u017F]/.test(String(str || ""));
}

/**
 * allowText=true -> SOLO aplica máscara si el usuario escribe numérico (sin letras).
 * allowText=false -> forzar solo dígitos (entradaCodigo/salidaCodigo/transferCodigo).
 */
function attachCodigoMask(input, { allowText=false } = {}){
  if(!input) return;

  input.addEventListener("input", () => {
    const raw = input.value ?? "";

    if(allowText){
      if(hasLetters(raw)) return;
      const t = String(raw).trim();
      if(t && !/^\d/.test(t)) return;
    }

    const digits = String(raw).replace(/\D/g, "");
    input.value = digitsToCodigo(digits);
  });
}

// ==========================
// UI NAV
// ==========================
const screens = ["homeScreen","catalogScreen","entradaScreen","salidaScreen","transferScreen","searchScreen","historialScreen"];
function showScreen(id){
  for(const s of screens){
    const el = $(s);
    if(el) el.classList.toggle("hidden", s !== id);
  }

  // evitar listas pegadas al navegar
  hideCodigoAutoList("entradaAutoList");
  hideCodigoAutoList("salidaAutoList");
  hideCodigoAutoList("transferAutoList");
}

// ==========================
// NETWORK ICON
// ==========================
function setNetworkState(isOnline){
  const icon = $("netIcon");
  if(icon){
    icon.classList.toggle("online", !!isOnline);
    icon.classList.toggle("offline", !isOnline);
    icon.title = isOnline ? "Con conexión" : "Sin conexión";
    icon.setAttribute("aria-label", isOnline ? "Con conexión" : "Sin conexión");
  }
  const estado = $("homeEstado");
  if(estado) estado.textContent = isOnline ? "ON" : "OFF";
}
window.addEventListener("online", () => setNetworkState(true));
window.addEventListener("offline", () => setNetworkState(false));

// ==========================
// INVENTORY NORMALIZATION
// ==========================
function normalizeBase(inv){
  const out = {};
  if(!inv || typeof inv !== "object") return out;

  for(const rawCode of Object.keys(inv)){
    const code = String(rawCode).trim().toUpperCase();
    const val = inv[rawCode];

    if(typeof val === "number"){
      out[code] = { producto: "(sin nombre)", departamento:"", stock: val };
      continue;
    }

    if(val && typeof val === "object"){
      const producto = String(val.producto ?? val.nombre ?? "(sin nombre)");
      const departamento = String(val.departamento ?? "");
      const stock = Number(val.stock ?? val.cantidad ?? 0);
      out[code] = {
        producto,
        departamento,
        stock: Number.isFinite(stock) ? stock : 0
      };
      continue;
    }

    out[code] = { producto: "(sin nombre)", departamento:"", stock: 0 };
  }
  return out;
}

function baseKeyFor(bodega){
  return `${K.BASE}_${bodega}`;
}

function getBase(bodega = activeBodega){
  return baseCache[bodega] || {};
}

// ==========================
// DEPARTAMENTO / CATEGORIA (split por "-")
// ==========================
function depSplit(dep){
  const s = String(dep || "").trim();
  if(!s) return { dep:"", cat:"" };
  const idx = s.indexOf("-");
  if(idx < 0) return { dep: s.trim(), cat:"" };
  const depMain = s.slice(0, idx).trim();
  const cat = s.slice(idx + 1).trim();
  return { dep: depMain, cat };
}
function getDepartamentoPrincipal(dep){ return depSplit(dep).dep; }
function getCategoria(dep){ return depSplit(dep).cat; }

// ==========================
// CATALOGO FILTERS (DEPARTAMENTOS/CATEGORIAS)
// ==========================
function cargarDepartamentos(){
  const select = $("filterDepartamento");
  if(!select) return;

  const prev = (filtroDepartamento || select.value || "").trim();
  const depsSet = new Set();

  const base = getBase();

  for(const code of Object.keys(base || {})){
    const depFull = base[code]?.departamento;
    const depMain = getDepartamentoPrincipal(depFull);
    if(depMain) depsSet.add(depMain);
  }

  const deps = Array.from(depsSet).sort((a,b) =>
    a.localeCompare(b, "es", { sensitivity: "base" })
  );

  select.innerHTML = `<option value="">Todos</option>`;
  for(const dep of deps){
    const opt = document.createElement("option");
    opt.value = dep;
    opt.textContent = dep;
    select.appendChild(opt);
  }

  filtroDepartamento = depsSet.has(prev) ? prev : "";
  select.value = filtroDepartamento;
}

function cargarCategorias(depMainFilter = filtroDepartamento){
  const select = $("filterCategoria");
  if(!select) return;

  const prev = (filtroCategoria || select.value || "").trim();
  const set = new Set();

  const base = getBase();

  for(const code of Object.keys(base || {})){
    const depFull = base[code]?.departamento || "";
    const depMain = getDepartamentoPrincipal(depFull);
    const cat = getCategoria(depFull);

    if(depMainFilter && depMain !== depMainFilter) continue;
    if(cat) set.add(cat);
  }

  const cats = Array.from(set).sort((a,b) =>
    a.localeCompare(b, "es", { sensitivity:"base" })
  );

  select.innerHTML = `<option value="">Todas</option>`;
  for(const c of cats){
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  }

  filtroCategoria = set.has(prev) ? prev : "";
  select.value = filtroCategoria;
}

// ==========================
// CHIPS DE FILTROS (DEP / CAT)
// ==========================
function updateFilterChips(){
  const depChip = $("chipDep");
  const depText = $("chipDepText");
  const catChip = $("chipCat");
  const catText = $("chipCatText");

  if(depChip && depText){
    if(filtroDepartamento){
      depText.textContent = filtroDepartamento;
      depChip.classList.remove("hidden");
    }else{
      depChip.classList.add("hidden");
    }
  }

  if(catChip && catText){
    if(filtroCategoria){
      catText.textContent = filtroCategoria;
      catChip.classList.remove("hidden");
    }else{
      catChip.classList.add("hidden");
    }
  }
}

// ==========================
// DELTAS (por bodega) + transferencias
// ==========================
function rebuildDelta(){
  const movs = readJSON(K.MOV, []);

  const entP = {}, salP = {};
  const entA = {}, salA = {};

  for(const m of movs){
    const c = String(m.codigo||"").trim().toUpperCase();
    const q = Number(m.cantidad||0);
    if(!c || !Number.isFinite(q)) continue;

    const bod = String(m.bodega || BODEGA.PRINCIPAL);

    const ent = (bod === BODEGA.ANEXO) ? entA : entP;
    const sal = (bod === BODEGA.ANEXO) ? salA : salP;

    const isEnt = (m.tipo === "entrada") || (m.tipo === "transferencia" && m.subTipo === "entrada");
    const isSal = (m.tipo === "salida")  || (m.tipo === "transferencia" && m.subTipo === "salida");

    if(isEnt) ent[c] = (ent[c] || 0) + q;
    if(isSal) sal[c] = (sal[c] || 0) + q;
  }

  deltaCache = { entP, salP, entA, salA };
  deltaDirty = false;
}

function getStock(code, bodega = activeBodega){
  if(deltaDirty) rebuildDelta();
  const c = String(code||"").trim().toUpperCase();
  const base = (baseCache[bodega]?.[c]?.stock ?? 0);

  const ent = (bodega === BODEGA.ANEXO) ? (deltaCache.entA[c] || 0) : (deltaCache.entP[c] || 0);
  const sal = (bodega === BODEGA.ANEXO) ? (deltaCache.salA[c] || 0) : (deltaCache.salP[c] || 0);

  return Number(base) + Number(ent) - Number(sal);
}

// ==========================
// SYNC (versionado general)
// ==========================
let syncing = false;

function migrateOldBaseIfNeeded(){
  // compat: si venías de la versión vieja (un solo K.BASE), lo tratamos como PRINCIPAL
  const old = localStorage.getItem(K.BASE);
  const newP = localStorage.getItem(baseKeyFor(BODEGA.PRINCIPAL));
  if(old && !newP){
    try{
      const parsed = JSON.parse(old);
      writeJSON(baseKeyFor(BODEGA.PRINCIPAL), parsed);
    }catch{}
  }
}

async function syncBase(showMsg){
  if(syncing) return;
  syncing = true;

  const btn = $("btnSync");
  const icon = $("netIcon");

  if(btn){
    btn.disabled = true;
    btn.textContent = "Actualizando...";
  }
  if(icon) icon.classList.add("spin");

  try{
    migrateOldBaseIfNeeded();

    const verRes = await fetch(VERSION_URL, { cache: "no-store" });
    if(!verRes.ok) throw new Error("No se pudo leer versión");
    const verJson = await verRes.json();
    const remoteVer = String(verJson.version || "").trim();
    if(!remoteVer) throw new Error("Versión inválida");

    const localVer = localStorage.getItem(K.VER) || "";
    const missingLocal =
      !localStorage.getItem(baseKeyFor(BODEGA.PRINCIPAL)) ||
      !localStorage.getItem(baseKeyFor(BODEGA.ANEXO));

    if(localVer !== remoteVer || missingLocal){
      // descargar ambos
      for(const bod of [BODEGA.PRINCIPAL, BODEGA.ANEXO]){
        const url = INVENTARIO_URLS[bod];
        const invRes = await fetch(url, { cache: "no-store" });
        if(!invRes.ok) throw new Error(`No se pudo leer inventario ${bod}`);
        const invJson = await invRes.json();
        const normalized = normalizeBase(invJson);
        writeJSON(baseKeyFor(bod), normalized);
        baseCache[bod] = normalized;
      }
      localStorage.setItem(K.VER, remoteVer);
      if(showMsg) toast("✅ Inventarios actualizados");
    }else{
      // cargar local
      baseCache[BODEGA.PRINCIPAL] = readJSON(baseKeyFor(BODEGA.PRINCIPAL), {});
      baseCache[BODEGA.ANEXO] = readJSON(baseKeyFor(BODEGA.ANEXO), {});
      if(showMsg) toast("✅ Ya estabas actualizado");
    }

    setNetworkState(true);
    cargarDepartamentos();
    cargarCategorias(filtroDepartamento);
    updateFilterChips();
    refreshHome();

    // re-render si está abierto
    if($("catalogScreen") && !$("catalogScreen").classList.contains("hidden")){
      renderCatalog($("catalogSearch")?.value || "");
    }
    if($("searchScreen") && !$("searchScreen").classList.contains("hidden")){
      renderSearch($("searchInput")?.value || "");
    }

  }catch(err){
    baseCache[BODEGA.PRINCIPAL] = readJSON(baseKeyFor(BODEGA.PRINCIPAL), {});
    baseCache[BODEGA.ANEXO] = readJSON(baseKeyFor(BODEGA.ANEXO), {});
    setNetworkState(navigator.onLine);

    cargarDepartamentos();
    cargarCategorias(filtroDepartamento);
    updateFilterChips();
    refreshHome();

    if($("catalogScreen") && !$("catalogScreen").classList.contains("hidden")){
      renderCatalog($("catalogSearch")?.value || "");
    }
    if($("searchScreen") && !$("searchScreen").classList.contains("hidden")){
      renderSearch($("searchInput")?.value || "");
    }

    if(showMsg) toast("⚠️ Sin internet: usando inventario local");
    console.warn(err);
  }

  if(btn){
    btn.disabled = false;
    btn.textContent = "Actualizar inventario";
  }
  if(icon) icon.classList.remove("spin");
  syncing = false;
}

// ==========================
// HOME
// ==========================
function refreshHome(){
  const ver = localStorage.getItem(K.VER) || "—";
  if($("homeVersion")) $("homeVersion").textContent = ver;

  const total = Object.keys(getBase() || {}).length;
  if($("homeProductos")) $("homeProductos").textContent = String(total);

  const movs = readJSON(K.MOV, []);
  const h = todayISO();

  // contar movimientos del día SOLO de la bodega activa (compat: sin bodega -> PRINCIPAL)
  const movHoy = movs.filter(m => {
    const fechaOk = String(m.fecha||"").slice(0,10) === h;
    const bod = String(m.bodega || BODEGA.PRINCIPAL);
    return fechaOk && bod === activeBodega;
  }).length;

  if($("homeMovHoy")) $("homeMovHoy").textContent = String(movHoy);

  updateBodegaUI();
}

// ==========================
// CATALOGO (TABLA) + FILTROS (stock SOLO bodega activa)
// ==========================
function renderCatalog(query){
  const list = $("catalogList");
  const info = $("catalogInfo");
  if(!list || !info) return;

  list.innerHTML = "";

  const q = (query || "").toLowerCase().trim();

  let entries = Object.entries(getBase() || {});
  const baseTotal = entries.length;

  if(baseTotal === 0){
    info.textContent = "No hay inventario cargado. Pulsa 'Actualizar inventario'.";
    return;
  }

  if(filtroDepartamento){
    entries = entries.filter(([_, data]) =>
      getDepartamentoPrincipal(data?.departamento || "") === filtroDepartamento
    );
  }

  if(filtroCategoria){
    entries = entries.filter(([_, data]) =>
      getCategoria(data?.departamento || "") === filtroCategoria
    );
  }

  if(filtroStock){
    entries = entries.filter(([code]) => getStock(code, activeBodega) > 0);
  }

  if(q.length === 0){
    entries.sort((a,b) => a[0].localeCompare(b[0], "es", { numeric:true, sensitivity:"base" }));
    const show = entries.slice(0, CATALOG_INITIAL_LIMIT);

    info.textContent = entries.length > show.length
      ? `Mostrando ${show.length} de ${entries.length}. Escribe para buscar o usa filtros.`
      : `Productos: ${entries.length} · Bodega: ${activeBodega}`;

    for(const [code, data] of show){
      const stock = getStock(code, activeBodega);
      const row = document.createElement("div");
      row.className = "trow cols-catalog";
      row.innerHTML = `
        <div class="cell" data-label="Código">${escapeHtml(code)}</div>
        <div class="cell wrap" data-label="Producto">${escapeHtml(data.producto || "(sin nombre)")}</div>
        <div class="cell" data-label="Departamento">${escapeHtml(data.departamento || "")}</div>
        <div class="cell right" data-label="Stock">${escapeHtml(String(stock))}</div>
      `;
      list.appendChild(row);
    }
    return;
  }

  const filtered = entries.filter(([code, data]) => {
    const name = String(data.producto||"").toLowerCase();
    return String(code||"").toLowerCase().includes(q) || name.includes(q);
  });

  if(filtered.length === 0){
    info.textContent = "Sin resultados.";
    return;
  }

  const show = filtered.slice(0, CATALOG_MAX_RENDER);
  info.textContent = filtered.length > show.length
    ? `Mostrando ${show.length} de ${filtered.length}. Sigue escribiendo para filtrar más.`
    : `Resultados: ${filtered.length} · Bodega: ${activeBodega}`;

  for(const [code, data] of show){
    const stock = getStock(code, activeBodega);
    const row = document.createElement("div");
    row.className = "trow cols-catalog";
    row.innerHTML = `
      <div class="cell" data-label="Código">${escapeHtml(code)}</div>
      <div class="cell wrap" data-label="Producto">${escapeHtml(data.producto || "(sin nombre)")}</div>
      <div class="cell" data-label="Departamento">${escapeHtml(data.departamento || "")}</div>
      <div class="cell right" data-label="Stock">${escapeHtml(String(stock))}</div>
    `;
    list.appendChild(row);
  }
}

// ==========================
// BUSCADOR (B2) - pantalla lupa (solo productos de bodega activa)
// ==========================
function selectProduct(code){
  const data = getBase()[code];
  if(!data) return;

  if(currentSearchContext === "entrada"){
    $("entradaCodigo").value = code;
    $("entradaProducto").value = data.producto || "";
    showScreen("entradaScreen");
    return;
  }
  if(currentSearchContext === "salida"){
    $("salidaCodigo").value = code;
    $("salidaProducto").value = data.producto || "";
    updateSalidaStockHint();
    showScreen("salidaScreen");
    return;
  }
  if(currentSearchContext === "transfer"){
    $("transferCodigo").value = code;
    $("transferProducto").value = data.producto || "";
    updateTransferStockHint();
    showScreen("transferScreen");
    return;
  }

  showScreen("homeScreen");
}

function renderSearch(query){
  const list = $("searchList");
  const info = $("searchInfo");
  if(!list || !info) return;

  list.innerHTML = "";

  const q = (query || "").toLowerCase().trim();
  const entries = Object.entries(getBase() || {});
  const total = entries.length;

  if(total > 500 && q.length < 2){
    info.textContent = "Escribe al menos 2 letras/números para buscar.";
    return;
  }

  const filtered = entries.filter(([code, data]) => {
    const name = String(data.producto||"").toLowerCase();
    return String(code||"").toLowerCase().includes(q) || name.includes(q);
  });

  if(filtered.length === 0){
    info.textContent = "Sin resultados.";
    return;
  }

  const show = filtered.slice(0, 250);
  info.textContent = filtered.length > show.length
    ? `Mostrando ${show.length} de ${filtered.length}. Sigue escribiendo para filtrar más.`
    : `Resultados: ${filtered.length} · Bodega: ${activeBodega}`;

  for(const [code, data] of show){
    const stock = getStock(code, activeBodega);

    const row = document.createElement("div");
    row.className = "trow cols-search selectable";
    row.innerHTML = `
      <div class="cell" data-label="Código">${escapeHtml(code)}</div>
      <div class="cell wrap" data-label="Producto">${escapeHtml(data.producto || "(sin nombre)")}</div>
      <div class="cell" data-label="Departamento">${escapeHtml(data.departamento || "")}</div>
      <div class="cell right" data-label="Stock">${escapeHtml(String(stock))}</div>
      <div class="cell right" data-label="">
        <button class="btn small row-action" type="button">Seleccionar</button>
      </div>
    `;

    row.addEventListener("click", () => selectProduct(code));
    row.querySelector(".row-action").addEventListener("click", (e) => {
      e.stopPropagation();
      selectProduct(code);
    });

    list.appendChild(row);
  }
}

// ==========================
// ✅ AUTOCOMPLETE SOLO POR CÓDIGO (ENTRADA / SALIDA / TRANSFER)
// ==========================
function hideCodigoAutoList(listId){
  const list = $(listId);
  if(!list) return;
  list.innerHTML = "";
  list.style.display = "none";
}

const CODE_CTX = {
  entrada: { inputId:"entradaCodigo", listId:"entradaAutoList", productId:"entradaProducto", focusId:"entradaCantidad" },
  salida: { inputId:"salidaCodigo", listId:"salidaAutoList", productId:"salidaProducto", focusId:"salidaCantidad" },
  transfer:{ inputId:"transferCodigo", listId:"transferAutoList", productId:"transferProducto", focusId:"transferCantidad" }
};

function renderCodigoAutoList(context){
  const cfg = CODE_CTX[context];
  if(!cfg) return;

  const input = $(cfg.inputId);
  const list = $(cfg.listId);
  if(!input || !list) return;

  const q = String(input.value || "").trim().toUpperCase();

  // solo mostrar cuando ya tenga 2 dígitos
  const digits = q.replace(/\D/g, "");
  if(digits.length < 2){
    hideCodigoAutoList(cfg.listId);
    return;
  }

  const codes = Object.keys(getBase() || {});
  if(codes.length === 0){
    hideCodigoAutoList(cfg.listId);
    return;
  }

  const matches = codes
    .filter(code => code.startsWith(q))
    .slice(0, 8);

  if(matches.length === 0){
    hideCodigoAutoList(cfg.listId);
    return;
  }

  list.innerHTML = "";

  for(const code of matches){
    const data = getBase()[code] || {};
    const stock = getStock(code, activeBodega);

    const item = document.createElement("div");
    item.className = "autocomplete-item";
    item.innerHTML = `
      <div class="auto-code">${escapeHtml(code)}</div>
      <div class="auto-name">${escapeHtml(data.producto || "")}</div>
      <div class="auto-stock">Stock: ${escapeHtml(String(stock))}</div>
    `;

    let done = false;
    const select = (e) => {
      if(done) return;
      done = true;
      e?.preventDefault?.();

      input.value = code;

      const prod = $(cfg.productId);
      if(prod) prod.value = data.producto || "";

      if(context === "salida") updateSalidaStockHint();
      if(context === "transfer") updateTransferStockHint();

      $(cfg.focusId)?.focus();

      hideCodigoAutoList(cfg.listId);
    };

    item.addEventListener("pointerdown", select);
    item.addEventListener("mousedown", select);
    item.addEventListener("click", select);

    list.appendChild(item);
  }

  list.style.display = "block";
}

// ==========================
// ENTRADAS / SALIDAS / TRANSFER (AUTO-LLENADO)
// ==========================
function fillProductoFromCode(context){
  const cfg = CODE_CTX[context];
  if(!cfg) return;

  const code = String($(cfg.inputId)?.value||"").trim().toUpperCase();
  const prod = $(cfg.productId);
  if(!prod) return;

  prod.value = getBase()[code]?.producto || "";

  if(context === "salida") updateSalidaStockHint();
  if(context === "transfer") updateTransferStockHint();
}

// ==========================
// STOCK HINTS
// ==========================
function updateSalidaStockHint(){
  const code = String($("salidaCodigo")?.value||"").trim().toUpperCase();
  const out = $("salidaStockInfo");
  if(!out) return;

  if(!code){
    out.textContent = "";
    return;
  }

  const stockReal = getStock(code, activeBodega);
  const reservado = sumItems(salidaItems, code);
  const disponible = stockReal - reservado;

  const extra = reservado > 0 ? ` (en factura: ${reservado})` : "";
  out.textContent = `Stock disponible (${activeBodega}): ${disponible}${extra}`;
}

function updateTransferStockHint(){
  const code = String($("transferCodigo")?.value||"").trim().toUpperCase();
  const out = $("transferStockInfo");
  if(!out) return;

  if(!code){
    out.textContent = "";
    return;
  }

  const origen = activeBodega;
  const destino = otherBodega(activeBodega);

  const stockReal = getStock(code, origen);
  const reservado = sumItems(transferItems, code);
  const disponible = stockReal - reservado;

  const extra = reservado > 0 ? ` (en transferencia: ${reservado})` : "";
  out.textContent = `Disponible en ${origen}: ${disponible}${extra} · Destino: ${destino}`;
}

// ==========================
// FACTURA BORRADOR (PREVIEW)
// ==========================
function flashInvoiceEl(el){
  if(!el) return;
  el.classList.add("invoice-flash");
  clearTimeout(el._flashTimer);
  el._flashTimer = setTimeout(() => el.classList.remove("invoice-flash"), 250);
}

function updateDraftTotalsFromDOM(context){
  const preview =
    context === "entrada" ? $("entradaFacturaPreview") :
    context === "salida"  ? $("salidaFacturaPreview")  :
    context === "transfer"? $("transferFacturaPreview") : null;

  const inv = preview?.querySelector(`.invoice[data-draft="${context}"]`);
  if(!inv) return;

  const inputs = inv.querySelectorAll("input.draft-cantidad");
  const totalProductos = inputs.length;

  let totalPiezas = 0;
  for(const inp of inputs){
    const v = Number(inp.value);
    if(Number.isFinite(v) && v > 0) totalPiezas += v;
  }

  inv.querySelectorAll(".t-prod").forEach(el => el.textContent = String(totalProductos));
  inv.querySelectorAll(".t-pzas").forEach(el => el.textContent = String(totalPiezas));

  flashInvoiceEl(inv);
}

function renderDraftFactura(context){
  const isEntrada = context === "entrada";
  const isSalida  = context === "salida";
  const isTransfer= context === "transfer";

  const items = isEntrada ? entradaItems : isSalida ? salidaItems : transferItems;

  const info =
    isEntrada ? $("entradaItemsInfo") :
    isSalida  ? $("salidaItemsInfo")  :
    $("transferItemsInfo");

  const preview =
    isEntrada ? $("entradaFacturaPreview") :
    isSalida  ? $("salidaFacturaPreview")  :
    $("transferFacturaPreview");

  if(!info || !preview) return;

  preview.innerHTML = "";

  if(items.length === 0){
    info.textContent = isTransfer ? "Transferencia vacía." : "Factura vacía.";
    return;
  }

  const fecha =
    (isEntrada ? $("entradaFecha")?.value :
     isSalida  ? $("salidaFecha")?.value :
     $("transferFecha")?.value) || todayISO();

  const factura =
    (isEntrada ? $("entradaFactura")?.value :
     isSalida  ? $("salidaFactura")?.value :
     $("transferReferencia")?.value) || "";

  const proveedor = isEntrada ? String($("entradaProveedor")?.value || "").trim() : "";
  const tipoLabel = isEntrada ? "ENTRADA" : isSalida ? "SALIDA" : "TRANSFERENCIA";

  const totalPiezas = items.reduce((a,it)=>a+Number(it.cantidad||0),0);
  info.textContent = (isTransfer ? "Productos en transferencia: " : "Productos en factura: ")
    + `${items.length} · Total piezas: ${totalPiezas}`;

  const origen = isTransfer ? activeBodega : "";
  const destino = isTransfer ? otherBodega(activeBodega) : "";

  const inv = document.createElement("div");
  inv.className = "invoice";
  inv.dataset.draft = context;

  // meta dinámico
  let metaHtml = "";
  if(isTransfer){
    metaHtml = `
      <div class="im-row"><span class="im-label">REF</span><span class="im-value">${escapeHtml(factura || "—")}</span></div>
      <div class="im-row"><span class="im-label">TIPO</span><span class="im-value">${escapeHtml(tipoLabel)}</span></div>
      <div class="im-row"><span class="im-label">FECHA</span><span class="im-value">${escapeHtml(fecha)}</span></div>
      <div class="im-row"><span class="im-label">ORIGEN</span><span class="im-value">${escapeHtml(origen)}</span></div>
      <div class="im-row"><span class="im-label">DESTINO</span><span class="im-value">${escapeHtml(destino)}</span></div>
    `;
  }else{
    const proveedorLabel = isEntrada ? "PROVEEDOR" : "REFERENCIA";
    const proveedorVal = isEntrada ? (proveedor || "—") : "—";
    metaHtml = `
      <div class="im-row"><span class="im-label">FACTURA</span><span class="im-value">${escapeHtml(factura || "—")}</span></div>
      <div class="im-row"><span class="im-label">TIPO</span><span class="im-value">${escapeHtml(tipoLabel)}</span></div>
      <div class="im-row"><span class="im-label">FECHA</span><span class="im-value">${escapeHtml(fecha)}</span></div>
      <div class="im-row"><span class="im-label">${escapeHtml(proveedorLabel)}</span><span class="im-value">${escapeHtml(proveedorVal)}</span></div>
      <div class="im-row"><span class="im-label">BODEGA</span><span class="im-value">${escapeHtml(activeBodega)}</span></div>
    `;
  }

  inv.innerHTML = `
    <div class="invoice-header">
      <div class="invoice-company">FERRETERÍA UNIVERSAL</div>
      <div class="invoice-sub">${isTransfer ? "TRANSFERENCIA (BORRADOR)" : "FACTURA (BORRADOR)"}</div>
    </div>

    <div class="invoice-meta">
      ${metaHtml}
    </div>

    <div class="invoice-summary">
      Productos: <b class="t-prod">${items.length}</b> · Piezas: <b class="t-pzas">${totalPiezas}</b>
    </div>

    <div class="invoice-rule"></div>

    <div class="invoice-table">
      <div class="it-head">
        <div>CÓD</div>
        <div>PRODUCTO</div>
        <div class="right">CANT</div>
        <div class="right">ACC</div>
      </div>

      ${items.map(it=>{
        const data = getBase()[it.codigo] || {};
        return `
          <div class="it-row">
            <div class="it-code">${escapeHtml(it.codigo)}</div>
            <div class="it-prod">${escapeHtml(data.producto || "(sin nombre)")}</div>
            <div class="right">
              <input
                class="qty-input draft-cantidad"
                type="number"
                min="1"
                inputmode="numeric"
                pattern="[0-9]*"
                value="${escapeHtml(String(it.cantidad))}"
                data-context="${escapeHtml(context)}"
                data-codigo="${escapeHtml(it.codigo)}">
            </div>
            <div class="it-actions">
              <button class="inv-action" type="button" data-edit-draft title="Editar cantidad">✏️</button>
              <button class="inv-action danger" type="button" data-del-draft="${escapeHtml(it.codigo)}" data-context="${escapeHtml(context)}" title="Eliminar producto">🗑</button>
            </div>
          </div>
        `;
      }).join("")}
    </div>

    <div class="invoice-rule"></div>

    <div class="invoice-totals">
      <div class="itot-row"><span>TOTAL PRODUCTOS</span><span class="t-prod">${items.length}</span></div>
      <div class="itot-row"><span>TOTAL PIEZAS</span><span class="t-pzas">${totalPiezas}</span></div>
    </div>
  `;

  preview.appendChild(inv);
}

function renderEntradaItems(){ renderDraftFactura("entrada"); }
function renderSalidaItems(){ renderDraftFactura("salida"); }
function renderTransferItems(){ renderDraftFactura("transfer"); }

// ==========================
// ADD ITEMS
// ==========================
function addEntradaItem(){
  const codigo = String($("entradaCodigo").value||"").trim().toUpperCase();
  const cantidad = Number($("entradaCantidad").value);

  if(!codigo || !Number.isFinite(cantidad) || cantidad <= 0){
    toast("Código y cantidad válidos.");
    return;
  }
  if(!getBase()[codigo]){
    toast(`Código no existe en ${activeBodega}.`);
    return;
  }

  const idx = entradaItems.findIndex(x => x.codigo === codigo);
  if(idx >= 0) entradaItems[idx].cantidad += cantidad;
  else entradaItems.push({ codigo, cantidad });

  $("entradaCodigo").value = "";
  $("entradaProducto").value = "";
  $("entradaCantidad").value = "";
  hideCodigoAutoList("entradaAutoList");

  renderEntradaItems();
  toast("➕ Agregado a la factura");
}

function addSalidaItem(){
  const codigo = String($("salidaCodigo").value||"").trim().toUpperCase();
  const cantidad = Number($("salidaCantidad").value);

  if(!codigo || !Number.isFinite(cantidad) || cantidad <= 0){
    toast("Código y cantidad válidos.");
    return;
  }
  if(!getBase()[codigo]){
    toast(`Código no existe en ${activeBodega}.`);
    return;
  }

  const stockReal = getStock(codigo, activeBodega);
  const reservado = sumItems(salidaItems, codigo);
  const disponible = stockReal - reservado;

  if(cantidad > disponible){
    toast(`Stock insuficiente. Disponible: ${disponible}`);
    return;
  }

  const idx = salidaItems.findIndex(x => x.codigo === codigo);
  if(idx >= 0) salidaItems[idx].cantidad += cantidad;
  else salidaItems.push({ codigo, cantidad });

  $("salidaCodigo").value = "";
  $("salidaProducto").value = "";
  $("salidaCantidad").value = "";
  hideCodigoAutoList("salidaAutoList");

  renderSalidaItems();
  updateSalidaStockHint();
  toast("➕ Agregado a la factura");
}

function addTransferItem(){
  const codigo = String($("transferCodigo").value||"").trim().toUpperCase();
  const cantidad = Number($("transferCantidad").value);

  if(!codigo || !Number.isFinite(cantidad) || cantidad <= 0){
    toast("Código y cantidad válidos.");
    return;
  }

  const origen = activeBodega;
  const destino = otherBodega(activeBodega);

  if(!baseCache[origen]?.[codigo]){
    toast(`Código no existe en ${origen}.`);
    return;
  }
  if(!baseCache[destino]?.[codigo]){
    toast(`No se puede transferir: el producto NO existe en ${destino}.`);
    return;
  }

  const stockReal = getStock(codigo, origen);
  const reservado = sumItems(transferItems, codigo);
  const disponible = stockReal - reservado;

  if(cantidad > disponible){
    toast(`Stock insuficiente en ${origen}. Disponible: ${disponible}`);
    return;
  }

  const idx = transferItems.findIndex(x => x.codigo === codigo);
  if(idx >= 0) transferItems[idx].cantidad += cantidad;
  else transferItems.push({ codigo, cantidad });

  $("transferCodigo").value = "";
  $("transferProducto").value = "";
  $("transferCantidad").value = "";
  hideCodigoAutoList("transferAutoList");

  renderTransferItems();
  updateTransferStockHint();
  toast("➕ Agregado a transferencia");
}

// ==========================
// SAVE FACTURAS / TRANSFERENCIAS
// ==========================
function saveFacturaEntrada(){
  const proveedor = String($("entradaProveedor").value||"").trim();
  const factura = String($("entradaFactura").value||"").trim();
  const fecha = $("entradaFecha").value || todayISO();

  if(entradaItems.length === 0){
    toast("Agrega al menos 1 producto.");
    return;
  }
  if(!proveedor || !factura || !fecha){
    toast("Completa Proveedor, Factura y Fecha.");
    return;
  }

  const grupoId = makeId();
  const movs = readJSON(K.MOV, []);

  for(const it of entradaItems){
    const codigo = it.codigo;
    const cantidad = Number(it.cantidad);

    movs.push({
      id: makeId(),
      grupoId,
      tipo: "entrada",
      bodega: activeBodega,
      codigo,
      producto: getBase()[codigo]?.producto || "",
      departamento: getBase()[codigo]?.departamento || "",
      cantidad,
      proveedor,
      factura,
      fecha,
      timestamp: Date.now()
    });
  }

  writeJSON(K.MOV, movs);
  deltaDirty = true;

  toast("✅ Factura de entrada guardada");
  refreshHome();
  clearEntradaDraft();
  showScreen("homeScreen");
}

function saveFacturaSalida(){
  const factura = String($("salidaFactura").value||"").trim();
  const fecha = $("salidaFecha").value || todayISO();

  if(salidaItems.length === 0){
    toast("Agrega al menos 1 producto.");
    return;
  }
  if(!factura || !fecha){
    toast("Completa Factura y Fecha.");
    return;
  }

  // validación final (por bodega activa)
  for(const it of salidaItems){
    const stockReal = getStock(it.codigo, activeBodega);
    const reservadoOtros = sumItems(salidaItems, it.codigo) - Number(it.cantidad || 0);
    const disponible = stockReal - reservadoOtros;
    if(Number(it.cantidad) > disponible){
      toast(`Stock insuficiente en ${it.codigo}. Disponible: ${disponible}`);
      return;
    }
  }

  const grupoId = makeId();
  const movs = readJSON(K.MOV, []);

  for(const it of salidaItems){
    const codigo = it.codigo;
    const cantidad = Number(it.cantidad);

    movs.push({
      id: makeId(),
      grupoId,
      tipo: "salida",
      bodega: activeBodega,
      codigo,
      producto: getBase()[codigo]?.producto || "",
      departamento: getBase()[codigo]?.departamento || "",
      cantidad,
      proveedor: "",
      factura,
      fecha,
      timestamp: Date.now()
    });
  }

  writeJSON(K.MOV, movs);
  deltaDirty = true;

  toast("✅ Factura de salida guardada");
  refreshHome();

  clearSalidaDraft();
  showScreen("homeScreen");
}

function saveTransferencia(){
  const fecha = $("transferFecha").value || todayISO();
  const referencia = String($("transferReferencia")?.value || "").trim();

  if(transferItems.length === 0){
    toast("Agrega al menos 1 producto.");
    return;
  }
  if(!fecha){
    toast("Completa la Fecha.");
    return;
  }

  const origen = activeBodega;
  const destino = otherBodega(activeBodega);

  // validación final
  for(const it of transferItems){
    const code = it.codigo;

    if(!baseCache[origen]?.[code]){
      toast(`Producto ${code} ya no existe en ${origen}`);
      return;
    }
    if(!baseCache[destino]?.[code]){
      toast(`No se puede transferir ${code}: no existe en ${destino}`);
      return;
    }

    const stockReal = getStock(code, origen);
    const reservadoOtros = sumItems(transferItems, code) - Number(it.cantidad || 0);
    const disponible = stockReal - reservadoOtros;

    if(Number(it.cantidad) > disponible){
      toast(`Stock insuficiente en ${code} (${origen}). Disponible: ${disponible}`);
      return;
    }
  }

  const trfId = "TRF-" + makeId();
  const movs = readJSON(K.MOV, []);

  for(const it of transferItems){
    const codigo = it.codigo;
    const cantidad = Number(it.cantidad);
    const prod = baseCache[origen]?.[codigo]?.producto || "";
    const dep  = baseCache[origen]?.[codigo]?.departamento || "";

    // SALIDA origen
    movs.push({
      id: makeId(),
      grupoId: trfId,
      transferenciaId: trfId,
      tipo: "transferencia",
      subTipo: "salida",
      bodega: origen,
      bodegaDestino: destino,
      codigo,
      producto: prod,
      departamento: dep,
      cantidad,
      referencia,
      fecha,
      timestamp: Date.now()
    });

    // ENTRADA destino
    movs.push({
      id: makeId(),
      grupoId: trfId,
      transferenciaId: trfId,
      tipo: "transferencia",
      subTipo: "entrada",
      bodega: destino,
      bodegaOrigen: origen,
      codigo,
      producto: prod,
      departamento: dep,
      cantidad,
      referencia,
      fecha,
      timestamp: Date.now()
    });
  }

  writeJSON(K.MOV, movs);
  deltaDirty = true;

  toast("🔁 Transferencia guardada");
  refreshHome();
  clearTransferDraft();
  showScreen("homeScreen");
}

// ==========================
// BORRADOR: acciones por producto + totales dinámicos
// ==========================
function setupDraftPreview(previewId, context){
  const preview = $(previewId);
  if(!preview) return;

  preview.addEventListener("click", (e) => {
    const btnDel = e.target.closest("button[data-del-draft]");
    if(btnDel){
      const code = String(btnDel.dataset.delDraft || "").trim().toUpperCase();

      if(context === "entrada"){
        entradaItems = entradaItems.filter(it => it.codigo !== code);
        renderEntradaItems();
      }else if(context === "salida"){
        salidaItems = salidaItems.filter(it => it.codigo !== code);
        renderSalidaItems();
        updateSalidaStockHint();
      }else if(context === "transfer"){
        transferItems = transferItems.filter(it => it.codigo !== code);
        renderTransferItems();
        updateTransferStockHint();
      }

      toast("Producto quitado");
      return;
    }

    const btnEdit = e.target.closest("button[data-edit-draft]");
    if(btnEdit){
      const row = btnEdit.closest(".it-row");
      const inp = row?.querySelector("input.draft-cantidad");
      if(inp){
        inp.focus();
        inp.select?.();
      }
    }
  });

  preview.addEventListener("input", (e) => {
    const inp = e.target.closest("input.draft-cantidad");
    if(!inp) return;
    updateDraftTotalsFromDOM(context);
  });

  preview.addEventListener("change", (e) => {
    const inp = e.target.closest("input.draft-cantidad");
    if(!inp) return;

    const code = String(inp.dataset.codigo || "").trim().toUpperCase();
    const nueva = Number(inp.value);

    if(!Number.isFinite(nueva) || nueva <= 0){
      toast("Cantidad inválida");
      if(context === "entrada") renderEntradaItems();
      else if(context === "salida") renderSalidaItems();
      else renderTransferItems();
      return;
    }

    if(context === "entrada"){
      const it = entradaItems.find(x => x.codigo === code);
      if(!it) return;
      it.cantidad = nueva;
      renderEntradaItems();
      toast("✅ Cantidad actualizada");
      return;
    }

    if(context === "salida"){
      const it = salidaItems.find(x => x.codigo === code);
      if(!it) return;

      const stockReal = getStock(code, activeBodega);
      const reservadoOtros = sumItems(salidaItems, code) - Number(it.cantidad || 0);
      const disponible = stockReal - reservadoOtros;

      if(nueva > disponible){
        toast(`Stock insuficiente. Disponible: ${disponible}`);
        renderSalidaItems();
        updateSalidaStockHint();
        return;
      }

      it.cantidad = nueva;
      renderSalidaItems();
      updateSalidaStockHint();
      toast("✅ Cantidad actualizada");
      return;
    }

    // TRANSFER (validar stock origen)
    const it = transferItems.find(x => x.codigo === code);
    if(!it) return;

    const origen = activeBodega;
    const destino = otherBodega(activeBodega);

    if(!baseCache[destino]?.[code]){
      toast(`No existe en destino ${destino}`);
      renderTransferItems();
      return;
    }

    const stockReal = getStock(code, origen);
    const reservadoOtros = sumItems(transferItems, code) - Number(it.cantidad || 0);
    const disponible = stockReal - reservadoOtros;

    if(nueva > disponible){
      toast(`Stock insuficiente en ${origen}. Disponible: ${disponible}`);
      renderTransferItems();
      updateTransferStockHint();
      return;
    }

    it.cantidad = nueva;
    renderTransferItems();
    updateTransferStockHint();
    toast("✅ Cantidad actualizada");
  });
}

// ==========================
// HISTORIAL (FACTURAS) + TRANSFERENCIAS
// ==========================
function movGroupKey(m){
  return String(m?.grupoId || m?.factura || m?.id || "").trim();
}

function groupFacturas(movs){
  const sorted = movs.slice().sort((a,b) => (b.timestamp||0)-(a.timestamp||0));
  const map = new Map();

  for(const m of sorted){
    const key = movGroupKey(m);
    if(!key) continue;

    let g = map.get(key);
    if(!g){
      g = { key, ts: m.timestamp||0, items: [] };
      map.set(key, g);
    }
    g.items.push(m);
  }

  const groups = Array.from(map.values());

  for(const g of groups){
    g.items.sort((a,b) =>
      String(a.codigo||"").localeCompare(String(b.codigo||""), "es", { numeric:true, sensitivity:"base" })
    );
  }

  groups.sort((a,b) => (b.ts||0)-(a.ts||0));
  return groups;
}

function calcFacturaTotalsFromItems(items){
  const totalProductos = items.length;
  const totalPiezas = items.reduce((a,i)=> a + (Number(i.cantidad||0) || 0), 0);
  return { totalProductos, totalPiezas };
}

function renderFacturaCard(group, container){
  const items = group.items || [];
  if(items.length === 0) return;

  const f = items[0];
  const grupoId = movGroupKey(f) || group.key;

  const facturaNo = String(f.factura || "—");
  const tipoLabel = f.tipo === "entrada" ? "ENTRADA" : "SALIDA";
  const fecha = String(f.fecha || "—");
  const proveedor = String(f.proveedor || "");
  const proveedorLabel = (f.tipo === "entrada") ? "PROVEEDOR" : "REFERENCIA";
  const proveedorVal = (f.tipo === "entrada") ? (proveedor || "—") : "—";
  const bodega = String(f.bodega || BODEGA.PRINCIPAL);

  const { totalProductos, totalPiezas } = calcFacturaTotalsFromItems(items);

  const el = document.createElement("div");
  el.className = "invoice";
  el.dataset.grupo = grupoId;

  el.innerHTML = `
    <div class="invoice-header">
      <div class="invoice-company">FERRETERÍA UNIVERSAL</div>
      <div class="invoice-sub">CONTROL DE INVENTARIO</div>
    </div>

    <div class="invoice-meta">
      <div class="im-row"><span class="im-label">FACTURA</span><span class="im-value">${escapeHtml(facturaNo)}</span></div>
      <div class="im-row"><span class="im-label">TIPO</span><span class="im-value">${escapeHtml(tipoLabel)}</span></div>
      <div class="im-row"><span class="im-label">FECHA</span><span class="im-value">${escapeHtml(fecha)}</span></div>
      <div class="im-row"><span class="im-label">${escapeHtml(proveedorLabel)}</span><span class="im-value">${escapeHtml(proveedorVal)}</span></div>
      <div class="im-row"><span class="im-label">BODEGA</span><span class="im-value">${escapeHtml(bodega)}</span></div>
    </div>

    <div class="invoice-summary">
      Productos: <b class="t-prod">${totalProductos}</b> · Piezas: <b class="t-pzas">${totalPiezas}</b>
    </div>

    <div class="invoice-rule"></div>

    <div class="invoice-table">
      <div class="it-head">
        <div>CÓD</div>
        <div>PRODUCTO</div>
        <div class="right">CANT</div>
        <div class="right">ACC</div>
      </div>

      ${items.map(it => `
        <div class="it-row">
          <div class="it-code">${escapeHtml(it.codigo)}</div>
          <div class="it-prod">${escapeHtml(it.producto)}</div>
          <div class="right">
            <input
              class="qty-input edit-cantidad"
              type="number"
              min="1"
              inputmode="numeric"
              pattern="[0-9]*"
              value="${escapeHtml(String(it.cantidad))}"
              data-id="${escapeHtml(it.id)}"
              data-grupo="${escapeHtml(grupoId)}"
              aria-label="Cantidad ${escapeHtml(it.codigo)}">
          </div>
          <div class="it-actions">
            <button class="inv-action" type="button" data-edit title="Editar cantidad">✏️</button>
            <button class="inv-action danger" type="button" data-del="${escapeHtml(it.id)}" title="Eliminar producto">🗑</button>
          </div>
        </div>
      `).join("")}
    </div>

    <div class="invoice-rule"></div>

    <div class="invoice-totals">
      <div class="itot-row"><span>TOTAL PRODUCTOS</span><span class="t-prod">${totalProductos}</span></div>
      <div class="itot-row"><span>TOTAL PIEZAS</span><span class="t-pzas">${totalPiezas}</span></div>
    </div>

    <div class="invoice-actions">
      <button class="inv-btn danger" type="button" data-del-factura="${escapeHtml(grupoId)}">Eliminar factura</button>
    </div>
  `;

  container.appendChild(el);
}

function groupTransferencias(movs){
  const tr = movs
    .filter(m => m.tipo === "transferencia")
    .slice()
    .sort((a,b) => (b.timestamp||0)-(a.timestamp||0));

  const map = new Map();
  for(const m of tr){
    const key = String(m.transferenciaId || m.grupoId || "").trim();
    if(!key) continue;

    if(!map.has(key)) map.set(key, { key, ts: m.timestamp||0, items: [] });
    map.get(key).items.push(m);
  }

  const groups = Array.from(map.values());
  groups.sort((a,b) => (b.ts||0)-(a.ts||0));
  return groups;
}

function renderTransferCard(group, container){
  const items = group.items || [];
  if(items.length === 0) return;

  const key = group.key;

  // tomamos origen/destino desde un item salida si existe, si no del primero
  const salida = items.find(x => x.subTipo === "salida") || items[0];
  const origen = String(salida.bodega || BODEGA.PRINCIPAL);
  const destino = String(salida.bodegaDestino || otherBodega(origen));
  const fecha = String(salida.fecha || "—");
  const ref = String(salida.referencia || "—");

  // consolidar por código usando SOLO subTipo=salida (1 fila por producto)
  const rows = items
    .filter(x => x.subTipo === "salida")
    .map(x => ({
      codigo: x.codigo,
      producto: x.producto,
      cantidad: x.cantidad
    }))
    .sort((a,b)=> String(a.codigo).localeCompare(String(b.codigo), "es", { numeric:true, sensitivity:"base" }));

  const totalProductos = rows.length;
  const totalPiezas = rows.reduce((a,r)=>a+(Number(r.cantidad)||0),0);

  const el = document.createElement("div");
  el.className = "invoice";
  el.dataset.trf = key;

  el.innerHTML = `
    <div class="invoice-header">
      <div class="invoice-company">FERRETERÍA UNIVERSAL</div>
      <div class="invoice-sub">TRANSFERENCIA ENTRE BODEGAS</div>
    </div>

    <div class="invoice-meta">
      <div class="im-row"><span class="im-label">ID</span><span class="im-value">${escapeHtml(key)}</span></div>
      <div class="im-row"><span class="im-label">REF</span><span class="im-value">${escapeHtml(ref)}</span></div>
      <div class="im-row"><span class="im-label">FECHA</span><span class="im-value">${escapeHtml(fecha)}</span></div>
      <div class="im-row"><span class="im-label">ORIGEN</span><span class="im-value">${escapeHtml(origen)}</span></div>
      <div class="im-row"><span class="im-label">DESTINO</span><span class="im-value">${escapeHtml(destino)}</span></div>
    </div>

    <div class="invoice-summary">
      Productos: <b class="t-prod">${totalProductos}</b> · Piezas: <b class="t-pzas">${totalPiezas}</b>
    </div>

    <div class="invoice-rule"></div>

    <div class="invoice-table">
      <div class="it-head">
        <div>CÓD</div>
        <div>PRODUCTO</div>
        <div class="right">CANT</div>
        <div class="right">ACC</div>
      </div>

      ${rows.map(r => `
        <div class="it-row">
          <div class="it-code">${escapeHtml(r.codigo)}</div>
          <div class="it-prod">${escapeHtml(r.producto)}</div>
          <div class="right">${escapeHtml(String(r.cantidad))}</div>
          <div class="it-actions">
            <button class="inv-action danger" type="button" data-del-trf="${escapeHtml(key)}" title="Eliminar transferencia">🗑</button>
          </div>
        </div>
      `).join("")}
    </div>

    <div class="invoice-rule"></div>

    <div class="invoice-totals">
      <div class="itot-row"><span>TOTAL PRODUCTOS</span><span class="t-prod">${totalProductos}</span></div>
      <div class="itot-row"><span>TOTAL PIEZAS</span><span class="t-pzas">${totalPiezas}</span></div>
    </div>
  `;

  container.appendChild(el);
}

function setHistTab(tab){
  historialTab = tab;

  $("tabMov")?.classList.toggle("active", tab === "mov");
  $("tabTrf")?.classList.toggle("active", tab === "trf");
  $("tabDel")?.classList.toggle("active", tab === "del");

  $("histHeadDel")?.classList.toggle("hidden", tab !== "del");

  const list = $("histList");
  if(list) list.innerHTML = "";

  renderHistorial();
}

function renderHistorial(){
  const q = ($("histSearch")?.value || "").toLowerCase().trim();
  const list = $("histList");
  if(!list) return;

  list.innerHTML = "";

  const movsAll = readJSON(K.MOV, []);

  if(historialTab === "mov"){
    const movs = movsAll.filter(m => m.tipo === "entrada" || m.tipo === "salida");
    const groups = groupFacturas(movs);

    const filtered = groups.filter(g => {
      if(!q) return true;
      const f = g.items[0] || {};
      const factura = String(f.factura||"").toLowerCase();
      const prov = String(f.proveedor||"").toLowerCase();
      const fecha = String(f.fecha||"").toLowerCase();
      const bod = String(f.bodega||"").toLowerCase();

      if(factura.includes(q) || prov.includes(q) || fecha.includes(q) || bod.includes(q)) return true;

      return g.items.some(m => {
        const c = String(m.codigo||"").toLowerCase();
        const p = String(m.producto||"").toLowerCase();
        return c.includes(q) || p.includes(q);
      });
    });

    if(filtered.length === 0){
      list.innerHTML = `<div class="trow"><div class="cell" data-label="">Sin facturas.</div></div>`;
      return;
    }

    for(const g of filtered){
      renderFacturaCard(g, list);
    }
    return;
  }

  if(historialTab === "trf"){
    const groups = groupTransferencias(movsAll);

    const filtered = groups.filter(g => {
      if(!q) return true;
      if(String(g.key||"").toLowerCase().includes(q)) return true;
      return g.items.some(m => {
        const c = String(m.codigo||"").toLowerCase();
        const p = String(m.producto||"").toLowerCase();
        const ref = String(m.referencia||"").toLowerCase();
        const bod = String(m.bodega||"").toLowerCase();
        const dst = String(m.bodegaDestino||"").toLowerCase();
        return c.includes(q) || p.includes(q) || ref.includes(q) || bod.includes(q) || dst.includes(q);
      });
    });

    if(filtered.length === 0){
      list.innerHTML = `<div class="trow"><div class="cell" data-label="">Sin transferencias.</div></div>`;
      return;
    }

    for(const g of filtered){
      renderTransferCard(g, list);
    }
    return;
  }

  // Eliminaciones
  const dels = readJSON(K.DEL, [])
    .slice()
    .sort((a,b) => (b.timestamp||0)-(a.timestamp||0));

  const filtered = dels.filter(d => {
    if(!q) return true;
    const c = String(d.codigo||"").toLowerCase();
    const p = String(d.producto||"").toLowerCase();
    const det = String(d.detalle||"").toLowerCase();
    return c.includes(q) || p.includes(q) || det.includes(q);
  });

  if(filtered.length === 0){
    list.innerHTML = `<div class="trow"><div class="cell" data-label="">Sin eliminaciones.</div></div>`;
    return;
  }

  for(const d of filtered){
    const row = document.createElement("div");
    row.className = "trow cols-hdel";
    row.innerHTML = `
      <div class="cell" data-label="Fecha/Hora">${escapeHtml(d.fechaHora)}</div>
      <div class="cell" data-label="Tipo">${escapeHtml(d.tipo)}</div>
      <div class="cell" data-label="Código">${escapeHtml(d.codigo)}</div>
      <div class="cell wrap" data-label="Producto">${escapeHtml(d.producto)}</div>
      <div class="cell right" data-label="Cant.">${escapeHtml(String(d.cantidad))}</div>
      <div class="cell wrap" data-label="Detalle">${escapeHtml(d.detalle)}</div>
    `;
    list.appendChild(row);
  }
}

async function deleteMovimiento(id){
  const ok = await uiConfirm("¿Eliminar este artículo de la factura? (Quedará registrado en Eliminaciones)");
  if(!ok) return;

  const movs = readJSON(K.MOV, []);
  const idx = movs.findIndex(m => m.id === id);
  if(idx < 0){
    toast("No se encontró el artículo.");
    return;
  }

  const m = movs[idx];
  const grupoId = movGroupKey(m);

  movs.splice(idx, 1);
  writeJSON(K.MOV, movs);
  deltaDirty = true;

  const bod = String(m.bodega || BODEGA.PRINCIPAL);

  const dels = readJSON(K.DEL, []);
  dels.push({
    id: makeId(),
    tipo: m.tipo,
    codigo: m.codigo,
    producto: m.producto,
    cantidad: m.cantidad,
    detalle: `Artículo eliminado de factura ${m.factura||""} (Bodega: ${bod})`,
    fechaHora: nowISO(),
    timestamp: Date.now()
  });
  writeJSON(K.DEL, dels);

  toast("🗑️ Artículo eliminado");
  refreshHome();
  renderHistorial();

  // actualizar totales visuales
  if(grupoId){
    // simple: re-render historial para recalcular
    renderHistorial();
  }
}

async function deleteFactura(grupoId){
  const ok = await uiConfirm("¿Eliminar FACTURA COMPLETA? (Se registrará en Eliminaciones)");
  if(!ok) return;

  const movs = readJSON(K.MOV, []);
  const eliminar = movs.filter(m => movGroupKey(m) === String(grupoId));
  const restantes = movs.filter(m => movGroupKey(m) !== String(grupoId));

  if(eliminar.length === 0){
    toast("No se encontró la factura.");
    return;
  }

  writeJSON(K.MOV, restantes);
  deltaDirty = true;

  const dels = readJSON(K.DEL, []);
  for(const m of eliminar){
    const bod = String(m.bodega || BODEGA.PRINCIPAL);
    dels.push({
      id: makeId(),
      tipo: m.tipo,
      codigo: m.codigo,
      producto: m.producto,
      cantidad: m.cantidad,
      detalle: `Factura eliminada: ${m.factura||""} (Bodega: ${bod})`,
      fechaHora: nowISO(),
      timestamp: Date.now()
    });
  }
  writeJSON(K.DEL, dels);

  toast("🧾 Factura eliminada");
  refreshHome();
  renderHistorial();
}

async function deleteTransferencia(trfId){
  const ok = await uiConfirm("¿Eliminar TRANSFERENCIA COMPLETA? (Se registrará en Eliminaciones)");
  if(!ok) return;

  const movs = readJSON(K.MOV, []);
  const eliminar = movs.filter(m => m.tipo === "transferencia" && String(m.transferenciaId||"") === String(trfId));
  const restantes = movs.filter(m => !(m.tipo === "transferencia" && String(m.transferenciaId||"") === String(trfId)));

  if(eliminar.length === 0){
    toast("No se encontró la transferencia.");
    return;
  }

  writeJSON(K.MOV, restantes);
  deltaDirty = true;

  // registrar eliminaciones SOLO por subTipo=salida (1 fila por producto)
  const dels = readJSON(K.DEL, []);
  const salidas = eliminar.filter(x => x.subTipo === "salida");
  for(const m of salidas){
    const origen = String(m.bodega || BODEGA.PRINCIPAL);
    const destino = String(m.bodegaDestino || "");
    dels.push({
      id: makeId(),
      tipo: "transferencia",
      codigo: m.codigo,
      producto: m.producto,
      cantidad: m.cantidad,
      detalle: `Transferencia eliminada: ${trfId} (${origen} → ${destino})`,
      fechaHora: nowISO(),
      timestamp: Date.now()
    });
  }
  writeJSON(K.DEL, dels);

  toast("🔁 Transferencia eliminada");
  refreshHome();
  renderHistorial();
}

// ==========================
// CONFIRM MODAL (sin window.confirm)
// ==========================
function uiConfirm(message){
  return new Promise(resolve => {
    const overlay = document.getElementById("confirmOverlay");
    const msg = document.getElementById("confirmMessage");
    const btnOk = document.getElementById("confirmOk");
    const btnCancel = document.getElementById("confirmCancel");

    if(!overlay || !msg || !btnOk || !btnCancel){
      resolve(window.confirm(message));
      return;
    }

    msg.textContent = message;
    overlay.classList.remove("hidden");

    const cleanup = (result) => {
      overlay.classList.add("hidden");
      btnOk.onclick = null;
      btnCancel.onclick = null;
      overlay.onclick = null;
      resolve(result);
    };

    btnOk.onclick = () => cleanup(true);
    btnCancel.onclick = () => cleanup(false);

    overlay.onclick = (e) => {
      if(e.target === overlay) cleanup(false);
    };
  });
}

// ==========================
// EXPORT EXCEL (incluye hoja TRANSFERENCIAS)
// ==========================
function exportExcel(){
  if(typeof XLSX === "undefined"){
    toast("No cargó Excel (revisa XLSX)");
    return;
  }

  const movs = readJSON(K.MOV, []);
  const dels = readJSON(K.DEL, []);

  if(movs.length === 0 && dels.length === 0){
    toast("No hay movimientos");
    return;
  }

  const entradas = movs
    .filter(m => m.tipo === "entrada")
    .map(m => ({
      ...m,
      fechaHora: formatFechaHora(m.timestamp),
      bodega: m.bodega || BODEGA.PRINCIPAL
    }));

  const salidas = movs
    .filter(m => m.tipo === "salida")
    .map(m => ({
      ...m,
      fechaHora: formatFechaHora(m.timestamp),
      bodega: m.bodega || BODEGA.PRINCIPAL
    }));

  // Transferencias: exportar SOLO subTipo=salida (1 fila por producto transferido)
  const transferencias = movs
    .filter(m => m.tipo === "transferencia" && m.subTipo === "salida")
    .map(m => ({
      transferenciaId: m.transferenciaId,
      referencia: m.referencia || "",
      codigo: m.codigo,
      producto: m.producto,
      cantidad: m.cantidad,
      origen: m.bodega || BODEGA.PRINCIPAL,
      destino: m.bodegaDestino || "",
      fecha: m.fecha,
      fechaHora: formatFechaHora(m.timestamp)
    }));

  const eliminaciones = dels.map(d => ({ ...d, fechaHora: formatFechaHora(d.timestamp) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entradas), "ENTRADAS");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salidas), "SALIDAS");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(transferencias), "TRANSFERENCIAS");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(eliminaciones), "ELIMINACIONES");

  const filename = `reporte_${todayISO()}.xlsx`;
  let saved = false;

  if(window.Android && typeof Android.saveFile === "function"){
    try{
      const wb64 = XLSX.write(wb, { bookType:"xlsx", type:"base64" });
      Android.saveFile(wb64, filename);
      saved = true;
      toast("📥 Archivo guardado en Descargas");
    }catch(e){
      console.warn("Android.saveFile falló", e);
    }
  }

  if(!saved){
    try{
      const wbarr = XLSX.write(wb, { bookType:"xlsx", type:"array" });
      const blob = new Blob([wbarr], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      saved = downloadBlob(blob, filename);
      if(saved) toast("📥 Descarga iniciada");
    }catch(e){
      console.warn("Export blob falló", e);
    }
  }

  if(!saved){
    toast("❌ No se pudo exportar (no se borró el historial)");
    return;
  }

  localStorage.removeItem(K.MOV);
  localStorage.removeItem(K.DEL);
  deltaDirty = true;

  refreshHome();
  renderHistorial();
}

// ==========================
// INIT
// ==========================
document.addEventListener("DOMContentLoaded", () => {
  migrateOldBaseIfNeeded();

  // cargar local inicialmente
  baseCache[BODEGA.PRINCIPAL] = readJSON(baseKeyFor(BODEGA.PRINCIPAL), {});
  baseCache[BODEGA.ANEXO] = readJSON(baseKeyFor(BODEGA.ANEXO), {});

  setNetworkState(navigator.onLine);
  updateBodegaUI();

  cargarDepartamentos();
  cargarCategorias("");
  updateFilterChips();

  refreshHome();
  showScreen("homeScreen");

  if($("entradaFecha")) $("entradaFecha").value = todayISO();
  if($("salidaFecha")) $("salidaFecha").value = todayISO();
  if($("transferFecha")) $("transferFecha").value = todayISO();

  // Máscara de código
  attachCodigoMask($("entradaCodigo"), { allowText:false });
  attachCodigoMask($("salidaCodigo"),  { allowText:false });
  attachCodigoMask($("transferCodigo"),{ allowText:false });

  // Búsquedas: permite texto
  attachCodigoMask($("searchInput"),   { allowText:true });
  attachCodigoMask($("catalogSearch"), { allowText:true });
  attachCodigoMask($("histSearch"),    { allowText:true });

  // Botones bodega
  $("btnBodegaPrincipal")?.addEventListener("click", () => setActiveBodega(BODEGA.PRINCIPAL));
  $("btnBodegaAnexo")?.addEventListener("click", () => setActiveBodega(BODEGA.ANEXO));

  $("btnSync")?.addEventListener("click", () => syncBase(true));
  $("btnExport")?.addEventListener("click", exportExcel);

  // Accesos con PIN según bodega activa
  $("btnCatalogo")?.addEventListener("click", async () => {
    const ok = await ensurePinForBodega(activeBodega);
    if(!ok) return;

    showScreen("catalogScreen");
    $("catalogSearch").value = "";

    filtroDepartamento = "";
    filtroCategoria = "";
    filtroStock = false;

    const selDep = $("filterDepartamento");
    const selCat = $("filterCategoria");
    if(selDep) selDep.value = "";
    if(selCat) selCat.value = "";

    const btnStock = $("btnFilterStock");
    if(btnStock) btnStock.classList.remove("active");

    cargarDepartamentos();
    cargarCategorias("");
    updateFilterChips();

    renderCatalog("");
  });

  $("btnEntrada")?.addEventListener("click", async () => {
    const ok = await ensurePinForBodega(activeBodega);
    if(!ok) return;

    showScreen("entradaScreen");
    $("entradaFecha").value = todayISO();
    $("entradaCodigo").value = "";
    $("entradaProducto").value = "";
    $("entradaCantidad").value = "";
    hideCodigoAutoList("entradaAutoList");
    clearEntradaDraft();
  });

  $("btnSalida")?.addEventListener("click", async () => {
    const ok = await ensurePinForBodega(activeBodega);
    if(!ok) return;

    showScreen("salidaScreen");
    $("salidaFecha").value = todayISO();
    $("salidaCodigo").value = "";
    $("salidaProducto").value = "";
    $("salidaCantidad").value = "";
    $("salidaFactura").value = "";
    hideCodigoAutoList("salidaAutoList");
    clearSalidaDraft();
  });

  $("btnTransferencia")?.addEventListener("click", async () => {
    const ok = await ensurePinForBodega(activeBodega);
    if(!ok) return;

    showScreen("transferScreen");
    $("transferFecha").value = todayISO();
    $("transferCodigo").value = "";
    $("transferProducto").value = "";
    $("transferCantidad").value = "";
    $("transferReferencia").value = "";
    hideCodigoAutoList("transferAutoList");
    clearTransferDraft();

    const info = $("transferBodegasInfo");
    if(info){
      info.textContent = `Origen: ${activeBodega} ➜ Destino: ${otherBodega(activeBodega)}`;
    }
  });

  $("btnHistorial")?.addEventListener("click", () => {
    showScreen("historialScreen");
    $("histSearch").value = "";
    setHistTab("mov");
  });

  $("btnBackCatalog")?.addEventListener("click", () => showScreen("homeScreen"));
  $("btnBackEntrada")?.addEventListener("click", () => showScreen("homeScreen"));
  $("btnBackSalida")?.addEventListener("click", () => showScreen("homeScreen"));
  $("btnBackTransfer")?.addEventListener("click", () => showScreen("homeScreen"));
  $("btnBackHistorial")?.addEventListener("click", () => showScreen("homeScreen"));

  $("btnBackSearch")?.addEventListener("click", () => {
    if(currentSearchContext === "entrada") showScreen("entradaScreen");
    else if(currentSearchContext === "salida") showScreen("salidaScreen");
    else if(currentSearchContext === "transfer") showScreen("transferScreen");
    else showScreen("homeScreen");
  });

  $("catalogSearch")?.addEventListener("input", (e) => renderCatalog(e.target.value));

  // Auto-llenado + autocomplete por código
  $("entradaCodigo")?.addEventListener("input", () => fillProductoFromCode("entrada"));
  $("salidaCodigo")?.addEventListener("input", () => fillProductoFromCode("salida"));
  $("transferCodigo")?.addEventListener("input", () => fillProductoFromCode("transfer"));

  $("entradaCodigo")?.addEventListener("input", () => renderCodigoAutoList("entrada"));
  $("salidaCodigo")?.addEventListener("input", () => renderCodigoAutoList("salida"));
  $("transferCodigo")?.addEventListener("input", () => renderCodigoAutoList("transfer"));

  $("entradaCodigo")?.addEventListener("blur", () => setTimeout(() => hideCodigoAutoList("entradaAutoList"), 220));
  $("salidaCodigo")?.addEventListener("blur", () => setTimeout(() => hideCodigoAutoList("salidaAutoList"), 220));
  $("transferCodigo")?.addEventListener("blur", () => setTimeout(() => hideCodigoAutoList("transferAutoList"), 220));

  // Lupa (buscar por nombre)
  $("btnBuscarEntrada")?.addEventListener("click", () => {
    currentSearchContext = "entrada";
    showScreen("searchScreen");
    $("searchInput").value = "";
    renderSearch("");
  });

  $("btnBuscarSalida")?.addEventListener("click", () => {
    currentSearchContext = "salida";
    showScreen("searchScreen");
    $("searchInput").value = "";
    renderSearch("");
  });

  $("btnBuscarTransfer")?.addEventListener("click", () => {
    currentSearchContext = "transfer";
    showScreen("searchScreen");
    $("searchInput").value = "";
    renderSearch("");
  });

  $("searchInput")?.addEventListener("input", (e) => renderSearch(e.target.value));

  // ===== filtros catálogo =====
  const selDep = $("filterDepartamento");
  if(selDep){
    selDep.addEventListener("change", (e) => {
      filtroDepartamento = e.target.value || "";
      cargarCategorias(filtroDepartamento);
      renderCatalog($("catalogSearch")?.value || "");
      updateFilterChips();
    });
  }

  const selCat = $("filterCategoria");
  if(selCat){
    selCat.addEventListener("change", (e) => {
      filtroCategoria = e.target.value || "";
      renderCatalog($("catalogSearch")?.value || "");
      updateFilterChips();
    });
  }

  const btnStock = $("btnFilterStock");
  if(btnStock){
    btnStock.addEventListener("click", () => {
      filtroStock = !filtroStock;
      btnStock.classList.toggle("active", filtroStock);
      renderCatalog($("catalogSearch")?.value || "");
    });
  }

  $("btnClearFilters")?.addEventListener("click", () => {
    filtroDepartamento = "";
    filtroCategoria = "";
    filtroStock = false;

    if(selDep) selDep.value = "";
    if(selCat) selCat.value = "";
    if(btnStock) btnStock.classList.remove("active");

    cargarCategorias("");
    renderCatalog($("catalogSearch")?.value || "");
    updateFilterChips();
  });

  $("chipDepClear")?.addEventListener("click", () => {
    filtroDepartamento = "";
    filtroCategoria = "";

    if(selDep) selDep.value = "";
    if(selCat) selCat.value = "";

    cargarCategorias("");
    renderCatalog($("catalogSearch")?.value || "");
    updateFilterChips();
  });

  $("chipCatClear")?.addEventListener("click", () => {
    filtroCategoria = "";
    if(selCat) selCat.value = "";
    renderCatalog($("catalogSearch")?.value || "");
    updateFilterChips();
  });

  // ====== BORRADOR: re-render si cambian datos ======
  $("entradaFactura")?.addEventListener("input", () => renderEntradaItems());
  $("entradaProveedor")?.addEventListener("input", () => renderEntradaItems());
  $("entradaFecha")?.addEventListener("change", () => renderEntradaItems());

  $("salidaFactura")?.addEventListener("input", () => renderSalidaItems());
  $("salidaFecha")?.addEventListener("change", () => renderSalidaItems());

  $("transferReferencia")?.addEventListener("input", () => renderTransferItems());
  $("transferFecha")?.addEventListener("change", () => renderTransferItems());

  // ====== BOTONES ======
  $("btnAddEntradaItem")?.addEventListener("click", addEntradaItem);
  $("btnClearEntradaItems")?.addEventListener("click", () => { clearEntradaDraft(); toast("Factura vaciada"); });
  $("btnGuardarEntrada")?.addEventListener("click", saveFacturaEntrada);

  $("btnAddSalidaItem")?.addEventListener("click", addSalidaItem);
  $("btnClearSalidaItems")?.addEventListener("click", () => { clearSalidaDraft(); toast("Factura vaciada"); });
  $("btnGuardarSalida")?.addEventListener("click", saveFacturaSalida);

  $("btnAddTransferItem")?.addEventListener("click", addTransferItem);
  $("btnClearTransferItems")?.addEventListener("click", () => { clearTransferDraft(); toast("Transferencia vaciada"); });
  $("btnGuardarTransferencia")?.addEventListener("click", saveTransferencia);

  // setup previews
  setupDraftPreview("entradaFacturaPreview", "entrada");
  setupDraftPreview("salidaFacturaPreview", "salida");
  setupDraftPreview("transferFacturaPreview", "transfer");

  // HISTORIAL tabs + search
  $("tabMov")?.addEventListener("click", () => setHistTab("mov"));
  $("tabTrf")?.addEventListener("click", () => setHistTab("trf"));
  $("tabDel")?.addEventListener("click", () => setHistTab("del"));
  $("histSearch")?.addEventListener("input", () => renderHistorial());

  // acciones historial
  $("histList")?.addEventListener("click", (e) => {
    const btnDel = e.target.closest("button[data-del]");
    if(btnDel){
      e.preventDefault();
      e.stopPropagation();
      deleteMovimiento(btnDel.dataset.del);
      return;
    }

    const btnDelFac = e.target.closest("button[data-del-factura]");
    if(btnDelFac){
      e.preventDefault();
      e.stopPropagation();
      deleteFactura(btnDelFac.dataset.delFactura);
      return;
    }

    const btnDelTrf = e.target.closest("button[data-del-trf]");
    if(btnDelTrf){
      e.preventDefault();
      e.stopPropagation();
      deleteTransferencia(btnDelTrf.dataset.delTrf);
      return;
    }

    const btnEdit = e.target.closest("button[data-edit]");
    if(btnEdit){
      const row = btnEdit.closest(".it-row");
      const inp = row?.querySelector("input.edit-cantidad");
      if(inp){
        inp.focus();
        inp.select?.();
      }
    }
  });

  // edición cantidades SOLO en tab mov
  $("histList")?.addEventListener("change", (e) => {
    if(historialTab !== "mov") return;

    const inp = e.target.closest("input.edit-cantidad");
    if(!inp) return;

    const id = inp.dataset.id;
    const nueva = Number(inp.value);

    if(!Number.isFinite(nueva) || nueva <= 0){
      toast("Cantidad inválida");
      renderHistorial();
      return;
    }

    const movs = readJSON(K.MOV, []);
    const m = movs.find(x => x.id === id);
    if(!m){
      toast("No se encontró el artículo");
      renderHistorial();
      return;
    }

    const bod = String(m.bodega || BODEGA.PRINCIPAL);
    const oldQty = Number(m.cantidad||0);
    const code = String(m.codigo||"").trim().toUpperCase();

    const stockActual = getStock(code, bod);
    let stockNuevo = stockActual;

    if(m.tipo === "entrada"){
      stockNuevo = stockActual - oldQty + nueva;
    }else if(m.tipo === "salida"){
      stockNuevo = stockActual + oldQty - nueva;
    }

    if(stockNuevo < 0){
      toast("❌ No se puede: dejaría stock negativo");
      inp.value = String(oldQty);
      return;
    }

    m.cantidad = nueva;
    writeJSON(K.MOV, movs);
    deltaDirty = true;

    toast("✅ Cantidad actualizada");
    refreshHome();
    renderHistorial();
  });

  // sync silencioso al iniciar
  syncBase(false);

  // render inicial
  renderEntradaItems();
  renderSalidaItems();
  renderTransferItems();
});
