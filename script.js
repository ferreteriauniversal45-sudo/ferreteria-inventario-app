const INVENTARIO_URL = "https://ferreteriauniversal45-sudo.github.io/ferreteria-inventario-app/inventario.json";
const VERSION_URL = "https://ferreteriauniversal45-sudo.github.io/ferreteria-inventario-app/inventario_version.json";

let actualizando = false;

async function cargarInventario(mostrarMensaje = false) {
  if (actualizando) return;
  actualizando = true;

  const boton = document.querySelector("button");
  const icon = document.getElementById("statusIcon");

  boton.textContent = "Actualizando...";
  boton.disabled = true;
  icon.classList.add("rotar");

  try {
    const inventarioResp = await fetch(INVENTARIO_URL, { cache: "no-store" });
    const inventario = await inventarioResp.json();

    const versionResp = await fetch(VERSION_URL, { cache: "no-store" });
    const version = await versionResp.json();

    localStorage.setItem("inventario", JSON.stringify(inventario));
    localStorage.setItem("version", version.version);

    document.getElementById("totalProductos").textContent =
      Object.keys(inventario).length;

    document.getElementById("ultimaActualizacion").textContent =
      version.version;

    setEstado(true);

    if (mostrarMensaje) {
      alert("✅ Inventario actualizado correctamente");
    }

  } catch (e) {
    cargarLocal();
    setEstado(false);

    if (mostrarMensaje) {
      alert("⚠️ Sin internet. Usando inventario local.");
    }
  }

  boton.textContent = "Actualizar inventario";
  boton.disabled = false;
  icon.classList.remove("rotar");
  actualizando = false;
}

function cargarLocal() {
  const inventario = JSON.parse(localStorage.getItem("inventario") || "{}");
  document.getElementById("totalProductos").textContent =
    Object.keys(inventario).length;

  document.getElementById("ultimaActualizacion").textContent =
    localStorage.getItem("version") || "—";
}

function setEstado(online) {
  const icon = document.getElementById("statusIcon");
  icon.className = "status " + (online ? "online" : "offline");
}

function forzarActualizacion() {
  cargarInventario(true);
}

window.addEventListener("load", () => cargarInventario(false));

let inventarioCache = {};

function abrirCatalogo() {
  document.querySelector("main").classList.add("oculto");
  document.getElementById("catalogo").classList.remove("oculto");

  inventarioCache = JSON.parse(localStorage.getItem("inventario") || "{}");
  renderCatalogo(Object.entries(inventarioCache));
}

function cerrarCatalogo() {
  document.getElementById("catalogo").classList.add("oculto");
  document.querySelector("main").classList.remove("oculto");
}

function renderCatalogo(lista) {
  const contenedor = document.getElementById("listaProductos");
  contenedor.innerHTML = "";

  if (lista.length === 0) {
    contenedor.innerHTML = "<p>No se encontraron productos</p>";
    return;
  }

  lista.forEach(([codigo, data]) => {
    const div = document.createElement("div");
    div.className = "producto";
    div.innerHTML = `
      <strong>${codigo} — ${data.producto}</strong>
      <span>${data.departamento}</span>
      <span>Stock: ${data.stock}</span>
    `;
    contenedor.appendChild(div);
  });
}

function filtrarCatalogo() {
  const texto = document.getElementById("buscador").value.toLowerCase();

  const filtrados = Object.entries(inventarioCache).filter(
    ([codigo, data]) =>
      codigo.toLowerCase().includes(texto) ||
      data.producto.toLowerCase().includes(texto)
  );

  renderCatalogo(filtrados);
}
