-- Perfil do profissional, categorias de exercício e pesquisa inteligente.
--
-- 1) Perfil (perfil.html): o formulário existia mas "Salvar alterações" não
--    gravava nada. trainers.nome já é a fonte do nome em todo o painel; os
--    demais campos do formulário ganham colunas próprias aqui. E-mail de login
--    continua só em auth.users/trainers.email e não é editado pelo perfil.
--
-- 2) Categorias de exercício continuam texto livre em exercicios.categoria
--    (sem tabela paralela). "Alongamento" é consolidado em "Alongamentos" e um
--    trigger canoniza toda gravação (maiúsculas, espaços, singular), então a
--    variante não volta por cadastro, edição, planilha ou importação com IA.
--    "Potência e aceleração" entra na lista oficial; nenhum exercício muda de
--    categoria sozinho.
--
-- 3) Busca de alimentos: o filtro no banco usava ILIKE com a palavra já sem
--    acento ("mamao"), que nunca bate com "Mamão". Cada catálogo ganha uma
--    coluna gerada `busca` (sem acento, minúscula, pontuação virando espaço,
--    com espaço inicial) indexada por trigram; o termo "% mamao%" casa com o
--    início de qualquer palavra do nome, em qualquer ordem.

-- ---------------------------------------------------------------- perfil

alter table trainers add column if not exists telefone text;
alter table trainers add column if not exists cref text;
alter table trainers add column if not exists bio text;
alter table trainers add column if not exists instagram text;
alter table trainers add column if not exists especialidades text[] not null default '{}';

-- ---------------------------------------------------------------- normalização

-- Mesma regra do js/busca-inteligente.js e supabase/functions/_shared/busca.ts.
-- translate() em vez de unaccent() porque precisa ser IMMUTABLE pra coluna gerada.
create or replace function public.normalizar_busca(t text)
returns text
language sql
immutable
parallel safe
as $$
  select btrim(regexp_replace(
    lower(translate(coalesce(t, ''),
      'áàâãäåÁÀÂÃÄÅéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇñÑýÿÝ',
      'aaaaaaAAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcCnNyyY')),
    '[^a-z0-9]+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------- categorias

create or replace function public.canonizar_categoria_exercicio(c text)
returns text
language sql
immutable
as $$
  select case
    when c is null or btrim(c) = '' then null
    when public.normalizar_busca(c) in ('alongamento', 'alongamentos') then 'Alongamentos'
    else coalesce(
      (select x from unnest(array[
        'Peitoral', 'Dorsal', 'Deltoide', 'Quadríceps', 'Isquiotibiais', 'Glúteos',
        'Bíceps', 'Tríceps', 'Antebraço', 'Panturrilha', 'Ativação', 'Alongamentos',
        'Mobilidade', 'Fortalecimento MMII', 'Trapézio', 'Adutor', 'Core', 'Abdômen',
        'Lombar', 'Pliometria', 'Potência e aceleração'
      ]) x where public.normalizar_busca(x) = public.normalizar_busca(c) limit 1),
      regexp_replace(btrim(c), '\s+', ' ', 'g'))
  end
$$;

create or replace function public.canonizar_categoria_trigger()
returns trigger
language plpgsql
as $$
begin
  new.categoria := public.canonizar_categoria_exercicio(new.categoria);
  return new;
end;
$$;

drop trigger if exists exercicios_canonizar_categoria on exercicios;
create trigger exercicios_canonizar_categoria
  before insert or update of categoria on exercicios
  for each row execute function public.canonizar_categoria_trigger();

drop trigger if exists exercicio_personalizacoes_canonizar_categoria on exercicio_personalizacoes;
create trigger exercicio_personalizacoes_canonizar_categoria
  before insert or update of categoria on exercicio_personalizacoes
  for each row execute function public.canonizar_categoria_trigger();

-- Migração dos dados: só a coluna categoria muda; id, nome, vídeo e os
-- vínculos com treino_exercicios ficam intactos.
update exercicios
  set categoria = public.canonizar_categoria_exercicio(categoria)
  where categoria is distinct from public.canonizar_categoria_exercicio(categoria);

update exercicio_personalizacoes
  set categoria = public.canonizar_categoria_exercicio(categoria)
  where categoria is not null
    and categoria is distinct from public.canonizar_categoria_exercicio(categoria);

-- ---------------------------------------------------------------- busca

create extension if not exists pg_trgm with schema extensions;

alter table alimentos add column if not exists busca text
  generated always as (' ' || public.normalizar_busca(coalesce(nome, '') || ' ' || coalesce(brand_name, ''))) stored;
alter table taco_alimentos add column if not exists busca text
  generated always as (' ' || public.normalizar_busca(nome)) stored;
alter table tbca_alimentos add column if not exists busca text
  generated always as (' ' || public.normalizar_busca(nome)) stored;

create index if not exists alimentos_busca_trgm on alimentos using gin (busca extensions.gin_trgm_ops);
create index if not exists taco_alimentos_busca_trgm on taco_alimentos using gin (busca extensions.gin_trgm_ops);
create index if not exists tbca_alimentos_busca_trgm on tbca_alimentos using gin (busca extensions.gin_trgm_ops);
