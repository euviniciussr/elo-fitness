-- Padroniza nomenclaturas duplicadas de grupamento muscular em exercicios.categoria.
-- "Peito"/"Costas"/"Glúteo"/"Abdome" nunca mais devem existir como valor da coluna
-- a partir daqui — só os nomes canônicos abaixo, pra análises de volume por
-- grupamento (montar-treino.html) não mostrarem a mesma categoria duas vezes.

update exercicios set categoria = 'Peitoral' where categoria = 'Peito';
update exercicios set categoria = 'Dorsal'   where categoria = 'Costas';
update exercicios set categoria = 'Glúteos'  where categoria = 'Glúteo';
update exercicios set categoria = 'Abdômen'  where categoria = 'Abdome';

-- Trava em nível de banco: bloqueia INSERT/UPDATE gravando qualquer uma das
-- 4 nomenclaturas antigas, mesmo que uma chamada futura (API direta, bug de
-- UI, etc.) ignore o <select> do acervo.html que já só oferece os nomes
-- canônicos. Não restringe nenhum outro valor de categoria.
alter table exercicios add constraint categoria_sem_nomenclatura_antiga
  check (categoria is null or categoria not in ('Peito', 'Costas', 'Glúteo', 'Abdome'));
