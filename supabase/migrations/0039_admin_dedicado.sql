-- Admin do painel de assinaturas passa a ser uma identidade própria,
-- desvinculada de qualquer trainer — antes estava (incorretamente) atrelado
-- a trainers.is_admin, que é da Savera, uma profissional real e separada
-- do dono do app. is_admin continua existindo e intocado (usado só pra
-- gestão do acervo compartilhado de alimentos, migration 0030).

create table admins (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);
alter table admins enable row level security;
create policy "admin vê sua própria linha" on admins for select
  using (id = auth.uid());

-- handle_new_trainer ganha uma segunda exceção: o e-mail do dono do app não
-- deve ganhar uma linha em trainers (mesma lógica já usada pra convites
-- pendentes de aluno, migration 0002) — em vez disso, ganha uma linha em
-- admins.
create or replace function public.handle_new_trainer()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.email = 'contabusinessvini@gmail.com' then
    insert into public.admins (id, email) values (new.id, new.email);
  elsif not exists (select 1 from convites where email = new.email and status = 'pendente') then
    insert into public.trainers (id, nome, email, status_assinatura, trial_termina_em)
    values (new.id, coalesce(new.raw_user_meta_data->>'nome', ''), new.email, 'trial', current_date + 14);
  end if;
  return new;
end;
$$;
