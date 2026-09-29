-- Ângulo explícito de cada foto de avaliação (frente, costas, lado direito,
-- lado esquerdo) — não depende da ordem de envio. Nulo = foto antiga (antes
-- desta migration) ou enviada sem ângulo: NÃO é reclassificada, continua
-- aparecendo normalmente como "outras fotos".
alter table fotos_evolucao add column angulo text
  check (angulo in ('frente', 'costas', 'lado_direito', 'lado_esquerdo'));

comment on column fotos_evolucao.angulo is
  'Posição da foto de avaliação: frente | costas | lado_direito | lado_esquerdo. Nulo = sem ângulo identificado (fotos antigas).';

-- Profissional responsável sempre é o profissional do cliente, decidido no
-- servidor: impede o aluno de gravar a foto com o trainer_id de outro
-- profissional (a policy de insert do aluno só confere o cliente_id).
create or replace function public.fotos_evolucao_trainer_do_cliente()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  select c.trainer_id into new.trainer_id from clientes c where c.id = new.cliente_id;
  if new.trainer_id is null then
    raise exception 'Cliente sem profissional vinculado';
  end if;
  return new;
end;
$$;

create trigger fotos_evolucao_trainer_do_cliente
  before insert on fotos_evolucao
  for each row execute function public.fotos_evolucao_trainer_do_cliente();
