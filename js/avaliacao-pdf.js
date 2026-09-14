// Geração de PDF da Avaliação Física — compartilhado entre aluno-detalhe.html
// (profissional) e app-aluno.html (aluno). Mesmo gerador pros dois perfis,
// sem nenhuma diferença de modelo. Requer avaliacao-fisica.js e jsPDF (UMD)
// carregados antes deste script.

const PDF_MARGEM = 16;
const PDF_LARGURA = 210; // A4 mm
const PDF_ALTURA = 297;

function pdfNovaPaginaSeNecessario(doc, y, espacoNecessario) {
  if (y + espacoNecessario > PDF_ALTURA - PDF_MARGEM) {
    doc.addPage();
    return 20;
  }
  return y;
}

function pdfLinhaSeparadora(doc, y) {
  doc.setDrawColor(220);
  doc.line(PDF_MARGEM, y, PDF_LARGURA - PDF_MARGEM, y);
}

function pdfCabecalho(doc, alunoNome, dataLabel, trainerNome) {
  let y = 20;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(20);
  doc.text('AVALIAÇÃO FÍSICA', PDF_MARGEM, y); y += 6.5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(120);
  doc.text('RELATÓRIO DE COMPOSIÇÃO CORPORAL', PDF_MARGEM, y); y += 9;
  doc.setTextColor(20); doc.setFontSize(10.5);
  doc.text('Aluno: ' + (alunoNome || '—'), PDF_MARGEM, y); y += 5.5;
  doc.text('Data: ' + dataLabel, PDF_MARGEM, y); y += 5.5;
  doc.text('Profissional responsável: ' + (trainerNome || '—'), PDF_MARGEM, y); y += 7;
  pdfLinhaSeparadora(doc, y); y += 8;
  return y;
}

function pdfRodape(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(140);
    doc.text('Método utilizado: Jackson & Pollock — 7 dobras cutâneas + equação de Siri.', PDF_MARGEM, PDF_ALTURA - 12);
    doc.text(String(i) + '/' + pageCount, PDF_LARGURA - PDF_MARGEM, PDF_ALTURA - 12, { align: 'right' });
  }
}

function pdfTituloBloco(doc, y, texto) {
  y = pdfNovaPaginaSeNecessario(doc, y, 14);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor(20);
  doc.text(texto, PDF_MARGEM, y);
  return y + 7;
}

function pdfLinhaLabelValor(doc, y, label, valor, colX) {
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(60);
  doc.text(label, PDF_MARGEM, y);
  doc.setFont('helvetica', 'bold'); doc.setTextColor(20);
  doc.text(String(valor), colX || (PDF_MARGEM + 75), y);
  return y + 6.2;
}

// Renderiza um Chart.js num canvas offscreen (fora da tela, mas anexado ao
// DOM — Chart.js precisa de layout real pra medir), com fundo branco sólido
// (pro JPEG sair correto e leve — sem fundo sólido o canvas fica
// transparente e o PNG exportado fica enorme), e retorna um JPEG como data
// URL. O canvas é removido logo em seguida.
function chartParaImagemJpeg(renderFn, larguraPx, alturaPx) {
  const canvas = document.createElement('canvas');
  canvas.width = larguraPx; canvas.height = alturaPx;
  canvas.style.position = 'fixed'; canvas.style.left = '-9999px'; canvas.style.top = '0';
  canvas.style.width = larguraPx + 'px'; canvas.style.height = alturaPx + 'px';
  document.body.appendChild(canvas);
  const chart = renderFn(canvas);
  const img = canvas.toDataURL('image/jpeg', 0.85);
  if (chart && chart.destroy) chart.destroy();
  document.body.removeChild(canvas);
  return img;
}

function pdfInserirGraficoComposicao(doc, y, avaliacoesAsc, metrica) {
  const larguraMm = PDF_LARGURA - PDF_MARGEM * 2;
  const alturaMm = 48;
  y = pdfNovaPaginaSeNecessario(doc, y, alturaMm + 8);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(80);
  doc.text(METRICA_LABEL[metrica], PDF_MARGEM, y); y += 3;
  const img = chartParaImagemJpeg((canvas) => renderComposicaoChart(canvas, avaliacoesAsc, metrica, '#ffffff'), 900, 340);
  doc.addImage(img, 'JPEG', PDF_MARGEM, y, larguraMm, alturaMm);
  return y + alturaMm + 6;
}

