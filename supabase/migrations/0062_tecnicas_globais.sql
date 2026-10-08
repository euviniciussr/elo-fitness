-- Técnicas avançadas globais da plataforma. Até aqui tecnicas_avancadas era
-- 100% isolada por trainer_id (migration 0012) e cada profissional recebia no
-- cadastro 4 cópias só com o nome (Super set, Drop set, Bi-set, Rest-pause).
-- Resultado: o nome aparecia pra todo mundo, mas a descrição só existia nas
-- linhas do admin. Agora segue o mesmo modelo dos exercícios (0061):
--   is_global = true  → técnica oficial, visível (nome + descrição) pra todo
--                       profissional, só o admin (trainers.is_admin) cria/edita/exclui;
--   is_global = false → particular, visível só pro trainer_id dono.
-- A mesma linha (mesmo id) é compartilhada, então treino_exercicios.tecnica_avancada
-- existentes continuam apontando pra mesma técnica.
alter table tecnicas_avancadas add column is_global boolean not null default false;

comment on column tecnicas_avancadas.is_global is
  'true = técnica da plataforma (visível pra todos os profissionais, controlada pelo admin). false = particular do trainer_id.';

-- Remove só as cópias semeadas que nunca foram tocadas: sem descrição, sem uso
-- em nenhum treino, e com uma técnica de mesmo nome descrita por um admin (que
-- vira a global). Técnica com descrição própria ou em uso fica como particular.
delete from tecnicas_avancadas ta
where coalesce(ta.observacao, '') = ''
  and not exists (select 1 from treino_exercicios te where te.tecnica_avancada = ta.id::text)
  and exists (
    select 1 from tecnicas_avancadas g
    join trainers t on t.id = g.trainer_id and t.is_admin
    where g.id <> ta.id
      and lower(g.nome) = lower(ta.nome)
      and coalesce(g.observacao, '') <> ''
  );

-- As técnicas já cadastradas pelo admin viram as globais (mesmos ids).
update tecnicas_avancadas set is_global = true
  where trainer_id in (select id from trainers where is_admin);

-- Profissional novo não recebe mais cópias: já enxerga as globais.
drop trigger on_trainer_created_tecnicas on trainers;
drop function public.handle_new_trainer_tecnicas();

drop policy "trainer vê e edita suas técnicas avançadas" on tecnicas_avancadas;

-- Leitura: as próprias + as globais (estas só pra quem é profissional — o
-- aluno continua enxergando apenas as usadas no treino dele, policy da 0012).
create policy "trainer vê suas técnicas e as globais"
  on tecnicas_avancadas for select
  using (
    trainer_id = auth.uid()
    or (is_global and exists (select 1 from trainers where trainers.id = auth.uid()))
  );

-- Criação: sempre em nome próprio; marcar como global só o admin.
create policy "trainer cria técnica particular, admin cria global"
  on tecnicas_avancadas for insert
  with check (
    trainer_id = auth.uid()
    and (not is_global or exists (select 1 from trainers where trainers.id = auth.uid() and trainers.is_admin))
  );

-- Edição: particular só pelo dono; global só pelo admin. O with check impede
-- um profissional comum de promover a própria técnica a global.
create policy "dono edita técnica particular, admin edita global"
  on tecnicas_avancadas for update
  using (
    (not is_global and trainer_id = auth.uid())
    or (is_global and exists (select 1 from trainers where trainers.id = auth.uid() and trainers.is_admin))
  )
  with check (
    (not is_global and trainer_id = auth.uid())
    or (is_global and exists (select 1 from trainers where trainers.id = auth.uid() and trainers.is_admin))
  );

-- Exclusão: mesma regra da edição.
create policy "dono exclui técnica particular, admin exclui global"
  on tecnicas_avancadas for delete
  using (
    (not is_global and trainer_id = auth.uid())
    or (is_global and exists (select 1 from trainers where trainers.id = auth.uid() and trainers.is_admin))
  );
