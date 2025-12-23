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
    $(s).classList.toggle("hidden", s !== id);
  }
}

// ==========================
// NETWORK ICON
// ==========================
function setNetworkState(isOnline){
  const icon = $("netIcon");
  icon.classList.toggle("online", !!isOnline);
  icon.classList.toggle("offline", !isOnline);
  $("homeEstado").textContent = isOnline ? "ON" : "OFF";
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

  btn.disabled = true;
  btn.textContent = "Actualizando...";
  icon.classList.add("spin");

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

    // si estás viendo catálogo, refrescarlo
    const cat = $("catalogScreen");
    if(cat && !cat.classList.contains("hidden")){
      renderCatalog($("catalogSearch")?.value || "");
    }

    if(showMsg) toast("⚠️ Sin internet: usando inventario local");
    console.warn(err);
  }

  btn.disabled = false;
  btn.textContent = "Actualizar inventario";
  icon.classList.remove("spin");
  syncing = false;
}

// ==========================
// HOME
// ==========================
function refreshHome(){
  const ver = localStorage.getItem(K.VER) || "—";
  $("homeVersion").textContent = ver;

  const total = Object.keys(baseCache || {}).length;
  $("homeProductos").textContent = String(total);

  const movs = readJSON(K.MOV, []);
  const h = todayISO();
  const movHoy = movs.filter(m => String(m.fecha||"").slice(0,10) === h).length;
  $("homeMovHoy").textContent = String(movHoy);
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
  const entriesAll = Object.entries(baseCache || {});
  const baseTotal = entriesAll.length;

  if(baseTotal > 500 && q.length < 2 && !filtroDepartamento && !filtroStock){
    info.textContent = "Escribe al menos 2 letras/números para buscar (catálogo grande).";
    return;
  }

  if(baseTotal === 0){
    info.textContent = "No hay inventario cargado. Pulsa 'Actualizar inventario'.";
    return;
  }

  // 1) filtro por departamento
  let entries = entriesAll;
  if(filtroDepartamento){
    entries = entries.filter(([_, data]) => String(data?.departamento || "") === filtroDepartamento);
  }

  // 2) filtro con stock
  if(filtroStock){
    entries = entries.filter(([code]) => getStock(code) > 0);
  }

  // 3) búsqueda por código o nombre
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
// ENTRADAS / SALIDAS
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
  const stock = getStock(code);
  $("salidaStockInfo").textContent = `Stock disponible: ${stock}`;
}

function saveEntrada(){
  const codigo = String($("entradaCodigo").value||"").trim().toUpperCase();
  const cantidad = Number($("entradaCantidad").value);
  const proveedor = String($("entradaProveedor").value||"").trim();
  const factura = String($("entradaFactura").value||"").trim();
  const fecha = $("entradaFecha").value || todayISO();

  if(!codigo || !Number.isFinite(cantidad) || cantidad <= 0 || !proveedor || !factura || !fecha){
    toast("Completa todos los campos.");
    return;
  }
  if(!baseCache[codigo]){
    toast("Código no existe en inventario base. Actualiza o revisa.");
    return;
  }

  const movs = readJSON(K.MOV, []);
  movs.push({
    id: makeId(),
    tipo: "entrada",
    codigo,
    producto: baseCache[codigo].producto || "",
    departamento: baseCache[codigo].departamento || "",
    cantidad,
    proveedor,
    factura,
    fecha,
    timestamp: Date.now()
  });
  writeJSON(K.MOV, movs);
  deltaDirty = true;

  toast("✅ Entrada guardada");
  refreshHome();
  showScreen("homeScreen");
}

