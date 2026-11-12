-- Ficha permanente de cada cliente (nombre, preferencias), separada de la plática de 24 h
create table if not exists public.clientes (
  negocio_phone_id text not null,
  telefono text not null,
  nombre_whatsapp text,
  nombre text,
  notas text,
  primera_vez timestamptz not null default now(),
  ultima_vez timestamptz not null default now(),
  primary key (negocio_phone_id, telefono)
);
alter table public.clientes enable row level security;
