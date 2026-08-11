# Organização do Frontend — InfraGeo AM

Estrutura pensada para manutenção rápida: cada parte da tela vive em seu próprio arquivo.

## Templates (HTML)

```
templates/
├── base.html                 # Layout geral (head, CSS, JS)
├── pages/
│   └── mapa.html             # Página principal do WebGIS
└── partials/
    ├── header.html           # Barra superior (logo + Filtros)
    ├── sidebar.html          # Container do painel esquerdo
    ├── sidebar_menu.html     # Botões: ligar, enquadrar, desmarcar, legendas
    ├── sidebar_layers.html   # Lista de grupos de camadas
    ├── sidebar_active.html   # "No mapa agora"
    ├── map_area.html         # Área do Leaflet
    └── panels.html           # Painéis flutuantes (filtros + legendas)
```

## CSS

```
static/css/
├── variables.css   # Cores, tipografia, medidas
├── base.css        # Reset e layout geral
├── header.css      # Cabeçalho
├── sidebar.css     # Menu + camadas + chips ativos
├── map.css         # Mapa e controles Leaflet
└── components.css  # Filtros e legendas
```

## JavaScript

```
static/js/
├── app.js                    # Bootstrap (orquestra tudo)
├── config/
│   └── layers.config.js      # ← Edite aqui para adicionar camadas
├── core/
│   └── map.js                # Leaflet (basemap, load GeoJSON, zoom)
└── modules/
    ├── sidebar.js            # Ações do MENU
    ├── layers.js             # Árvore de camadas + chips ativos
    ├── legend.js             # Painel de legendas
    └── filters.js            # Painel Filtros
```

## Dados do mapa

```
static/data/
├── amazonas_limite.geojson
└── amostras/
    ├── oae_pontos.geojson
    ├── rodovias.geojson
    ├── portos.geojson
    └── ucs.geojson
```

## Como adicionar uma camada nova

1. Coloque o `.geojson` em `static/data/` (ou `amostras/`).
2. Em `static/js/config/layers.config.js`, adicione o item no grupo desejado.
3. Recarregue a página — sem alterar HTML/CSS.

## Como alterar o visual

| O quê | Onde |
|-------|------|
| Cores / tema | `static/css/variables.css` |
| Header | `templates/partials/header.html` + `header.css` |
| Botões do menu | `templates/partials/sidebar_menu.html` + `sidebar.css` |
| Grupos de camadas | `layers.config.js` |
| Logo | `static/img/logo-spu.svg` |
