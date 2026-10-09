// Personalização individual de exercícios da plataforma (migration 0063).
// O exercício global é um registro único em `exercicios`; cada profissional
// pode sobrepor nome, grupo muscular e vídeo em `exercicio_personalizacoes`.
// Campo nulo na personalização = herda o valor oficial. O isolamento é a RLS
// (profissional só lê as próprias; aluno só as do profissional que prescreveu
// o treino dele) — aqui é só a mescla pra exibição, sempre filtrando pelo
// trainerId de quem prescreve.
const ExPers = (() => {
  const CAMPOS = ['nome', 'categoria', 'video_url'];
  let cache = null;

  function carregar(recarregar) {
    if (!cache || recarregar) {
      cache = supabaseClient.from('exercicio_personalizacoes')
        .select('id, exercicio_id, trainer_id, nome, categoria, video_url')
        .then(({ data }) => data || []);
    }
    return cache;
  }

  function mesclar(ex, p) {
    if (!ex || !p) return ex;
    const out = { ...ex, personalizacao: p, original: {} };
    CAMPOS.forEach(c => {
      if (c in ex) out.original[c] = ex[c];
      if (p[c] && c in ex) out[c] = p[c];
    });
    return out;
  }

  async function mapaDe(trainerId) {
    const rows = await carregar();
    const mapa = {};
    rows.forEach(p => { if (p.trainer_id === trainerId) mapa[p.exercicio_id] = p; });
    return mapa;
  }

  // Lista de exercícios (acervo, seletor do treino): mesma quantidade de
  // itens, com a versão do profissional aplicada e reordenada por nome.
  async function lista(exs, trainerId) {
    const mapa = await mapaDe(trainerId);
    if (!Object.keys(mapa).length) return exs || [];
    return (exs || []).map(ex => mesclar(ex, mapa[ex.id]))
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt', { sensitivity: 'base' }));
  }

  // Linhas de treino_exercicios com `exercicios(...)` embutido.
  async function embutidos(tes, trainerId) {
    const mapa = await mapaDe(trainerId);
    (tes || []).forEach(te => {
      if (te.exercicios && mapa[te.exercicio_id]) te.exercicios = mesclar(te.exercicios, mapa[te.exercicio_id]);
    });
    return tes || [];
  }

  // Linhas de serie_cargas com `treino_exercicios(exercicio_id, exercicios(nome))`.
  async function cargas(rows, trainerId) {
    await embutidos((rows || []).map(r => r.treino_exercicios).filter(Boolean), trainerId);
    return rows || [];
  }

  // Salva a versão do profissional. Campo vazio ou igual ao oficial vira
  // nulo (volta a herdar); se nada sobrar personalizado, a linha é removida.
  async function salvar(exercicioId, trainerId, original, valores) {
    const payload = {};
    CAMPOS.forEach(c => {
      const v = String(valores[c] || '').trim();
      payload[c] = v && v !== String(original[c] || '').trim() ? v : null;
    });
    let res;
    if (CAMPOS.every(c => payload[c] === null)) {
      res = await restaurar(exercicioId, trainerId);
    } else {
      res = await supabaseClient.from('exercicio_personalizacoes')
        .upsert({ exercicio_id: exercicioId, trainer_id: trainerId, ...payload, updated_at: new Date().toISOString() }, { onConflict: 'exercicio_id,trainer_id' });
    }
    cache = null;
    return res;
  }

  async function restaurar(exercicioId, trainerId) {
    const res = await supabaseClient.from('exercicio_personalizacoes').delete().eq('exercicio_id', exercicioId).eq('trainer_id', trainerId);
    cache = null;
    return res;
  }

  return { carregar, lista, embutidos, cargas, salvar, restaurar };
})();
