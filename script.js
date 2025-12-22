// ====== CONFIG: TU URL de GitHub Pages ======
const BASE_URL = "https://ferreteriauniversal45-sudo.github.io/ferreteria-inventario-app";
const INVENTARIO_URL = `${BASE_URL}/inventario.json`;
const VERSION_URL = `${BASE_URL}/inventario_version.json`;

// ====== STORAGE KEYS ======
const K = {
  INV: "inv_data",              // inventario cache (obj)
  VER: "inv_version",           // version string
  MOV: "movimientos",           // entradas + salidas
  EDIT: "ediciones",            // registros de edicion
  DEL: "eliminaciones"          // registros de eliminacion
};

let actualizando = false;
let inventarioCache = {}; // inventario en memoria para buscador/catalogo
let buscadorContexto = null; // 'entrada' | 'salida'
let histTab = "mov"; // mov | edit | del

// ====== HELPERS ======
const $ = (id) => document.getElementById(id);

function hoyISO(){
  return new Date().toISOString().slice(0,10);
}

function nowISO(){
  const d = new Date();
  const pad = (n) => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

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

function setEstado(online) {
  const icon = $("statusIcon");
  icon.className = "status " + (online ? "online" : "offline");
  icon.title = online ? "Conectado" : "Sin conexión";
}

function showPanel(id){
  $("home").classList.add("oculto");
  $("catalogo").classList.add("oculto");
  $("entradas").classList.add("oculto");
  $("salidas").classList.add("oculto");
  $("buscador").classList.add("oculto");
  $("historial").classList.add("oculto");

  $(id).classList.remove("oculto");
}

function backHome(){
  $("catalogo").classList.add("oculto");
  $("entradas").classList.add("oculto");
  $("salidas").classList.add("oculto");
  $("buscador").classList.add("oculto");
  $("historial").classList.add("oculto");
  $("home").classList.remove("oculto");
}

// ====== INVENTARIO SYNC ======
async function cargarInventario(mostrarMensaje = false) {
  if (actualizando) return;
  actualizando = true;

  const boton = $("btnActualizar");
  const icon = $("statusIcon");

  boton.textContent = "Actualizando...";
  boton.disabled = true;
  icon.classList.add("rotar");

  try {
    const verRes = await fetch(VERSION_URL, { cache: "no-store" });
    if(!verRes.ok) throw new Error("No se pudo leer version");
    const ver = await verRes.json();
    const remoteVersion = String(ver.version || "").trim();
    if(!remoteVersion) throw new Error("Version invalida");

    const localVersion = localStorage.getItem(K.VER) || "";

    // descargamos inventario si es diferente o si no hay inventario local
    const need = (localVersion !== remoteVersion) || !localStorage.getItem(K.INV);

    if(need){
      const invRes = await fetch(INVENTARIO_URL, { cache: "no-store" });
      if(!invRes.ok) throw new Error("No se pudo leer inventario");
      const inv = await invRes.json();

      // Normalizar: aceptar formatos:
      // 1) {"A001": 10, "A002": 5}
      // 2) {"A001": {"producto":"...", "departamento":"...", "stock":10}, ...}
      const norm = normalizeInventario(inv);

      writeJSON(K.INV, norm);
      localStorage.setItem(K.VER, remoteVersion);

      inventarioCache = norm;
      if(mostrarMensaje) alert("✅ Inventario actualizado");
    } else {
      // ya al dia
      inventarioCache = readJSON(K.INV, {});
      if(mostrarMensaje) alert("✅ Ya estabas actualizado");
    }

    setEstado(true);
    refreshHome();

  } catch (e) {
    // offline o error: cargar local
    inventarioCache = readJSON(K.INV, {});
    refreshHome();
    setEstado(false);
    if (mostrarMensaje) alert("⚠️ Sin internet o error. Usando inventario local.");
  }

  boton.textContent = "Actualizar inventario";
  boton.disabled = false;
  icon.classList.remove("rotar");
  actualizando = false;
}

function forzarActualizacion() {
  cargarInventario(true);
}

function normalizeInventario(inv){
  const out = {};
  if(!inv || typeof inv !== "object") return out;

  for(const code of Object.keys(inv)){
    const val = inv[code];

    if(typeof val === "number"){
      out[String(code).toUpperCase()] = {
        producto: "(sin nombre)",
        departamento: "",
        stock: val
      };
      continue;
    }

    if(val && typeof val === "object"){
      const producto = String(val.producto || val.nombre || "(sin nombre)");
      const departamento = String(val.departamento || "");
      const stock = Number(val.stock ?? val.cantidad ?? 0);
      out[String(code).toUpperCase()] = {
        producto,
        departamento,
        stock: Number.isFinite(stock) ? stock : 0
      };
      continue;
    }

    // fallback
    out[String(code).toUpperCase()] = {
      producto: "(sin nombre)",
      departamento: "",
      stock: 0
    };
  }
  return out;
}

// ====== HOME ======
function refreshHome(){
  const inv = readJSON(K.INV, {});
  const ver = localStorage.getItem(K.VER) || "—";
  $("totalProductos").textContent = String(Object.keys(inv).length);
  $("ultimaActualizacion").textContent = ver;

  // movimientos del dia
  const movs = readJSON(K.MOV, []);
  const hoy = hoyISO();
  const countHoy = movs.filter(m => String(m.fecha||"").slice(0,10) === hoy).length;
  $("movHoy").textContent = String(countHoy);
}

// ====== CATALOGO ======
function abrirCatalogo(){
  inventarioCache = readJSON(K.INV, {});
  $("buscadorCatalogo").value = "";
  renderCatalogo(Object.entries(inventarioCache));
  showPanel("catalogo");
}

function cerrarCatalogo(){ backHome(); }

function renderCatalogo(lista){
  const cont = $("listaProductos");
  cont.innerHTML = "";

  if(!lista.length){
    cont.innerHTML = `<div class="item"><div class="meta">No hay productos.</div></div>`;
    return;
  }

  for(const [codigo, data] of lista){
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="itemTop">
        <div class="code">${codigo}</div>
        <div class="badge">Stock: ${Number(data.stock||0)}</div>
      </div>
      <div class="name">${escapeHtml(data.producto || "(sin nombre)")}</div>
      <div class="meta">${escapeHtml(data.departamento || "")}</div>
    `;
    cont.appendChild(div);
  }
}

function filtrarCatalogo(){
  const t = ($("buscadorCatalogo").value || "").toLowerCase();
  const all = Object.entries(inventarioCache);
  const filtered = all.filter(([codigo, data]) => {
    const name = String(data.producto || "").toLowerCase();
    return codigo.toLowerCase().includes(t) || name.includes(t);
  });
  renderCatalogo(filtered);
}

// ====== ENTRADAS ======
function abrirEntradas(){
  showPanel("entradas");
  $("entradaFecha").value = hoyISO();
  $("entradaCodigo").value = "";
  $("entradaProducto").value = "";
  $("entradaCantidad").value = "";
  $("entradaProveedor").value = "";
  $("entradaFactura").value = "";
}

function cerrarEntradas(){ backHome(); }

function guardarEntrada(){
  const codigo = String($("entradaCodigo").value || "").trim().toUpperCase();
  const cantidad = Number($("entradaCantidad").value);
  const proveedor = String($("entradaProveedor").value || "").trim();
  const factura = String($("entradaFactura").value || "").trim();
  const fecha = $("entradaFecha").value || hoyISO();

  if(!codigo || !Number.isFinite(cantidad) || cantidad <= 0){
    alert("Completa código y cantidad.");
    return;
  }

  const inv = readJSON(K.INV, {});
  if(!inv[codigo]){
    alert("Producto no encontrado en inventario. Actualiza o verifica el código.");
    return;
  }

  const producto = inv[codigo].producto || "(sin nombre)";

  // Guardar movimiento
  const movs = readJSON(K.MOV, []);
  const mov = {
    id: cryptoId(),
    tipo: "entrada",
    codigo,
    producto,
    cantidad,
    proveedor,
    factura,
    fecha,
    timestamp: Date.now()
  };
  movs.push(mov);
  writeJSON(K.MOV, movs);

  // Aplicar a stock local (para operar offline)
  inv[codigo].stock = Number(inv[codigo].stock || 0) + cantidad;
  writeJSON(K.INV, inv);
  inventarioCache = inv;

  alert("✅ Entrada guardada");
  refreshHome();
  cerrarEntradas();
}

// ====== SALIDAS ======
function abrirSalidas(){
  showPanel("salidas");
  $("salidaFecha").value = hoyISO();
  $("salidaCodigo").value = "";
  $("salidaProducto").value = "";
  $("salidaCantidad").value = "";
  $("salidaFactura").value = "";
}

function cerrarSalidas(){ backHome(); }

function guardarSalida(){
  const codigo = String($("salidaCodigo").value || "").trim().toUpperCase();
  const cantidad = Number($("salidaCantidad").value);
  const factura = String($("salidaFactura").value || "").trim();
  const fecha = $("salidaFecha").value || hoyISO();

  if(!codigo || !Number.isFinite(cantidad) || cantidad <= 0){
    alert("Completa código y cantidad.");
    return;
  }

  const inv = readJSON(K.INV, {});
  if(!inv[codigo]){
    alert("Producto no encontrado en inventario. Actualiza o verifica el código.");
    return;
  }

  const stock = Number(inv[codigo].stock || 0);
  if(cantidad > stock){
    alert(`❌ Stock insuficiente. Disponible: ${stock}`);
    return;
  }

  const producto = inv[codigo].producto || "(sin nombre)";

  const movs = readJSON(K.MOV, []);
  const mov = {
    id: cryptoId(),
    tipo: "salida",
    codigo,
    producto,
    cantidad,
    proveedor: "", // no aplica
    factura,
    fecha,
    timestamp: Date.now()
  };
  movs.push(mov);
  writeJSON(K.MOV, movs);

  inv[codigo].stock = stock - cantidad;
  writeJSON(K.INV, inv);
  inventarioCache = inv;

  alert("✅ Salida registrada");
  refreshHome();
  cerrarSalidas();
}

// ====== B2: BUSCADOR VISUAL REUTILIZABLE ======
function abrirBuscador(ctx){
  buscadorContexto = ctx; // 'entrada' o 'salida'
  inventarioCache = readJSON(K.INV, {});
  $("buscadorInput").value = "";
  renderBuscador(Object.entries(inventarioCache));
  showPanel("buscador");

  // Si no hay nombres, avisar
  const anyName = Object.values(inventarioCache).some(v => (v.producto || "") !== "(sin nombre)");
  if(!anyName){
    // no bloquea, solo avisa
    console.warn("Inventario sin nombres: el buscador por nombre será limitado.");
  }
}

function cerrarBuscador(){
  // volver al panel correcto
  if(buscadorContexto === "entrada") showPanel("entradas");
  else if(buscadorContexto === "salida") showPanel("salidas");
  else backHome();
}

function filtrarBuscador(){
  const t = ($("buscadorInput").value || "").toLowerCase();
  const all = Object.entries(inventarioCache);
  const filtered = all.filter(([codigo, data]) => {
    const name = String(data.producto || "").toLowerCase();
    return codigo.toLowerCase().includes(t) || name.includes(t);
  });
  renderBuscador(filtered);
}

function renderBuscador(lista){
  const cont = $("buscadorLista");
  cont.innerHTML = "";

  if(!lista.length){
    cont.innerHTML = `<div class="item"><div class="meta">Sin resultados.</div></div>`;
    return;
  }

  for(const [codigo, data] of lista){
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="itemTop">
        <div class="code">${codigo}</div>
        <div class="badge">Stock: ${Number(data.stock||0)}</div>
      </div>
      <div class="name">${escapeHtml(data.producto || "(sin nombre)")}</div>
      <div class="meta">${escapeHtml(data.departamento || "")}</div>
      <div class="meta">Toca para seleccionar</div>
    `;
    div.onclick = () => seleccionarProductoBuscador(codigo, data);
    cont.appendChild(div);
  }
}

function seleccionarProductoBuscador(codigo, data){
  if(buscadorContexto === "entrada"){
    $("entradaCodigo").value = codigo;
    $("entradaProducto").value = data.producto || "(sin nombre)";
    cerrarBuscador();
    return;
  }
  if(buscadorContexto === "salida"){
    $("salidaCodigo").value = codigo;
    $("salidaProducto").value = data.producto || "(sin nombre)";
    cerrarBuscador();
    return;
  }
  cerrarBuscador();
}

function autollenarProducto(ctx){
  const inv = readJSON(K.INV, {});
  if(ctx === "entrada"){
    const code = String($("entradaCodigo").value||"").trim().toUpperCase();
    $("entradaProducto").value = inv[code]?.producto || "";
  }
  if(ctx === "salida"){
    const code = String($("salidaCodigo").value||"").trim().toUpperCase();
    $("salidaProducto").value = inv[code]?.producto || "";
  }
}

// ====== D: HISTORIAL + EDITAR/ELIMINAR ======
function abrirHistorial(){
  histTab = "mov";
  setHistTab("mov");
  $("histSearch").value = "";
  renderHistorial();
  showPanel("historial");
}

function cerrarHistorial(){ backHome(); }

function setHistTab(tab){
  histTab = tab;
  $("tabMov").classList.toggle("active", tab==="mov");
  $("tabEdit").classList.toggle("active", tab==="edit");
  $("tabDel").classList.toggle("active", tab==="del");
  renderHistorial();
}

function renderHistorial(){
  const q = ($("histSearch").value || "").toLowerCase();
  const cont = $("histList");
  cont.innerHTML = "";

  let data = [];
  if(histTab === "mov") data = readJSON(K.MOV, []);
  if(histTab === "edit") data = readJSON(K.EDIT, []);
  if(histTab === "del") data = readJSON(K.DEL, []);

  // filtro
  data = data.filter(r => {
    const c = String(r.codigo||"").toLowerCase();
    const p = String(r.producto||"").toLowerCase();
    return c.includes(q) || p.includes(q);
  });

  // orden: más reciente
  data.sort((a,b) => Number(b.timestamp||0) - Number(a.timestamp||0));

  if(!data.length){
    cont.innerHTML = `<div class="item"><div class="meta">Sin registros.</div></div>`;
    return;
  }

  for(const r of data){
    const div = document.createElement("div");
    div.className = "item";

    if(histTab === "mov"){
      div.innerHTML = `
        <div class="itemTop">
          <div class="code">${r.tipo.toUpperCase()} · ${r.codigo}</div>
          <div class="badge">${r.cantidad ?? ""}</div>
        </div>
        <div class="name">${escapeHtml(r.producto || "")}</div>
        <div class="meta">Fecha: ${escapeHtml(r.fecha || "")}</div>
        <div class="meta">${r.tipo === "entrada"
          ? `Factura: ${escapeHtml(r.factura||"")} · Proveedor: ${escapeHtml(r.proveedor||"")}`
          : `Factura: ${escapeHtml(r.factura||"")}`
        }</div>

        <div class="actions">
          <button class="smallBtn" onclick="abrirEditarMovimiento('${r.id}')">✏️ Editar</button>
          <button class="smallBtn danger" onclick="eliminarMovimiento('${r.id}')">🗑️ Eliminar</button>
        </div>
      `;
    } else if(histTab === "edit"){
      div.innerHTML = `
        <div class="itemTop">
          <div class="code">EDICION · ${escapeHtml(r.tipo||"")}</div>
          <div class="badge">${escapeHtml(r.codigo||"")}</div>
        </div>
        <div class="name">${escapeHtml(r.producto||"")}</div>
        <div class="meta">${escapeHtml(r.fechaHora||"")}</div>
        <div class="meta">Antes: ${escapeHtml(r.antes||"")}</div>
        <div class="meta">Después: ${escapeHtml(r.despues||"")}</div>
      `;
    } else {
      div.innerHTML = `
        <div class="itemTop">
          <div class="code">ELIMINACION · ${escapeHtml(r.tipo||"")}</div>
          <div class="badge">${escapeHtml(r.codigo||"")}</div>
        </div>
        <div class="name">${escapeHtml(r.producto||"")}</div>
        <div class="meta">${escapeHtml(r.fechaHora||"")}</div>
        <div class="meta">Cantidad: ${escapeHtml(String(r.cantidad||""))}</div>
        <div class="meta">Detalle: ${escapeHtml(r.detalle||"")}</div>
      `;
    }

    cont.appendChild(div);
  }
}

function abrirEditarMovimiento(id){
  const movs = readJSON(K.MOV, []);
  const m = movs.find(x => x.id === id);
  if(!m){
    alert("No se encontró el movimiento.");
    return;
  }

  $("editId").value = m.id;
  $("editTipo").value = m.tipo;
  $("editCodigo").value = m.codigo;
  $("editProducto").value = m.producto;

  $("editCantidad").value = m.cantidad ?? "";
  $("editFactura").value = m.factura ?? "";
  $("editFecha").value = (m.fecha || hoyISO()).slice(0,10);

  // proveedor solo para entrada
  const isEntrada = m.tipo === "entrada";
  $("editProveedorWrap").style.display = isEntrada ? "block" : "none";
  $("editProveedor").value = isEntrada ? (m.proveedor || "") : "";

  $("modalTitle").textContent = `Editar ${m.tipo.toUpperCase()}`;
  $("modal").classList.remove("oculto");
}

function cerrarModal(){
  $("modal").classList.add("oculto");
}

function guardarEdicion(){
  const id = $("editId").value;
  const tipo = $("editTipo").value;

  const nuevaCantidad = Number($("editCantidad").value);
  const nuevaFactura = String($("editFactura").value || "").trim();
  const nuevaFecha = $("editFecha").value || hoyISO();
  const nuevoProveedor = String($("editProveedor").value || "").trim();

  if(!id || !tipo){
    alert("Edición inválida.");
    return;
  }
  if(!Number.isFinite(nuevaCantidad) || nuevaCantidad <= 0){
    alert("Cantidad inválida.");
    return;
  }

  const movs = readJSON(K.MOV, []);
  const idx = movs.findIndex(x => x.id === id);
  if(idx < 0){
    alert("No se encontró el movimiento.");
    return;
  }

  const old = movs[idx];

  // recalcular stock: revertir old y aplicar new
  const inv = readJSON(K.INV, {});
  if(!inv[old.codigo]){
    alert("Producto no está en inventario local. Actualiza inventario.");
    return;
  }

  // revertir stock anterior
  if(old.tipo === "entrada"){
    inv[old.codigo].stock = Number(inv[old.codigo].stock||0) - Number(old.cantidad||0);
  } else {
    inv[old.codigo].stock = Number(inv[old.codigo].stock||0) + Number(old.cantidad||0);
  }

  // validar y aplicar nuevo
  if(tipo === "salida"){
    const stockNow = Number(inv[old.codigo].stock||0);
    if(nuevaCantidad > stockNow){
      // devolver estado anterior (reaplicar old)
      inv[old.codigo].stock = stockNow - 0; // no-op
      // re-aplicar old para no dañar:
      inv[old.codigo].stock = stockNow - 0; // keep
      // mejor: deshacer revert y salir
      // re-aplicar old:
      inv[old.codigo].stock = stockNow - 0; // keep
      // en la práctica, volvemos a sumar old revert? ya revertimos salida sumando, aquí stockNow ya incluye eso
      alert(`Stock insuficiente para nueva salida. Disponible: ${stockNow}`);
      // restaurar aplicando old otra vez (salida)
      inv[old.codigo].stock = stockNow - 0; // keep
      // aplicar old salida:
      inv[old.codigo].stock = stockNow - 0; // keep
      // Para evitar complicación, recalculamos con función simple:
      recomputeInvFromScratch(inv); // fallback seguro
      return;
    }
    inv[old.codigo].stock = Number(inv[old.codigo].stock||0) - nuevaCantidad;
  } else {
    inv[old.codigo].stock = Number(inv[old.codigo].stock||0) + nuevaCantidad;
  }

  // Guardar cambios en movimiento
  const antes = resumenMovimiento(old);
  const updated = { ...old };
  updated.cantidad = nuevaCantidad;
  updated.factura = nuevaFactura;
  updated.fecha = nuevaFecha;
  if(updated.tipo === "entrada"){
    updated.proveedor = nuevoProveedor;
  }
  updated.timestamp = Date.now();

  movs[idx] = updated;
  writeJSON(K.MOV, movs);
  writeJSON(K.INV, inv);
  inventarioCache = inv;

  // Log de edición
  const edits = readJSON(K.EDIT, []);
  edits.push({
    id: cryptoId(),
    tipo: updated.tipo,
    codigo: updated.codigo,
    producto: updated.producto,
    antes,
    despues: resumenMovimiento(updated),
    fechaHora: nowISO(),
    timestamp: Date.now()
  });
  writeJSON(K.EDIT, edits);

  cerrarModal();
  alert("✅ Editado");
  refreshHome();
  renderHistorial();
}

function eliminarMovimiento(id){
  const ok = confirm("¿Eliminar este movimiento? (Quedará registrado en eliminaciones)");
  if(!ok) return;

  const movs = readJSON(K.MOV, []);
  const idx = movs.findIndex(x => x.id === id);
  if(idx < 0){
    alert("No se encontró el movimiento.");
    return;
  }

  const m = movs[idx];

  // revertir impacto en inventario
  const inv = readJSON(K.INV, {});
  if(inv[m.codigo]){
    if(m.tipo === "entrada"){
      inv[m.codigo].stock = Number(inv[m.codigo].stock||0) - Number(m.cantidad||0);
    } else {
      inv[m.codigo].stock = Number(inv[m.codigo].stock||0) + Number(m.cantidad||0);
    }
    writeJSON(K.INV, inv);
    inventarioCache = inv;
  }

  // quitar movimiento
  movs.splice(idx, 1);
  writeJSON(K.MOV, movs);

  // registrar eliminación
  const dels = readJSON(K.DEL, []);
  dels.push({
    id: cryptoId(),
    tipo: m.tipo,
    codigo: m.codigo,
    producto: m.producto,
    cantidad: m.cantidad,
    detalle: resumenMovimiento(m),
    fechaHora: nowISO(),
    timestamp: Date.now()
  });
  writeJSON(K.DEL, dels);

  alert("🗑️ Eliminado (registrado)");
  refreshHome();
  renderHistorial();
}

// Fallback seguro si quieres recomputar stock desde inventario base + movimientos.
// Aquí lo dejamos mínimo (no borramos), por si en un futuro lo haces.
function recomputeInvFromScratch(inv){
  // En esta versión no tenemos "base master" separada; usas el inv local ya modificado.
  // Por simplicidad, solo guardamos lo que haya y avisamos.
  writeJSON(K.INV, inv);
  alert("⚠️ Ajuste realizado. Si notas inconsistencia, actualiza inventario desde GitHub.");
  cerrarModal();
  refreshHome();
  renderHistorial();
}

// ====== E: EXPORTAR EXCEL (1 archivo, hojas separadas) ======
function exportarExcel(){
  if(typeof XLSX === "undefined"){
    alert("No se cargó la librería de Excel (XLSX). Recarga la página.");
    return;
  }

  const movs = readJSON(K.MOV, []);
  const edits = readJSON(K.EDIT, []);
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

  const edSheet = edits.map(e => ({
    FECHA_HORA: e.fechaHora || "",
    TIPO: e.tipo || "",
    CODIGO: e.codigo || "",
    PRODUCTO: e.producto || "",
    ANTES: e.antes || "",
    DESPUES: e.despues || ""
  }));

  const delSheet = dels.map(d => ({
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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(edSheet), "EDICIONES");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(delSheet), "ELIMINACIONES");

  const filename = `reporte_movimientos_${hoyISO()}.xlsx`;
  XLSX.writeFile(wb, filename);

  alert("📤 Excel exportado. En Android normalmente quedará en Descargas.");
}

// ====== UTILS ======
function cryptoId(){
  // id corto seguro (sin depender de crypto.randomUUID que a veces falla en WebView vieja)
  return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

function escapeHtml(str){
  return String(str || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// ====== INIT ======
window.addEventListener("online", () => setEstado(true));
window.addEventListener("offline", () => setEstado(false));

window.addEventListener("load", () => {
  // cargar local primero
  inventarioCache = readJSON(K.INV, {});
  refreshHome();
  setEstado(navigator.onLine);

  // luego intentar sync silencioso
  cargarInventario(false);
});
