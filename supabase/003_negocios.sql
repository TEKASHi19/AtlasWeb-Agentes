-- Configuración de cada negocio, por número de WhatsApp (phone_number_id)
create table if not exists public.negocios (
  phone_number_id text primary key,
  config jsonb not null,
  activo boolean not null default true,
  actualizado timestamptz not null default now()
);
alter table public.negocios enable row level security;
-- Pausa del bot por cliente (cuando el equipo atiende en persona)
alter table public.clientes add column if not exists bot_pausado_hasta timestamptz;
