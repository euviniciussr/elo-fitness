-- Biblioteca de séries pré-definidas: templates reutilizáveis de estrutura de
-- séries (ex: "Protocolo Padrão" = Aquecimento 10 / Trabalho 8 / Trabalho 8 /
-- Variação 12) que o trainer aplica em qualquer exercício, preenchendo o
-- campo texto "series" de treino_exercicios sem alterar o template original.

create table series_predefinidas (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  nome text not null,
  linhas jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table series_predefinidas enable row level security;

create policy "trainer vê e edita suas séries pré-definidas"
  on series_predefinidas for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());
