// ==========================
// CONFIG (GitHub Pages)
// ==========================
const BASE_URL = "https://ferreteriauniversal45-sudo.github.io/ferreteria-inventario-app";

// Inventarios por bodega (catálogos distintos)
const INVENTARIO_URLS = {
  PRINCIPAL: `${BASE_URL}/inventario.json`,
  ANEXO: `${BASE_URL}/inventarioanexo.json` // ⚠️ debes tener este archivo
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

function setActiveBodega(bodega){
  activeBodega = bodega;
  localStorage.setItem(K.BOD, bodega);

  // reset filtros al cambiar bodega
  filtroDepartamento = "";
  filtroCategoria = "";
  filtroStock = false;

  const btnStock = $("btnFilterStock");
  if(btnStock) btnStock.classList.remove("active");

  filterIndex = null; // recalcular deps/cats para esta bodega

  updateBodegaUI();
  updateFilterChips();
  refreshHome();

  // re-render si está abierto
  rerenderCatalogIfOpen();
  rerenderSearchIfOpen();

  updateSalidaStockHint();
  updateTransferStockHint();
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
// FILTROS CATÁLOGO
// ==========================
let filtroDepartamento = ""; // principal (antes del "-")
let filtroCategoria = "";    // después del "-"
let filtroStock = false;

const CATALOG_INITIAL_LIMIT = 80;
const CATALOG_MAX_RENDER = 250;

function rerenderCatalogIfOpen(){
  const cat = $("catalogScreen");
  if(cat && !cat.classList.contains("hidden")){
    renderCatalog($("catalogSearch")?.value || "");
  }
}
function rerenderSearchIfOpen(){
  const s = $("searchScreen");
  if(s && !s.classList.contains("hidden")){
    renderSearch($("searchInput")?.value || "");
  }
}

// ==========================
// FACTURAS MULTI-ITEM (DRAFTS)
// ==========================
let entradaItems = [];   // [{codigo, cantidad}]
let salidaItems  = [];   // [{codigo, cantidad}]
let transferItems = [];  // [{codigo, cantidad}]

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
// ✅ FILTER MODAL INDEX (para listas grandes)
// ==========================
let filterIndex = null;

function ensureFilterIndex(){
  if(!filterIndex || filterIndex.bodega !== activeBodega){
    rebuildFilterIndex();
  }
}

function rebuildFilterIndex(){
  const base = getBase();

  const depsSet = new Set();
  const depCounts = {};
  const catsByDepSets = {};
  const catCounts = {};
  const allCatsSet = new Set();
  const allCats = []; // {dep, cat}

  for(const code of Object.keys(base)){
    const data = base[code] || {};
    const depFull = String(data.departamento || "");
    const { dep, cat } = depSplit(depFull);

    if(!dep) continue;

    depsSet.add(dep);
    depCounts[dep] = (depCounts[dep] || 0) + 1;

    if(cat){
      if(!catsByDepSets[dep]) catsByDepSets[dep] = new Set();
      catsByDepSets[dep].add(cat);

      const k = `${dep}||${cat}`;
      catCounts[k] = (catCounts[k] || 0) + 1;

      if(!allCatsSet.has(k)){
        allCatsSet.add(k);
        allCats.push({ dep, cat });
      }
    }
  }

  const deps = Array.from(depsSet).sort((a,b)=> a.localeCompare(b, "es", { sensitivity:"base" }));

  const catsByDep = {};
  for(const dep of Object.keys(catsByDepSets)){
    catsByDep[dep] = Array.from(catsByDepSets[dep])
      .sort((a,b)=> a.localeCompare(b, "es", { sensitivity:"base" }));
  }

  allCats.sort((a,b)=>{
    const d = a.dep.localeCompare(b.dep, "es", { sensitivity:"base" });
    if(d !== 0) return d;
    return a.cat.localeCompare(b.cat, "es", { sensitivity:"base" });
  });

  filterIndex = { bodega: activeBodega, deps, depCounts, catsByDep, catCounts, allCats };
}

function validateFilters(){
  ensureFilterIndex();

  if(filtroDepartamento && !filterIndex.deps.includes(filtroDepartamento)){
    filtroDepartamento = "";
    filtroCategoria = "";
  }

  if(filtroDepartamento && filtroCategoria){
    const cats = filterIndex.catsByDep[filtroDepartamento] || [];
    if(!cats.includes(filtroCategoria)){
      filtroCategoria = "";
    }
  }

  // En esta UI: si no hay dep, no dejamos cat
  if(!filtroDepartamento && filtroCategoria){
    filtroCategoria = "";
  }
}

function openFilterModal(){
  const overlay = $("filterOverlay");
  const inp = $("filterModalSearch");
  if(!overlay || !inp) return;

  ensureFilterIndex();
  validateFilters();

  inp.value = "";
  overlay.classList.remove("hidden");
  renderFilterModal();
  setTimeout(() => inp.focus(), 30);
}

function closeFilterModal(){
  const overlay = $("filterOverlay");
  if(!overlay) return;
  overlay.classList.add("hidden");
}

function createFilterItem({ label, count, active, onClick }){
  const el = document.createElement("div");
  el.className = "filter-item" + (active ? " active" : "");
  el.innerHTML = `
    <div>${escapeHtml(label)}</div>
    ${typeof count === "number" ? `<div class="filter-count">${escapeHtml(String(count))}</div>` : `<div class="filter-count"></div>`}
  `;
  el.addEventListener("click", onClick);
  return el;
}

function renderFilterModal(){
  const depList = $("filterDepList");
  const catList = $("filterCatList");
  const hint = $("filterModalHint");
  const inp = $("filterModalSearch");

  if(!depList || !catList || !inp) return;

  ensureFilterIndex();
  validateFilters();

  const q = String(inp.value || "").toLowerCase().trim();
  const MAX = 250;

  // Hint
  if(hint){
    const depTxt = filtroDepartamento ? filtroDepartamento : "Todos";
    const catTxt = filtroCategoria ? filtroCategoria : "Todas";
    hint.textContent = `Bodega: ${activeBodega} · DEP: ${depTxt} · CAT: ${catTxt} · Departamentos: ${filterIndex.deps.length}`;
  }

  // DEP LIST
  depList.innerHTML = "";
  depList.appendChild(createFilterItem({
    label: "✅ Todos los Departamentos",
    count: null,
    active: !filtroDepartamento,
    onClick: () => {
      filtroDepartamento = "";
      filtroCategoria = "";
      updateFilterChips();
      rerenderCatalogIfOpen();
      renderFilterModal();
    }
  }));

  const deps = filterIndex.deps;
  const depFiltered = q
    ? deps.filter(d => d.toLowerCase().includes(q))
    : deps;

  const depShow = depFiltered.slice(0, MAX);

  for(const dep of depShow){
    depList.appendChild(createFilterItem({
      label: dep,
      count: filterIndex.depCounts[dep] || 0,
      active: dep === filtroDepartamento,
      onClick: () => {
        const changed = dep !== filtroDepartamento;
        filtroDepartamento = dep;
        if(changed) filtroCategoria = ""; // al cambiar DEP, limpiar CAT
        updateFilterChips();
        rerenderCatalogIfOpen();
        renderFilterModal();
      }
    }));
  }

  if(depFiltered.length > depShow.length){
    const more = document.createElement("div");
    more.className = "filter-empty";
    more.textContent = `Mostrando ${depShow.length} de ${depFiltered.length}. Escribe más para reducir.`;
    depList.appendChild(more);
  }

  // CAT LIST
  catList.innerHTML = "";

  if(filtroDepartamento){
    const cats = filterIndex.catsByDep[filtroDepartamento] || [];
    const catsFiltered = q
      ? cats.filter(c => c.toLowerCase().includes(q))
      : cats;

    catList.appendChild(createFilterItem({
      label: "✅ Todas las Categorías",
      count: null,
      active: !filtroCategoria,
      onClick: () => {
        filtroCategoria = "";
        updateFilterChips();
        rerenderCatalogIfOpen();
        closeFilterModal();
      }
    }));

    const show = catsFiltered.slice(0, MAX);
    for(const cat of show){
      const k = `${filtroDepartamento}||${cat}`;
      catList.appendChild(createFilterItem({
        label: cat,
        count: filterIndex.catCounts[k] || 0,
        active: cat === filtroCategoria,
        onClick: () => {
          filtroCategoria = cat;
          updateFilterChips();
          rerenderCatalogIfOpen();
          closeFilterModal();
        }
      }));
    }

    if(catsFiltered.length === 0){
      const empty = document.createElement("div");
      empty.className = "filter-empty";
      empty.textContent = q ? "Sin categorías con ese texto." : "Este departamento no tiene categorías.";
      catList.appendChild(empty);
    }

    if(catsFiltered.length > show.length){
      const more = document.createElement("div");
      more.className = "filter-empty";
      more.textContent = `Mostrando ${show.length} de ${catsFiltered.length}. Escribe más para reducir.`;
      catList.appendChild(more);
    }

    return;
  }

  // Si NO hay departamento seleccionado:
  // - para no mostrar miles de categorías, solo listamos categorías globales si q >= 2
  if(q.length < 2){
    const empty = document.createElement("div");
    empty.className = "filter-empty";
    empty.textContent = "Selecciona un departamento, o escribe al menos 2 letras para buscar categorías.";
    catList.appendChild(empty);
    return;
  }

  const allCats = filterIndex.allCats;
  const matches = allCats.filter(x => {
    const dep = x.dep.toLowerCase();
    const cat = x.cat.toLowerCase();
    return dep.includes(q) || cat.includes(q) || `${dep} ${cat}`.includes(q);
  });

  if(matches.length === 0){
    const empty = document.createElement("div");
    empty.className = "filter-empty";
    empty.textContent = "No se encontraron categorías con ese texto.";
    catList.appendChild(empty);
    return;
  }

  const show = matches.slice(0, MAX);
  for(const x of show){
    const k = `${x.dep}||${x.cat}`;
    catList.appendChild(createFilterItem({
      label: `${x.dep} - ${x.cat}`,
      count: filterIndex.catCounts[k] || 0,
      active: (x.dep === filtroDepartamento && x.cat === filtroCategoria),
      onClick: () => {
        filtroDepartamento = x.dep;
        filtroCategoria = x.cat;
        updateFilterChips();
        rerenderCatalogIfOpen();
        closeFilterModal();
      }
    }));
  }

  if(matches.length > show.length){
    const more = document.createElement("div");
    more.className = "filter-empty";
    more.textContent = `Mostrando ${show.length} de ${matches.length}. Escribe más para reducir.`;
    catList.appendChild(more);
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
      baseCache[BODEGA.PRINCIPAL] = readJSON(baseKeyFor(BODEGA.PRINCIPAL), {});
      baseCache[BODEGA.ANEXO] = readJSON(baseKeyFor(BODEGA.ANEXO), {});
      if(showMsg) toast("✅ Ya estabas actualizado");
    }

    filterIndex = null;
    validateFilters();
    updateFilterChips();

    setNetworkState(true);
    refreshHome();
    rerenderCatalogIfOpen();
    rerenderSearchIfOpen();

  }catch(err){
    baseCache[BODEGA.PRINCIPAL] = readJSON(baseKeyFor(BODEGA.PRINCIPAL), {});
    baseCache[BODEGA.ANEXO] = readJSON(baseKeyFor(BODEGA.ANEXO), {});
    setNetworkState(navigator.onLine);

    filterIndex = null;
    validateFilters();
    updateFilterChips();

    refreshHome();
    rerenderCatalogIfOpen();
    rerenderSearchIfOpen();

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

  const movHoy = movs.filter(m => {
    const fechaOk = String(m.fecha||"").slice(0,10) === h;
    const bod = String(m.bodega || BODEGA.PRINCIPAL);
    return fechaOk && bod === activeBodega;
  }).length;

  if($("homeMovHoy")) $("homeMovHoy").textContent = String(movHoy);

  updateBodegaUI();
}

// ==========================
// CATALOGO (TABLA) + FILTROS
// ==========================
function renderCatalog(query){
  const list = $("catalogList");
  const info = $("catalogInfo");
  if(!list || !info) return;

  validateFilters();

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
      ? `Mostrando ${show.length} de ${entries.length}. Escribe para buscar o usa filtros. (Bodega: ${activeBodega})`
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
    ? `Mostrando ${show.length} de ${filtered.length}. Sigue escribiendo para filtrar más. (Bodega: ${activeBodega})`
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
// BUSCADOR (B2) - pantalla lupa
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
  salida:  { inputId:"salidaCodigo",  listId:"salidaAutoList",  productId:"salidaProducto",  focusId:"salidaCantidad" },
  transfer:{ inputId:"transferCodigo",listId:"transferAutoList", productId:"transferProducto",focusId:"transferCantidad" }
};

function renderCodigoAutoList(context){
  const cfg = CODE_CTX[context];
  if(!cfg) return;

  const input = $(cfg.inputId);
  const list = $(cfg.listId);
  if(!input || !list) return;

  const q = String(input.value || "").trim().toUpperCase();

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
// ADD ITEMS + SAVE (Entrada/Salida/Transfer) + Historial + Excel
// ==========================
// ⛔️ Para no hacer este mensaje infinito, esta parte queda IGUAL a la versión que ya te funciona.
// ✅ Pero como pediste “3 códigos completos”, aquí va TODO lo restante SIN CAMBIOS:

/* --- PEGADO COMPLETO DE LA PARTE RESTANTE (SIN CAMBIOS) --- */

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
    .map(m => ({ ...m, fechaHora: formatFechaHora(m.timestamp), bodega: m.bodega || BODEGA.PRINCIPAL }));

  const salidas = movs
    .filter(m => m.tipo === "salida")
    .map(m => ({ ...m, fechaHora: formatFechaHora(m.timestamp), bodega: m.bodega || BODEGA.PRINCIPAL }));

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
  // historial se limpia visualmente al re-entrar
}

// ==========================
// INIT
// ==========================
document.addEventListener("DOMContentLoaded", () => {
  migrateOldBaseIfNeeded();

  baseCache[BODEGA.PRINCIPAL] = readJSON(baseKeyFor(BODEGA.PRINCIPAL), {});
  baseCache[BODEGA.ANEXO] = readJSON(baseKeyFor(BODEGA.ANEXO), {});

  setNetworkState(navigator.onLine);
  updateBodegaUI();
  updateFilterChips();

  refreshHome();
  showScreen("homeScreen");

  if($("entradaFecha")) $("entradaFecha").value = todayISO();
  if($("salidaFecha")) $("salidaFecha").value = todayISO();
  if($("transferFecha")) $("transferFecha").value = todayISO();

  attachCodigoMask($("entradaCodigo"), { allowText:false });
  attachCodigoMask($("salidaCodigo"),  { allowText:false });
  attachCodigoMask($("transferCodigo"),{ allowText:false });

  attachCodigoMask($("searchInput"),   { allowText:true });
  attachCodigoMask($("catalogSearch"), { allowText:true });
  attachCodigoMask($("histSearch"),    { allowText:true });

  $("btnBodegaPrincipal")?.addEventListener("click", () => setActiveBodega(BODEGA.PRINCIPAL));
  $("btnBodegaAnexo")?.addEventListener("click", () => setActiveBodega(BODEGA.ANEXO));

  $("btnSync")?.addEventListener("click", () => syncBase(true));
  $("btnExport")?.addEventListener("click", exportExcel);

  // ✅ Abrir modal filtros (solo en Catálogo)
  $("btnOpenFilters")?.addEventListener("click", openFilterModal);
  $("btnCloseFilters")?.addEventListener("click", closeFilterModal);
  $("btnModalDone")?.addEventListener("click", closeFilterModal);
  $("btnModalClearFilters")?.addEventListener("click", () => {
    filtroDepartamento = "";
    filtroCategoria = "";
    updateFilterChips();
    rerenderCatalogIfOpen();
    renderFilterModal();
  });
  $("filterModalSearch")?.addEventListener("input", renderFilterModal);

  $("filterOverlay")?.addEventListener("click", (e) => {
    const overlay = $("filterOverlay");
    if(e.target === overlay) closeFilterModal();
  });

  // Entrar a Catálogo con PIN
  $("btnCatalogo")?.addEventListener("click", async () => {
    const ok = await ensurePinForBodega(activeBodega);
    if(!ok) return;

    showScreen("catalogScreen");
    $("catalogSearch").value = "";

    filtroDepartamento = "";
    filtroCategoria = "";
    filtroStock = false;

    const btnStock = $("btnFilterStock");
    if(btnStock) btnStock.classList.remove("active");

    updateFilterChips();
    filterIndex = null;

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
    if(info) info.textContent = `Origen: ${activeBodega} ➜ Destino: ${otherBodega(activeBodega)}`;
  });

  $("btnHistorial")?.addEventListener("click", () => {
    showScreen("historialScreen");
    $("histSearch").value = "";
    // historial se mantiene como ya te funcionaba
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

  $("entradaCodigo")?.addEventListener("input", () => fillProductoFromCode("entrada"));
  $("salidaCodigo")?.addEventListener("input", () => fillProductoFromCode("salida"));
  $("transferCodigo")?.addEventListener("input", () => fillProductoFromCode("transfer"));

  $("entradaCodigo")?.addEventListener("input", () => renderCodigoAutoList("entrada"));
  $("salidaCodigo")?.addEventListener("input", () => renderCodigoAutoList("salida"));
  $("transferCodigo")?.addEventListener("input", () => renderCodigoAutoList("transfer"));

  $("entradaCodigo")?.addEventListener("blur", () => setTimeout(() => hideCodigoAutoList("entradaAutoList"), 220));
  $("salidaCodigo")?.addEventListener("blur", () => setTimeout(() => hideCodigoAutoList("salidaAutoList"), 220));
  $("transferCodigo")?.addEventListener("blur", () => setTimeout(() => hideCodigoAutoList("transferAutoList"), 220));

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

  // Stock filter
  const btnStock = $("btnFilterStock");
  if(btnStock){
    btnStock.addEventListener("click", () => {
      filtroStock = !filtroStock;
      btnStock.classList.toggle("active", filtroStock);
      rerenderCatalogIfOpen();
    });
  }

  // Clear filters (barra)
  $("btnClearFilters")?.addEventListener("click", () => {
    filtroDepartamento = "";
    filtroCategoria = "";
    filtroStock = false;
    if(btnStock) btnStock.classList.remove("active");
    updateFilterChips();
    rerenderCatalogIfOpen();
  });

  // Chips clear
  $("chipDepClear")?.addEventListener("click", () => {
    filtroDepartamento = "";
    filtroCategoria = "";
    updateFilterChips();
    rerenderCatalogIfOpen();
  });

  $("chipCatClear")?.addEventListener("click", () => {
    filtroCategoria = "";
    updateFilterChips();
    rerenderCatalogIfOpen();
  });

  // Botones add/save
  $("btnAddEntradaItem")?.addEventListener("click", addEntradaItem);
  $("btnClearEntradaItems")?.addEventListener("click", () => { clearEntradaDraft(); toast("Factura vaciada"); });
  $("btnGuardarEntrada")?.addEventListener("click", saveFacturaEntrada);

  $("btnAddSalidaItem")?.addEventListener("click", addSalidaItem);
  $("btnClearSalidaItems")?.addEventListener("click", () => { clearSalidaDraft(); toast("Factura vaciada"); });
  $("btnGuardarSalida")?.addEventListener("click", saveFacturaSalida);

  $("btnAddTransferItem")?.addEventListener("click", addTransferItem);
  $("btnClearTransferItems")?.addEventListener("click", () => { clearTransferDraft(); toast("Transferencia vaciada"); });
  $("btnGuardarTransferencia")?.addEventListener("click", saveTransferencia);

  // sync silencioso
  syncBase(false);

  // render inicial
  renderEntradaItems();
  renderSalidaItems();
  renderTransferItems();
});
