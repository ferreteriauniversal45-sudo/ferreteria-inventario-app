const INVENTARIO_URL = "https://ferreteriauniversal45-sudo.github.io/ferreteria-inventario-app/inventario.json";
const VERSION_URL = "https://ferreteriauniversal45-sudo.github.io/ferreteria-inventario-app/inventario_version.json";

async function cargarInventario() {
  try {
    const inventarioResp = await fetch(INVENTARIO_URL);
    const inventario = await inventarioResp.json();

    const versionResp = await fetch(VERSION_URL);
    const version = await versionResp.json();

    localStorage.setItem("inventario", JSON.stringify(inventario));
    localStorage.setItem("version", version.version);

    document.getElementById("totalProductos").textContent =
      Object.keys(inventario).length;
    document.getElementById("ultimaActualizacion").textContent =
      version.version;

    setEstado(true);

  } catch (e) {
    cargarLocal();
    setEstado(false);
  }
}

function cargarLocal() {
  const inventario = JSON.parse(localStorage.getItem("inventario") || "{}");
  document.getElementById("totalProductos").textContent =
    Object.keys(inventario).length;
}

function setEstado(online) {
  const icon = document.getElementById("statusIcon");
  icon.className = "status " + (online ? "online" : "offline");
}

function forzarActualizacion() {
  cargarInventario();
}

window.addEventListener("load", cargarInventario);
