-- Biblioteca de técnicas avançadas: substitui o <select> fixo (super_set,
-- drop_set, bi_set, rest_pause) por uma tabela editável por trainer, com
-- nome + observação/explicação vinculadas, reutilizável em qualquer treino.

create table tecnicas_avancadas (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  nome text not null,
  observacao text,
  created_at timestamptz not null default now()
);

alter table tecnicas_avancadas enable row level security;

create policy "trainer vê e edita suas técnicas avançadas"
  on tecnicas_avancadas for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

create policy "aluno vê técnicas usadas no seu treino"
  on tecnicas_avancadas for select
  using (exists (
    select 1 from treino_exercicios te
    join treinos tr on tr.id = te.treino_id
    join clientes on clientes.id = tr.cliente_id
    where te.tecnica_avancada = tecnicas_avancadas.id::text
    and clientes.auth_user_id = auth.uid()
  ));

-- Semeia as 4 técnicas pré-cadastradas pra cada trainer já existente.
insert into tecnicas_avancadas (trainer_id, nome)
select t.id, v.nome
from trainers t
cross join (values ('Super set'), ('Drop set'), ('Bi-set'), ('Rest-pause')) as v(nome);

-- Remigra treino_exercicios que usavam os slugs fixos pro id da técnica
-- correspondente do mesmo trainer.
update treino_exercicios te
set tecnica_avancada = ta.id::text
from treinos tr
join tecnicas_avancadas ta on ta.trainer_id = tr.trainer_id
where te.treino_id = tr.id
  and ta.nome = case te.tecnica_avancada
    when 'super_set' then 'Super set'
    when 'drop_set' then 'Drop set'
    when 'bi_set' then 'Bi-set'
    when 'rest_pause' then 'Rest-pause'
    else null
  end
  and te.tecnica_avancada in ('super_set', 'drop_set', 'bi_set', 'rest_pause');

-- Semeia as mesmas 4 técnicas automaticamente pra cada novo trainer.
create function public.handle_new_trainer_tecnicas()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into tecnicas_avancadas (trainer_id, nome)
  values (new.id, 'Super set'), (new.id, 'Drop set'), (new.id, 'Bi-set'), (new.id, 'Rest-pause');
  return new;
end;
$$;

create trigger on_trainer_created_tecnicas
  after insert on trainers
  for each row execute function public.handle_new_trainer_tecnicas();
