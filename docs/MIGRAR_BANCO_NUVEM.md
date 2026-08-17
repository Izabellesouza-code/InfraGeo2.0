# Migrar o banco InfraGeo (PostGIS local) para a nuvem (Railway)

O banco local está OK: **`infrageo`** em `192.168.0.102` (~72 MB, 32 camadas).

## Passo 1 — Railway: URL pública + PostGIS

### 1.1 Public Networking
No serviço **Postgres** → **Settings** → **Networking** → **Public Networking / TCP Proxy**  
(porta interna `5432`).

Isso cria a variável **`DATABASE_PUBLIC_URL`** (host tipo `xxx.proxy.rlwy.net`).

> A URL com `postgres.railway.internal` **não** funciona do seu PC nem do Render.

### 1.2 PostGIS
O Postgres padrão do Railway **muitas vezes não tem PostGIS**. Opções:

**A (recomendada):** apague o Postgres simples e faça deploy do template  
[PostGIS Spatial Database](https://railway.com/deploy/postgis-spatial-database)

**B:** no **Console** do Postgres, tente:
```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```
Se der erro de pacote/arquivo, use a opção A.

Copie a **`DATABASE_PUBLIC_URL`** e envie aqui (pode ocultar a senha).

---

## Passo 2 — Dump do banco local

No PowerShell (ajuste o caminho do `pg_dump` se necessário):

```powershell
cd C:\Users\izabelle\Desktop\IZA\novaversaoInfraGeo
# Use a senha do Postgres origem (não versionar no Git)
$env:PGPASSWORD = $env:SOURCE_PGPASSWORD  # ou digite manualmente
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" `
  -h $env:SOURCE_PGHOST -p 5432 -U postgres -d infrageo `
  -Fc -f ".\data\exports\infrageo.dump"
```

Exemplo com valores locais (substitua pelos seus):

```powershell
$env:PGPASSWORD = "SUA_SENHA"
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" `
  -h 192.168.0.102 -p 5432 -U postgres -d infrageo `
  -Fc -f ".\data\exports\infrageo.dump"
```

---

## Passo 3 — Restore no Railway

```powershell
# Use a DATABASE_PUBLIC_URL (não a .internal)
# Ex.: postgresql://postgres:SENHA@HOST_PUBLICO:PORTA/railway

$public = "postgresql://postgres:SENHA@HOST.proxy.rlwy.net:PORTA/railway"
# Ative PostGIS no destino antes do restore:
# psql $public -c "CREATE EXTENSION IF NOT EXISTS postgis;"

$env:PGPASSWORD = "SENHA"
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" `
  --no-owner --no-acl -d $public ".\data\exports\infrageo.dump"
```

---

## Passo 4 — Apontar o InfraGeo

No `.env`:

```env
DATABASE_URL=postgresql+psycopg2://postgres:SENHA@HOST.proxy.rlwy.net:PORTA/railway
```

Reinicie: `.\iniciar.bat`  
Teste: http://127.0.0.1:8000/api/postgis/health

---

## Checklist

- [ ] TCP Proxy / `DATABASE_PUBLIC_URL`
- [ ] PostGIS ativo no Railway
- [ ] Dump local (~72 MB)
- [ ] Restore no Railway
- [ ] `.env` com URL pública
- [ ] Health + camadas no mapa
