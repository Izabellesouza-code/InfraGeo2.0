# Sync de schemas Postgres (local) → Neon (nuvem)
# ================================================
#
# Fluxo automático (CREATE):
#   1. Schema criado no Postgres origem (SOURCE_DATABASE_URL)
#   2. Watcher ou API espelha no Neon (NEON_DATABASE_URL / DATABASE_URL)
#   3. Site atualiza sozinho (catálogo ao vivo via /api/postgis/catalog)
#   4. Opcional: grava data/catalog_snapshot.json e faz git push (Vercel)
#
# Fluxo seguro (DELETE):
#   1. DROP na origem → NÃO apaga no Neon
#   2. Gera pedido pendente + token
#   3. Admin confirma com frase "EXCLUIR <schema>" + token
#   4. Só então DROP SCHEMA CASCADE no Neon + snapshot/git
#
# Schemas protegidos (nunca apaga): public, topology, LIMITE_ESTADUAL, …
#
# API (JWT admin):
#   GET    /api/admin/schemas/diff
#   POST   /api/admin/schemas/install-triggers
#   POST   /api/admin/schemas/sync-missing
#   POST   /api/admin/schemas                 { "schema_name": "MEU_SCHEMA" }
#   POST   /api/admin/schemas/{nome}/delete-request
#   DELETE /api/admin/schemas/{nome}          { "confirm_phrase": "EXCLUIR NOME", "confirm_token": "..." }
#   POST   /api/admin/schemas/{nome}/delete-cancel
#
# Watcher local:
#   python scripts/watch_schema_sync.py
#
# Variáveis (.env):
#   SOURCE_DATABASE_URL=postgresql+psycopg2://...@localhost:5432/infrageo
#   NEON_DATABASE_URL=postgresql+psycopg2://...@...neon.tech/neondb?sslmode=require
#   SCHEMA_SYNC_AUTO_GIT=false
#   SCHEMA_SYNC_GIT_REMOTE=origin
#   SCHEMA_SYNC_GIT_BRANCH=main
#
# Requisito para copiar tabelas: pg_dump e pg_restore no PATH.
