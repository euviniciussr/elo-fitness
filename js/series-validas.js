// Prescrição individual das séries válidas — compartilhado entre
// montar-treino.html e aluno-detalhe.html.
//
// O formato salvo continua o mesmo de sempre em treino_exercicios.series:
// texto livre, 1 linha = 1 série, e "3x8-10" = 3 séries de 8-10. É esse
// texto que o app do aluno expande linha a linha e que o serie_index de
// serie_cargas referencia, então nada no banco muda — o editor só deixa o
// profissional enxergar e editar cada série separadamente.
const SeriesValidas = (() => {
  const MAX_SERIES = 15;
  const NOTACAO = /^(\d{1,2})\s*[x×X]\s*(.+)$/;

  // Mesma regra de expandirSeriesLinhas (app-aluno/aluno-detalhe/montar-treino).
  function linhas(texto) {
    const out = [];
    String(texto || '').split('\n').map(s => s.trim()).filter(Boolean).forEach(linha => {
      const m = linha.match(NOTACAO);
      const n = m ? parseInt(m[1], 10) : 0;
      if (m && n >= 1 && n <= MAX_SERIES) {
        const resto = m[2].trim();
        for (let i = 0; i < n; i++) out.push(resto);
      } else {
        out.push(linha);
      }
    });
    return out;
  }

  // Volta pro texto salvo. Se a prescrição não mudou, devolve o texto
  // original intacto (dado antigo nunca é reescrito à toa). Séries iguais em
  // sequência viram "3x8-10" só quando a prescrição começa com número —
  // é a notação que todas as telas já sabem contar e expandir.
  function texto(series, original) {
    const limpas = (series || []).map(s => String(s || '').trim()).filter(Boolean);
    const anteriores = linhas(original);
    if (limpas.length === anteriores.length && limpas.every((s, i) => s === anteriores[i])) {
      return String(original || '').trim() || null;
    }
    const out = [];
    for (let i = 0; i < limpas.length;) {
      let j = i;
      while (j + 1 < limpas.length && limpas[j + 1] === limpas[i]) j++;
      const qtd = j - i + 1;
      if (qtd > 1 && /^\d/.test(limpas[i])) out.push(qtd + 'x' + limpas[i]);
      else for (let k = i; k <= j; k++) out.push(limpas[k]);
      i = j + 1;
    }
    return out.join('\n') || null;
  }

  // "8-10" → "8–10 repetições"; texto livre ("até a falha", "12 reps") fica como está.
  function rotulo(serie) {
    const s = String(serie || '').trim();
    const m = s.match(/^(\d+)(?:\s*(?:-|–|a|até)\s*(\d+))?$/i);
    if (!m) return s;
    if (m[2]) return m[1] + '–' + m[2] + ' repetições';
    return m[1] + (m[1] === '1' ? ' repetição' : ' repetições');
  }

  // Linhas de resumo pra listas: todas iguais → uma linha; diferentes →
  // uma linha por série. Retorna strings já escapadas.
  function resumo(textoSeries) {
    const ls = linhas(textoSeries);
    if (!ls.length) return [];
    const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (ls.every(l => l === ls[0])) {
      return [ls.length + (ls.length === 1 ? ' série válida' : ' séries válidas') + ' × ' + esc(rotulo(ls[0]))];
    }
    return ls.map((l, i) => 'Série ' + (i + 1) + ': ' + esc(rotulo(l)));
  }

  function criar(tag, attrs, textoNo) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'style') n.style.cssText = v;
      else if (k in n) n[k] = v;
      else n.setAttribute(k, v);
    });
    if (textoNo != null) n.textContent = textoNo;
    return n;
  }

  // Editor: "N séries de [reps] → Aplicar a todas" + uma linha por série.
  // opts: { texto, compacto, onChange(textoSerializado) }.
  // Retorna { node, getTexto(), setTexto(t), validar() → mensagem|null }.
  function editor(opts) {
    const original = (opts && opts.texto) || '';
    let series = linhas(original);
    const compacto = !!(opts && opts.compacto);

    const node = criar('div', { className: 'sv-editor', style: 'display:flex;flex-direction:column;gap:6px;' });
    const rapido = criar('div', { style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--texto-2,#9aa4b2);' });
    const qtdIn = criar('input', { type: 'number', min: '1', max: String(MAX_SERIES), placeholder: 'Qtd', style: 'width:64px;padding:7px 8px;' });
    const repsIn = criar('input', { placeholder: 'Ex: 8-10', style: 'width:110px;flex:1;min-width:90px;padding:7px 8px;' });
    const aplicar = criar('button', { type: 'button', className: 'serie-tmpl-link', style: 'white-space:nowrap;' }, 'Aplicar a todas');
    rapido.appendChild(qtdIn);
    rapido.appendChild(criar('span', {}, 'séries de'));
    rapido.appendChild(repsIn);
    rapido.appendChild(criar('span', {}, 'reps'));
    rapido.appendChild(aplicar);
    node.appendChild(rapido);

    const lista = criar('div', { style: 'display:flex;flex-direction:column;gap:5px;' });
    node.appendChild(lista);
    const addBtn = criar('button', { type: 'button', className: 'add-serie-btn' }, '+ Adicionar série válida');
    node.appendChild(addBtn);
    if (!compacto) node.appendChild(criar('div', { className: 'sub', style: 'margin:0;font-size:11.5px;' }, 'Cada série pode ter sua própria prescrição (8, 8-10, 12-15…). Contam no volume de séries por grupamento muscular.'));

    const avisar = () => { if (opts && opts.onChange) opts.onChange(texto(series, original)); };

    function preencherRapido() {
      qtdIn.value = series.length || '';
      repsIn.value = series.length && series.every(s => s === series[0]) ? series[0] : '';
    }

    function render() {
      lista.innerHTML = '';
      series.forEach((s, i) => {
        const row = criar('div', { style: 'display:flex;align-items:center;gap:8px;' });
        row.appendChild(criar('span', { style: 'flex:0 0 56px;font-size:12px;font-weight:700;color:var(--texto-2,#9aa4b2);' }, 'Série ' + (i + 1)));
        const inp = criar('input', { value: s, placeholder: 'Repetições (ex: 8-10)', style: 'flex:1;padding:7px 9px;' });
        inp.addEventListener('input', () => { series[i] = inp.value; preencherRapido(); });
        // Digitou "3x10" numa série só: vira 3 séries, igual ao app do aluno contaria.
        inp.addEventListener('change', () => {
          const exp = linhas(inp.value);
          if (exp.length > 1) {
            series.splice(i, 1, ...exp);
            series = series.slice(0, MAX_SERIES);
            render();
          } else {
            series[i] = inp.value.trim();
          }
          avisar();
        });
        const rm = criar('button', { type: 'button', className: 'ex-icon-btn', title: 'Remover série ' + (i + 1) }, '✕');
        rm.addEventListener('click', () => { series.splice(i, 1); render(); avisar(); });
        row.appendChild(inp);
        row.appendChild(rm);
        lista.appendChild(row);
      });
      addBtn.disabled = series.length >= MAX_SERIES;
      preencherRapido();
    }

    aplicar.addEventListener('click', () => {
      const n = Math.min(MAX_SERIES, Math.max(0, parseInt(qtdIn.value, 10) || 0));
      const reps = repsIn.value.trim();
      if (!n || !reps) { (n ? repsIn : qtdIn).focus(); return; }
      series = Array.from({ length: n }, () => reps);
      render();
      avisar();
    });
    addBtn.addEventListener('click', () => {
      if (series.length >= MAX_SERIES) return;
      series.push(series.length ? series[series.length - 1] : '');
      render();
      avisar();
      const inputs = lista.querySelectorAll('input');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });

    render();
    return {
      node,
      getTexto: () => texto(series, original),
      setTexto: (t) => { series = linhas(t); render(); avisar(); },
      validar: () => {
        const vazia = series.findIndex(s => !String(s || '').trim());
        return vazia >= 0 ? 'Preencha as repetições da Série ' + (vazia + 1) + ' ou remova essa série.' : null;
      }
    };
  }

  return { linhas, texto, rotulo, resumo, editor, MAX_SERIES };
})();
