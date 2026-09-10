-- Dois problemas no gatilho que decide se um novo cadastro vira `trainers`:
--
-- 1) BUG (causa real do "aluno virou personal"): a checagem de convite
--    pendente comparava e-mail com igualdade exata (`email = new.email`).
--    Se o personal digitou o e-mail do aluno com uma capitalização
--    diferente da que o aluno usou ao criar a senha em convite.html (ex.:
--    "Fulano@gmail.com" vs "fulano@gmail.com"), a comparação falhava, o
--    convite pendente não era encontrado, e o aluno ganhava uma linha em
--    `trainers` por engano — mesmo entrando pelo link de convite certo.
--    O resto do projeto já trata e-mail como case-insensitive
--    (`lower(email) = lower(...)` em 0019, 0044, 0045, 0047) — só esse
--    gatilho, o mais crítico, tinha ficado pra trás.
--
-- 2) Bloqueio deliberado: por enquanto só duas contas devem conseguir virar
--    personal trainer (castrosavera@gmail.com e contabusinessvini@gmail.com)
--    — qualquer outro cadastro sem convite pendente NÃO deve mais criar uma
--    linha em trainers sozinho. Evita autocadastro público de personal
--    trainer enquanto o produto está fechado a esses dois.
create or replace function public.handle_new_trainer()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if lower(new.email) in ('castrosavera@gmail.com', 'contabusinessvini@gmail.com')
     and not exists (
       select 1 from convites where lower(email) = lower(new.email) and status = 'pendente'
     )
  then
    insert into public.trainers (id, nome, email, status_assinatura, trial_termina_em)
    values (new.id, coalesce(new.raw_user_meta_data->>'nome', ''), new.email, 'trial', current_date + 14);
  end if;
  return new;
end;
$$;