function saveSalida(){
  const codigo = String($("salidaCodigo").value||"").trim().toUpperCase();
  const cantidad = Number($("salidaCantidad").value);
  const factura = String($("salidaFactura").value||"").trim();
  const fecha = $("salidaFecha").value || todayISO();

  if(!codigo || !Number.isFinite(cantidad) || cantidad <= 0 || !factura || !fecha){
    toast("Completa todos los campos.");
    return;
  }
  if(!baseCache[codigo]){
    toast("Código no existe en inventario base. Actualiza o revisa.");
    return;
  }

  const stock = getStock(codigo);
  if(cantidad > stock){
    toast(`Stock insuficiente. Disponible: ${stock}`);
    return;
  }

  const movs = readJSON(K.MOV, []);
  movs.push({
    id: makeId(),
    tipo: "salida",
    codigo,
    producto: baseCache[codigo].producto || "",
    departamento: baseCache[codigo].departamento || "",
    cantidad,
    proveedor: "",
    factura,
    fecha,
    timestamp: Date.now()
  });
  writeJSON(K.MOV, movs);
  deltaDirty = true;

  toast("✅ Salida guardada");
  refreshHome();
  showScreen("homeScreen");
}

// ==========================
// HISTORIAL (TABLA) + ELIMINAR
// ==========================
function setHistTab(tab){
  historialTab = tab;
  $("tabMov").classList.toggle("active", tab === "mov");
  $("tabDel").classList.toggle("active", tab === "del");

  $("histHeadMov").classList.toggle("hidden", tab !== "mov");
  $("histHeadDel").classList.toggle("hidden", tab !== "del");

  renderHistorial();
}

function renderHistorial(){
  const q = ($("histSearch").value || "").toLowerCase().trim();
  const list = $("histList");
  list.innerHTML = "";

  if(historialTab === "mov"){
    const movs = readJSON(K.MOV, []).slice().sort((a,b) => (b.timestamp||0)-(a.timestamp||0));
    const filtered = movs.filter(m => {
      const c = String(m.codigo||"").toLowerCase();
      const p = String(m.producto||"").toLowerCase();
      return c.includes(q) || p.includes(q);
    });

    if(filtered.length === 0){
      list.innerHTML = `<div class="trow"><div class="cell" data-label="">Sin movimientos.</div></div>`;
      return;
    }

    for(const m of filtered){
      const row = document.createElement("div");
      row.className = "trow cols-hmov";

      const tipo = m.tipo === "entrada" ? "ENTRADA" : "SALIDA";
      const proveedor = m.tipo === "entrada" ? (m.proveedor || "") : "";

      row.innerHTML = `
        <div class="cell" data-label="Tipo">${escapeHtml(tipo)}</div>
        <div class="cell" data-label="Código">${escapeHtml(m.codigo||"")}</div>
        <div class="cell wrap" data-label="Producto">${escapeHtml(m.producto||"")}</div>
        <div class="cell right" data-label="Cant.">${escapeHtml(String(m.cantidad||0))}</div>
        <div class="cell" data-label="Fecha">${escapeHtml(m.fecha||"")}</div>
        <div class="cell" data-label="Factura">${escapeHtml(m.factura||"")}</div>
        <div class="cell" data-label="Proveedor">${escapeHtml(proveedor)}</div>
        <div class="cell right" data-label="">
          <button class="btn small danger row-action" type="button">Eliminar</button>
        </div>
      `;

      row.querySelector(".row-action").addEventListener("click", () => deleteMovimiento(m.id));
      list.appendChild(row);
    }

    return;
  }

  const dels = readJSON(K.DEL, []).slice().sort((a,b) => (b.timestamp||0)-(a.timestamp||0));
  const filtered = dels.filter(d => {
    const c = String(d.codigo||"").toLowerCase();
    const p = String(d.producto||"").toLowerCase();
    return c.includes(q) || p.includes(q);
  });

  if(filtered.length === 0){
    list.innerHTML = `<div class="trow"><div class="cell" data-label="">Sin eliminaciones.</div></div>`;
    return;
  }

  for(const d of filtered){
    const row = document.createElement("div");
    row.className = "trow cols-hdel";
    row.innerHTML = `
      <div class="cell" data-label="Fecha/Hora">${escapeHtml(d.fechaHora||"")}</div>
      <div class="cell" data-label="Tipo">${escapeHtml(d.tipo||"")}</div>
      <div class="cell" data-label="Código">${escapeHtml(d.codigo||"")}</div>
      <div class="cell wrap" data-label="Producto">${escapeHtml(d.producto||"")}</div>
      <div class="cell right" data-label="Cant.">${escapeHtml(String(d.cantidad||0))}</div>
      <div class="cell wrap" data-label="Detalle">${escapeHtml(d.detalle||"")}</div>
    `;
    list.appendChild(row);
  }
}