function pdfInserirGraficoPeso(doc, y, avaliacoesAsc) {
  const larguraMm = PDF_LARGURA - PDF_MARGEM * 2;
  const alturaMm = 48;
  y = pdfNovaPaginaSeNecessario(doc, y, alturaMm + 8);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(80);
  doc.text('Peso', PDF_MARGEM, y); y += 3;
  const img = chartParaImagemJpeg((canvas) => renderPesoChart(canvas, avaliacoesAsc, '#ffffff'), 900, 340);
  doc.addImage(img, 'JPEG', PDF_MARGEM, y, larguraMm, alturaMm);
  return y + alturaMm + 6;
}

function pdfBlocoResumo(doc, y, avaliacao) {
  const r = avaliacaoResultado(avaliacao);
  y = pdfTituloBloco(doc, y, 'RESUMO');
  y = pdfLinhaLabelValor(doc, y, 'Peso', fmtNum(avaliacao.peso_kg, 1) + ' kg');
  y = pdfLinhaLabelValor(doc, y, '% Gordura', fmtNum(r.percGordura, 1) + '%');
  y = pdfLinhaLabelValor(doc, y, 'Massa de gordura', fmtNum(r.massaGorda, 1) + ' kg');
  y = pdfLinhaLabelValor(doc, y, 'Massa livre de gordura', fmtNum(r.massaMagra, 1) + ' kg');
  return y + 4;
}

function pdfBlocoEvolucaoDesdePrimeira(doc, y, primeira, atual) {
  const d = diffAvaliacoes(primeira, atual);
  y = pdfTituloBloco(doc, y, 'EVOLUÇÃO DESDE A PRIMEIRA AVALIAÇÃO');
  y = pdfLinhaLabelValor(doc, y, 'Peso', fmtDiffSinal(d.peso, 1, ' kg'));
  y = pdfLinhaLabelValor(doc, y, '% Gordura', fmtDiffSinal(d.percGordura, 1, ' p.p.'));
  y = pdfLinhaLabelValor(doc, y, 'Massa de gordura', fmtDiffSinal(d.massaGorda, 1, ' kg'));
  y = pdfLinhaLabelValor(doc, y, 'Massa livre de gordura', fmtDiffSinal(d.massaMagra, 1, ' kg'));
  return y + 4;
}

function pdfBlocoDetalhado(doc, y, avaliacao) {
  const r = avaliacaoResultado(avaliacao);
  y = pdfTituloBloco(doc, y, 'AVALIAÇÃO DETALHADA — ' + fmtDataBr(avaliacao.data));

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(80);
  doc.text('DADOS ANTROPOMÉTRICOS', PDF_MARGEM, y); y += 6;
  y = pdfLinhaLabelValor(doc, y, 'Peso', fmtNum(avaliacao.peso_kg, 1) + ' kg', PDF_MARGEM + 62);
  y = pdfLinhaLabelValor(doc, y, 'Altura', avaliacao.altura_cm ? fmtNum(avaliacao.altura_cm, 0) + ' cm' : '—', PDF_MARGEM + 62);
  y = pdfLinhaLabelValor(doc, y, 'Sexo', avaliacao.sexo === 'M' ? 'Masculino' : 'Feminino', PDF_MARGEM + 62);
  y = pdfLinhaLabelValor(doc, y, 'Idade', avaliacao.idade + ' anos', PDF_MARGEM + 62);
  y += 3;

  y = pdfNovaPaginaSeNecessario(doc, y, 60);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(80);
  doc.text('DOBRAS CUTÂNEAS (mm)', PDF_MARGEM, y); y += 6;
  const dobras = avaliacaoDobrasDeRegistro(avaliacao);
  DOBRAS_CAMPOS_PADRAO.forEach(([chave, label]) => {
    y = pdfLinhaLabelValor(doc, y, label, fmtNum(dobras[chave], 1) + ' mm', PDF_MARGEM + 62);
  });
  y = pdfLinhaLabelValor(doc, y, 'Soma das 7 dobras', fmtNum(r.soma, 1) + ' mm', PDF_MARGEM + 62);
  y += 3;

  y = pdfNovaPaginaSeNecessario(doc, y, 40);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(80);
  doc.text('RESULTADOS', PDF_MARGEM, y); y += 6;
  y = pdfLinhaLabelValor(doc, y, 'Densidade corporal', fmtNum(r.densidade, 4) + ' g/cm³', PDF_MARGEM + 62);
  y = pdfLinhaLabelValor(doc, y, 'Percentual de gordura', fmtNum(r.percGordura, 1) + '%', PDF_MARGEM + 62);
  y = pdfLinhaLabelValor(doc, y, 'Massa de gordura', fmtNum(r.massaGorda, 1) + ' kg', PDF_MARGEM + 62);
  y = pdfLinhaLabelValor(doc, y, 'Massa livre de gordura', fmtNum(r.massaMagra, 1) + ' kg', PDF_MARGEM + 62);
  return y + 4;
}

