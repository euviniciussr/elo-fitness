// Fotos de avaliação/evolução — fonte única usada por anamnese.html (etapa de
// fotos após a anamnese), app-aluno.html (aluno) e aluno-detalhe.html
// (profissional): ângulos, envio, visualizador com zoom, download da foto
// original e geração da imagem final de uma comparação.
//
// Os arquivos ficam no bucket privado fotos-evolucao; a linha em
// fotos_evolucao guarda o path (coluna url) e o ângulo (coluna angulo,
// migration 0060). Download/zoom sempre usam o arquivo original — nada aqui
// reescreve ou recomprime o que está no Storage.

const FOTO_ANGULOS = [
  { key: 'frente', label: 'Frente', arquivo: 'Frente', dica: 'De frente pra câmera, braços relaxados ao lado do corpo.' },
  { key: 'costas', label: 'Costas', arquivo: 'Costas', dica: 'De costas pra câmera, mesma postura da foto de frente.' },
  { key: 'lado_direito', label: 'Lado direito', arquivo: 'LadoDireito', dica: 'Lado direito do corpo virado pra câmera.' },
  { key: 'lado_esquerdo', label: 'Lado esquerdo', arquivo: 'LadoEsquerdo', dica: 'Lado esquerdo do corpo virado pra câmera.' }
];

function fotoAngulo(key) {
  return FOTO_ANGULOS.find(a => a.key === key) || null;
}

function fotoAnguloLabel(key) {
  const a = fotoAngulo(key);
  return a ? a.label : '';
}

// Ordem de exibição: frente, costas, lado direito, lado esquerdo; fotos sem
// ângulo (antigas) por último, na ordem original.
function fotoAnguloOrdem(key) {
  const i = FOTO_ANGULOS.findIndex(a => a.key === key);
  return i === -1 ? FOTO_ANGULOS.length : i;
}

function ordenarFotosPorAngulo(fotos) {
  return fotos.map((f, i) => ({ f, i }))
    .sort((a, b) => (fotoAnguloOrdem(a.f.angulo) - fotoAnguloOrdem(b.f.angulo)) || (a.i - b.i))
    .map(x => x.f);
}

// Mini silhueta do ângulo esperado (indicador visual simples, sem câmera
// customizada). Braço/perna destacados indicam o lado virado pra câmera.
function fotoAnguloSvg(key, cor) {
  const c = cor || 'currentColor';
  const corpo = '<circle cx="20" cy="8" r="5"/>';
  if (key === 'frente' || key === 'costas') {
    const rosto = key === 'frente'
      ? '<circle cx="18" cy="7.5" r=".9" fill="' + c + '"/><circle cx="22" cy="7.5" r=".9" fill="' + c + '"/>'
      : '';
    return '<svg width="34" height="54" viewBox="0 0 40 64" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      corpo + rosto +
      '<path d="M14 16H26L27 36H24V62H21V42H19V62H16V36H13Z"/>' +
      '<path d="M14 17L9 35M26 17L31 35"/></svg>';
  }
  const dir = key === 'lado_direito';
  // perfil: nariz aponta pra direita (lado direito) ou esquerda
  const nariz = dir ? '<path d="M25 8l2 1.5-2 .5"/>' : '<path d="M15 8l-2 1.5 2 .5"/>';
  return '<svg width="34" height="54" viewBox="0 0 40 64" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    corpo + nariz +
    '<path d="M17 16H23L24 36H22V62H18V36H16Z"/>' +
    '<path d="M20 17l' + (dir ? '3' : '-3') + ' 17"/></svg>';
}

// "João da Silva" -> "JoaoDaSilva" (sem acento/espaço, seguro pra nome de arquivo)
function fotoNomeSeguro(nome) {
  return String(nome || 'Aluno')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('') || 'Aluno';
}

function fotoDataISO(foto) {
  return (foto.created_at || '').slice(0, 10);
}

function fotoDataBR(iso) {
  return iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '';
}

function fotoExtensao(path) {
  const ext = String(path || '').split('?')[0].split('.').pop().toLowerCase();
  return /^(jpe?g|png|webp|heic|heif|gif)$/.test(ext) ? ext : 'jpg';
}

