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
  BASE: "fu_base_inv",         // Inventario base descargado (obj por código)
  VER: "fu_base_ver",          // Versión descargada (string)
  MOV: "fu_movimientos",       // Movimientos (entradas+salidas)
  DEL: "fu_eliminaciones"      // Eliminaciones (log)
};

const $ = (id) => document.getElementById(id);

let currentSearchContext = null; // "entrada" | "salida"
let historialTab = "mov";        // "mov" | "del"

// cache para rendimiento
let baseCache = {};
let deltaDirty = true;
let deltaCache = { ent: {}, sal: {} };

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
  toastTimer = setTimeout(() => t.classList.remove("show"), 1500);
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
// Acepta:
// 1) {"A001": 10}
// 2) {"A001": {"producto":"Martillo","departamento":"Herr","stock":10}}
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
// DELTAS (entradas/salidas)
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
// SYNC INVENTARIO BASE
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
      // no tocamos movimientos: así NO pierdes lo que registraste
      if(showMsg) toast("✅ Inventario actualizado");
    }else{
      baseCache = readJSON(K.BASE, {});
      if(showMsg) toast("✅ Ya estabas actualizado");
    }

    setNetworkState(true);
    refreshHome();

  }catch(err){
    // offline o error: usar local
    baseCache = readJSON(K.BASE, {});
    setNetworkState(navigator.onLine);
    refreshHome();
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

  // movimientos del día
  const movs = readJSON(K.MOV, []);
  const h = todayISO();
  const movHoy = movs.filter(m => String(m.fecha||"").slice(0,10) === h).length;
  $("homeMovHoy").textContent = String(movHoy);
}

