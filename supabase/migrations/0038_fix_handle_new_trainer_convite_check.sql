-- A migration 0037 substituiu handle_new_trainer() e, sem querer, perdeu a
-- checagem de convite pendente adicionada na migration 0002_convites.sql
-- (comentário original: "Evita que aceitar um convite de aluno também crie
-- uma linha em trainers"). Sem essa checagem, todo aluno que aceitasse um
-- convite passaria a ganhar uma linha trainers espúria, agora também com
-- trial/cobrança. Esta migration restaura a checagem, mantendo os campos
-- de trial adicionados na 0037.
create or replace function public.handle_new_trainer()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from convites where email = new.email and status = 'pendente') then
    insert into public.trainers (id, nome, email, status_assinatura, trial_termina_em)
    values (new.id, coalesce(new.raw_user_meta_data->>'nome', ''), new.email, 'trial', current_date + 14);
  end if;
  return new;
end;
$$;
