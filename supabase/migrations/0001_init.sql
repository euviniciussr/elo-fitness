-- Performa AI — schema inicial
-- Cada trainer é o próprio usuário do Supabase Auth (trainers.id = auth.uid()).

create table trainers (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create table clientes (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  nome text not null,
  email text,
  telefone text,
  idade int,
  altura_cm int,
  peso_kg numeric,
  plano text,
  status text not null default 'ativo' check (status in ('ativo', 'inativo')),
  created_at timestamptz not null default now()
);

create table convites (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  cliente_id uuid references clientes(id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  email text,
  status text not null default 'pendente' check (status in ('pendente', 'aceito', 'expirado')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create table exercicios (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid references trainers(id) on delete cascade,
  nome text not null,
  categoria text,
  idioma text not null default 'pt',
  video_url text,
  created_at timestamptz not null default now()
);

create table treinos (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  cliente_id uuid references clientes(id) on delete cascade,
  nome text not null,
  descricao text,
  habilitado boolean not null default true,
  dias_semana int[] not null default '{}',
  data_inicio date,
  data_expiracao date,
  created_at timestamptz not null default now()
);

create table treino_exercicios (
  id uuid primary key default gen_random_uuid(),
  treino_id uuid not null references treinos(id) on delete cascade,
  exercicio_id uuid not null references exercicios(id) on delete cascade,
  ordem int not null default 0,
  series text,
  intervalo_descanso text,
  tecnica_avancada text not null default 'nenhuma',
  observacoes text,
  created_at timestamptz not null default now()
);

create table pagamentos (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  cliente_id uuid references clientes(id) on delete set null,
  valor numeric not null,
  data date not null default current_date,
  descricao text,
  created_at timestamptz not null default now()
);

-- RLS: cada trainer só acessa seus próprios dados.
alter table trainers enable row level security;
alter table clientes enable row level security;
alter table convites enable row level security;
alter table exercicios enable row level security;
alter table treinos enable row level security;
alter table treino_exercicios enable row level security;
alter table pagamentos enable row level security;

create policy "trainer vê e edita seu próprio perfil"
  on trainers for all
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "trainer vê e edita seus clientes"
  on clientes for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

create policy "trainer vê e edita seus convites"
  on convites for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

create policy "trainer vê e edita seus exercícios"
  on exercicios for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

create policy "trainer vê e edita seus treinos"
  on treinos for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

create policy "trainer vê e edita exercícios do treino"
  on treino_exercicios for all
  using (exists (
    select 1 from treinos
    where treinos.id = treino_exercicios.treino_id
    and treinos.trainer_id = auth.uid()
  ))
  with check (exists (
    select 1 from treinos
    where treinos.id = treino_exercicios.treino_id
    and treinos.trainer_id = auth.uid()
  ));

create policy "trainer vê e edita seus pagamentos"
  on pagamentos for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

-- Cria a linha em trainers automaticamente quando um usuário se cadastra.
create function public.handle_new_trainer()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.trainers (id, nome, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', ''), new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_trainer();
