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
      id: "esri-light-gray",
      name: "Esri Light Gray",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA, TomTom, Garmin, FAO, NPS",
      maxZoom: 16,
      default: true,
    },
    {
      id: "esri-light-gray-labels",
      name: "Esri Light Gray + rótulos",
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA, TomTom, Garmin, FAO, NPS",
      maxZoom: 16,
      stack: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
      ],
    },
    {
      id: "esri-topo",
      name: "Esri Topográfico",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA, TomTom, Garmin, FAO, NPS",
      maxZoom: 19,
    },
    {
      id: "esri-streets",
      name: "Esri Streets",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA, TomTom, Garmin, FAO, NPS",
      maxZoom: 19,
    },
    {
      id: "opentopomap",
      name: "OpenTopoMap",
      url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
      maxZoom: 17,
      subdomains: "abc",
    },
    {
      id: "osm",
      name: "OpenStreetMap",
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    },
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
      id: "esri-satellite",
      name: "Satélite (Esri)",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
      maxZoom: 19,
    },
  ],
  groups: [
    {
      id: "oae",
      name: "OAE",
      icon: "🌉",
      iconClass: "layer-group__icon--teal",
      layers: [],
    },
    {
      id: "oac",
      name: "OAC",
      icon: "🕳️",
      iconClass: "layer-group__icon--teal",
      layers: [],
    },
    {
      id: "usina",
      name: "Usina",
      icon: "🏭",
      iconClass: "layer-group__icon--teal",
      layers: [],
    },
    {
      id: "canteiro",
      name: "Canteiro",
      icon: "🏕️",
      iconClass: "layer-group__icon--teal",
      layers: [],
    },
    {
      id: "prads",
      name: "PRADS",
      icon: "📍",
      iconClass: "layer-group__icon--teal",
      layers: [],
    },
    {
      id: "pca_prads",
      name: "PCA PRADS",
      icon: "📌",
      iconClass: "layer-group__icon--teal",
      layers: [],
    },
    {
      id: "faixa_dominio",
      name: "Faixa de domínio",
      icon: "📏",
      iconClass: "layer-group__icon--grid",
      layers: [],
    },
    {
      id: "jazidas",
      name: "Jazidas",
      icon: "⛰️",
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
