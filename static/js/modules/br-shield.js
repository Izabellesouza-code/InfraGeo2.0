/**
 * Placas BR (ícone estilo DNIT) para camadas de rodovias federais.
 */
window.InfraGeoBrShield = (function () {
  "use strict";

  function extractBrNumber(label) {
    const s = String(label || "");
    // Só extrai se houver "BR" explícito — evita pegar 174 de BUEIROS_174 como placa
    const m =
      s.match(/BR[_\-\s]*(\d{2,4})/i) ||
      s.match(/^BR_(\d{2,4})$/i);
    return m ? String(m[1]) : "";
  }

  function isBrLayer(meta) {
    if (!meta) return false;
    // Placa só nas rodovias do grupo BR-AM (schemas BR_174, BR_319…)
    const schema = String(meta.schema || "").toUpperCase();
    if (schema.startsWith("BR_")) return true;
    if (meta.groupId === "br_am" && schema.startsWith("BR_")) return true;
    return false;
  }

  function makeMapIcon(brNum) {
    const num = String(brNum || "").replace(/\D/g, "") || "?";
    return L.divIcon({
      className: "br-shield-map-wrap",
      html:
        `<div class="br-shield br-shield--map" title="BR-${num}">` +
        `<span class="br-shield__prefix">BR</span>` +
        `<span class="br-shield__num">${num}</span>` +
        `</div>`,
      iconSize: [36, 42],
      iconAnchor: [18, 21],
    });
  }

  function sidebarHtml(brNum) {
    const num = String(brNum || "").replace(/\D/g, "") || "?";
    return (
      `<span class="br-shield br-shield--sidebar" aria-hidden="true" title="BR-${num}">` +
      `<span class="br-shield__prefix">BR</span>` +
      `<span class="br-shield__num">${num}</span>` +
      `</span>`
    );
  }

  function latLngsFromGeometry(geometry) {
    const out = [];
    if (!geometry || geometry.coordinates == null) return out;
    (function walk(c) {
      if (!Array.isArray(c) || !c.length) return;
      if (typeof c[0] === "number" && typeof c[1] === "number") {
        out.push(L.latLng(c[1], c[0]));
        return;
      }
      c.forEach(walk);
    })(geometry.coordinates);
    return out;
  }

  function flattenLatLngs(latlngs) {
    const out = [];
    (function walk(v) {
      if (!v) return;
      if (typeof v.lat === "number" && typeof v.lng === "number") {
        out.push(v);
        return;
      }
      if (Array.isArray(v)) v.forEach(walk);
    })(latlngs);
    return out;
  }

  function midpointOfLayer(geoJsonLayer) {
    const all = [];
    geoJsonLayer?.eachLayer?.((lyr) => {
      let flat = [];
      try {
        if (lyr?.feature?.geometry) flat = latLngsFromGeometry(lyr.feature.geometry);
      } catch {
        flat = [];
      }
      if (!flat.length) flat = flattenLatLngs(lyr.getLatLngs?.() || []);
      if (!flat.length) {
        try {
          const b = lyr.getBounds?.();
          if (b?.isValid?.()) flat = [b.getCenter()];
        } catch {
          /* ignore */
        }
      }
      if (flat.length) all.push(...flat);
    });

    if (all.length) return all[Math.floor(all.length / 2)];
    try {
      const b = geoJsonLayer.getBounds?.();
      if (b?.isValid?.()) return b.getCenter();
    } catch {
      /* ignore */
    }
    return null;
  }

  /**
   * Cria um LayerGroup com a placa BR no meio do traçado.
   */
  function buildMarkers(geoJsonLayer, meta) {
    const label = meta?.name || meta?.schema || meta?.id || "";
    const num = extractBrNumber(label);
    const icon = makeMapIcon(num);
    const group = L.layerGroup();
    const at = midpointOfLayer(geoJsonLayer);
    if (!at) return group;

    L.marker(at, {
      icon,
      interactive: false,
      keyboard: false,
      zIndexOffset: 600,
    }).addTo(group);

    return group;
  }

  return {
    extractBrNumber,
    isBrLayer,
    makeMapIcon,
    sidebarHtml,
    buildMarkers,
  };
})();
