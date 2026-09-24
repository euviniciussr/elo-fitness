-- Cadastro aberto e separado por tipo de conta (substitui a allowlist de
-- 0048, que deixava só dois e-mails virarem personal):
--
-- - login.html → "Sou personal trainer" manda user_metadata.tipo = 'personal'
--   → vira trainers (trial de 14 dias, pode assinar) e cai no dashboard.
-- - login.html → "Sou aluno" e convite.html mandam tipo = 'aluno' → NUNCA
--   vira trainers; cai na área do aluno (vínculo com o personal vem do
--   convite, via accept_convite).
--
-- Sem tipo (cadastro por outro caminho) = aluno. Isso mantém a proteção de
-- 0048 contra "aluno virou personal": só vira personal quem escolheu isso
-- explicitamente na tela de cadastro.
create or replace function public.handle_new_trainer()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce(new.raw_user_meta_data->>'tipo', '') = 'personal' then
    insert into public.trainers (id, nome, email, status_assinatura, trial_termina_em)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'nome', new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
      new.email, 'trial', current_date + 14
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;
