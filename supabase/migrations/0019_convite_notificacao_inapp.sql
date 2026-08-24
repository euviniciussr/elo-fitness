-- Permite que o aluno já logado veja e aceite convites pendentes direto no
-- app (app-aluno.html), sem depender do link/token copiado manualmente.
-- Segue o mesmo padrão de get_convite (0002_convites.sql): security definer,
-- só expõe o necessário, sem abrir RLS de convites/trainers pro aluno.
create or replace function public.list_meus_convites_pendentes()
returns table (token uuid, trainer_nome text, created_at timestamptz, tem_cadastro_previo boolean)
language sql
security definer set search_path = public
as $$
  select c.token, t.nome, c.created_at, (c.cliente_id is not null) as tem_cadastro_previo
  from convites c
  join trainers t on t.id = c.trainer_id
  where lower(c.email) = lower(auth.email())
    and c.status = 'pendente'
    and c.expires_at > now()
  order by c.created_at desc;
$$;

grant execute on function public.list_meus_convites_pendentes() to authenticated;
