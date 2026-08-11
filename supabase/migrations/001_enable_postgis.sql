-- InfraGeo 2.0 — bootstrap PostGIS no Supabase
-- Rode no SQL Editor: https://supabase.com/dashboard/project/_/sql

-- 1) Extensão espacial (schema extensions — padrão Supabase)
create extension if not exists postgis with schema extensions;

-- 2) Schema para uploads de SHP pela API
create schema if not exists uploads;

-- 3) (Opcional) schemas das camadas SEPLAN — crie se for migrar dumps
-- create schema if not exists limite_estadual;
-- create schema if not exists limite_municipal;
-- create schema if not exists br_319;
-- ...

-- 4) Garante search_path com functions do PostGIS
-- (já costuma incluir "extensions" no Supabase)
alter database postgres set search_path to public, extensions, uploads;

select extensions.postgis_full_version() as postgis;
