-- Cache interno de busca (Parte 23) — reduz chamadas repetidas à FatSecret.
-- Só a Edge Function acessa esta tabela (service role, que ignora RLS por
-- padrão). Sem GRANT pra `authenticated`/`anon`: o frontend nunca consegue
-- ler/escrever aqui diretamente, então isso nunca vira um "dump navegável"
-- do catálogo da FatSecret — é só um cache curto de textos já buscados.

create table if not exists food_search_cache (
  cache_key text primary key,
  query_text text not null,
  region text not null default 'BR',
  language text not null default 'pt',
  results jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table food_search_cache enable row level security;
-- Nenhuma policy criada de propósito: RLS habilitada + zero policy = nega
-- tudo pra `authenticated`/`anon`. Só a service role (usada pela Edge
-- Function) contorna RLS e consegue ler/escrever.

create index if not exists food_search_cache_fetched_at_idx
  on food_search_cache (fetched_at);
