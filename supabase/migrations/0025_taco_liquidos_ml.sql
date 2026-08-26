-- Complementa a 0020 (medidas caseiras/"unidade" pra ovo, pão, maçã, banana):
-- nenhum item líquido da base local (leite, suco, refrigerante, iogurte...)
-- tinha default_unit = 'ml' — o seletor de unidade em montar-dieta.html só
-- oferece "ml" quando `isLiquid` (default_unit === 'ml'), então hoje esses
-- alimentos só podem ser lançados em g, mesmo sendo medidos em ml na prática
-- (ex.: "200ml de leite"). availableMeasures()/computeNutrients() (Edge
-- Function + espelho em montar-dieta.html) já tratam ml pra líquido tratando
-- o valor por-100 como por-100ml direto — não precisa de conversão adicional
-- pros itens abaixo, todos com densidade próxima de 1g/ml.
--
-- Ficam de fora de propósito (não são liquidos "bebíveis" em ml): leite
-- condensado, creme de leite, doce de leite (consistência de colher/pasta),
-- leite em pó e café em pó (sólidos), chocolate ao leite (barra), canjica
-- (prato) — esses continuam em g.
update taco_alimentos set default_unit = 'ml'
  where id in (
    471,           -- Café, infusão 10%
    188,           -- Caju, suco concentrado, envasado
    478,           -- Coco, água de
    448, 449, 450, 451, 452, -- Iogurte (natural/desnatado/sabores)
    209, 211, 213, 215, 217, -- Laranja, suco (variações)
    454,           -- Leite, de cabra
    523,           -- Leite, de coco
    455,           -- Leite, de vaca, achocolatado
    457,           -- Leite, de vaca, desnatado, UHT
    458,           -- Leite, de vaca, integral
    460,           -- Leite, fermentado
    218, 219,       -- Limão, suco (cravo/galego)
    234,           -- Maracujá, suco concentrado, envasado
    479, 480, 481, 482, 483, -- Refrigerante (água tônica/cola/guaraná/laranja/limão)
    252,           -- Tangerina, Poncã, suco
    258            -- Uva, suco concentrado, envasado
  );
