-- Memoria de las pláticas del agente de WhatsApp
create table if not exists public.mensajes (
  id bigint generated always as identity primary key,
  negocio_phone_id text not null,
  cliente text not null,
  rol text not null check (rol in ('user','assistant')),
  contenido text not null,
  wa_message_id text unique,
  creado timestamptz not null default now()
);
create index if not exists mensajes_platica_idx on public.mensajes (negocio_phone_id, cliente, creado desc);
-- Solo el servidor (llave secreta) puede leer y escribir: RLS activo y sin políticas públicas.
alter table public.mensajes enable row level security;