// PDF de UMA avaliação específica — os dados são sempre os daquele registro
// (nunca os dados atuais do aluno), e `historico` (opcional, todas as
// avaliações do aluno) só alimenta os gráficos de evolução do bloco 2.
function gerarPdfAvaliacao({ avaliacao, alunoNome, trainerNome, historico }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = pdfCabecalho(doc, alunoNome, fmtDataBr(avaliacao.data), trainerNome);

  y = pdfBlocoResumo(doc, y, avaliacao);

  const asc = ordenarAvaliacoesAsc(historico && historico.length ? historico : [avaliacao]);
  if (asc.length >= 2) {
    pdfLinhaSeparadora(doc, y); y += 8;
    y = pdfTituloBloco(doc, y, 'EVOLUÇÃO');
    y = pdfInserirGraficoComposicao(doc, y, asc, 'percGordura');
    y = pdfInserirGraficoComposicao(doc, y, asc, 'massaGorda');
    y = pdfInserirGraficoComposicao(doc, y, asc, 'massaMagra');
    y = pdfInserirGraficoPeso(doc, y, asc);
    pdfLinhaSeparadora(doc, y); y += 8;
    y = pdfBlocoEvolucaoDesdePrimeira(doc, y, asc[0], asc[asc.length - 1]);
  }

  pdfLinhaSeparadora(doc, y); y += 8;
  pdfBlocoDetalhado(doc, y, avaliacao);

  pdfRodape(doc);
  return doc;
}

// "Gerar relatório de evolução" — primeira avaliação, atual, histórico e
// gráficos, pensado pro profissional mandar pro aluno.
function gerarPdfEvolucao({ avaliacoes, alunoNome, trainerNome }) {
  const asc = ordenarAvaliacoesAsc(avaliacoes);
  if (asc.length < 1) throw new Error('Nenhuma avaliação registrada.');
  const primeira = asc[0];
  const atual = asc[asc.length - 1];

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = pdfCabecalho(doc, alunoNome, fmtDataBr(primeira.data) + ' — ' + fmtDataBr(atual.data), trainerNome);

  y = pdfTituloBloco(doc, y, 'RELATÓRIO DE EVOLUÇÃO');
  y = pdfLinhaLabelValor(doc, y, 'Primeira avaliação', fmtDataBr(primeira.data));
  y = pdfLinhaLabelValor(doc, y, 'Avaliação atual', fmtDataBr(atual.data));
  y += 2;

  if (asc.length >= 2) {
    y = pdfInserirGraficoComposicao(doc, y, asc, 'percGordura');
    y = pdfInserirGraficoComposicao(doc, y, asc, 'massaGorda');
    y = pdfInserirGraficoComposicao(doc, y, asc, 'massaMagra');
    y = pdfInserirGraficoPeso(doc, y, asc);
  }

  pdfLinhaSeparadora(doc, y); y += 8;
  y = pdfBlocoEvolucaoDesdePrimeira(doc, y, primeira, atual);

  pdfLinhaSeparadora(doc, y); y += 8;
  y = pdfTituloBloco(doc, y, 'HISTÓRICO DE AVALIAÇÕES');
  asc.slice().reverse().forEach(av => {
    const r = avaliacaoResultado(av);
    y = pdfNovaPaginaSeNecessario(doc, y, 6.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(20);
    doc.text(
      fmtDataBr(av.data) + '  ·  ' + fmtNum(av.peso_kg, 1) + ' kg  ·  ' + fmtNum(r.percGordura, 1) + '% gordura  ·  ' +
      fmtNum(r.massaGorda, 1) + ' kg gordura  ·  ' + fmtNum(r.massaMagra, 1) + ' kg MLG',
      PDF_MARGEM, y
    );
    y += 6.5;
  });

  pdfRodape(doc);
  return doc;
}

// Compartilha o PDF pelo mecanismo nativo do dispositivo (Web Share API
// com arquivo) quando disponível; senão baixa normalmente.
async function compartilharOuBaixarPdf(doc, nomeArquivo) {
  const blob = doc.output('blob');
  const file = new File([blob], nomeArquivo, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: nomeArquivo });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // usuário cancelou o share
    }
  }
  doc.save(nomeArquivo);
}
