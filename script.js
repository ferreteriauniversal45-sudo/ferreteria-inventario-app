document.addEventListener("DOMContentLoaded", () => {
  // =========================
  // STORAGE KEYS
  // =========================
  const S = {
    CATALOG: "fu_catalog",
    LAST_SYNC: "fu_catalog_last_sync",
    ENTRADAS: "fu_entradas",
    SALIDAS: "fu_salidas",
    INICIAL: "fu_inicial"
  };

  // =========================
  // DOM HELPERS
  // =========================
  const $ = (id) => document.getElementById(id);

  const screens = [
    "homeScreen",
    "catalogScreen",
    "entradaScreen",
    "salidaScreen",
    "inventarioScreen",
    "productSearchScreen"
  ];

  function showScreen(screenId){
    for (const id of screens){
      $(id).classList.toggle("hidden", id !== screenId);
    }
  }

  // =========================
  // TOAST
  // =========================
  let toastTimer = null;
  function toast(msg){
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1400);
  }

  // =========================
  // JSON STORAGE
  // =========================
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

  // =========================
  // NETWORK ICON
  // =========================
  function updateNetworkStatus(){
    const icon = $("netIcon");
    if (navigator.onLine){
      icon.classList.remove("offline");
      icon.classList.add("online");
      icon.title = "Conectado a internet";
    } else {
      icon.classList.remove("online");
      icon.classList.add("offline");
      icon.title = "Sin conexión";
    }
  }
  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);
  updateNetworkStatus();

  // Click en icono (solo informativo)
  $("netIcon").addEventListener("click", () => {
    toast(navigator.onLine ? "Online" : "Offline");
  });

  // =========================
  // DATA ACCESS
  // =========================
  function getCatalog(){ return readJSON(S.CATALOG, []); }
  function getEntradas(){ return readJSON(S.ENTRADAS, []); }
  function getSalidas(){ return readJSON(S.SALIDAS, []); }
  function getInicial(){ return readJSON(S.INICIAL, {}); }

  function normalizeCode(code){
    return (code || "").trim().toUpperCase();
  }

  function findProductByCode(code){
    const c = normalizeCode(code);
    return getCatalog().find(p => normalizeCode(p.codigo) === c) || null;
  }

  function sumByCode(movs){
    const map = {};
    for (const m of movs){
      const code = normalizeCode(m.codigo);
      const qty = Number(m.cantidad || 0);
      if (!code || !Number.isFinite(qty)) continue;
      map[code] = (map[code] || 0) + qty;
    }
    return map;
  }

  function computeStock(code){
    const c = normalizeCode(code);

    const inicial = getInicial();
    const ini = Number(inicial[c] || 0);

    const entMap = sumByCode(getEntradas());
    const salMap = sumByCode(getSalidas());

    const ent = Number(entMap[c] || 0);
    const sal = Number(salMap[c] || 0);
    const stock = ini + ent - sal;

    return { ini, ent, sal, stock };
  }

  // =========================
  // HOME STATUS
  // =========================
  function updateHome(){
    const catalog = getCatalog();
    const inicial = getInicial();
    const entradas = getEntradas();
    const salidas = getSalidas();

    $("homeCatalogCount").textContent = String(catalog.length);
    $("homeInicialCount").textContent = String(Object.keys(inicial).length);
    $("homeEntradaCount").textContent = String(entradas.length);
    $("homeSalidaCount").textContent = String(salidas.length);

    const last = localStorage.getItem(S.LAST_SYNC);
    $("homeLastSync").textContent = last || "—";
  }

  // =========================
  // DEMO + RESET
  // =========================
  $("btnDemo").addEventListener("click", () => {
    const demoCatalog = [
      { codigo:"A001", producto:"Martillo", departamento:"Herramientas" },
      { codigo:"A002", producto:"Clavos", departamento:"Ferretería" },
      { codigo:"A003", producto:"Pintura Blanca", departamento:"Pinturas" },
      { codigo:"A004", producto:"Cinta Métrica", departamento:"Herramientas" }
    ];

    const demoInicial = {
      A001: 10,
      A002: 200,
      A003: 25,
      A004: 15
    };

    writeJSON(S.CATALOG, demoCatalog);
    writeJSON(S.INICIAL, demoInicial);

    localStorage.setItem(S.LAST_SYNC, new Date().toLocaleString("es-ES"));

    updateHome();
    toast("Demo cargada");
  });

  $("btnReset").addEventListener("click", () => {
    const ok = confirm("¿Seguro que deseas borrar catálogo, inicial, entradas y salidas del teléfono?");
    if(!ok) return;

    localStorage.removeItem(S.CATALOG);
    localStorage.removeItem(S.INICIAL);
    localStorage.removeItem(S.ENTRADAS);
    localStorage.removeItem(S.SALIDAS);
    localStorage.removeItem(S.LAST_SYNC);

    updateHome();
    toast("Datos borrados");
    showScreen("homeScreen");
  });

  // =========================
  // NAVIGATION
  // =========================
  $("btnCatalogo").addEventListener("click", () => {
    showScreen("catalogScreen");
    $("catalogSearchInput").value = "";
    renderCatalog("");
  });

  $("btnBackFromCatalog").addEventListener("click", () => {
    showScreen("homeScreen");
  });

  $("btnEntrada").addEventListener("click", () => {
    showScreen("entradaScreen");
    setTodayIfEmpty("entradaFecha");
    // refresca producto si ya hay código
    fillProductoFromCode("entradaCodigo", "entradaProducto");
  });

  $("btnVolverEntrada").addEventListener("click", () => {
    showScreen("homeScreen");
  });

  $("btnSalida").addEventListener("click", () => {
    showScreen("salidaScreen");
    setTodayIfEmpty("salidaFecha");
    fillProductoFromCode("salidaCodigo", "salidaProducto");
  });

  $("btnVolverSalida").addEventListener("click", () => {
    showScreen("homeScreen");
  });

  $("btnInventario").addEventListener("click", () => {
    showScreen("inventarioScreen");
    $("inventarioSearchInput").value = "";
    renderInventario("");
  });

  $("btnVolverInventario").addEventListener("click", () => {
    showScreen("homeScreen");
  });

  // =========================
  // CATALOG SCREEN
  // =========================
  function renderCatalog(filter){
    const list = $("catalogList");
    const catalog = getCatalog();
    const f = (filter || "").toLowerCase();

    const filtered = catalog.filter(p => {
      const code = (p.codigo || "").toLowerCase();
      const name = (p.producto || "").toLowerCase();
      return code.includes(f) || name.includes(f);
    });

    list.innerHTML = "";

    if(filtered.length === 0){
      list.innerHTML = `<div class="item"><div class="dept">No hay productos (o no coincide la búsqueda).</div></div>`;
      return;
    }

    for (const p of filtered){
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div class="item-top">
          <div class="code">${p.codigo}</div>
          <div class="badge">${p.departamento || ""}</div>
        </div>
        <div class="name">${p.producto || ""}</div>
      `;
      list.appendChild(el);
    }
  }

  $("catalogSearchInput").addEventListener("input", (e) => {
    renderCatalog(e.target.value);
  });

  // =========================
  // PRODUCT SEARCH (GLOBAL)
  // =========================
  let searchContext = null; // { returnScreen, codeId, productId }

  function openProductSearch(ctx){
    searchContext = ctx;

    showScreen("productSearchScreen");
    $("productSearchInput").value = "";
    renderProductSearch("");
    $("productSearchInput").focus();
  }

  function closeProductSearch(){
    if(!searchContext){
      showScreen("homeScreen");
      return;
    }
    showScreen(searchContext.returnScreen);
  }

  $("btnCloseSearch").addEventListener("click", closeProductSearch);

  function renderProductSearch(filter){
    const list = $("productSearchList");
    const catalog = getCatalog();
    const f = (filter || "").toLowerCase();

    const filtered = catalog.filter(p => {
      const code = (p.codigo || "").toLowerCase();
      const name = (p.producto || "").toLowerCase();
      return code.includes(f) || name.includes(f);
    });

    list.innerHTML = "";

    if(filtered.length === 0){
      list.innerHTML = `<div class="item"><div class="dept">Sin resultados.</div></div>`;
      return;
    }

    for (const p of filtered){
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div class="item-top">
          <div class="code">${p.codigo}</div>
          <div class="badge">${p.departamento || ""}</div>
        </div>
        <div class="name">${p.producto || ""}</div>
        <div class="dept">Toca para seleccionar</div>
      `;
      el.addEventListener("click", () => {
        if(!searchContext) return;

        $(searchContext.codeId).value = p.codigo;
        $(searchContext.productId).value = p.producto || "";

        toast("Producto seleccionado");
        closeProductSearch();
      });

      list.appendChild(el);
    }
  }

  $("productSearchInput").addEventListener("input", (e) => {
    renderProductSearch(e.target.value);
  });

  // Botones de buscador en Entrada/Salida
  $("btnBuscarEntrada").addEventListener("click", () => {
    openProductSearch({
      returnScreen: "entradaScreen",
      codeId: "entradaCodigo",
      productId: "entradaProducto"
    });
  });

  $("btnBuscarSalida").addEventListener("click", () => {
    openProductSearch({
      returnScreen: "salidaScreen",
      codeId: "salidaCodigo",
      productId: "salidaProducto"
    });
  });

  // =========================
  // AUTO-FILL PRODUCT FROM CODE
  // =========================
  function fillProductoFromCode(codeInputId, productInputId){
    const code = normalizeCode($(codeInputId).value);
    if(!code){
      $(productInputId).value = "";
      return;
    }
    const p = findProductByCode(code);
    $(productInputId).value = p ? (p.producto || "") : "";
  }

  $("entradaCodigo").addEventListener("input", () => fillProductoFromCode("entradaCodigo", "entradaProducto"));
  $("salidaCodigo").addEventListener("input", () => fillProductoFromCode("salidaCodigo", "salidaProducto"));

  function setTodayIfEmpty(dateInputId){
    const el = $(dateInputId);
    if(el && !el.value){
      el.value = new Date().toISOString().slice(0,10);
    }
  }

  // =========================
  // SAVE ENTRADA
  // =========================
  $("btnGuardarEntrada").addEventListener("click", () => {
    const code = normalizeCode($("entradaCodigo").value);
    const cantidad = Number($("entradaCantidad").value);
    const factura = ($("entradaFactura").value || "").trim();
    const proveedor = ($("entradaProveedor").value || "").trim();
    const fecha = $("entradaFecha").value;

    if(!code || !Number.isFinite(cantidad) || cantidad <= 0 || !factura || !proveedor || !fecha){
      toast("Completa todos los campos");
      return;
    }

    const prod = findProductByCode(code);
    if(!prod){
      toast("Código no existe en catálogo");
      return;
    }

    const entradas = getEntradas();
    entradas.push({
      codigo: code,
      producto: prod.producto || "",
      cantidad,
      factura,
      proveedor,
      fecha,
      ts: Date.now()
    });
    writeJSON(S.ENTRADAS, entradas);

    // limpiar
    $("entradaCodigo").value = "";
    $("entradaProducto").value = "";
    $("entradaCantidad").value = "";
    $("entradaFactura").value = "";
    $("entradaProveedor").value = "";
    setTodayIfEmpty("entradaFecha");

    updateHome();
    toast("Entrada guardada");
  });

  // =========================
  // SAVE SALIDA
  // =========================
  $("btnGuardarSalida").addEventListener("click", () => {
    const code = normalizeCode($("salidaCodigo").value);
    const cantidad = Number($("salidaCantidad").value);
    const factura = ($("salidaFactura").value || "").trim();
    const fecha = $("salidaFecha").value;

    if(!code || !Number.isFinite(cantidad) || cantidad <= 0 || !factura || !fecha){
      toast("Completa todos los campos");
      return;
    }

    const prod = findProductByCode(code);
    if(!prod){
      toast("Código no existe en catálogo");
      return;
    }

    // Validar stock disponible
    const { stock } = computeStock(code);
    if(cantidad > stock){
      toast(`Stock insuficiente (Disponible: ${stock})`);
      return;
    }

    const salidas = getSalidas();
    salidas.push({
      codigo: code,
      producto: prod.producto || "",
      cantidad,
      factura,
      fecha,
      ts: Date.now()
    });
    writeJSON(S.SALIDAS, salidas);

    // limpiar
    $("salidaCodigo").value = "";
    $("salidaProducto").value = "";
    $("salidaCantidad").value = "";
    $("salidaFactura").value = "";
    setTodayIfEmpty("salidaFecha");

    updateHome();
    toast("Salida registrada");
  });

  // =========================
  // INVENTARIO SCREEN
  // =========================
  function renderInventario(filter){
    const list = $("inventarioList");
    const catalog = getCatalog();

    const inicial = getInicial();
    const entMap = sumByCode(getEntradas());
    const salMap = sumByCode(getSalidas());

    const f = (filter || "").toLowerCase();

    const rows = catalog
      .map(p => {
        const code = normalizeCode(p.codigo);
        const ini = Number(inicial[code] || 0);
        const ent = Number(entMap[code] || 0);
        const sal = Number(salMap[code] || 0);
        const stock = ini + ent - sal;

        return {
          codigo: code,
          producto: p.producto || "",
          departamento: p.departamento || "",
          ini, ent, sal, stock
        };
      })
      .filter(r => r.codigo.toLowerCase().includes(f) || r.producto.toLowerCase().includes(f))
      .sort((a,b) => a.producto.localeCompare(b.producto, "es"));

    list.innerHTML = "";

    if(rows.length === 0){
      list.innerHTML = `<div class="item"><div class="dept">No hay productos (o no coincide el filtro).</div></div>`;
      return;
    }

    for (const r of rows){
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div class="item-top">
          <div class="code">${r.codigo}</div>
          <div class="badge">Stock: ${r.stock}</div>
        </div>
        <div class="name">${r.producto}</div>
        <div class="dept">${r.departamento}</div>
        <div class="stockline">Inicial: ${r.ini} · Entradas: ${r.ent} · Salidas: ${r.sal}</div>
        <div class="stockstrong">Stock actual: ${r.stock}</div>
      `;
      list.appendChild(el);
    }
  }

  $("inventarioSearchInput").addEventListener("input", (e) => {
    renderInventario(e.target.value);
  });

  // =========================
  // INIT
  // =========================
  updateHome();
  showScreen("homeScreen");
});

