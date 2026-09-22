// Gráficos de progressão de carga e de peso corporal (Chart.js) —
// compartilhado entre app-aluno.html e aluno-detalhe.html. Requer
// avaliacao-fisica.js (fmtNum/fmtDataBr), avaliacao-charts.js
// (fundoSolidoPlugin) e o Chart.js (UMD) carregados antes deste script.

// A carga é texto livre (ex.: "40 kg - 30 kg - 20 kg" num drop set). Pro
// gráfico usa o MAIOR número do texto; o texto salvo nunca é alterado.
// Sem número nenhum (ex.: "elástico") → null, fica fora do gráfico.
function cargaNumero(texto) {
  const nums = String(texto == null ? '' : texto).match(/\d+(?:[.,]\d+)?/g);
  if (!nums) return null;
  const valores = nums.map(n => Number(n.replace(',', '.'))).filter(n => n > 0);
  return valores.length ? Math.max(...valores) : null;
}

// "20 kg" / "22,5 kg" — sem ",0" à toa.
function fmtKg(n) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + ' kg';
}
function fmtKgSinal(n) {
  return (n > 0.0001 ? '+' : n < -0.0001 ? '-' : '') + fmtKg(Math.abs(n));
}

function fmtDataCurta(dataStr) {
  return new Date(dataStr + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// cargas: linhas de serie_cargas com o embed
// treino_exercicios(exercicio_id, exercicios(nome)). Agrupa pelo exercício
// do acervo (não pelo treino_exercicio), pra histórico continuar quando o
// personal monta um treino novo com o mesmo exercício. Cada dia vira um
// ponto com a maior carga de qualquer série daquele dia.
function progressaoPorExercicio(cargas) {
  const porEx = {};
  (cargas || []).forEach(c => {
    const kg = cargaNumero(c.carga);
    const te = c.treino_exercicios;
    if (kg == null || !te || !te.exercicio_id) return;
    const ex = porEx[te.exercicio_id] || (porEx[te.exercicio_id] = {
      exercicioId: te.exercicio_id, nome: (te.exercicios && te.exercicios.nome) || 'Exercício', porData: {}
    });
    ex.porData[c.data] = Math.max(ex.porData[c.data] || 0, kg);
  });
  return Object.values(porEx).map(ex => {
    const pontos = Object.keys(ex.porData).sort().map(data => ({ data, kg: ex.porData[data] }));
    const inicial = pontos[0].kg, atual = pontos[pontos.length - 1].kg;
    const recorde = Math.max(...pontos.map(p => p.kg));
    const delta = atual - inicial;
    // Estagnado: 4+ treinos e a carga não subiu nos últimos 4 registros.
    const ult = pontos.slice(-4);
    const estagnado = pontos.length >= 4 && Math.max(...ult.map(p => p.kg)) <= ult[0].kg;
    return {
      exercicioId: ex.exercicioId, nome: ex.nome, pontos, inicial, atual, recorde, delta,
      deltaPct: inicial ? (delta / inicial) * 100 : 0,
      ultimaData: pontos[pontos.length - 1].data,
      bateuRecordeUltimo: pontos.length > 1 && atual === recorde && atual > Math.max(...pontos.slice(0, -1).map(p => p.kg)),
      estagnado
    };
  }).sort((a, b) => a.ultimaData < b.ultimaData ? 1 : a.ultimaData > b.ultimaData ? -1 : a.nome.localeCompare(b.nome));
}

// Cards de resumo de um exercício — [{ label, valor, cor }].
function resumoCargaCards(p) {
  const cor = p.delta > 0 ? '#4ade80' : p.delta < 0 ? '#f87171' : '#9aa4b2';
  return [
    { label: 'Primeira', valor: fmtKg(p.inicial), cor: '#e5e9f0' },
    { label: 'Atual', valor: fmtKg(p.atual), cor: '#e5e9f0' },
    { label: 'Recorde', valor: fmtKg(p.recorde), cor: '#facc15' },
    { label: 'Evolução', valor: fmtKgSinal(p.delta) + (p.inicial ? ' (' + fmtDiffSinal(p.deltaPct, 0, '%') + ')' : ''), cor }
  ];
}

// Frase curta de leitura do exercício — o "insight" em cima do gráfico.
function insightCarga(p) {
  if (p.pontos.length < 2) return 'Registre esse exercício em mais treinos pra ver a evolução.';
  if (p.bateuRecordeUltimo) return '🏆 Recorde pessoal no último treino!';
  if (p.estagnado) return 'Carga parada nos últimos 4 treinos — hora de conversar com seu personal sobre progredir.';
  if (p.delta > 0) return 'Você já subiu ' + fmtKg(p.delta) + ' desde o primeiro registro.';
  if (p.delta < 0) return 'Carga atual abaixo do primeiro registro (' + fmtKgSinal(p.delta) + ').';
  return 'Carga estável desde o primeiro registro.';
}

function renderCargaChart(canvas, p, corFundo) {
  if (canvas._chartInstance) canvas._chartInstance.destroy();
  const cor = '#f97316';
  canvas._chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    plugins: [fundoSolidoPlugin(corFundo || '#10151f')],
    data: { labels: p.pontos.map(x => fmtDataCurta(x.data)), datasets: [{
      label: 'Carga', data: p.pontos.map(x => x.kg), borderColor: cor, backgroundColor: cor + '20',
      cubicInterpolationMode: 'monotone', fill: true, pointRadius: 4, pointHoverRadius: 6,
      pointBackgroundColor: p.pontos.map(x => x.kg === p.recorde ? '#facc15' : cor),
      pointBorderColor: p.pontos.map(x => x.kg === p.recorde ? '#facc15' : cor)
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          title: (items) => fmtDataBr(p.pontos[items[0].dataIndex].data),
          label: (ctx) => {
            const i = ctx.dataIndex, kg = ctx.parsed.y;
            const linhas = [fmtKg(kg) + (kg === p.recorde ? '  🏆 recorde' : '')];
            if (i > 0) linhas.push(fmtKgSinal(kg - p.pontos[i - 1].kg) + ' vs treino anterior');
            return linhas;
          }
        } }
      },
      scales: { y: { beginAtZero: false, ticks: { callback: (v) => fmtNum(v, 0) + ' kg' } } }
    }
  });
  return canvas._chartInstance;
}

