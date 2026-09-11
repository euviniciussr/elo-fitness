-- Foto de perfil do profissional (trainer) ----------------------------------
-- Coluna guarda o path do arquivo no Storage (não a URL), seguindo o padrão
-- de fotos-evolucao. Bucket é público porque a foto do profissional já é
-- exibida publicamente (catálogo público em perfil.html), então dá pra usar
-- getPublicUrl() direto, sem precisar de signed URLs em toda tela que mostra
-- o avatar do trainer.

alter table trainers add column foto_url text;

insert into storage.buckets (id, name, public)
values ('fotos-perfil', 'fotos-perfil', true)
on conflict (id) do nothing;

create policy "trainer gerencia a própria foto de perfil"
  on storage.objects for all
  using (
    bucket_id = 'fotos-perfil'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'fotos-perfil'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "qualquer um lê fotos de perfil (bucket público)"
  on storage.objects for select
  using (bucket_id = 'fotos-perfil');
