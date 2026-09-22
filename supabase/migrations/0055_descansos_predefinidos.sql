-- Biblioteca de intervalos de descanso pré-definidos: mesmo conceito de
-- series_predefinidas (0013), mas pra reaproveitar o tempo de descanso
-- (texto amigável + segundos do timer) em qualquer exercício.

create table descansos_predefinidos (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  nome text,
  segundos integer not null check (segundos > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table descansos_predefinidos enable row level security;

create policy "trainer vê e edita seus intervalos pré-definidos"
  on descansos_predefinidos for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

grant select, insert, update, delete on descansos_predefinidos to authenticated;
