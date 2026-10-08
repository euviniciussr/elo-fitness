-- Exercícios globais da plataforma. Até aqui exercicios era 100% isolado por
-- trainer_id (migration 0030), então um profissional novo entrava com o
-- acervo vazio. Agora existem dois tipos, distinguidos no banco:
--   is_global = true  → acervo oficial, visível pra todo profissional,
--                       só o admin (trainers.is_admin) cria/edita/exclui;
--   is_global = false → particular, visível só pro trainer_id dono.
-- Nada é copiado por profissional: a mesma linha (mesmo id) é compartilhada,
-- então treino_exercicios existentes continuam apontando pro mesmo exercício.
-- trainer_id continua preenchido nos globais (quem cadastrou).
alter table exercicios add column is_global boolean not null default false;

comment on column exercicios.is_global is
  'true = exercício da plataforma (visível pra todos os profissionais, controlado pelo admin). false = particular do trainer_id.';

-- Os exercícios já cadastrados pelo admin viram o acervo global (mesmos ids).
update exercicios set is_global = true
  where trainer_id in (select id from trainers where is_admin);

create index exercicios_is_global_idx on exercicios (is_global) where is_global;

drop policy "trainer vê e edita seus exercícios" on exercicios;
drop policy "trainer cria seus próprios exercícios" on exercicios;
drop policy "trainer edita seus próprios exercícios" on exercicios;
drop policy "só admin exclui exercícios" on exercicios;

-- Leitura: os próprios + os globais (estes só pra quem é profissional — o
-- aluno continua enxergando apenas o que está no treino dele, policy da 0003).
create policy "trainer vê seus exercícios e os globais"
  on exercicios for select
  using (
    trainer_id = auth.uid()
    or (is_global and exists (select 1 from trainers where trainers.id = auth.uid()))
  );

-- Criação: sempre em nome próprio; marcar como global só o admin.
create policy "trainer cria exercício particular, admin cria global"
  on exercicios for insert
  with check (
    trainer_id = auth.uid()
    and (not is_global or exists (select 1 from trainers where trainers.id = auth.uid() and trainers.is_admin))
  );

-- Edição: particular só pelo dono; global só pelo admin. O with check impede
-- um profissional comum de promover o próprio exercício a global.
create policy "dono edita particular, admin edita global"
  on exercicios for update
  using (
    (not is_global and trainer_id = auth.uid())
    or (is_global and exists (select 1 from trainers where trainers.id = auth.uid() and trainers.is_admin))
  )
  with check (
    (not is_global and trainer_id = auth.uid())
    or (is_global and exists (select 1 from trainers where trainers.id = auth.uid() and trainers.is_admin))
  );

-- Exclusão continua exclusiva do admin (como na 0030), agora cobrindo também
-- os globais cadastrados por outro admin.
create policy "só admin exclui exercícios"
  on exercicios for delete
  using (
    exists (select 1 from trainers where trainers.id = auth.uid() and trainers.is_admin)
    and (is_global or trainer_id = auth.uid())
  );
