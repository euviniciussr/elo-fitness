-- 1) Carga utilizada vira texto livre: o aluno pode registrar mais de uma
-- carga na mesma série (ex.: drop set "40 kg - 30 kg - 20 kg"). O app nunca
-- deve extrair/cortar um número disso — grava e mostra exatamente o texto.
alter table serie_cargas alter column carga type text using carga::text;

comment on column serie_cargas.carga is
  'Texto livre digitado pelo aluno (ex.: "60 kg" ou "40 kg - 30 kg - 20 kg" num drop set). Nunca parseado/cortado — salvo e exibido exatamente como digitado.';

-- 2) Check individual "exercício realizado", persistido por dia. Presença da
-- linha = marcado; desmarcar apaga a linha (sem estado "falso" armazenado).
create table treino_exercicio_execucoes (
  id uuid primary key default gen_random_uuid(),
  treino_exercicio_id uuid not null references treino_exercicios(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,
  trainer_id uuid not null references trainers(id) on delete cascade,
  data date not null default current_date,
  created_at timestamptz not null default now(),
  unique (treino_exercicio_id, data)
);

alter table treino_exercicio_execucoes enable row level security;

create policy "aluno gerencia seus próprios checks de exercício"
  on treino_exercicio_execucoes for all
  using (exists (select 1 from clientes where clientes.id = treino_exercicio_execucoes.cliente_id and clientes.auth_user_id = auth.uid()))
  with check (exists (select 1 from clientes where clientes.id = treino_exercicio_execucoes.cliente_id and clientes.auth_user_id = auth.uid()));

create policy "trainer vê checks de exercício dos seus alunos"
  on treino_exercicio_execucoes for select
  using (trainer_id = auth.uid());

-- 3) treino_execucoes ("Finalizar treino") precisa suportar mais de um
-- treino por dia e o histórico de qual treino específico foi finalizado —
-- a constraint antiga (cliente_id, data) não deixava. Tabela está vazia em
-- produção (nunca foi usada de verdade), então a troca é segura.
alter table treino_execucoes drop constraint treino_execucoes_cliente_id_data_key;
alter table treino_execucoes drop constraint treino_execucoes_treino_id_fkey;
alter table treino_execucoes alter column treino_id set not null;
alter table treino_execucoes add constraint treino_execucoes_treino_id_fkey
  foreign key (treino_id) references treinos(id) on delete cascade;
alter table treino_execucoes add constraint treino_execucoes_cliente_treino_data_key unique (cliente_id, treino_id, data);

comment on table treino_execucoes is
  'Um registro por treino finalizado pelo aluno num dia (upsert por (cliente_id, treino_id, data) — clicar de novo no mesmo dia edita, não duplica). created_at é o horário da finalização.';
