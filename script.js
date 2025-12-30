// ==========================
// CONFIG (GitHub Pages)
// ==========================
const BASE_URL = "https://ferreteriauniversal45-sudo.github.io/ferreteria-inventario-app";
const INVENTARIO_URL = `${BASE_URL}/inventario.json`;
const VERSION_URL = `${BASE_URL}/inventario_version.json`;

// ==========================
// STORAGE KEYS
// ==========================
const K = {
  BASE: "fu_base_inv",
  VER: "fu_base_ver",
  MOV: "fu_movimientos",
  DEL: "fu_eliminaciones"
};

const $ = (id) => document.getElementById(id);

let currentSearchContext = null; // "entrada" | "salida"
let historialTab = "mov";        // "mov" | "del"

let baseCache = {};
let deltaDirty = true;
let deltaCache = { ent: {}, sal: {} };

// ==========================
// CATALOGO FILTERS (UI STATE)
// ==========================
let filtroDepartamento = "";
let filtroStock = false;
const CATALOG_INITIAL_LIMIT = 80;
const CATALOG_MAX_RENDER = 250;

// ==========================
// FACTURAS MULTI-ITEM (DRAFTS)
// ==========================
let entradaItems = []; // [{codigo, cantidad}]
let salidaItems  = []; // [{codigo, cantidad}]

function sumItems(items, code){
  const c = String(code || "").trim().toUpperCase();
  return items.reduce((acc, it) => acc + (it.codigo === c ? Number(it.cantidad || 0) : 0), 0);
}

function clearEntradaDraft(){
  entradaItems = [];
  renderEntradaItems(); // ahora renderiza FACTURA BORRADOR
}

function clearSalidaDraft(){
  salidaItems = [];
  renderSalidaItems();  // ahora renderiza FACTURA BORRADOR
  updateSalidaStockHint();
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

// ✅ FECHA LOCAL (NO UTC)
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
  // ✅ con 2 dígitos ya deja el guion listo
  if(d.length === 2) return `${d}-`;
  return `${d.slice(0,2)}-${d.slice(2)}`;
}

function hasLetters(str){
  return /[a-zA-Z\u00C0-\u017F]/.test(String(str || ""));
}

/**
 * allowText=true -> SOLO aplica máscara si el usuario está escribiendo algo numérico (sin letras).
 * allowText=false -> forzar solo dígitos (ideal para entradaCodigo/salidaCodigo).
 */
