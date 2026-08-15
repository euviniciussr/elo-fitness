-- Calculadora energética (TMB / GET / Meta calórica) — aba "Energético" no
-- perfil do aluno. Os 4 campos abaixo são os únicos dados persistidos; TMB,
-- GET e Meta calórica são sempre derivados em tempo real a partir deles +
-- idade/altura_cm/peso_kg (já existentes), nunca armazenados prontos —
-- assim ficam sempre atualizados quando o cadastro do aluno muda.
--
-- "nivel_atividade" e "objetivo_calorico" são conceitos novos e distintos
-- dos já existentes "nivel" (nível de experiência: iniciante/intermediário/
-- avançado) e "objetivo" (objetivo geral de treino), por isso ganham nomes
-- de coluna próprios em vez de reaproveitar os antigos.
--
-- RLS e GRANTs não precisam de ajuste: as policies "for all" já existentes
-- em anamnese_respostas (0006_aluno_e_nutricao.sql) cobrem a tabela inteira,
-- incluindo colunas novas.

alter table anamnese_respostas
  add column sexo text check (sexo in ('M', 'F')),
  add column nivel_atividade text check (nivel_atividade in ('sedentario', 'leve', 'moderado', 'muito_ativo', 'extremo')),
  add column objetivo_calorico text check (objetivo_calorico in ('emagrecer', 'emagrecer_agressivo', 'manter', 'ganho_seco', 'ganho_agressivo')),
  add column estado_atual text check (estado_atual in ('magro', 'magro_gordura_moderada', 'falso_magro', 'acima_peso'));
