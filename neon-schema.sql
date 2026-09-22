-- Schema recomendado para Neon/PostgreSQL.
-- Rode no SQL Editor do Neon antes de colocar muitos dados em producao.

create table if not exists public."Profissional do futuro" (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cpf text not null unique check (cpf ~ '^[0-9]{11}$'),
  -- Pode ficar nula temporariamente nos registros antigos, ate a escola ser informada.
  escola text,
  pontuacao integer not null default 0 check (pontuacao >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profissional_futuro_nome_idx
  on public."Profissional do futuro" using btree (nome);

create index if not exists profissional_futuro_cpf_idx
  on public."Profissional do futuro" using btree (cpf);

-- Esta alteracao tambem funciona para uma tabela que ja existia antes desta coluna.
alter table public."Profissional do futuro"
  add column if not exists escola text;

-- Deixa o ranking por escola rapido: maiores pontuacoes aparecem primeiro.
create index if not exists profissional_futuro_escola_ranking_idx
  on public."Profissional do futuro" using btree (escola, pontuacao desc, nome asc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profissional_futuro_set_updated_at
  on public."Profissional do futuro";

create trigger profissional_futuro_set_updated_at
before update on public."Profissional do futuro"
for each row
execute function public.set_updated_at();