function deleteMovimiento(id){
  const ok = confirm("¿Eliminar este movimiento? (quedará registrado en Eliminaciones)");
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
// EXPORT EXCEL (MEJORADO + CONFIRMAR + LIMPIAR)
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

  // 👉 ANDROID GUARDA EL ARCHIVO
  if(window.Android){
    Android.saveFile(wbout, filename);
    toast("📥 Archivo guardado en Descargas");
  }else{
    XLSX.writeFile(wb, filename); // navegador
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

  $("entradaFecha").value = todayISO();
  $("salidaFecha").value = todayISO();

  $("btnSync").addEventListener("click", () => syncBase(true));
  $("btnExport").addEventListener("click", exportExcel);

  $("btnCatalogo").addEventListener("click", () => {
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

  $("btnEntrada").addEventListener("click", () => {
    showScreen("entradaScreen");
    $("entradaFecha").value = todayISO();
    $("entradaCodigo").value = "";
    $("entradaProducto").value = "";
    $("entradaCantidad").value = "";
    $("entradaProveedor").value = "";
    $("entradaFactura").value = "";
  });

  $("btnSalida").addEventListener("click", () => {
    showScreen("salidaScreen");
    $("salidaFecha").value = todayISO();
    $("salidaCodigo").value = "";
    $("salidaProducto").value = "";
    $("salidaCantidad").value = "";
    $("salidaFactura").value = "";
    updateSalidaStockHint();
  });

  $("btnHistorial").addEventListener("click", () => {
    showScreen("historialScreen");
    $("histSearch").value = "";
    setHistTab("mov");
  });

  $("btnBackCatalog").addEventListener("click", () => showScreen("homeScreen"));
  $("btnBackEntrada").addEventListener("click", () => showScreen("homeScreen"));
  $("btnBackSalida").addEventListener("click", () => showScreen("homeScreen"));
  $("btnBackHistorial").addEventListener("click", () => showScreen("homeScreen"));

  $("btnBackSearch").addEventListener("click", () => {
    if(currentSearchContext === "entrada") showScreen("entradaScreen");
    else if(currentSearchContext === "salida") showScreen("salidaScreen");
    else showScreen("homeScreen");
  });

  $("catalogSearch").addEventListener("input", (e) => renderCatalog(e.target.value));
  $("entradaCodigo").addEventListener("input", () => fillProductoFromCode("entrada"));
  $("salidaCodigo").addEventListener("input", () => fillProductoFromCode("salida"));

  $("btnBuscarEntrada").addEventListener("click", () => {
    currentSearchContext = "entrada";
    showScreen("searchScreen");
    $("searchInput").value = "";
    renderSearch("");
  });

  $("btnBuscarSalida").addEventListener("click", () => {
    currentSearchContext = "salida";
    showScreen("searchScreen");
    $("searchInput").value = "";
    renderSearch("");
  });

  $("searchInput").addEventListener("input", (e) => renderSearch(e.target.value));

  $("btnGuardarEntrada").addEventListener("click", saveEntrada);
  $("btnGuardarSalida").addEventListener("click", saveSalida);

  $("tabMov").addEventListener("click", () => setHistTab("mov"));
  $("tabDel").addEventListener("click", () => setHistTab("del"));
  $("histSearch").addEventListener("input", renderHistorial);

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

  const btnClear = $("btnClearFilters");
  if(btnClear){
    btnClear.addEventListener("click", () => {
      filtroDepartamento = "";
      filtroStock = false;

      if(selDep) selDep.value = "";
      if(btnStock) btnStock.classList.remove("active");

      renderCatalog($("catalogSearch")?.value || "");
    });
  }

  // sync silencioso al iniciar
  syncBase(false);
});
