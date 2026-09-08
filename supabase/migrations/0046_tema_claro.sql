alter table trainers add column tema text not null default 'escuro' check (tema in ('escuro', 'claro'));
alter table clientes add column tema text not null default 'escuro' check (tema in ('escuro', 'claro'));
alter table admins   add column tema text not null default 'escuro' check (tema in ('escuro', 'claro'));