function attachCodigoMask(input, { allowText=false } = {}){
  if(!input) return;

  input.addEventListener("input", () => {
    const raw = input.value ?? "";

    if(allowText){
      // si tiene letras, no tocar (para poder buscar por nombre)
      if(hasLetters(raw)) return;

      // si empieza con letra u otro, no tocar
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
const screens = ["homeScreen","catalogScreen","entradaScreen","salidaScreen","searchScreen","historialScreen"];
function showScreen(id){
  for(const s of screens){
    const el = $(s);
    if(el) el.classList.toggle("hidden", s !== id);
  }

  // ✅ Ocultar autocomplete al cambiar de pantalla (evita listas "pegadas")
  const l1 = $("entradaAutoList");
  if(l1){
    l1.innerHTML = "";
    l1.style.display = "none";
  }
  const l2 = $("salidaAutoList");
  if(l2){
    l2.innerHTML = "";
    l2.style.display = "none";
  }
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

// ==========================
// CATALOGO FILTERS (DEPARTAMENTOS)
// ==========================
function cargarDepartamentos(){
  const select = $("filterDepartamento");
  if(!select) return;

  const prev = (filtroDepartamento || select.value || "").trim();

  const depsSet = new Set();
  for(const code of Object.keys(baseCache || {})){
    const dep = baseCache[code]?.departamento;
    if(dep) depsSet.add(String(dep));
  }

  const deps = Array.from(depsSet).sort((a,b) =>
    a.localeCompare(b, "es", { sensitivity: "base" })
  );

  select.innerHTML = `<option value="">Todos los departamentos</option>`;
  for(const dep of deps){
    const opt = document.createElement("option");
    opt.value = dep;
    opt.textContent = dep;
    select.appendChild(opt);
  }

  const finalVal = depsSet.has(prev) ? prev : "";
  select.value = finalVal;
  filtroDepartamento = finalVal;
}

// ==========================
// DELTAS
// ==========================
function rebuildDelta(){
  const movs = readJSON(K.MOV, []);
  const ent = {};
  const sal = {};
  for(const m of movs){
    const c = String(m.codigo||"").trim().toUpperCase();
    const q = Number(m.cantidad||0);
    if(!c || !Number.isFinite(q)) continue;
    if(m.tipo === "entrada") ent[c] = (ent[c] || 0) + q;
    if(m.tipo === "salida")  sal[c] = (sal[c] || 0) + q;
  }
  deltaCache = { ent, sal };
  deltaDirty = false;
}

function getStock(code){
  if(deltaDirty) rebuildDelta();
  const c = String(code||"").trim().toUpperCase();
  const base = baseCache[c]?.stock ?? 0;
  const ent = deltaCache.ent[c] || 0;
  const sal = deltaCache.sal[c] || 0;
  return Number(base) + Number(ent) - Number(sal);
}

// ==========================
// SYNC
// ==========================
let syncing = false;

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
    const verRes = await fetch(VERSION_URL, { cache: "no-store" });
    if(!verRes.ok) throw new Error("No se pudo leer versión");
    const verJson = await verRes.json();
    const remoteVer = String(verJson.version || "").trim();
    if(!remoteVer) throw new Error("Versión inválida");

    const localVer = localStorage.getItem(K.VER) || "";

    if(localVer !== remoteVer || !localStorage.getItem(K.BASE)){
      const invRes = await fetch(INVENTARIO_URL, { cache: "no-store" });
      if(!invRes.ok) throw new Error("No se pudo leer inventario");
      const invJson = await invRes.json();

      const normalized = normalizeBase(invJson);
      writeJSON(K.BASE, normalized);
      localStorage.setItem(K.VER, remoteVer);

      baseCache = normalized;
      if(showMsg) toast("✅ Inventario actualizado");
    }else{
      baseCache = readJSON(K.BASE, {});
      if(showMsg) toast("✅ Ya estabas actualizado");
    }

    setNetworkState(true);
    cargarDepartamentos();
    refreshHome();

    const cat = $("catalogScreen");
    if(cat && !cat.classList.contains("hidden")){
      renderCatalog($("catalogSearch")?.value || "");
    }

  }catch(err){
    baseCache = readJSON(K.BASE, {});
    setNetworkState(navigator.onLine);
    cargarDepartamentos();
    refreshHome();

    const cat = $("catalogScreen");
    if(cat && !cat.classList.contains("hidden")){
      renderCatalog($("catalogSearch")?.value || "");
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

  const total = Object.keys(baseCache || {}).length;
  if($("homeProductos")) $("homeProductos").textContent = String(total);

  const movs = readJSON(K.MOV, []);
  const h = todayISO();
  const movHoy = movs.filter(m => String(m.fecha||"").slice(0,10) === h).length;
  if($("homeMovHoy")) $("homeMovHoy").textContent = String(movHoy);
}

// ==========================
// CATALOGO (TABLA) + FILTROS
// ==========================
function renderCatalog(query){
  const list = $("catalogList");
  const info = $("catalogInfo");
  if(!list || !info) return;

  list.innerHTML = "";

  const q = (query || "").toLowerCase().trim();

  let entries = Object.entries(baseCache || {});
  const baseTotal = entries.length;

  if(baseTotal === 0){
    info.textContent = "No hay inventario cargado. Pulsa 'Actualizar inventario'.";
    return;
  }

  if(filtroDepartamento){
    entries = entries.filter(([_, data]) => String(data?.departamento || "") === filtroDepartamento);
  }
  if(filtroStock){
    entries = entries.filter(([code]) => getStock(code) > 0);
  }

  if(q.length === 0){
    entries.sort((a,b) => a[0].localeCompare(b[0], "es", { numeric:true, sensitivity:"base" }));
    const show = entries.slice(0, CATALOG_INITIAL_LIMIT);

    info.textContent = entries.length > show.length
      ? `Mostrando ${show.length} de ${entries.length}. Escribe para buscar o usa filtros.`
      : `Productos: ${entries.length}`;

    for(const [code, data] of show){
      const stock = getStock(code);
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
    : `Resultados: ${filtered.length}`;

  for(const [code, data] of show){
    const stock = getStock(code);
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
// BUSCADOR (B2)
// ==========================
function selectProduct(code){
  const data = baseCache[code];
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

  showScreen("homeScreen");
}

function renderSearch(query){
  const list = $("searchList");
  const info = $("searchInfo");
  if(!list || !info) return;

  list.innerHTML = "";

  const q = (query || "").toLowerCase().trim();
  const entries = Object.entries(baseCache || {});
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
    : `Resultados: ${filtered.length}`;

  for(const [code, data] of show){
    const stock = getStock(code);

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
// ✅ AUTOCOMPLETE SOLO POR CÓDIGO (ENTRADA / SALIDA)
// ==========================
function hideCodigoAutoList(listId){
  const list = $(listId);
  if(!list) return;
  list.innerHTML = "";
  list.style.display = "none";
}

function renderCodigoAutoList(context){
  const inputId = context === "entrada" ? "entradaCodigo" : "salidaCodigo";
  const listId  = context === "entrada" ? "entradaAutoList" : "salidaAutoList";

  const input = $(inputId);
  const list = $(listId);
  if(!input || !list) return;

  const q = String(input.value || "").trim().toUpperCase();

  // Mostrar sugerencias SOLO cuando ya haya 2 dígitos (ej: "01-")
  const digits = q.replace(/\D/g, "");
  if(digits.length < 2){
    hideCodigoAutoList(listId);
    return;
  }

  const codes = Object.keys(baseCache || {});
  if(codes.length === 0){
    hideCodigoAutoList(listId);
    return;
  }

  // SOLO por código: empieza con lo escrito
  const matches = codes
    .filter(code => code.startsWith(q))
    .slice(0, 8);

  if(matches.length === 0){
    hideCodigoAutoList(listId);
    return;
  }

  list.innerHTML = "";

  for(const code of matches){
    const data = baseCache[code] || {};
    const stock = getStock(code);

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

      if(context === "entrada"){
        $("entradaProducto").value = data.producto || "";
        $("entradaCantidad")?.focus();
      }else{
        $("salidaProducto").value = data.producto || "";
        updateSalidaStockHint();
        $("salidaCantidad")?.focus();
      }

      hideCodigoAutoList(listId);
    };

    // pointerdown va excelente en Android
    item.addEventListener("pointerdown", select);
    item.addEventListener("mousedown", select);
    item.addEventListener("click", select);

    list.appendChild(item);
  }

  list.style.display = "block";
}

// ==========================
// ENTRADAS / SALIDAS (AUTO-LLENADO)
// ==========================
function fillProductoFromCode(context){
  if(context === "entrada"){
    const code = String($("entradaCodigo").value||"").trim().toUpperCase();
    $("entradaProducto").value = baseCache[code]?.producto || "";
  }
  if(context === "salida"){
    const code = String($("salidaCodigo").value||"").trim().toUpperCase();
    $("salidaProducto").value = baseCache[code]?.producto || "";
    updateSalidaStockHint();
  }
}

function updateSalidaStockHint(){
  const code = String($("salidaCodigo").value||"").trim().toUpperCase();
  const out = $("salidaStockInfo");
  if(!out) return;

  if(!code){
    out.textContent = "";
    return;
  }
  const stockReal = getStock(code);
  const reservado = sumItems(salidaItems, code);
  const disponible = stockReal - reservado;

  const extra = reservado > 0 ? ` (en factura: ${reservado})` : "";
  out.textContent = `Stock disponible: ${disponible}${extra}`;
}

// ==========================
// FACTURA BORRADOR (PREVIEW) - MISMO ESTILO QUE HISTORIAL
// ==========================
function flashInvoiceEl(el){
  if(!el) return;
  el.classList.add("invoice-flash");
  clearTimeout(el._flashTimer);
  el._flashTimer = setTimeout(() => el.classList.remove("invoice-flash"), 250);
}

function updateDraftTotalsFromDOM(context){
  const preview = context === "entrada" ? $("entradaFacturaPreview") : $("salidaFacturaPreview");
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
  const items = isEntrada ? entradaItems : salidaItems;

  const info = isEntrada ? $("entradaItemsInfo") : $("salidaItemsInfo");
  const preview = isEntrada ? $("entradaFacturaPreview") : $("salidaFacturaPreview");
  if(!info || !preview) return;

  preview.innerHTML = "";

  if(items.length === 0){
    info.textContent = "Factura vacía.";
    return;
  }

  const fecha = (isEntrada ? $("entradaFecha")?.value : $("salidaFecha")?.value) || todayISO();
  const factura = (isEntrada ? $("entradaFactura")?.value : $("salidaFactura")?.value) || "";

  const proveedor = isEntrada ? String($("entradaProveedor")?.value || "").trim() : "";
  const tipoLabel = isEntrada ? "ENTRADA" : "SALIDA";

  const totalPiezas = items.reduce((a,it)=>a+Number(it.cantidad||0),0);
  info.textContent = `Productos en factura: ${items.length} · Total piezas: ${totalPiezas}`;

  const inv = document.createElement("div");
  inv.className = "invoice";
  inv.dataset.draft = context;

  inv.innerHTML = `
    <div class="invoice-header">
      <div class="invoice-company">FERRETERÍA UNIVERSAL</div>
      <div class="invoice-sub">FACTURA (BORRADOR)</div>
    </div>

    <div class="invoice-meta">
      <div class="im-row"><span class="im-label">FACTURA</span><span class="im-value">${escapeHtml(factura || "—")}</span></div>
      <div class="im-row"><span class="im-label">TIPO</span><span class="im-value">${escapeHtml(tipoLabel)}</span></div>
      <div class="im-row"><span class="im-label">FECHA</span><span class="im-value">${escapeHtml(fecha)}</span></div>
      <div class="im-row"><span class="im-label">${isEntrada ? "PROVEEDOR" : "REFERENCIA"}</span><span class="im-value">${escapeHtml(isEntrada ? (proveedor || "—") : "—")}</span></div>
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
        const data = baseCache[it.codigo] || {};
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

// ==========================
// FACTURAS MULTI-ITEM: ADD ITEM
// ==========================
function addEntradaItem(){
  const codigo = String($("entradaCodigo").value||"").trim().toUpperCase();
  const cantidad = Number($("entradaCantidad").value);

  if(!codigo || !Number.isFinite(cantidad) || cantidad <= 0){
    toast("Código y cantidad válidos.");
    return;
  }
  if(!baseCache[codigo]){
    toast("Código no existe en inventario base.");
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
  if(!baseCache[codigo]){
    toast("Código no existe en inventario base.");
    return;
  }

  const stockReal = getStock(codigo);
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

// ==========================
// FACTURAS MULTI-ITEM: SAVE FACTURA
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
      codigo,
      producto: baseCache[codigo]?.producto || "",
      departamento: baseCache[codigo]?.departamento || "",
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

  // validación final de stock
  for(const it of salidaItems){
    const stockReal = getStock(it.codigo);
    const reservado = sumItems(salidaItems, it.codigo) - Number(it.cantidad || 0);
    const disponible = stockReal - reservado;
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
      codigo,
      producto: baseCache[codigo]?.producto || "",
      departamento: baseCache[codigo]?.departamento || "",
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

// ==========================
// HISTORIAL NUEVO (FACTURAS)
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

function flashInvoice(grupoId){
  const inv = document.querySelector(`.invoice[data-grupo="${grupoId}"]`);
  if(!inv) return;
  inv.classList.add("invoice-flash");
  clearTimeout(inv._flashTimer);
  inv._flashTimer = setTimeout(() => inv.classList.remove("invoice-flash"), 250);
}

function updateTotalsFromDOM(grupoId){
  const inv = document.querySelector(`.invoice[data-grupo="${grupoId}"]`);
  if(!inv) return;

  const inputs = inv.querySelectorAll("input.edit-cantidad");
  const totalProductos = inputs.length;

  let totalPiezas = 0;
  for(const inp of inputs){
    const v = Number(inp.value);
    if(Number.isFinite(v) && v > 0) totalPiezas += v;
  }

  inv.querySelectorAll(".t-prod").forEach(el => el.textContent = String(totalProductos));
  inv.querySelectorAll(".t-pzas").forEach(el => el.textContent = String(totalPiezas));

  flashInvoice(grupoId);
}

function updateFacturaTotalsFromStorage(grupoId){
  const movs = readJSON(K.MOV, []);
  const items = movs.filter(m => movGroupKey(m) === String(grupoId));
  const { totalProductos, totalPiezas } = calcFacturaTotalsFromItems(items);

  const inv = document.querySelector(`.invoice[data-grupo="${grupoId}"]`);
  if(!inv) return;

  inv.querySelectorAll(".t-prod").forEach(el => el.textContent = String(totalProductos));
  inv.querySelectorAll(".t-pzas").forEach(el => el.textContent = String(totalPiezas));

  flashInvoice(grupoId);
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

function setHistTab(tab){
  historialTab = tab;

  const tMov = $("tabMov");
  const tDel = $("tabDel");
  tMov?.classList.remove("active");
  tDel?.classList.remove("active");

  if(tab === "mov") tMov?.classList.add("active");
  else tDel?.classList.add("active");

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

  if(historialTab === "mov"){
    const movs = readJSON(K.MOV, []);
    const groups = groupFacturas(movs);

    const filtered = groups.filter(g => {
      if(!q) return true;
      const f = g.items[0] || {};
      const factura = String(f.factura||"").toLowerCase();
      const prov = String(f.proveedor||"").toLowerCase();
      const fecha = String(f.fecha||"").toLowerCase();

      if(factura.includes(q) || prov.includes(q) || fecha.includes(q)) return true;

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

  // ELIMINACIONES
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

  const dels = readJSON(K.DEL, []);
  dels.push({
    id: makeId(),
    tipo: m.tipo,
    codigo: m.codigo,
    producto: m.producto,
    cantidad: m.cantidad,
    detalle: `Artículo eliminado de factura ${m.factura||""}`,
    fechaHora: nowISO(),
    timestamp: Date.now()
  });
  writeJSON(K.DEL, dels);

  toast("🗑️ Artículo eliminado");
  refreshHome();
  renderHistorial();

  if(grupoId) updateFacturaTotalsFromStorage(grupoId);
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
    dels.push({
      id: makeId(),
      tipo: m.tipo,
      codigo: m.codigo,
      producto: m.producto,
      cantidad: m.cantidad,
      detalle: `Factura eliminada: ${m.factura||""}`,
      fechaHora: nowISO(),
      timestamp: Date.now()
    });
  }
  writeJSON(K.DEL, dels);

  toast("🧾 Factura eliminada");
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
// EXPORT EXCEL (robusto)
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
    fechaHora: formatFechaHora(m.timestamp)
  }));

  const salidas = movs
  .filter(m => m.tipo === "salida")
  .map(m => ({
    ...m,
    fechaHora: formatFechaHora(m.timestamp)
  }));

  const eliminaciones = dels.map(d => ({
    ...d,
    fechaHora: formatFechaHora(d.timestamp)
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entradas), "ENTRADAS");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salidas), "SALIDAS");
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
  baseCache = readJSON(K.BASE, {});
  setNetworkState(navigator.onLine);
  cargarDepartamentos();
  refreshHome();
  showScreen("homeScreen");

  if($("entradaFecha")) $("entradaFecha").value = todayISO();
  if($("salidaFecha")) $("salidaFecha").value = todayISO();

  // ✅ Máscara de código (con "-" automático)
  attachCodigoMask($("entradaCodigo"), { allowText:false });
  attachCodigoMask($("salidaCodigo"),  { allowText:false });

  // ✅ En búsquedas: solo aplica si el usuario está escribiendo algo numérico
  attachCodigoMask($("searchInput"),   { allowText:true });
  attachCodigoMask($("catalogSearch"), { allowText:true });
  attachCodigoMask($("histSearch"),    { allowText:true });

  $("btnSync")?.addEventListener("click", () => syncBase(true));
  $("btnExport")?.addEventListener("click", exportExcel);

  $("btnCatalogo")?.addEventListener("click", () => {
    showScreen("catalogScreen");
    $("catalogSearch").value = "";
    filtroDepartamento = "";
    filtroStock = false;

    const selDep = $("filterDepartamento");
    if(selDep) selDep.value = "";

    const btnStock = $("btnFilterStock");
    if(btnStock) btnStock.classList.remove("active");

    cargarDepartamentos();
    renderCatalog("");
  });

  $("btnEntrada")?.addEventListener("click", () => {
    showScreen("entradaScreen");
    $("entradaFecha").value = todayISO();
    $("entradaCodigo").value = "";
    $("entradaProducto").value = "";
    $("entradaCantidad").value = "";
    hideCodigoAutoList("entradaAutoList");
    clearEntradaDraft();
  });

  $("btnSalida")?.addEventListener("click", () => {
    showScreen("salidaScreen");
    $("salidaFecha").value = todayISO();
    $("salidaCodigo").value = "";
    $("salidaProducto").value = "";
    $("salidaCantidad").value = "";
    $("salidaFactura").value = "";
    hideCodigoAutoList("salidaAutoList");
    clearSalidaDraft();
  });

  $("btnHistorial")?.addEventListener("click", () => {
    showScreen("historialScreen");
    $("histSearch").value = "";
    setHistTab("mov");
  });

  $("btnBackCatalog")?.addEventListener("click", () => showScreen("homeScreen"));
  $("btnBackEntrada")?.addEventListener("click", () => showScreen("homeScreen"));
  $("btnBackSalida")?.addEventListener("click", () => showScreen("homeScreen"));
  $("btnBackHistorial")?.addEventListener("click", () => showScreen("homeScreen"));

  $("btnBackSearch")?.addEventListener("click", () => {
    if(currentSearchContext === "entrada") showScreen("entradaScreen");
    else if(currentSearchContext === "salida") showScreen("salidaScreen");
    else showScreen("homeScreen");
  });

  $("catalogSearch")?.addEventListener("input", (e) => renderCatalog(e.target.value));

  $("entradaCodigo")?.addEventListener("input", () => fillProductoFromCode("entrada"));
  $("salidaCodigo")?.addEventListener("input", () => fillProductoFromCode("salida"));

  // ✅ Autocomplete SOLO por código (debajo del input)
  $("entradaCodigo")?.addEventListener("input", () => renderCodigoAutoList("entrada"));
  $("salidaCodigo")?.addEventListener("input", () => renderCodigoAutoList("salida"));

  // Ocultar al perder foco (con delay para permitir tap)
  $("entradaCodigo")?.addEventListener("blur", () => setTimeout(() => hideCodigoAutoList("entradaAutoList"), 220));
  $("salidaCodigo")?.addEventListener("blur", () => setTimeout(() => hideCodigoAutoList("salidaAutoList"), 220));

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

  $("searchInput")?.addEventListener("input", (e) => renderSearch(e.target.value));

  // ====== BORRADOR: re-render si cambian datos de factura ======
  $("entradaFactura")?.addEventListener("input", () => renderEntradaItems());
  $("entradaProveedor")?.addEventListener("input", () => renderEntradaItems());
  $("entradaFecha")?.addEventListener("change", () => renderEntradaItems());

  $("salidaFactura")?.addEventListener("input", () => renderSalidaItems());
  $("salidaFecha")?.addEventListener("change", () => renderSalidaItems());

  // ====== FACTURAS MULTI-ITEM: BOTONES ======
  $("btnAddEntradaItem")?.addEventListener("click", addEntradaItem);
  $("btnClearEntradaItems")?.addEventListener("click", () => {
    clearEntradaDraft();
    toast("Factura vaciada");
  });
  $("btnGuardarEntrada")?.addEventListener("click", saveFacturaEntrada);

  $("btnAddSalidaItem")?.addEventListener("click", addSalidaItem);
  $("btnClearSalidaItems")?.addEventListener("click", () => {
    clearSalidaDraft();
    toast("Factura vaciada");
  });
  $("btnGuardarSalida")?.addEventListener("click", saveFacturaSalida);

  // ==========================
  // EVENTOS FILTROS CATALOGO
  // ==========================
  const selDep = $("filterDepartamento");
  if(selDep){
    selDep.addEventListener("change", (e) => {
      filtroDepartamento = e.target.value || "";
      renderCatalog($("catalogSearch")?.value || "");
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
    filtroStock = false;

    if(selDep) selDep.value = "";
    if(btnStock) btnStock.classList.remove("active");

    renderCatalog($("catalogSearch")?.value || "");
  });

  // ==========================
  // BORRADOR: acciones por producto (editar/eliminar) + totales dinámicos
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
        }else{
          salidaItems = salidaItems.filter(it => it.codigo !== code);
          renderSalidaItems();
          updateSalidaStockHint();
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

    // totales en vivo mientras escribe
    preview.addEventListener("input", (e) => {
      const inp = e.target.closest("input.draft-cantidad");
      if(!inp) return;
      updateDraftTotalsFromDOM(context);
    });

    // guardar cambio al terminar
    preview.addEventListener("change", (e) => {
      const inp = e.target.closest("input.draft-cantidad");
      if(!inp) return;

      const code = String(inp.dataset.codigo || "").trim().toUpperCase();
      const nueva = Number(inp.value);

      if(!Number.isFinite(nueva) || nueva <= 0){
        toast("Cantidad inválida");
        // re-render para restaurar valores
        if(context === "entrada") renderEntradaItems(); else renderSalidaItems();
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

      // SALIDA: validar stock
      const it = salidaItems.find(x => x.codigo === code);
      if(!it) return;

      const stockReal = getStock(code);
      const reservadoOtros = 0; // en salidaItems solo 1 por código
      const disponible = stockReal - reservadoOtros;

      if(nueva > disponible){
        toast(`Stock insuficiente. Disponible: ${disponible}`);
        renderSalidaItems(); // restaura
        updateSalidaStockHint();
        return;
      }

      it.cantidad = nueva;
      renderSalidaItems();
      updateSalidaStockHint();
      toast("✅ Cantidad actualizada");
    });
  }

  setupDraftPreview("entradaFacturaPreview", "entrada");
  setupDraftPreview("salidaFacturaPreview", "salida");

  // ==========================
  // HISTORIAL: tabs, filtro, acciones
  // ==========================
  $("tabMov")?.addEventListener("click", () => setHistTab("mov"));
  $("tabDel")?.addEventListener("click", () => setHistTab("del"));
  $("histSearch")?.addEventListener("input", () => renderHistorial());

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

  // Totales dinámicos mientras escribe en historial
  $("histList")?.addEventListener("input", (e) => {
    const inp = e.target.closest("input.edit-cantidad");
    if(!inp) return;
    const gid = inp.dataset.grupo;
    if(gid) updateTotalsFromDOM(gid);
  });

  // Guardar cambio en historial (con validación de stock negativo)
  $("histList")?.addEventListener("change", (e) => {
    const inp = e.target.closest("input.edit-cantidad");
    if(!inp) return;

    const id = inp.dataset.id;
    const gid = inp.dataset.grupo;
    const nueva = Number(inp.value);

    if(!Number.isFinite(nueva) || nueva <= 0){
      toast("Cantidad inválida");
      updateFacturaTotalsFromStorage(gid);
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

    const oldQty = Number(m.cantidad||0);
    const code = String(m.codigo||"").trim().toUpperCase();

    const stockActual = getStock(code);
    let stockNuevo = stockActual;

    if(m.tipo === "entrada"){
      stockNuevo = stockActual - oldQty + nueva;
    }else if(m.tipo === "salida"){
      stockNuevo = stockActual + oldQty - nueva;
    }

    if(stockNuevo < 0){
      toast("❌ No se puede: dejaría stock negativo");
      inp.value = String(oldQty);
      updateTotalsFromDOM(gid);
      return;
    }

    m.cantidad = nueva;
    writeJSON(K.MOV, movs);
    deltaDirty = true;

    toast("✅ Cantidad actualizada");
    refreshHome();
    updateFacturaTotalsFromStorage(gid);
  });

  // sync silencioso al iniciar
  syncBase(false);

  // render inicial de borradores por si recargas en esas pantallas
  renderEntradaItems();
  renderSalidaItems();
});