// ==========================
// CATALOGO
// ==========================
function renderCatalog(query){
  const list = $("catalogList");
  const info = $("catalogInfo");
  list.innerHTML = "";

  const q = (query || "").toLowerCase().trim();
  const entries = Object.entries(baseCache || {});
  const total = entries.length;

  // performance: si hay muchos productos, pedir 2 caracteres
  if(total > 500 && q.length < 2){
    info.textContent = "Escribe al menos 2 letras/números para buscar (catálogo grande).";
    return;
  }
  info.textContent = total > 0 ? "" : "No hay inventario cargado. Pulsa 'Actualizar inventario'.";

  const filtered = entries.filter(([code, data]) => {
    const name = String(data.producto||"").toLowerCase();
    return code.toLowerCase().includes(q) || name.includes(q);
  });

  if(filtered.length === 0){
    list.innerHTML = `<div class="item"><div class="meta">Sin resultados.</div></div>`;
    return;
  }

  // limitar render si es enorme
  const show = filtered.slice(0, 250);

  for(const [code, data] of show){
    const stock = getStock(code);
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="item-top">
        <div class="code">${escapeHtml(code)}</div>
        <div class="badge">Stock: ${escapeHtml(String(stock))}</div>
      </div>
      <div class="name">${escapeHtml(data.producto || "(sin nombre)")}</div>
      <div class="meta">${escapeHtml(data.departamento || "")}</div>
    `;
    list.appendChild(el);
  }

  if(filtered.length > show.length){
    const more = document.createElement("div");
    more.className = "note";
    more.textContent = `Mostrando ${show.length} de ${filtered.length}. Sigue escribiendo para filtrar más.`;
    list.appendChild(more);
  }
}

// ==========================
// BUSCADOR (B2)
// ==========================
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
  info.textContent = "";

  const filtered = entries.filter(([code, data]) => {
    const name = String(data.producto||"").toLowerCase();
    return code.toLowerCase().includes(q) || name.includes(q);
  });

  if(filtered.length === 0){
    list.innerHTML = `<div class="item"><div class="meta">Sin resultados.</div></div>`;
    return;
  }

  const show = filtered.slice(0, 250);

  for(const [code, data] of show){
    const stock = getStock(code);
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="item-top">
        <div class="code">${escapeHtml(code)}</div>
        <div class="badge">Stock: ${escapeHtml(String(stock))}</div>
      </div>
      <div class="name">${escapeHtml(data.producto || "(sin nombre)")}</div>
      <div class="meta">${escapeHtml(data.departamento || "")}</div>
      <div class="meta">Toca para seleccionar</div>
    `;
    el.addEventListener("click", () => {
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
    });
    list.appendChild(el);
  }

  if(filtered.length > show.length){
    const more = document.createElement("div");
    more.className = "note";
    more.textContent = `Mostrando ${show.length} de ${filtered.length}. Sigue escribiendo para filtrar más.`;
    list.appendChild(more);
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
// HISTORIAL (D) + ELIMINAR
// ==========================
function setHistTab(tab){
  historialTab = tab;
  $("tabMov").classList.toggle("active", tab === "mov");
  $("tabDel").classList.toggle("active", tab === "del");
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
      list.innerHTML = `<div class="item"><div class="meta">Sin movimientos.</div></div>`;
      return;
    }

    for(const m of filtered){
      const el = document.createElement("div");
      el.className = "item";
      const badge = m.tipo === "entrada" ? "ENTRADA" : "SALIDA";
      const detail = m.tipo === "entrada"
        ? `Factura: ${escapeHtml(m.factura||"")} · Proveedor: ${escapeHtml(m.proveedor||"")}`
        : `Factura: ${escapeHtml(m.factura||"")}`;

      el.innerHTML = `
        <div class="item-top">
          <div class="code">${badge} · ${escapeHtml(m.codigo||"")}</div>
          <div class="badge">${escapeHtml(String(m.cantidad||0))}</div>
        </div>
        <div class="name">${escapeHtml(m.producto||"")}</div>
        <div class="meta">Fecha: ${escapeHtml(m.fecha||"")}</div>
        <div class="meta">${detail}</div>
        <div style="margin-top:10px;">
          <button class="btn danger" type="button" data-del="${escapeHtml(m.id)}">🗑️ Eliminar</button>
        </div>
      `;

      el.querySelector("[data-del]").addEventListener("click", () => deleteMovimiento(m.id));
      list.appendChild(el);
    }

    return;
  }

  // eliminaciones
  const dels = readJSON(K.DEL, []).slice().sort((a,b) => (b.timestamp||0)-(a.timestamp||0));
  const filtered = dels.filter(d => {
    const c = String(d.codigo||"").toLowerCase();
    const p = String(d.producto||"").toLowerCase();
    return c.includes(q) || p.includes(q);
  });

  if(filtered.length === 0){
    list.innerHTML = `<div class="item"><div class="meta">Sin eliminaciones.</div></div>`;
    return;
  }

  for(const d of filtered){
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="item-top">
        <div class="code">ELIMINADO · ${escapeHtml(d.tipo||"")}</div>
        <div class="badge">${escapeHtml(d.codigo||"")}</div>
      </div>
      <div class="name">${escapeHtml(d.producto||"")}</div>
      <div class="meta">${escapeHtml(d.fechaHora||"")}</div>
      <div class="meta">Cantidad: ${escapeHtml(String(d.cantidad||0))}</div>
      <div class="meta">${escapeHtml(d.detalle||"")}</div>
    `;
    list.appendChild(el);
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
// EXPORT EXCEL (E)
// 1 archivo, 4 hojas: ENTRADAS, SALIDAS, EDICIONES (vacía), ELIMINACIONES
// ==========================
function exportExcel(){
  if(typeof XLSX === "undefined"){
    toast("No cargó Excel (XLSX). Abre con internet una vez y recarga.");
    return;
  }

  const movs = readJSON(K.MOV, []);
  const dels = readJSON(K.DEL, []);

  const entradas = movs.filter(m => m.tipo === "entrada").map(m => ({
    FECHA: m.fecha || "",
    CODIGO: m.codigo || "",
    PRODUCTO: m.producto || "",
    CANTIDAD: m.cantidad || 0,
    FACTURA: m.factura || "",
    PROVEEDOR: m.proveedor || ""
  }));

  const salidas = movs.filter(m => m.tipo === "salida").map(m => ({
    FECHA: m.fecha || "",
    CODIGO: m.codigo || "",
    PRODUCTO: m.producto || "",
    CANTIDAD: m.cantidad || 0,
    FACTURA: m.factura || ""
  }));

  // EDICIONES: no aplica (sin editar)
  const ediciones = [{
    NOTA: "Edición deshabilitada en esta versión. Hoja reservada."
  }];

  const eliminaciones = dels.map(d => ({
    FECHA_HORA: d.fechaHora || "",
    TIPO: d.tipo || "",
    CODIGO: d.codigo || "",
    PRODUCTO: d.producto || "",
    CANTIDAD: d.cantidad || 0,
    DETALLE: d.detalle || ""
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entradas), "ENTRADAS");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salidas), "SALIDAS");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ediciones), "EDICIONES");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(eliminaciones), "ELIMINACIONES");

  const filename = `reporte_movimientos_${todayISO()}.xlsx`;
  XLSX.writeFile(wb, filename);

  toast("📤 Excel exportado");
}

// ==========================
// INIT + EVENTS
// ==========================
document.addEventListener("DOMContentLoaded", () => {
  // cargar inventario base local
  baseCache = readJSON(K.BASE, {});
  setNetworkState(navigator.onLine);
  refreshHome();
  showScreen("homeScreen");

  // default fechas
  $("entradaFecha").value = todayISO();
  $("salidaFecha").value = todayISO();

  // botones home
  $("btnSync").addEventListener("click", () => syncBase(true));
  $("btnExport").addEventListener("click", exportExcel);

  $("btnCatalogo").addEventListener("click", () => {
    showScreen("catalogScreen");
    $("catalogSearch").value = "";
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
    setHistTab("mov");
    $("histSearch").value = "";
    renderHistorial();
  });

  // back buttons
  $("btnBackCatalog").addEventListener("click", () => showScreen("homeScreen"));
  $("btnBackEntrada").addEventListener("click", () => showScreen("homeScreen"));
  $("btnBackSalida").addEventListener("click", () => showScreen("homeScreen"));
  $("btnBackSearch").addEventListener("click", () => {
    if(currentSearchContext === "entrada") showScreen("entradaScreen");
    else if(currentSearchContext === "salida") showScreen("salidaScreen");
    else showScreen("homeScreen");
  });
  $("btnBackHistorial").addEventListener("click", () => showScreen("homeScreen"));

  // catalog input
  $("catalogSearch").addEventListener("input", (e) => renderCatalog(e.target.value));

  // entrada/salida typing
  $("entradaCodigo").addEventListener("input", () => fillProductoFromCode("entrada"));
  $("salidaCodigo").addEventListener("input", () => fillProductoFromCode("salida"));

  // buscador buttons
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

  // guardar
  $("btnGuardarEntrada").addEventListener("click", saveEntrada);
  $("btnGuardarSalida").addEventListener("click", saveSalida);

  // historial tabs
  $("tabMov").addEventListener("click", () => setHistTab("mov"));
  $("tabDel").addEventListener("click", () => setHistTab("del"));
  $("histSearch").addEventListener("input", renderHistorial);

  // sync silencioso al iniciar
  syncBase(false);
});
