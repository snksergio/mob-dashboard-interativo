// iGreen · Painel V1 · visão 2D: a planta do posto vista de cima, para aparelhos mais fracos (e como opção para todos).
// Tem o mesmo contrato do maquete.js (criarMaquete): o painel não sabe qual das duas está desenhando.
// A planta sai do mesmo ancoras.json do 3D (vagas, bombas, saídas dos cabos, cobertura, floreiras, totem), então nenhum
// posto é desenhado à mão. Os carros são o carro v2 renderizado de cima no Blender (dados/planta/carro-<cor>.webp).
// Desenho em SVG (metros como unidade); chuva e nuvens num canvas por cima; selos em HTML (as mesmas classes do 3D).
// as mesmas chaves de hora do 3D, copiadas aqui para a planta não carregar o three.js
const CHAVES = [[0, 'noite'], [5, 'noite'], [7.5, 'manha'], [10, 'manha'], [12.5, 'tarde'], [16.5, 'tarde'], [17.8, 'por'], [18.6, 'por'], [19.6, 'noite'], [24, 'noite']]

const NS = 'http://www.w3.org/2000/svg'
const lerp = (a, b, t) => a + (b - a) * t
const clamp01 = (t) => Math.max(0, Math.min(1, t))
const clamp = (t, a, b) => Math.max(a, Math.min(b, t))
const suave = (t) => t * t * (3 - 2 * t)
const easeOut = (t) => 1 - Math.pow(1 - t, 3)
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const CORES = { carregando: '#3DFF6A', conectando: '#E9FFEF', falha: '#FF2A1F', concluido: '#F5B54A' }
const POT = { fast: { dc: 38, ac: 7 }, ultra: { dc: 76, ac: 7 }, mobi: { dc: 7, ac: 7 } }
const NOME_BOMBA = { fast: 'Mobi Fast', ultra: 'Mobi Ultra Fast', mobi: 'Mobi' }
// cor do carro que o painel manda (hex) → render de cima
const COR_IMG = { '#e9ebed': 'branco', '#b9c0c6': 'prata', '#4a5157': 'grafite', '#1f8a4c': 'verde' }
const IMGS = ['branco', 'prata', 'grafite', 'verde']
// carro de cima: o quadro do render tem 2,3 m × 4,6 m (câmera ortográfica do carro_topo.py)
const CAR_W = 2.3, CAR_H = 4.6, PORTA = { x: 0.89, y: 1.33 }
const D_CHEGADA = 3.6, D_SAIDA = 4.2, T_CHEGA = 3.2, T_CONECTA = 1.5, T_DESCONECTA = 1.0, T_SAI = 4.2
const ZOOM_MIN = 0.75, ZOOM_MAX = 3
function periodoDaHora(h) {
  h = ((h % 24) + 24) % 24
  for (let i = 0; i < CHAVES.length - 1; i++) {
    const [h0, p0] = CHAVES[i], [h1, p1] = CHAVES[i + 1]
    if (h >= h0 && h <= h1) return { a: p0, b: p1, t: p0 === p1 ? 0 : suave((h - h0) / (h1 - h0)) }
  }
  return { a: 'noite', b: 'noite', t: 0 }
}

function el2(tag, attrs = {}, pai) {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  if (pai) pai.appendChild(e)
  return e
}
const caixa = (o) => ({ x0: o.min[0], x1: o.max[0], y0: o.min[1], y1: o.max[1] })

