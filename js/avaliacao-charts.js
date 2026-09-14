// Gráficos de evolução da Avaliação Física (Chart.js) — compartilhado entre
// aluno-detalhe.html e app-aluno.html. Requer avaliacao-fisica.js e o
// Chart.js (UMD) carregados antes deste script.

const METRICA_LABEL = {
  percGordura: '% Gordura',
  massaGorda: 'Massa de gordura',
  massaMagra: 'Massa livre de gordura'
};
const METRICA_SUFIXO = { percGordura: '%', massaGorda: ' kg', massaMagra: ' kg' };
const METRICA_COR = { percGordura: '#f97316', massaGorda: '#f87171', massaMagra: '#4ade80' };

// Preenche o canvas com uma cor sólida antes do Chart.js desenhar por cima.
// Sem isso o canvas fica transparente e o PNG exportado pro PDF fica enorme
// (muito ruído de cor no alpha-blend da área preenchida do gráfico).
function fundoSolidoPlugin(cor) {
  return { id: 'fundoSolido', beforeDraw: (chart) => {
    const { ctx, width, height } = chart;
    ctx.save(); ctx.fillStyle = cor; ctx.fillRect(0, 0, width, height); ctx.restore();
  } };
}

function renderComposicaoChart(canvas, avaliacoesAsc, metrica, corFundo) {
  if (canvas._chartInstance) canvas._chartInstance.destroy();
  const labels = avaliacoesAsc.map(av => fmtDataBr(av.data));
  const dados = avaliacoesAsc.map(av => avaliacaoResultado(av)[metrica]);
  const cor = METRICA_COR[metrica];
  canvas._chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    plugins: [fundoSolidoPlugin(corFundo || '#10151f')],
    data: { labels, datasets: [{
      label: METRICA_LABEL[metrica], data: dados, borderColor: cor,
      backgroundColor: cor + '20', tension: .3, fill: true, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: cor
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => avaliacoesAsc[items[0].dataIndex] ? fmtDataBr(avaliacoesAsc[items[0].dataIndex].data) : '',
            label: (ctx) => {
              const av = avaliacoesAsc[ctx.dataIndex];
              return [METRICA_LABEL[metrica] + ': ' + fmtNum(ctx.parsed.y, 1) + METRICA_SUFIXO[metrica], 'Peso: ' + fmtNum(av.peso_kg, 1) + ' kg'];
            }
          }
        }
      },
      scales: { y: { beginAtZero: false, ticks: { callback: (v) => fmtNum(v, 0) + METRICA_SUFIXO[metrica] } } }
    }
  });
  return canvas._chartInstance;
}

function renderPesoChart(canvas, avaliacoesAsc, corFundo) {
  if (canvas._chartInstance) canvas._chartInstance.destroy();
  const labels = avaliacoesAsc.map(av => fmtDataBr(av.data));
  const dados = avaliacoesAsc.map(av => Number(av.peso_kg));
  canvas._chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    plugins: [fundoSolidoPlugin(corFundo || '#10151f')],
    data: { labels, datasets: [{
      label: 'Peso', data: dados, borderColor: '#60a5fa', backgroundColor: '#60a5fa20',
      tension: .3, fill: true, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: '#60a5fa'
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => 'Peso: ' + fmtNum(ctx.parsed.y, 1) + ' kg' } }
      },
      scales: { y: { beginAtZero: false, ticks: { callback: (v) => fmtNum(v, 0) + ' kg' } } }
    }
  });
  return canvas._chartInstance;
}
