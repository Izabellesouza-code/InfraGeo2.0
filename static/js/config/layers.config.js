/**
 * Catálogo estático (fallback). Em runtime o app.js substitui `groups`
 * pelo retorno de /api/postgis/catalog (dados reais do PostgreSQL).
 */
window.InfraGeoConfig = {
  appName: "InfraGeo AM",
  defaultCenter: [-3.4653, -62.2159],
  defaultZoom: 7,
  amazonaBounds: [
    [-9.9, -73.8],
    [2.3, -56.0],
  ],
  basemaps: [
    {
      id: "google-earth",
      name: "Google Earth",
      url: "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
      attribution: "&copy; Google",
      maxZoom: 21,
      subdomains: ["0", "1", "2", "3"],
    },
    {
      id: "google-hybrid",
      name: "Google Earth híbrido",
      url: "https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
      attribution: "&copy; Google",
      maxZoom: 21,
      subdomains: ["0", "1", "2", "3"],
    },
    {
      id: "osm",
      name: "OpenStreetMap",
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    },
    {
      id: "carto-positron",
      name: "Carto Positron",
      url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      maxZoom: 20,
      subdomains: "abcd",
      default: true,
    },
    {
      id: "carto-dark",
      name: "Carto Dark",
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      maxZoom: 20,
      subdomains: "abcd",
    },
  ],
  groups: [
    {
      id: "oae_oac",
      name: "OAE/OAC",
      icon: "🌉",
      iconClass: "layer-group__icon--teal",
      layers: [],
    },
    {
      id: "br_am",
      name: "BR-AM",
      icon: "🛣️",
      iconClass: "layer-group__icon--green",
      layers: [],
    },
    {
      id: "aquaviario",
      name: "Aquaviário",
      icon: "🚢",
      iconClass: "layer-group__icon--blue",
      layers: [],
    },
    {
      id: "ucs",
      name: "Unidades de Conservação",
      icon: "🍃",
      iconClass: "layer-group__icon--leaf",
      layers: [],
    },
    {
      id: "limites_am",
      name: "Limites AM",
      icon: "🧭",
      iconClass: "layer-group__icon--grid",
      layers: [],
    },
  ],
};