// NomeAluno_Frente_29-09-2026.jpg
function fotoNomeArquivo(nomeAluno, foto) {
  const a = fotoAngulo(foto.angulo);
  const data = fotoDataBR(fotoDataISO(foto)).replace(/\//g, '-');
  return fotoNomeSeguro(nomeAluno) + '_' + (a ? a.arquivo : 'Foto') + '_' + data + '.' + fotoExtensao(foto.path || foto.url);
}

// Arquivo original direto do Storage (autenticado, sem CORS/tainted canvas).
async function fotoBaixarOriginal(path) {
  const { data, error } = await supabaseClient.storage.from('fotos-evolucao').download(path);
  if (error) throw error;
  return data;
}

function fotoEhCelular() {
  return window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
}

function fotoDispararDownload(blob, nomeArquivo) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// Salva um blob de imagem: no celular usa o compartilhamento nativo (onde
// fica "Salvar imagem"/galeria); no computador inicia o download do arquivo.
// Se o navegador recusar o share por ter passado muito tempo desde o toque
// (ex: gerar a comparação demorou), mostra um botão pra confirmar — o share
// precisa acontecer direto num toque do usuário.
async function fotoSalvarImagem(blob, nomeArquivo) {
  const file = new File([blob], nomeArquivo, { type: blob.type || 'image/jpeg' });
  if (fotoEhCelular() && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: nomeArquivo });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      if (err && err.name === 'NotAllowedError') { fotoConfirmarSalvar(file); return; }
    }
  }
  fotoDispararDownload(blob, nomeArquivo);
}

function fotoConfirmarSalvar(file) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px;';
  ov.innerHTML = '<div style="background:#10151f;border:1px solid #1e2633;border-radius:14px;padding:20px;max-width:320px;width:100%;text-align:center;color:#e5e9f0;font-family:inherit;">' +
    '<div style="font-size:15px;font-weight:800;margin-bottom:6px;">Imagem pronta</div>' +
    '<div style="font-size:12.5px;color:#9aa4b2;margin-bottom:16px;">Toque abaixo pra salvar na galeria ou compartilhar.</div>' +
    '<button type="button" data-a="salvar" style="width:100%;background:linear-gradient(135deg,#f97316,#ea580c);border:none;color:#fff;font-family:inherit;font-size:14px;font-weight:700;padding:12px;border-radius:10px;cursor:pointer;margin-bottom:8px;">Salvar / compartilhar</button>' +
    '<button type="button" data-a="baixar" style="width:100%;background:#131a26;border:1px solid #1e2633;color:#9aa4b2;font-family:inherit;font-size:13px;font-weight:700;padding:10px;border-radius:10px;cursor:pointer;margin-bottom:8px;">Baixar arquivo</button>' +
    '<button type="button" data-a="fechar" style="width:100%;background:none;border:none;color:#66707e;font-family:inherit;font-size:12.5px;padding:6px;cursor:pointer;">Cancelar</button></div>';
  ov.addEventListener('click', async (e) => {
    const a = e.target.getAttribute && e.target.getAttribute('data-a');
    if (e.target === ov || a === 'fechar') { ov.remove(); return; }
    if (a === 'salvar') {
      try { await navigator.share({ files: [file], title: file.name }); } catch (err) { if (!err || err.name !== 'AbortError') fotoDispararDownload(file, file.name); }
      ov.remove();
    } else if (a === 'baixar') {
      fotoDispararDownload(file, file.name); ov.remove();
    }
  });
  document.body.appendChild(ov);
}

