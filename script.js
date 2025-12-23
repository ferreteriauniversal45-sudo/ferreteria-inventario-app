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
const CATALOG_INITIAL_LIMIT = 80;  // cuantos productos mostrar al entrar sin buscar
const CATALOG_MAX_RENDER = 250;    // límite cuando ya estás buscando

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
  renderEntradaItems();
}
function clearSalidaDraft(){
  salidaItems = [];
  renderSalidaItems();
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

function todayISO(){
  return new Date().toISOString().slice(0,10);
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

// ✅ Descarga compatible con Android WebView (evita crash por XLSX.writeFile)
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
// UI NAV
// ==========================
const screens = ["homeScreen","catalogScreen","entradaScreen","salidaScreen","searchScreen","historialScreen"];
function showScreen(id){
  for(const s of screens){
    const el = $(s);
    if(el) el.classList.toggle("hidden", s !== id);
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

    // si estás viendo catálogo, refrescarlo
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

  // Base
  let entries = Object.entries(baseCache || {});
  const baseTotal = entries.length;

  if(baseTotal === 0){
    info.textContent = "No hay inventario cargado. Pulsa 'Actualizar inventario'.";
    return;
  }

  // ✅ Aplicar filtros (si existen en tu script)
  if(typeof filtroDepartamento !== "undefined" && filtroDepartamento){
    entries = entries.filter(([_, data]) => String(data?.departamento || "") === filtroDepartamento);
  }
  if(typeof filtroStock !== "undefined" && filtroStock){
    entries = entries.filter(([code]) => getStock(code) > 0);
  }

  // ✅ SI NO HAY BÚSQUEDA: mostrar vista previa (para que siempre se vea catálogo)
  if(q.length === 0){
    // (opcional) ordenar por código para que se vea "limpio"
    entries.sort((a,b) => a[0].localeCompare(b[0], "es", { numeric:true, sensitivity:"base" }));

    const show = entries.slice(0, CATALOG_INITIAL_LIMIT);

    if(entries.length > show.length){
      info.textContent = `Mostrando ${show.length} de ${entries.length}. Escribe para buscar o usa filtros.`;
    }else{
      info.textContent = `Productos: ${entries.length}`;
    }

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

  // ✅ SI HAY BÚSQUEDA: filtrar por código o nombre
  const filtered = entries.filter(([code, data]) => {
    const name = String(data.producto||"").toLowerCase();
    return code.toLowerCase().includes(q) || name.includes(q);
  });

  if(filtered.length === 0){
    info.textContent = "Sin resultados.";
    return;
  }

  const show = filtered.slice(0, CATALOG_MAX_RENDER);

  if(filtered.length > show.length){
    info.textContent = `Mostrando ${show.length} de ${filtered.length}. Sigue escribiendo para filtrar más.`;
  }else{
    info.textContent = `Resultados: ${filtered.length}`;
  }

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
// BUSCADOR (TABLA) (B2)
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
    return code.toLowerCase().includes(q) || name.includes(q);
  });

  if(filtered.length === 0){
    info.textContent = "Sin resultados.";
    return;
  }

  const show = filtered.slice(0, 250);
  if(filtered.length > show.length){
    info.textContent = `Mostrando ${show.length} de ${filtered.length}. Sigue escribiendo para filtrar más.`;
  }else{
    info.textContent = `Resultados: ${filtered.length}`;
  }

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
  if(!code){
    $("salidaStockInfo").textContent = "";
    return;
  }
  const stockReal = getStock(code);
  const reservado = sumItems(salidaItems, code);
  const disponible = stockReal - reservado;

  const extra = reservado > 0 ? ` (en factura: ${reservado})` : "";
  $("salidaStockInfo").textContent = `Stock disponible: ${disponible}${extra}`;
}

// ==========================
// FACTURAS MULTI-ITEM: RENDER LISTS
// ==========================
function renderEntradaItems(){
  const info = $("entradaItemsInfo");
  const list = $("entradaItemsList");
  if(!info || !list) return;

  list.innerHTML = "";

  if(entradaItems.length === 0){
    info.textContent = "Factura vacía.";
    return;
  }

  const totalPiezas = entradaItems.reduce((a,it)=>a+Number(it.cantidad||0),0);
  info.textContent = `Productos en factura: ${entradaItems.length} · Total piezas: ${totalPiezas}`;

  for(const it of entradaItems){
    const data = baseCache[it.codigo] || {};
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `
      <div class="item-left">
        <div class="item-title">${escapeHtml(it.codigo)} · ${escapeHtml(data.producto || "(sin nombre)")}</div>
        <div class="item-meta">Depto: ${escapeHtml(data.departamento || "")}</div>
        <div class="item-qty">Cantidad: ${escapeHtml(String(it.cantidad))}</div>
      </div>
      <div class="item-actions">
        <button class="btn tiny danger" type="button">Quitar</button>
      </div>
    `;
    row.querySelector("button").addEventListener("click", () => {
      entradaItems = entradaItems.filter(x => x.codigo !== it.codigo);
      renderEntradaItems();
      toast("Producto quitado");
    });
    list.appendChild(row);
  }
}

function renderSalidaItems(){
  const info = $("salidaItemsInfo");
  const list = $("salidaItemsList");
  if(!info || !list) return;

  list.innerHTML = "";

  if(salidaItems.length === 0){
    info.textContent = "Factura vacía.";
    return;
  }

  const totalPiezas = salidaItems.reduce((a,it)=>a+Number(it.cantidad||0),0);
  info.textContent = `Productos en factura: ${salidaItems.length} · Total piezas: ${totalPiezas}`;

  for(const it of salidaItems){
    const data = baseCache[it.codigo] || {};
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `
      <div class="item-left">
        <div class="item-title">${escapeHtml(it.codigo)} · ${escapeHtml(data.producto || "(sin nombre)")}</div>
        <div class="item-meta">Depto: ${escapeHtml(data.departamento || "")}</div>
        <div class="item-qty">Cantidad: ${escapeHtml(String(it.cantidad))}</div>
      </div>
      <div class="item-actions">
        <button class="btn tiny danger" type="button">Quitar</button>
      </div>
    `;
    row.querySelector("button").addEventListener("click", () => {
      salidaItems = salidaItems.filter(x => x.codigo !== it.codigo);
      renderSalidaItems();
      updateSalidaStockHint();
      toast("Producto quitado");
    });
    list.appendChild(row);
  }
}

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

  // limpiar campos de producto para el siguiente
  $("entradaCodigo").value = "";
  $("entradaProducto").value = "";
  $("entradaCantidad").value = "";

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

  // limpiar draft (pero dejamos proveedor/factura/fecha por si van a capturar otra)
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

  // validación final de stock (por seguridad)
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
// HISTORIAL (TABLA) + ELIMINAR
// ==========================
function setHistTab(tab){
  historialTab = tab;

  // Tabs
  $("tabMov").classList.remove("active");
  $("tabDel").classList.remove("active");

  if(tab === "mov"){
    $("tabMov").classList.add("active");
  }else{
    $("tabDel").classList.add("active");
  }

  // Headers
  $("histHeadMov").classList.toggle("hidden", tab !== "mov");
  $("histHeadDel").classList.toggle("hidden", tab !== "del");

  // Limpiar lista y volver a renderizar
  const list = $("histList");
  if(list) list.innerHTML = "";

  renderHistorial();
}


function renderHistorial(){
  const q = ($("histSearch").value || "").toLowerCase().trim();
  const list = $("histList");
  if(!list) return;

  list.innerHTML = "";

  // ======================
  // MOVIMIENTOS
  // ======================
  if(historialTab === "mov"){
    const movs = readJSON(K.MOV, [])
      .slice()
      .sort((a,b) => (b.timestamp||0)-(a.timestamp||0));

    const filtered = movs.filter(m => {
      const c = String(m.codigo||"").toLowerCase();
      const p = String(m.producto||"").toLowerCase();
      return c.includes(q) || p.includes(q);
    });

    if(filtered.length === 0){
      list.innerHTML = `<div class="trow"><div class="cell">Sin movimientos.</div></div>`;
      return;
    }

    for(const m of filtered){
      const row = document.createElement("div");
      row.className = "trow cols-hmov";
      row.innerHTML = `
        <div class="cell">${m.tipo === "entrada" ? "ENTRADA" : "SALIDA"}</div>
        <div class="cell">${escapeHtml(m.codigo)}</div>
        <div class="cell wrap">${escapeHtml(m.producto)}</div>
        <div class="cell right">${m.cantidad}</div>
        <div class="cell">${m.fecha}</div>
        <div class="cell">${escapeHtml(m.factura || "")}</div>
        <div class="cell">${escapeHtml(m.proveedor || "")}</div>
        <div class="cell right">
          <button class="btn small danger row-action" data-id="${m.id}">Eliminar</button>
        </div>
      `;
      list.appendChild(row);
    }
    return;
  }

  // ======================
  // ELIMINACIONES
  // ======================
  const dels = readJSON(K.DEL, [])
    .slice()
    .sort((a,b) => (b.timestamp||0)-(a.timestamp||0));

  const filtered = dels.filter(d => {
    const c = String(d.codigo||"").toLowerCase();
    const p = String(d.producto||"").toLowerCase();
    return c.includes(q) || p.includes(q);
  });

  if(filtered.length === 0){
    list.innerHTML = `<div class="trow"><div class="cell">Sin eliminaciones.</div></div>`;
    return;
  }

  for(const d of filtered){
    const row = document.createElement("div");
    row.className = "trow cols-hdel";
    row.innerHTML = `
      <div class="cell">${escapeHtml(d.fechaHora)}</div>
      <div class="cell">${escapeHtml(d.tipo)}</div>
      <div class="cell">${escapeHtml(d.codigo)}</div>
      <div class="cell wrap">${escapeHtml(d.producto)}</div>
      <div class="cell right">${d.cantidad}</div>
      <div class="cell wrap">${escapeHtml(d.detalle)}</div>
    `;
    list.appendChild(row);
  }
}


async function deleteMovimiento(id){
  const ok = await uiConfirm(
    "¿Eliminar este movimiento? (quedará registrado en Eliminaciones)"
  );
  if(!ok) return;

  const movs = readJSON(K.MOV, []);
  const idx = movs.findIndex(m => m.id === id);
  if(idx < 0){
    toast("No se encontró el movimiento.");
    return;
  }

  const m = movs[idx];
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
    detalle: m.tipo === "entrada"
      ? `Factura: ${m.factura||""} · Proveedor: ${m.proveedor||""} · Fecha: ${m.fecha||""}`
      : `Factura: ${m.factura||""} · Fecha: ${m.fecha||""}`,
    fechaHora: nowISO(),
    timestamp: Date.now()
  });
  writeJSON(K.DEL, dels);

  toast("🗑️ Eliminado");
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
// EXPORT EXCEL
// ==========================
function exportExcel(){
  if(typeof XLSX === "undefined"){
    toast("No cargó Excel");
    return;
  }

  const movs = readJSON(K.MOV, []);
  const dels = readJSON(K.DEL, []);

  if(movs.length === 0 && dels.length === 0){
    toast("No hay movimientos");
    return;
  }

  const entradas = movs.filter(m=>m.tipo==="entrada");
  const salidas = movs.filter(m=>m.tipo==="salida");

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entradas), "ENTRADAS");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salidas), "SALIDAS");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dels), "ELIMINACIONES");

  const wbout = XLSX.write(wb,{bookType:"xlsx",type:"base64"});
  const filename = `reporte_${todayISO()}.xlsx`;

  if(window.Android){
    Android.saveFile(wbout, filename);
    toast("📥 Archivo guardado en Descargas");
  }else{
    XLSX.writeFile(wb, filename);
  }

  // LIMPIEZA AUTOMÁTICA
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

  $("btnSync")?.addEventListener("click", () => syncBase(true));
  $("btnExport")?.addEventListener("click", exportExcel);

  $("btnCatalogo")?.addEventListener("click", () => {
    showScreen("catalogScreen");
    $("catalogSearch").value = "";

    // reset filtros al abrir Catálogo
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

    // No borramos proveedor/factura automáticamente por si capturan varias facturas seguidas
    // pero si quieres, descomenta:
    // $("entradaProveedor").value = "";
    // $("entradaFactura").value = "";

    clearEntradaDraft();
  });

  $("btnSalida")?.addEventListener("click", () => {
    showScreen("salidaScreen");
    $("salidaFecha").value = todayISO();
    $("salidaCodigo").value = "";
    $("salidaProducto").value = "";
    $("salidaCantidad").value = "";
    $("salidaFactura").value = "";

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

  // sync silencioso al iniciar
  syncBase(false);

  // render inicial de drafts por si recargas en esas pantallas
  renderEntradaItems();
  renderSalidaItems();
});