export async function criarPlanta(el, opcoes = {}) {
  const base = opcoes.dados || 'dados/fast/'
  const passo = (f) => opcoes.aoProgresso && opcoes.aoProgresso(f)
  const an = await fetch(base + 'ancoras.json').then((r) => r.json()); passo(0.5)
  await Promise.all(IMGS.map((c) => new Promise((ok) => { const im = new Image(); im.onload = im.onerror = ok; im.src = `dados/planta/carro-${c}.webp` }))); passo(1)

  // ---------------------------------------------------------- medidas da planta (as mesmas do Blender)
  const BW = an.BAY_W, BD = an.BAY_D
  const xs = an.vagas.map((v) => v.x)
  const X_ESQ = Math.min(...xs) - BW / 2, X_DIR = Math.max(...xs) + BW / 2
  const LAJE = { x0: X_ESQ - 1.9, x1: X_DIR + 2.2, y0: an.AP_Y0 - 0.12, y1: an.FX_Y0 + 2.0 + 0.3 }
  const FX = { y0: an.FX_Y0, y1: an.FX_Y0 + 2.0 }
  const Y = (y) => -y                                           // SVG: y para baixo; mundo: y para a frente (para o fundo do posto)

  // ---------------------------------------------------------- SVG
  const svg = el2('svg', { class: 'mv-planta', role: 'img', 'aria-label': 'Planta do posto vista de cima', preserveAspectRatio: 'none' })
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', touchAction: 'none' })
  el.appendChild(svg)
  const defs = el2('defs', {}, svg)
  defs.innerHTML = `
    <filter id="pl-sombra" x="-40%" y="-20%" width="180%" height="140%"><feDropShadow dx="0.06" dy="0.12" stdDeviation="0.12" flood-color="#000" flood-opacity=".75"/></filter>
    <filter id="pl-brilho" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="0.12"/></filter>
    <filter id="pl-brilho2" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="0.35"/></filter>
    <pattern id="pl-solar" width="0.62" height="1.02" patternUnits="userSpaceOnUse"><rect width="0.6" height="1" fill="#1D2A33"/><path d="M0 .5h.6M.3 0v1" stroke="#2C3B46" stroke-width=".02"/></pattern>
    <radialGradient id="pl-luz"><stop offset="0" stop-color="#03FF1F" stop-opacity=".45"/><stop offset="1" stop-color="#03FF1F" stop-opacity="0"/></radialGradient>
    <radialGradient id="pl-farol"><stop offset="0" stop-color="#EAF4FF" stop-opacity=".55"/><stop offset="1" stop-color="#EAF4FF" stop-opacity="0"/></radialGradient>
    <radialGradient id="pl-re"><stop offset="0" stop-color="#FF3020" stop-opacity=".8"/><stop offset="1" stop-color="#FF3020" stop-opacity="0"/></radialGradient>`
  const gMundo = el2('g', {}, svg)

  // laje, pátio e a faixa elevada das bombas
  const R = 0.9
  const borda = el2('rect', { x: LAJE.x0 - 0.06, y: Y(LAJE.y1) - 0.06, width: LAJE.x1 - LAJE.x0 + 0.12, height: LAJE.y1 - LAJE.y0 + 0.12, rx: R + 0.06, fill: 'none', stroke: '#03FF1F', 'stroke-opacity': '.55', 'stroke-width': '.05' }, gMundo)
  el2('rect', { x: LAJE.x0 - 0.06, y: Y(LAJE.y1) - 0.06, width: LAJE.x1 - LAJE.x0 + 0.12, height: LAJE.y1 - LAJE.y0 + 0.12, rx: R + 0.06, fill: 'none', stroke: '#03FF1F', 'stroke-opacity': '.2', 'stroke-width': '.2', filter: 'url(#pl-brilho)' }, gMundo)
  const laje = el2('rect', { x: LAJE.x0, y: Y(LAJE.y1), width: LAJE.x1 - LAJE.x0, height: LAJE.y1 - LAJE.y0, rx: R, fill: '#1A211D', stroke: 'rgba(255,255,255,.10)', 'stroke-width': '.03' }, gMundo)
  const patio = el2('rect', { x: LAJE.x0 + 0.12, y: Y(0), width: LAJE.x1 - LAJE.x0 - 0.24, height: -LAJE.y0 - 0.12, fill: '#202823' }, gMundo)
  const calcada = el2('rect', { x: LAJE.x0 + 0.12, y: Y(FX.y1), width: LAJE.x1 - LAJE.x0 - 0.24, height: FX.y1 - FX.y0, rx: 0.12, fill: '#262F2A', stroke: 'rgba(255,255,255,.07)', 'stroke-width': '.02' }, gMundo)
  // piso em placas na calçada (linhas finas)
  const placas = el2('g', { stroke: 'rgba(255,255,255,.045)', 'stroke-width': '.015' }, gMundo)
  for (let x = Math.ceil(LAJE.x0); x < LAJE.x1; x += 1) el2('path', { d: `M${x} ${Y(FX.y1)}V${Y(FX.y0)}` }, placas)
  // entrada: setas no pátio
  const entrada = el2('g', { fill: 'none', stroke: 'rgba(255,255,255,.22)', 'stroke-width': '.06', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, gMundo)
  for (const dx of [-0.6, 0, 0.6]) el2('path', { d: `M${(X_ESQ + X_DIR) / 2 + dx - 0.18} ${Y(-0.95)}l.18 -.18l.18 .18` }, entrada)
  const tEntrada = el2('text', { x: (X_ESQ + X_DIR) / 2, y: Y(LAJE.y0) - 0.32, 'font-size': '.26', 'text-anchor': 'middle', fill: 'rgba(255,255,255,.42)', 'font-family': 'Instrument Sans, system-ui, sans-serif' }, gMundo)
  tEntrada.textContent = 'Entrada'

  // floreiras, frades e totem (do ancoras.json)
  const gObj = el2('g', {}, gMundo)
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (const o of an.oclusores) {
    const c = caixa(o)
    if (/floreira/.test(o.nome)) {
      el2('rect', { x: c.x0, y: Y(c.y1), width: c.x1 - c.x0, height: c.y1 - c.y0, rx: 0.16, fill: '#E8ECE9', 'fill-opacity': '.14', stroke: 'rgba(255,255,255,.18)', 'stroke-width': '.03' }, gObj)
      const n = Math.round((c.x1 - c.x0) * (c.y1 - c.y0) * 9)
      for (let k = 0; k < n; k++) el2('circle', { cx: lerp(c.x0 + 0.18, c.x1 - 0.18, rnd()), cy: Y(lerp(c.y0 + 0.18, c.y1 - 0.18, rnd())), r: 0.11 + rnd() * 0.09, fill: k % 3 ? '#285F35' : '#347A42', stroke: 'rgba(0,0,0,.25)', 'stroke-width': '.02' }, gObj)
    } else if (/^frade/.test(o.nome)) {
      el2('circle', { cx: (c.x0 + c.x1) / 2, cy: Y((c.y0 + c.y1) / 2), r: 0.09, fill: '#3A433E', stroke: 'rgba(255,255,255,.25)', 'stroke-width': '.02' }, gObj)
    }
  }
  const tc = an.oclusores.find((o) => o.nome === 'totem_corpo')
  let precoTxt = null
  if (tc) {
    const c = caixa(tc)
    el2('rect', { x: c.x0, y: Y(c.y1), width: c.x1 - c.x0, height: c.y1 - c.y0, rx: 0.05, fill: '#0F1411', stroke: '#03FF1F', 'stroke-opacity': '.6', 'stroke-width': '.03' }, gObj)
    precoTxt = el2('text', { x: (c.x0 + c.x1) / 2, y: Y(c.y0) + 0.42, 'font-size': '.24', 'font-weight': '600', 'text-anchor': 'middle', fill: '#7DFF8C', 'font-family': 'Instrument Sans, system-ui, sans-serif' }, gObj)
    precoTxt.textContent = 'R$ 2,20'
  }

  // vagas: o piso verde, o número e o anel do estado
  const gVagas = el2('g', {}, gMundo)
  const gCabos = el2('g', {}, gMundo)
  const gCarros = el2('g', {}, gMundo)
  const gLuzes = el2('g', { style: 'mix-blend-mode:screen' }, gMundo)

  // bombas e saídas dos cabos (conectores)
  const gBombas = el2('g', {}, gMundo)
  const bombas = an.bombas.map((b, bi) => {
    const bs = an.oclusores.find((o) => o.nome === `bomba${bi}_base`)
    const c = bs ? caixa(bs) : { x0: b.x - 0.56, x1: b.x + 0.56, y0: b.y - 0.21, y1: b.y + 0.21 }
    const g = el2('g', { class: 'pl-bomba', style: 'cursor:pointer' }, gBombas)
    const luz = el2('circle', { cx: b.x, cy: Y(b.y), r: 1.2, fill: 'url(#pl-luz)', opacity: '0' }, g)
    const alarme = el2('rect', { x: c.x0 - 0.12, y: Y(c.y1) - 0.12, width: c.x1 - c.x0 + 0.24, height: c.y1 - c.y0 + 0.24, rx: 0.12, fill: 'none', stroke: '#FF2A1F', 'stroke-width': '.06', opacity: '0' }, g)
    el2('rect', { x: c.x0, y: Y(c.y1), width: c.x1 - c.x0, height: c.y1 - c.y0, rx: 0.08, fill: '#0E9E3C', stroke: '#7DFF8C', 'stroke-opacity': '.55', 'stroke-width': '.03', filter: 'url(#pl-sombra)' }, g)
    el2('rect', { x: c.x0 + 0.08, y: Y(c.y1) + 0.05, width: c.x1 - c.x0 - 0.16, height: 0.09, rx: 0.03, fill: '#07130B' }, g)   // a tela, nas costas
    const t = el2('text', { x: b.x, y: Y(c.y1) - 0.18, 'font-size': '.22', 'text-anchor': 'middle', fill: 'rgba(255,255,255,.55)', 'font-family': 'Instrument Sans, system-ui, sans-serif' }, g)
    const nome = NOME_BOMBA[b.modelo] + (an.bombas.length > 1 ? ' ' + (bi + 1) : '')
    t.textContent = nome
    g.addEventListener('click', () => el.dispatchEvent(new CustomEvent('mv-bomba', { detail: { bomba: bi } })))
    return { bi, modelo: b.modelo, nome, x: b.x, y: b.y, g, luz, alarme, falha: false, sel: null }
  })
  // conectores: uma saída de cabo por (bomba, saída), como no 3D
  const conectores = []
  an.vagas.forEach((v, i) => {
    const chave = v.bomba + ':' + v.saida.map((n) => n.toFixed(3)).join(',')
    const ja = conectores.find((c) => c.chave === chave); if (ja) { ja.vagasNaturais.push(i); return }
    const b = an.bombas[v.bomba]
    conectores.push({ id: conectores.length, chave, bomba: v.bomba, dc: v.ponto === 'dc' || v.ponto.startsWith('dc'), sx: v.saida[0], sy: v.saida[1],
      lado: v.saida[0] < b.x - 0.05 ? 'esquerda' : v.saida[0] > b.x + 0.05 ? 'direita' : 'centro', vagasNaturais: [i], uso: null })
  })
  for (const c of conectores) {
    el2('circle', { cx: c.sx, cy: Y(c.sy), r: 0.07, fill: '#07130B', stroke: '#7DFF8C', 'stroke-width': '.025' }, gBombas)
    const t = el2('text', { x: c.sx, y: Y(c.sy) + 0.34, 'font-size': '.16', 'font-weight': '600', 'text-anchor': 'middle', fill: 'rgba(125,255,140,.75)', 'font-family': 'Instrument Sans, system-ui, sans-serif' }, gBombas)
    t.textContent = c.dc ? 'DC' : 'AC'
  }
  // cobertura: projeção translúcida das placas solares e os pilares (só se o posto tiver)
  const gTeto = el2('g', { style: 'pointer-events:none' }, gMundo)
  let teto = null
  if (an.posto && an.posto.cobertura) {
    const pil = an.oclusores.filter((o) => /cobertura.*pilar/.test(o.nome) && !/_base$/.test(o.nome))
    for (const o of an.oclusores.filter((o) => /cobertura.*pilar.*_base$/.test(o.nome))) {
      const c = caixa(o), m = 0.12
      el2('rect', { x: c.x0 + m, y: Y(c.y1) + m, width: c.x1 - c.x0 - 2 * m, height: c.y1 - c.y0 - 2 * m, rx: 0.04, fill: '#0B5E2E', stroke: '#3DFF6A', 'stroke-opacity': '.5', 'stroke-width': '.025' }, gTeto)
    }
    const px0 = Math.min(X_ESQ - 0.3, ...pil.map((o) => o.min[0] - 0.3)), px1 = Math.max(X_DIR + 0.3, ...pil.map((o) => o.max[0] + 0.3))
    teto = el2('g', {}, gTeto)
    el2('rect', { x: px0, y: Y(FX.y1 - 0.2), width: px1 - px0, height: FX.y1 - 0.2 - 0.6, rx: 0.1, fill: 'url(#pl-solar)', 'fill-opacity': '.1', stroke: '#03FF1F', 'stroke-opacity': '.22', 'stroke-width': '.03', 'stroke-dasharray': '.18 .14' }, teto)
  }

  // vagas
  const proximas = [0]
  const vagas = an.vagas.map((v, i) => {
    const x = v.x, y = v.ycarro, x0 = x - BW / 2
    const g = el2('g', { 'data-vaga': i, style: 'cursor:pointer' }, gVagas)
    el2('rect', { x: x0 + 0.05, y: Y(BD), width: BW - 0.1, height: BD, fill: '#03FF1F', 'fill-opacity': '.07' }, g)
    el2('path', { d: `M${x0 + 0.05} ${Y(0)}V${Y(BD)}H${x0 + BW - 0.05}V${Y(0)}`, fill: 'none', stroke: 'rgba(255,255,255,.75)', 'stroke-width': '.07' }, g)
    el2('path', { d: 'M7 .8 2.6 7h3L5 11.2 9.4 5h-3Z', fill: '#03FF1F', 'fill-opacity': '.14', transform: `translate(${x - 0.6} ${Y(y) - 0.6}) scale(.1)` }, g)   // raio no piso da vaga, como a marca pintada no 3D
    const num = el2('text', { x, y: Y(-0.42), 'font-size': '.27', 'font-weight': '500', 'text-anchor': 'middle', fill: 'rgba(255,255,255,.62)', 'font-family': 'Instrument Sans, system-ui, sans-serif' }, g)   // no pátio, logo na boca da vaga (o carro não cobre)
    num.textContent = `Vaga ${i + 1}`
    const anelG = el2('rect', { x: x0 + 0.18, y: Y(BD - 0.13), width: BW - 0.36, height: BD - 0.26, rx: 0.3, fill: 'none', stroke: CORES.carregando, 'stroke-width': '.14', opacity: '0', filter: 'url(#pl-brilho)' }, g)
    const anel = el2('rect', { x: x0 + 0.18, y: Y(BD - 0.13), width: BW - 0.36, height: BD - 0.26, rx: 0.3, fill: 'none', stroke: CORES.carregando, 'stroke-width': '.05', opacity: '0' }, g)
    // carro: imagem de cima + faróis + luz de ré
    const gc = el2('g', { opacity: '0', style: 'pointer-events:none' }, gCarros)
    const farois = el2('g', { opacity: '0' }, gc)
    el2('ellipse', { cx: -0.55, cy: -CAR_H / 2 - 0.55, rx: 0.42, ry: 0.85, fill: 'url(#pl-farol)' }, farois)
    el2('ellipse', { cx: 0.55, cy: -CAR_H / 2 - 0.55, rx: 0.42, ry: 0.85, fill: 'url(#pl-farol)' }, farois)
    const re = el2('ellipse', { cx: 0, cy: CAR_H / 2 - 0.15, rx: 1.0, ry: 0.4, fill: 'url(#pl-re)', opacity: '0' }, gc)
    const img = el2('image', { href: 'dados/planta/carro-branco.webp', x: -CAR_W / 2, y: -CAR_H / 2, width: CAR_W, height: CAR_H, filter: 'url(#pl-sombra)' }, gc)
    // cabo: da saída do conector até a tomada do carro (lado virado para a bomba)
    const cabo = el2('path', { fill: 'none', stroke: '#0B0D0C', 'stroke-width': '.09', 'stroke-linecap': 'round', pathLength: '1', 'stroke-dasharray': '1 1', 'stroke-dashoffset': '1' }, gCabos)
    const fluxo = el2('path', { fill: 'none', stroke: CORES.carregando, 'stroke-width': '.05', 'stroke-linecap': 'round', 'stroke-dasharray': '.08 .16', opacity: '0' }, gCabos)
    g.addEventListener('click', (e) => { if (arrastou) return; el.dispatchEvent(new CustomEvent('mv-vaga', { detail: { vaga: i, estado: vagas[i].estado } })) })
    const vg = { i, dc: v.ponto === 'dc', nome: v.nome, bomba: v.bomba, lado: v.lado, pos: { x, y }, con: null, ficar: false, estado: 'vazia', t: 0,
      pct: 18 + 30 * (i % 2), kw: POT[an.bombas[v.bomba].modelo][v.ponto === 'dc' ? 'dc' : 'ac'], anel, anelG, gc, img, farois, re, cabo, fluxo, cy: y, a: 0, realce: false, pessoa: null, aviso: null }
    return vg
  })
  // a planta fica por cima das vagas: carros acima do piso, teto translúcido acima dos carros
  gMundo.appendChild(gCabos); gMundo.appendChild(gCarros); gMundo.appendChild(gBombas); gMundo.appendChild(gLuzes); gMundo.appendChild(gTeto)

  // ---------------------------------------------------------- canvas do clima (chuva e sombra de nuvem) e selos
  const cnvClima = document.createElement('canvas')
  Object.assign(cnvClima.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' })
  el.appendChild(cnvClima)
  const ctx = cnvClima.getContext('2d')
  const camadaSelos = document.createElement('div'); camadaSelos.className = 'mv-selos'; el.appendChild(camadaSelos)
  function selo(cls) { const d = document.createElement('div'); d.className = 'mv-selo ' + (cls || ''); camadaSelos.appendChild(d); return d }
  for (const b of bombas) { b.sel = selo('mv-selo-bomba'); b.sel.addEventListener('click', () => el.dispatchEvent(new CustomEvent('mv-bomba', { detail: { bomba: b.bi } }))) }
  for (const vg of vagas) {
    vg.sel = selo('mv-selo-carro')
    vg.sel.addEventListener('click', () => { if (vg.pessoa) el.dispatchEvent(new CustomEvent('mv-selo', { detail: { vaga: vg.i } })) })
    vg.info = selo('mv-selo-info'); vg.infoAte = -1; vg.info.addEventListener('click', () => { vg.infoAte = -1 })
  }
  const ouvintes = []
  const avisa = (vg) => { for (const f of ouvintes) f({ vaga: vg.i, nome: vg.nome, estado: vg.estado }) }

  // ---------------------------------------------------------- vista: enquadramento, zoom e arrasto
  const VB = { x0: LAJE.x0 - 0.35, x1: LAJE.x1 + 0.35, y0: Y(LAJE.y1) - 0.45, y1: Y(LAJE.y0) + 0.35 }
  const zoom = { k: 1, alvo: 1, cx: (VB.x0 + VB.x1) / 2, cy: (VB.y0 + VB.y1) / 2, acx: null, acy: null }
  const centro0 = { x: zoom.cx, y: zoom.cy }
  let W = 1, H = 1, s0 = 1, s = 1, vb = { x: 0, y: 0 }, quadro0 = { l: 0, t: 0, w: 1, h: 1 }, gradeChave = ''
  function margens() {
    const mg = (getComputedStyle(el).getPropertyValue('--mv-margem').trim() || '0').split(/\s+/).map(parseFloat)
    const [t, r, b, l] = [mg[0], mg[1] ?? mg[0], mg[2] ?? mg[0], mg[3] ?? mg[1] ?? mg[0]].map((v) => v || 0)
    return { t, r, b, l }
  }
  function tamanho() {
    W = Math.max(1, el.clientWidth); H = Math.max(1, el.clientHeight)
    const m = margens(); quadro0 = { l: m.l, t: m.t, w: Math.max(1, W - m.l - m.r), h: Math.max(1, H - m.t - m.b) }
    s0 = Math.min(quadro0.w / (VB.x1 - VB.x0), quadro0.h / (VB.y1 - VB.y0))
    cnvClima.width = Math.round(W * Math.min(2, devicePixelRatio || 1)); cnvClima.height = Math.round(H * Math.min(2, devicePixelRatio || 1))
    aplicaVista()
  }
  function aplicaVista() {
    s = s0 * zoom.k
    // aproximado: o centro fica dentro da planta; no 100% volta ao centro
    if (zoom.k <= 1.001) { zoom.cx = lerp(zoom.cx, centro0.x, 0.2); zoom.cy = lerp(zoom.cy, centro0.y, 0.2) }
    zoom.cx = clamp(zoom.cx, VB.x0, VB.x1); zoom.cy = clamp(zoom.cy, VB.y0, VB.y1)
    const cxp = quadro0.l + quadro0.w / 2, cyp = quadro0.t + quadro0.h / 2
    vb = { x: zoom.cx - cxp / s, y: zoom.cy - cyp / s }
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${W / s} ${H / s}`)
    // pontinhos do fundo presos à planta
    const kTela = s / s0, gx = (VB.x0 - vb.x) * s, gy = (VB.y0 - vb.y) * s
    const ch = kTela.toFixed(3) + ' ' + gx.toFixed(1) + ' ' + gy.toFixed(1)
    if (ch !== gradeChave) { gradeChave = ch; el.style.setProperty('--grade-k', kTela.toFixed(3)); el.style.setProperty('--grade-x', gx.toFixed(1) + 'px'); el.style.setProperty('--grade-y', gy.toFixed(1) + 'px') }
  }
  const tela = (x, y) => ({ x: (x - vb.x) * s, y: (Y(y) - vb.y) * s })     // mundo → px dentro do elemento
  const limita = (k) => clamp(k, ZOOM_MIN, ZOOM_MAX)
  let arrasto = null, arrastou = false
  el.addEventListener('wheel', (e) => {
    e.preventDefault()
    const r = el.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top
    const antes = { x: vb.x + mx / s, y: vb.y + my / s }
    zoom.alvo = limita(zoom.alvo * Math.exp(-e.deltaY * 0.0015)); if (zoom.alvo < 1.05) focoAlvo = 0
    zoom.acx = antes.x; zoom.acy = antes.y; zoom.amx = mx; zoom.amy = my                // o ponto embaixo do mouse fica parado
    atualizaCursor()
  }, { passive: false })
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest && e.target.closest('.mv-selo')) return
    arrasto = { x: e.clientX, y: e.clientY }; arrastou = false
  })
  el.addEventListener('pointermove', (e) => {
    if (!arrasto) return
    const dx = e.clientX - arrasto.x, dy = e.clientY - arrasto.y
    if (!arrastou && Math.hypot(dx, dy) < 5) return
    arrastou = true
    if (zoom.k > 1.02) { zoom.cx -= dx / s; zoom.cy -= dy / s; zoom.acx = null }
    arrasto = { x: e.clientX, y: e.clientY }
  })
  const solta = () => { arrasto = null; setTimeout(() => { arrastou = false }, 0) }
  el.addEventListener('pointerup', solta); el.addEventListener('pointercancel', solta); el.addEventListener('pointerleave', solta)
  el.addEventListener('dblclick', () => { zoom.alvo = 1; focoAlvo = 0; zoom.acx = null; atualizaCursor() })
  function atualizaCursor() { el.style.cursor = zoom.alvo > 1.02 ? 'grab' : '' }
  let focoAlvo = 0, bombaFoco = 0

  // ---------------------------------------------------------- estados das vagas (os mesmos do 3D)
  function muda(vg, estado) { vg.estado = estado; vg.t = 0; avisa(vg) }
  function livreNaBomba(vg) { return conectores.find((c) => c.bomba === vg.bomba && c.uso == null && c.vagasNaturais.includes(vg.i)) || conectores.find((c) => c.bomba === vg.bomba && c.uso == null) }
  function liberaConector(vg) { const c = conectores[vg.con]; if (c && c.uso === vg.i) c.uso = null }
  function evento(i, acao, opc = {}) {
    const vg = vagas[i]; if (!vg) return false
    if (acao === 'chegar' && vg.estado === 'vazia') {
      const c = opc.conector != null ? conectores[opc.conector] : livreNaBomba(vg)
      if (!c || c.uso != null || c.bomba !== vg.bomba) return false
      c.uso = vg.i; vg.con = c.id; vg.dc = c.dc; vg.ficar = !!opc.ficar
      vg.kw = POT[an.bombas[vg.bomba].modelo][c.dc ? 'dc' : 'ac']
      const cor = COR_IMG[String(opc.cor || '').toLowerCase()] || IMGS[proximas[0]++ % IMGS.length]
      vg.img.setAttribute('href', `dados/planta/carro-${cor}.webp`)
      vg.pct = 12 + ((vg.i * 37 + proximas[0] * 23) % 40)
      muda(vg, 'chegando')
    }
    if (acao === 'sair' && ['carregando', 'falha'].includes(vg.estado)) { if (opc.ficar != null) vg.ficar = !!opc.ficar; muda(vg, 'desconectando') }
    else if (acao === 'sair' && vg.estado === 'concluido') muda(vg, 'saindo')
    return true
  }
  function setFalha(on, bi) {
    for (const b of bombas) if (bi === undefined || b.bi === bi) b.falha = on
    for (const vg of vagas) {
      const f = bombas[vg.bomba].falha
      if (f && vg.estado === 'carregando') muda(vg, 'falha'); else if (!f && vg.estado === 'falha') muda(vg, 'carregando')
    }
  }
  // tomada do carro: lado virado para a bomba (o mesmo do 3D: lado > 0 → esquerda do carro)
  const tomada = (vg) => ({ x: vg.pos.x + (vg.lado > 0 ? -PORTA.x : PORTA.x), y: vg.cy + PORTA.y })

  // ---------------------------------------------------------- hora do dia e clima
  let hora = opcoes.hora ?? 14, noite = 0
  const chuva = { k: 0, alvo: 0 }, nuvem = { k: 0, alvo: 0 }
  function aplicaHora() {
    const { a, b, t } = periodoDaHora(hora)
    noite = lerp(a === 'noite' ? 1 : 0, b === 'noite' ? 1 : 0, t) * 0.85 + (a === 'por' || b === 'por' ? 0.25 : 0)
    noite = clamp01(noite)
    const cinza = Math.max(chuva.k, 0.6 * nuvem.k)
    const piso = (c0, c1) => mistura(c0, c1, noite)
    laje.setAttribute('fill', escurece(piso('#1A211D', '#0F1412'), cinza))
    patio.setAttribute('fill', escurece(piso('#202823', '#121815'), cinza))
    calcada.setAttribute('fill', escurece(piso('#262F2A', '#161C19'), cinza))
    borda.setAttribute('stroke-opacity', (0.45 + 0.4 * noite).toFixed(2))
    for (const b2 of bombas) b2.luz.setAttribute('opacity', (0.25 + 0.75 * noite).toFixed(2))
    svg.style.filter = cinza > 0.01 ? `saturate(${(1 - 0.3 * cinza).toFixed(2)}) brightness(${(1 - 0.12 * cinza).toFixed(2)})` : ''
  }
  const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16))
  const paraHex = (c) => '#' + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')
  const mistura = (a, b, t) => { const x = hex(a), y = hex(b); return paraHex(x.map((v, k) => lerp(v, y[k], t))) }
  const escurece = (h, k) => paraHex(hex(h).map((v) => v * (1 - 0.18 * k)))

  // chuva vista de cima: respingos (anéis) no chão da laje e riscos finos; nuvens: sombras grandes e macias passando
  const pingos = []
  function desenhaClima(dt, tempo) {
    const dpr = cnvClima.width / W
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H)
    if (nuvem.k > 0.01) {
      for (let k = 0; k < 3; k++) {
        const px = ((tempo * 0.35 + k * 7.3) % 22) - 6 + LAJE.x0, py = LAJE.y0 + 2 + k * 2.6
        const p = tela(px, py), r = (3.2 + k) * s
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r)
        g.addColorStop(0, `rgba(0,0,0,${0.22 * nuvem.k})`); g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g; ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r)
      }
    }
    if (chuva.k < 0.01) { pingos.length = 0; return }
    const nNovos = 22 * chuva.k * dt * 10
    for (let k = 0; k < nNovos; k++) pingos.push({ x: lerp(LAJE.x0 + 0.2, LAJE.x1 - 0.2, Math.random()), y: lerp(LAJE.y0 + 0.2, LAJE.y1 - 0.2, Math.random()), t: 0, d: 0.35 + Math.random() * 0.25 })
    ctx.lineWidth = 1
    for (let k = pingos.length - 1; k >= 0; k--) {
      const p = pingos[k]; p.t += dt
      if (p.t > p.d) { pingos.splice(k, 1); continue }
      const f = p.t / p.d, q = tela(p.x, p.y)
      ctx.strokeStyle = `rgba(205,222,240,${(0.42 * (1 - f) * (1 - f) * chuva.k).toFixed(3)})`   // pingo que bate e abre um anel pequeno
      ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1, (0.02 + f * 0.11) * s), 0, Math.PI * 2); ctx.stroke()
    }
    // riscos: a chuva caindo, bem de leve, inclinada pelo vento
    ctx.strokeStyle = `rgba(210,225,245,${(0.16 * chuva.k).toFixed(3)})`
    ctx.beginPath()
    for (let k = 0; k < 90 * chuva.k; k++) {
      const x = (Math.sin(k * 91.7) * 0.5 + 0.5) * W, y0 = ((Math.sin(k * 37.3) * 0.5 + 0.5) * H + tempo * (380 + (k % 5) * 40)) % (H + 40) - 20
      ctx.moveTo(x, y0); ctx.lineTo(x - 4, y0 + 14)
    }
    ctx.stroke()
  }

  // ---------------------------------------------------------- selos (as mesmas classes e o mesmo arranjo do 3D)
  const ICONE_RAIO = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M8 1 3 8h3.5L6 13l5-7H7.5Z" fill="currentColor"/></svg>'
  const ICONE_ALERTA = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 15 14H1Z" fill="currentColor"/><path d="M8 6v4" stroke="#200" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="12" r=".9" fill="#200"/></svg>'
  const ICONE_BOMBA = '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2.5" y="1.5" width="6.5" height="11" rx="1.2" fill="currentColor"/><path d="M9 4.5h1.6a1 1 0 0 1 1 1v4.2a.9.9 0 0 0 1.8 0V4.3L12 3" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>'
  function seloPessoa(vg, ps) {
    const tipo = vg.con != null ? (conectores[vg.con].dc ? 'CCS2' : 'Tipo 2') : ''
    const linha = vg.estado === 'falha' ? `${tipo} · Interrompida` : vg.estado === 'conectando' ? `${tipo} · Conectando` : vg.estado === 'concluido' ? 'Terminou · ainda na vaga' : `${tipo} · ${vg.kw} kW${vg.aviso ? ` <em class="mv-aviso">${vg.aviso}</em>` : ''}`
    const anel = vg.dc && vg.estado === 'carregando' ? `<i class="mv-pct" style="--p:${vg.pct.toFixed(0)}">${vg.pct.toFixed(0)}%</i>` : ''
    return `<b class="mv-av">${ps.iniciais}</b><span class="mv-tx"><b>${ps.nome}</b><small>${linha}</small></span>${anel}`
  }
  function telaSelo(div, p, on) {
    if (div.dataset.mw == null || div.dataset.mh !== div.dataset.h) { div.dataset.mw = div.offsetWidth; div.dataset.mh = div.dataset.h }
    return { div, on, x: p.x, y: p.y, w: Number(div.dataset.mw), h: div.offsetHeight || 32, sobe: 0 }
  }
  function arrumaSelos(itens) {
    const vis = itens.filter((i) => i.on).sort((a, b) => b.y - a.y)
    for (let i = 1; i < vis.length; i++) for (let j = 0; j < i; j++) {
      const a = vis[i], b = vis[j], folga = 6
      const baseA = a.y - a.sobe, topoB = b.y - b.sobe - b.h
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 + folga && baseA > topoB - folga && baseA - a.h < b.y - b.sobe) a.sobe += baseA - (topoB - folga)
    }
    for (const it of itens) {
      it.div.style.transform = `translate(${it.x}px, ${it.y - it.sobe}px) translate(-50%, -100%)`
      it.div.style.setProperty('--haste', `${7 + it.sobe}px`)
      it.div.classList.toggle('on', it.on)
    }
  }
  let tempo = 0
  function atualizaSelos() {
    const itens = []
    for (const vg of vagas) {
      const on = ['carregando', 'falha', 'conectando'].includes(vg.estado) || (vg.estado === 'concluido' && !!vg.pessoa)
      if (on) {
        const ps = vg.pessoa
        const html = ps ? seloPessoa(vg, ps)
          : vg.estado === 'falha' ? `<b class="mv-ic mv-ic-falha">${ICONE_ALERTA}</b><span>${vg.nome} · Interrompida</span>`
          : vg.estado === 'conectando' ? `<b class="mv-ic">${ICONE_RAIO}</b><span>${vg.nome} · Conectando</span>`
          : `<b class="mv-ic">${ICONE_RAIO}</b><span>${vg.nome} · ${vg.kw} kW</span>`
        if (vg.sel.dataset.h !== html) { vg.sel.innerHTML = html; vg.sel.dataset.h = html }
        vg.sel.classList.toggle('falha', vg.estado === 'falha'); vg.sel.classList.toggle('pessoa', !!ps)
      }
      itens.push(telaSelo(vg.sel, tela(vg.pos.x, vg.cy + 0.3), on))
      itens.push(telaSelo(vg.info, tela(vg.pos.x, vg.pos.y - 1.2), tempo < vg.infoAte))
    }
    for (const b of bombas) {
      const emFoco = foco > 0.6 && bombaFoco === b.bi && zoom.k > 1.35
      const htmlB = b.falha ? `<b class="mv-ic mv-ic-falha">${ICONE_ALERTA}</b><span>${b.nome} · Falha de comunicação</span><em class="mv-link">Ver detalhes</em>`
        : `<b class="mv-ic">${ICONE_BOMBA}</b><span>${b.nome} · Online</span><em class="mv-link">Ver detalhes</em>`
      if (b.sel.dataset.h !== htmlB) { b.sel.innerHTML = htmlB; b.sel.dataset.h = htmlB }
      b.sel.classList.toggle('falha', b.falha); b.sel.classList.add('clicavel')
      itens.push(telaSelo(b.sel, tela(b.x, b.y + 0.55), b.falha || emFoco))
    }
    arrumaSelos(itens)
  }

  // ---------------------------------------------------------- quadro
  let foco = 0
  function atualizaVaga(vg, dt) {
    vg.t += dt
    let y = vg.pos.y, a = 1, re = 0
    if (vg.estado === 'chegando') {
      const k = clamp01(vg.t / T_CHEGA), e = easeOut(k)
      y = vg.pos.y - D_CHEGADA * (1 - e); a = suave(clamp01(k / 0.25))
      if (k >= 1) muda(vg, 'conectando')
    } else if (vg.estado === 'saindo') {
      const k = clamp01(vg.t / T_SAI), e = easeInOut(k)
      y = vg.pos.y - D_SAIDA * e; a = 1 - suave(clamp01((k - 0.75) / 0.25)); re = 1
      if (k >= 1) { muda(vg, 'vazia'); liberaConector(vg); vg.con = null }
    }
    if (vg.estado === 'vazia') a = 0
    vg.cy = y; vg.a = a
    vg.gc.setAttribute('transform', `translate(${vg.pos.x} ${Y(y)})`)
    vg.gc.setAttribute('opacity', a.toFixed(3))
    vg.farois.setAttribute('opacity', (Math.max(noite, 0.6 * chuva.k) * (vg.estado === 'vazia' ? 0 : 1)).toFixed(2))
    vg.re.setAttribute('opacity', (re || (vg.estado === 'desconectando' && vg.t > T_DESCONECTA * 0.6) ? 0.9 : 0).toString())
    // cabo: cresce ao conectar, some ao desconectar
    let f = 0
    if (vg.estado === 'conectando') { f = easeInOut(clamp01(vg.t / T_CONECTA)); if (vg.t >= T_CONECTA) muda(vg, bombas[vg.bomba].falha ? 'falha' : 'carregando') }
    else if (['carregando', 'falha'].includes(vg.estado)) f = 1
    else if (vg.estado === 'desconectando') { f = 1 - easeInOut(clamp01(vg.t / T_DESCONECTA)); if (vg.t >= T_DESCONECTA) { liberaConector(vg); muda(vg, vg.ficar ? 'concluido' : 'saindo') } }
    const c = conectores[vg.con]
    if (c && f > 0) {
      const tp = tomada(vg), mx = (c.sx + tp.x) / 2 + (tp.x - c.sx) * 0.15, my = (c.sy + tp.y) / 2 + 0.55
      const d = `M${c.sx} ${Y(c.sy)}Q${mx} ${Y(my)} ${tp.x} ${Y(tp.y)}`
      if (vg.cabo.getAttribute('d') !== d) { vg.cabo.setAttribute('d', d); vg.fluxo.setAttribute('d', d) }
      vg.cabo.setAttribute('stroke-dashoffset', (1 - f).toFixed(3)); vg.cabo.setAttribute('opacity', '1')
      vg.fluxo.setAttribute('opacity', vg.estado === 'carregando' ? '0.95' : vg.estado === 'falha' ? '0.8' : '0')
      vg.fluxo.setAttribute('stroke', vg.estado === 'falha' ? CORES.falha : CORES.carregando)
      vg.fluxo.setAttribute('stroke-dashoffset', (-tempo * 0.6).toFixed(3))
    } else { vg.cabo.setAttribute('opacity', '0'); vg.fluxo.setAttribute('opacity', '0') }
    // anel do estado
    const cor = vg.estado === 'carregando' ? CORES.carregando : vg.estado === 'falha' ? CORES.falha : vg.estado === 'concluido' && !vg.realce ? CORES.concluido : vg.realce ? CORES.carregando : CORES.conectando
    const alvoA = ({ carregando: 0.75 + 0.25 * Math.sin(tempo * 2.4), falha: 0.55 + 0.45 * Math.sin(tempo * 6), conectando: 0.6, chegando: 0.35 * suave(clamp01(vg.t / T_CHEGA)), desconectando: 0.35, concluido: 0.55, saindo: 0, vazia: 0 }[vg.estado] || 0) + (vg.realce ? 0.5 : 0)
    vg.anelA = lerp(vg.anelA || 0, clamp01(alvoA), Math.min(1, dt * 6))
    for (const r of [vg.anel, vg.anelG]) { r.setAttribute('stroke', cor); r.setAttribute('opacity', vg.anelA.toFixed(3)) }
    if (vg.estado === 'carregando') vg.pct = Math.min(100, vg.pct + dt * 0.9)
  }
  function quadro(dt) {
    tempo += dt
    // zoom suave; com o mouse, aproxima no ponto apontado
    const kAnt = zoom.k
    zoom.k = lerp(zoom.k, zoom.alvo, Math.min(1, dt * 6))
    foco = lerp(foco, focoAlvo, Math.min(1, dt * 3.2))
    if (focoAlvo > 0.5) { const b = bombas[bombaFoco]; zoom.cx = lerp(zoom.cx, b.x, Math.min(1, dt * 4)); zoom.cy = lerp(zoom.cy, Y(b.y - 1.6), Math.min(1, dt * 4)) }
    else if (zoom.acx != null && Math.abs(zoom.k - kAnt) > 1e-5) {
      const sN = s0 * zoom.k, cxp = quadro0.l + quadro0.w / 2, cyp = quadro0.t + quadro0.h / 2
      zoom.cx = zoom.acx - (zoom.amx - cxp) / sN; zoom.cy = zoom.acy - (zoom.amy - cyp) / sN
    }
    aplicaVista()
    if (teto) teto.setAttribute('opacity', (1 - 0.85 * suave(clamp01((zoom.k - 1.1) / 0.8))).toFixed(2))
    for (const vg of vagas) atualizaVaga(vg, dt)
    for (const b of bombas) {
      const al = b.falha ? 0.55 + 0.45 * Math.sin(tempo * 5.5) : 0
      b.alarme.setAttribute('opacity', al.toFixed(2))
    }
    let mudou = false
    for (const c of [chuva, nuvem]) if (Math.abs(c.k - c.alvo) > 0.001) { c.k = lerp(c.k, c.alvo, Math.min(1, dt * 1.6)); if (Math.abs(c.k - c.alvo) < 0.002) c.k = c.alvo; mudou = true }
    if (mudou) aplicaHora()
    desenhaClima(dt, tempo)
    atualizaSelos()
  }
  let ultimo = performance.now()
  function laco(agora) { const dt = Math.min(0.1, (agora - ultimo) / 1000); ultimo = agora; quadro(dt); requestAnimationFrame(laco) }
  new ResizeObserver(tamanho).observe(el); tamanho()
  aplicaHora(); atualizaCursor()
  requestAnimationFrame(laco)

  let preco = '2,20'
  return {
    posto: an.posto, visao: '2d',
    quadroImagem: () => ({ x: quadro0.l, y: quadro0.t, w: quadro0.w, h: quadro0.h }),
    _telaDaVaga: (i) => { const p = tela(vagas[i].pos.x, vagas[i].pos.y), r = el.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y } },   // testes
    vagas: vagas.map((v) => ({ nome: v.nome, dc: v.dc, bomba: v.bomba, kw: v.kw, natural: (conectores.find((c) => c.vagasNaturais.includes(v.i)) || {}).id })),
    conectores: conectores.map((c) => ({ id: c.id, bomba: c.bomba, dc: c.dc, lado: c.lado, vagasNaturais: [...c.vagasNaturais] })),
    conectorDa: (i) => vagas[i].con,
    conectorLivre: (i) => { const c = livreNaBomba(vagas[i]); return c ? c.id : null },
    bombas: bombas.map((b) => ({ nome: b.nome, modelo: b.modelo })),
    estado: (i) => vagas[i].estado,
    falha: (bi) => bombas[bi].falha,
    evento, setFalha,
    setDados(i, d) { const vg = vagas[i]; if (d.kw != null) vg.kw = d.kw; if (d.pct != null) vg.pct = d.pct; if (d.pessoa !== undefined) vg.pessoa = d.pessoa; if (d.aviso !== undefined) vg.aviso = d.aviso },
    getDados: (i) => ({ kw: vagas[i].kw, pct: vagas[i].pct }),
    setRealce(i) { for (const vg of vagas) vg.realce = vg.i === i },
    mostrarVaga(i, html, seg = 5) { const vg = vagas[i]; if (vg.info.dataset.h !== html) { vg.info.innerHTML = html; vg.info.dataset.h = html } vg.infoAte = tempo + seg },
    ouvir(f) { ouvintes.push(f) },
    setHora(h) { hora = h; aplicaHora() },
    getHora: () => hora,
    setPreco(v) { preco = v; if (precoTxt) precoTxt.textContent = `R$ ${preco}` },
    setChuva(on, imediato) { chuva.alvo = on ? 1 : 0; nuvem.alvo = on ? 1 : nuvem.alvo; if (imediato) { chuva.k = chuva.alvo; nuvem.k = nuvem.alvo; aplicaHora() } },
    getChuva: () => chuva.alvo > 0.5,
    setClima({ nuvens = 0, chuva: ch = 0 } = {}, imediato) { nuvem.alvo = clamp01(nuvens); chuva.alvo = clamp01(ch); if (imediato) { nuvem.k = nuvem.alvo; chuva.k = chuva.alvo; aplicaHora() } },
    setZoom(on, bi = 0) { bombaFoco = bi; focoAlvo = on ? 1 : 0; zoom.alvo = on ? 2.0 : 1; zoom.acx = null; atualizaCursor() },
    setZoomNivel(k) { zoom.alvo = limita(Math.abs(k - 1) < 0.08 ? 1 : k); if (zoom.alvo < 1.05) focoAlvo = 0; zoom.acx = null; atualizaCursor() },
    zoomLimites: { min: ZOOM_MIN, max: ZOOM_MAX },
    getZoom: () => zoom.alvo,
    avancar(dt, passos = 1) { for (let i = 0; i < passos; i++) quadro(dt) },
    canvas: svg,
  }
}
