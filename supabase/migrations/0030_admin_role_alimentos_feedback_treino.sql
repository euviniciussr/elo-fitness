-- 1) Papel de administrador. Só a conta do dono do app (Savera, usada como
-- "minha conta" em todo o desenvolvimento) é marcada admin — qualquer outro
-- trainer que se cadastre entra como profissional comum (default false).
alter table trainers add column is_admin boolean not null default false;
update trainers set is_admin = true where email = 'savera.personal@gmail.com';

-- 2) Alimentos passam a ser uma base compartilhada entre treinadores (o
-- pedido do administrador é que os demais profissionais usem os mesmos
-- alimentos ao montar dietas, mas só o admin edite/exclua). Isso reverte a
-- decisão anterior "não existe biblioteca compartilhada" (migration 0014)
-- só pra esta tabela — exercicios, dietas etc. continuam isolados por
-- trainer_id.
drop policy "trainer vê e edita seus alimentos" on alimentos;

create policy "qualquer trainer vê os alimentos"
  on alimentos for select
  using (exists (select 1 from trainers where trainers.id = auth.uid()));

create policy "trainer cria seus próprios alimentos"
  on alimentos for insert
  with check (trainer_id = auth.uid());

create policy "só admin edita alimentos"
  on alimentos for update
  using (exists (select 1 from trainers where trainers.id = auth.uid() and trainers.is_admin))
  with check (exists (select 1 from trainers where trainers.id = auth.uid() and trainers.is_admin));

create policy "só admin exclui alimentos"
  on alimentos for delete
  using (exists (select 1 from trainers where trainers.id = auth.uid() and trainers.is_admin));

-- 3) Exercícios continuam privados por trainer (sem mudança de leitura) —
-- só a exclusão vira exclusiva do admin, exatamente como pedido. Edição
-- continua liberada pro próprio dono (nenhuma restrição nova aí).
drop policy "trainer vê e edita seus exercícios" on exercicios;

create policy "trainer vê e edita seus exercícios"
  on exercicios for select
  using (trainer_id = auth.uid());

create policy "trainer cria seus próprios exercícios"
  on exercicios for insert
  with check (trainer_id = auth.uid());

create policy "trainer edita seus próprios exercícios"
  on exercicios for update
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

create policy "só admin exclui exercícios"
  on exercicios for delete
  using (trainer_id = auth.uid() and exists (select 1 from trainers where trainers.id = auth.uid() and trainers.is_admin));

-- 4) Feedback por treino: mesma tabela do feedback geral (feedbacks_treino),
-- só que com treino_id preenchido — nulo continua sendo o feedback geral
-- que já existe hoje (área Evolução), sem migração de dados necessária.
alter table feedbacks_treino add column treino_id uuid references treinos(id) on delete cascade;

comment on column feedbacks_treino.treino_id is
  'Nulo = feedback geral do aluno (aba Evolução). Preenchido = feedback vinculado a um treino específico, enviado logo após "Finalizar treino".';