// Envia as fotos de avaliação por ângulo ({ frente: File, costas: File, ... })
// num único insert — todas ficam com o mesmo created_at (mesmo registro/data).
// trainer_id é recalculado no servidor (trigger da migration 0060).
async function fotoEnviarAngulos(clienteId, trainerId, arquivosPorAngulo, tipo) {
  const itens = FOTO_ANGULOS.filter(a => arquivosPorAngulo[a.key]).map(a => ({ angulo: a.key, file: arquivosPorAngulo[a.key] }));
  if (!itens.length) return [];
  const ts = Date.now();
  const paths = [];
  try {
    for (const it of itens) {
      const path = clienteId + '/avaliacao-' + it.angulo.replace('_', '-') + '-' + ts + '.' + fotoExtensao(it.file.name);
      const { error } = await supabaseClient.storage.from('fotos-evolucao').upload(path, it.file, { contentType: it.file.type || undefined });
      if (error) throw error;
      paths.push(path);
    }
    const { data, error } = await supabaseClient.from('fotos_evolucao').insert(itens.map((it, i) => ({
      cliente_id: clienteId, trainer_id: trainerId, url: paths[i], tipo: tipo || 'evolucao', angulo: it.angulo, enviado_por_aluno: true
    }))).select();
    if (error) throw error;
    return data || [];
  } catch (err) {
    // não deixa arquivo órfão no Storage se o registro não foi criado
    if (paths.length) await supabaseClient.storage.from('fotos-evolucao').remove(paths);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Visualizador (profissional): foto ampliada com zoom (botões, roda do
// mouse, pinça no celular), arrastar quando ampliada, baixar e fechar.
// foto = { path, url (signed), angulo, created_at }
// ---------------------------------------------------------------------------
function abrirVisualizadorFoto(foto, nomeAluno) {
  const titulo = (fotoAnguloLabel(foto.angulo) || 'Foto') + ' · ' + fotoDataBR(fotoDataISO(foto));
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(5,7,11,.96);display:flex;flex-direction:column;color:#e5e9f0;font-family:inherit;';
  const btn = 'background:#131a26;border:1px solid #1e2633;color:#e5e9f0;font-family:inherit;font-size:13px;font-weight:700;padding:9px 13px;border-radius:9px;cursor:pointer;';
  ov.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #1a2130;flex-wrap:wrap;">' +
      '<div data-el="titulo" style="font-size:14px;font-weight:800;flex:1;min-width:120px;"></div>' +
      '<button type="button" data-a="menos" title="Reduzir" style="' + btn + '">−</button>' +
      '<button type="button" data-a="reset" title="Tamanho original da tela" style="' + btn + 'min-width:62px;" data-el="nivel">100%</button>' +
      '<button type="button" data-a="mais" title="Ampliar" style="' + btn + '">+</button>' +
      '<button type="button" data-a="baixar" style="' + btn + 'background:linear-gradient(135deg,#f97316,#ea580c);border-color:transparent;color:#fff;">Baixar foto</button>' +
      '<button type="button" data-a="fechar" style="' + btn + '">Fechar</button>' +
    '</div>' +
    '<div data-el="palco" style="flex:1;position:relative;overflow:hidden;touch-action:none;cursor:grab;user-select:none;">' +
      '<img data-el="img" draggable="false" style="position:absolute;left:50%;top:50%;max-width:100%;max-height:100%;transform-origin:center center;will-change:transform;">' +
    '</div>' +
    '<div data-el="status" style="font-size:11.5px;color:#66707e;text-align:center;padding:8px;">Use + / − , a roda do mouse ou dois dedos pra dar zoom. Arraste pra mover.</div>';
  ov.querySelector('[data-el="titulo"]').textContent = titulo;
  const palco = ov.querySelector('[data-el="palco"]');
  const img = ov.querySelector('[data-el="img"]');
  const nivel = ov.querySelector('[data-el="nivel"]');
  const status = ov.querySelector('[data-el="status"]');
  img.src = foto.url;

  let escala = 1, tx = 0, ty = 0;
  const MIN = 1, MAX = 8;
  const aplicar = () => {
    if (escala <= MIN) { escala = MIN; tx = 0; ty = 0; }
    img.style.transform = 'translate(-50%,-50%) translate(' + tx + 'px,' + ty + 'px) scale(' + escala + ')';
    nivel.textContent = Math.round(escala * 100) + '%';
    palco.style.cursor = escala > 1 ? 'grab' : 'default';
  };
  // zoom mantendo o ponto (cx, cy — relativo ao centro do palco) parado
  const zoomEm = (nova, cx, cy) => {
    nova = Math.max(MIN, Math.min(MAX, nova));
    const f = nova / escala;
    tx = cx - (cx - tx) * f; ty = cy - (cy - ty) * f;
    escala = nova; aplicar();
  };
  const centroRel = (clientX, clientY) => {
    const r = palco.getBoundingClientRect();
    return [clientX - r.left - r.width / 2, clientY - r.top - r.height / 2];
  };
  aplicar();

  // Original em segundo plano — o "Baixar" já sai direto do toque (o share
  // do celular exige isso) e o zoom passa a usar o arquivo original.
  let blobOriginal = null;
  const pronto = fotoBaixarOriginal(foto.path).then(b => {
    blobOriginal = b;
    const u = URL.createObjectURL(b);
    img.onload = () => URL.revokeObjectURL(u);
    img.src = u;
    return b;
  }).catch(() => null);

  const ponteiros = new Map();
  let pinca = null, arrasto = null;
  palco.addEventListener('pointerdown', (e) => {
    palco.setPointerCapture(e.pointerId);
    ponteiros.set(e.pointerId, [e.clientX, e.clientY]);
    if (ponteiros.size === 2) {
      const [a, b] = [...ponteiros.values()];
      pinca = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), escala, meio: centroRel((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) };
      arrasto = null;
    } else if (ponteiros.size === 1) {
      arrasto = { x: e.clientX, y: e.clientY, tx, ty };
    }
  });
  palco.addEventListener('pointermove', (e) => {
    if (!ponteiros.has(e.pointerId)) return;
    ponteiros.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinca && ponteiros.size >= 2) {
      const [a, b] = [...ponteiros.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomEm(pinca.escala * d / pinca.dist, pinca.meio[0], pinca.meio[1]);
    } else if (arrasto && escala > 1) {
      tx = arrasto.tx + (e.clientX - arrasto.x); ty = arrasto.ty + (e.clientY - arrasto.y); aplicar();
    }
  });
  const soltar = (e) => {
    ponteiros.delete(e.pointerId);
    if (ponteiros.size < 2) pinca = null;
    if (ponteiros.size === 1) { const [p] = [...ponteiros.values()]; arrasto = { x: p[0], y: p[1], tx, ty }; }
    if (ponteiros.size === 0) arrasto = null;
  };
  palco.addEventListener('pointerup', soltar);
  palco.addEventListener('pointercancel', soltar);
  palco.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [cx, cy] = centroRel(e.clientX, e.clientY);
    zoomEm(escala * (e.deltaY < 0 ? 1.15 : 1 / 1.15), cx, cy);
  }, { passive: false });
  palco.addEventListener('dblclick', (e) => {
    const [cx, cy] = centroRel(e.clientX, e.clientY);
    if (escala > 1) { escala = 1; aplicar(); } else zoomEm(2.5, cx, cy);
  });

  const fechar = () => { document.removeEventListener('keydown', onKey); ov.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', onKey);

  ov.addEventListener('click', async (e) => {
    const a = e.target.getAttribute && e.target.getAttribute('data-a');
    if (!a) return;
    if (a === 'fechar') fechar();
    else if (a === 'mais') zoomEm(escala * 1.4, 0, 0);
    else if (a === 'menos') zoomEm(escala / 1.4, 0, 0);
    else if (a === 'reset') { escala = 1; aplicar(); }
    else if (a === 'baixar') {
      const nome = fotoNomeArquivo(nomeAluno, foto);
      if (blobOriginal) { fotoSalvarImagem(blobOriginal, nome); return; }
      status.textContent = 'Preparando o arquivo original…';
      const b = await pronto;
      if (!b) { status.textContent = 'Não foi possível baixar a foto. Tente novamente.'; return; }
      status.textContent = '';
      fotoSalvarImagem(b, nome);
    }
  });
  document.body.appendChild(ov);
}

// ---------------------------------------------------------------------------
// Imagem final da comparação (Antes × Depois) — mesma estrutura da tela:
// duas colunas; quando todas as fotos têm ângulo, cada linha pareia o mesmo
// ângulo (Frente × Frente, Costas × Costas...). Usa os arquivos originais.
// ---------------------------------------------------------------------------
function fotoCarregarImagem(blob) {
  return new Promise((resolve, reject) => {
    const u = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => { resolve(im); setTimeout(() => URL.revokeObjectURL(u), 0); };
    im.onerror = () => { URL.revokeObjectURL(u); reject(new Error('Imagem inválida')); };
    im.src = u;
  });
}

async function gerarImagemComparacao(antes, depois, nomeAluno) {
  antes = ordenarFotosPorAngulo(antes); depois = ordenarFotosPorAngulo(depois);
  const todas = antes.concat(depois);
  const imgs = new Map();
  await Promise.all(todas.map(async f => { imgs.set(f.id, await fotoCarregarImagem(await fotoBaixarOriginal(f.path))); }));

  const pareadoPorAngulo = todas.every(f => f.angulo);
  let linhas;
  if (pareadoPorAngulo) {
    linhas = FOTO_ANGULOS
      .map(a => ({ label: a.label, antes: antes.filter(f => f.angulo === a.key), depois: depois.filter(f => f.angulo === a.key) }))
      .filter(l => l.antes.length || l.depois.length);
    // mais de uma foto do mesmo ângulo num lado vira linhas extras
    linhas = linhas.flatMap(l => {
      const n = Math.max(l.antes.length, l.depois.length);
      return Array.from({ length: n }, (_, i) => ({ label: l.label, antes: l.antes[i] || null, depois: l.depois[i] || null }));
    });
  } else {
    const n = Math.max(antes.length, depois.length);
    linhas = Array.from({ length: n }, (_, i) => ({ label: '', antes: antes[i] || null, depois: depois[i] || null }));
  }

  const PAD = 36, GAP = 20, COL = 620, CELL_H = Math.round(COL * 4 / 3), CAP = 34, LBL = pareadoPorAngulo ? 40 : 0;
  const HEAD = 118;
  const W = PAD * 2 + COL * 2 + GAP;
  const H = HEAD + linhas.length * (LBL + CELL_H + CAP + GAP) + PAD;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const fonte = (peso, px) => peso + ' ' + px + 'px Inter, -apple-system, "Segoe UI", Roboto, sans-serif';

  ctx.fillStyle = '#0a0d13'; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#e5e9f0'; ctx.font = fonte(800, 30);
  ctx.fillText('Comparação de fotos — ' + (nomeAluno || 'Aluno'), PAD, PAD + 30);
  const dataLado = (fs) => { const ds = [...new Set(fs.map(fotoDataISO))].sort(); return ds.length ? ds.map(fotoDataBR).join(', ') : '—'; };
  ctx.font = fonte(800, 20);
  ctx.fillStyle = '#3b82f6'; ctx.fillText('ANTES · ' + dataLado(antes), PAD, HEAD - 22);
  ctx.fillStyle = '#4ade80'; ctx.fillText('DEPOIS · ' + dataLado(depois), PAD + COL + GAP, HEAD - 22);

  const desenhar = (f, x, y) => {
    ctx.fillStyle = '#10151f';
    ctx.fillRect(x, y, COL, CELL_H);
    if (f) {
      const im = imgs.get(f.id);
      const s = Math.min(COL / im.naturalWidth, CELL_H / im.naturalHeight);
      const w = im.naturalWidth * s, h = im.naturalHeight * s;
      ctx.drawImage(im, x + (COL - w) / 2, y + (CELL_H - h) / 2, w, h);
      ctx.fillStyle = '#9aa4b2'; ctx.font = fonte(600, 18);
      ctx.fillText(fotoDataBR(fotoDataISO(f)), x + 4, y + CELL_H + 25);
    } else {
      ctx.fillStyle = '#66707e'; ctx.font = fonte(600, 20); ctx.textAlign = 'center';
      ctx.fillText('Sem foto', x + COL / 2, y + CELL_H / 2); ctx.textAlign = 'left';
    }
  };
  let y = HEAD;
  linhas.forEach(l => {
    if (LBL) { ctx.fillStyle = '#e5e9f0'; ctx.font = fonte(800, 22); ctx.fillText(l.label.toUpperCase(), PAD, y + 28); }
    desenhar(l.antes, PAD, y + LBL);
    desenhar(l.depois, PAD + COL + GAP, y + LBL);
    y += LBL + CELL_H + CAP + GAP;
  });

  return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Falha ao gerar a imagem')), 'image/jpeg', 0.92));
}

async function baixarComparacao(antes, depois, nomeAluno, dataISO) {
  const blob = await gerarImagemComparacao(antes, depois, nomeAluno);
  const d = fotoDataBR(dataISO || new Date().toISOString().slice(0, 10)).replace(/\//g, '-');
  await fotoSalvarImagem(blob, fotoNomeSeguro(nomeAluno) + '_Comparacao_' + d + '.jpg');
}