// Peso corporal (registros_peso) — pesosAsc ordenado por data crescente.
function resumoPesoCorporal(pesosAsc) {
  if (!pesosAsc.length) return null;
  const primeiro = Number(pesosAsc[0].peso), atual = Number(pesosAsc[pesosAsc.length - 1].peso);
  const valores = pesosAsc.map(p => Number(p.peso));
  // Tendência (kg/semana) por regressão linear dos últimos 30 dias — menos
  // sensível ao sobe-e-desce diário que comparar só dois pontos.
  const ultimaData = new Date(pesosAsc[pesosAsc.length - 1].data + 'T00:00:00');
  const janela = pesosAsc.filter(p => (ultimaData - new Date(p.data + 'T00:00:00')) / 864e5 <= 30);
  let tendenciaSemana = null;
  if (janela.length >= 3) {
    const xs = janela.map(p => (new Date(p.data + 'T00:00:00') - ultimaData) / 864e5);
    const ys = janela.map(p => Number(p.peso));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    const den = xs.reduce((s, x) => s + (x - mx) * (x - mx), 0);
    if (den > 0) tendenciaSemana = (num / den) * 7;
  }
  return { primeiro, atual, delta: atual - primeiro, minimo: Math.min(...valores), maximo: Math.max(...valores), tendenciaSemana };
}

function resumoPesoCards(r) {
  const corDelta = Math.abs(r.delta) < 0.05 ? '#9aa4b2' : '#60a5fa';
  const cards = [
    { label: 'Atual', valor: fmtNum(r.atual, 1) + ' kg', cor: '#e5e9f0' },
    { label: 'Desde o início', valor: fmtDiffSinal(r.delta, 1, ' kg'), cor: corDelta },
    { label: 'Menor / maior', valor: fmtNum(r.minimo, 1) + ' / ' + fmtNum(r.maximo, 1), cor: '#e5e9f0' }
  ];
  if (r.tendenciaSemana != null) {
    cards.push({ label: 'Ritmo (últ. 30 dias)', valor: fmtDiffSinal(r.tendenciaSemana, 2, ' kg') + '/sem', cor: corDelta });
  }
  return cards;
}

// Linha do peso + média móvel de 7 registros (tira o ruído de água/sal
// do dia a dia e mostra a direção real).
function renderPesoCorporalChart(canvas, pesosAsc, corFundo) {
  if (canvas._chartInstance) canvas._chartInstance.destroy();
  const valores = pesosAsc.map(p => Number(p.peso));
  const media = valores.map((_, i) => {
    const janela = valores.slice(Math.max(0, i - 6), i + 1);
    return janela.reduce((a, b) => a + b, 0) / janela.length;
  });
  const datasets = [{
    label: 'Peso', data: valores, borderColor: '#60a5fa', backgroundColor: '#60a5fa20',
    tension: .25, fill: true, pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: '#60a5fa'
  }];
  if (valores.length >= 5) {
    datasets.push({
      label: 'Média 7 registros', data: media, borderColor: '#f97316', borderDash: [5, 4],
      borderWidth: 2, pointRadius: 0, fill: false, tension: .3
    });
  }
  canvas._chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    plugins: [fundoSolidoPlugin(corFundo || '#10151f')],
    data: { labels: pesosAsc.map(p => fmtDataCurta(p.data)), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: datasets.length > 1, labels: { color: '#9aa4b2', boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: {
          title: (items) => fmtDataBr(pesosAsc[items[0].dataIndex].data),
          label: (ctx) => {
            const i = ctx.dataIndex;
            if (ctx.datasetIndex === 1) return 'Média: ' + fmtNum(ctx.parsed.y, 1) + ' kg';
            const linha = 'Peso: ' + fmtNum(ctx.parsed.y, 1) + ' kg';
            return i > 0 ? [linha, fmtDiffSinal(valores[i] - valores[i - 1], 1, ' kg') + ' vs registro anterior'] : linha;
          }
        } }
      },
      scales: { y: { beginAtZero: false, ticks: { callback: (v) => fmtNum(v, 1) + ' kg' } } }
    }
  });
  return canvas._chartInstance;
}
