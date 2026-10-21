// iGreen · Painel V1 · visão 2D em imagens: o posto visto do alto (~62°), feito de camadas renderizadas,
// e o que muda ao vivo (carros, cabos, anéis das vagas, preço do totem, chuva, selos) por cima.
// Mesmo contrato do maquete.js (criarMaquete): o painel não sabe qual visão está desenhando.
//
// Camadas (dados/<posto>/<pasta>/, geradas por blender/maquete_topo.py):
//   planta-tarde.webp, planta-noite.webp   o posto vazio, de dia e de noite
//   teto-tarde.webp, teto-noite.webp       o teto da cobertura (translúcido por cima dos carros; some ao aproximar)
//   planta.json                            a projeção mundo (metros) → pixel da imagem; "ajuste" opcional (variação ilustrada)
// Carros: dados/planta/carro62-<cor>.webp (blender/carro_planta.py, o mesmo carro v2 da maquete, no mesmo ângulo e escala).
const NS = 'http://www.w3.org/2000/svg'
const CHAVES = [[0, 'noite'], [5, 'noite'], [7.5, 'manha'], [10, 'manha'], [12.5, 'tarde'], [16.5, 'tarde'], [17.8, 'por'], [18.6, 'por'], [19.6, 'noite'], [24, 'noite']]
const lerp = (a, b, t) => a + (b - a) * t
const clamp01 = (t) => Math.max(0, Math.min(1, t))
const clamp = (t, a, b) => Math.max(a, Math.min(b, t))
const suave = (t) => t * t * (3 - 2 * t)
const easeOut = (t) => 1 - Math.pow(1 - t, 3)
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
function periodoDaHora(h) {
  h = ((h % 24) + 24) % 24
  for (let i = 0; i < CHAVES.length - 1; i++) {
    const [h0, p0] = CHAVES[i], [h1, p1] = CHAVES[i + 1]
    if (h >= h0 && h <= h1) return { a: p0, b: p1, t: p0 === p1 ? 0 : suave((h - h0) / (h1 - h0)) }
  }
  return { a: 'noite', b: 'noite', t: 0 }
}
const CORES = { carregando: '#3DFF6A', conectando: '#E9FFEF', falha: '#FF2A1F', concluido: '#F5B54A' }
const POT = { fast: { dc: 38, ac: 7 }, ultra: { dc: 76, ac: 7 }, mobi: { dc: 7, ac: 7 } }
const NOME_BOMBA = { fast: 'Mobi Fast', ultra: 'Mobi Ultra Fast', mobi: 'Mobi' }
const COR_IMG = { '#e9ebed': 'branco', '#b9c0c6': 'prata', '#4a5157': 'grafite', '#1f8a4c': 'verde' }
const IMGS = ['branco', 'prata', 'grafite', 'verde']
const CAR = { w: 2.8, h: 5.6 }                                  // metros do quadro do render do carro (carro_planta.py)
const PORTA = { x: 0.89, y: 1.33, z: 0.97 }                     // tomada (carro.json), lado virado para a bomba
const D_CHEGADA = 3.6, D_SAIDA = 4.2, T_CHEGA = 3.2, T_CONECTA = 1.5, T_DESCONECTA = 1.0, T_SAI = 4.2
const ZOOM_MIN = 0.75, ZOOM_MAX = 3, CABE = 0.7               // CABE: no 100% a planta ocupa 70% do espaço
const LINHAS_TOTEM = { fast: ['DC · 40 kW', 'AC · 7 kW', '2 vagas'], ultra: ['DC · 80 kW', '2 vagas'], mobi: ['AC · 7 kW', '2 vagas'] }

function no(tag, attrs = {}, pai) {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  if (pai) pai.appendChild(e)
  return e
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mistura = (a, b, t) => { const x = hex(a), y = hex(b); return '#' + x.map((v, i) => Math.round(lerp(v, y[i], t)).toString(16).padStart(2, '0')).join('') }
const carrega = (u) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(true); im.onerror = () => ok(false); im.src = u })

export async function criarPlantaImagem(el, opcoes = {}) {
  const base = opcoes.dados || 'dados/fast/', pasta = base + (opcoes.pasta || 'planta') + '/'
  const passo = (f) => opcoes.aoProgresso && opcoes.aoProgresso(f)
  const [an, pj] = await Promise.all([fetch(base + 'ancoras.json').then((r) => r.json()), fetch(pasta + 'planta.json').then((r) => r.json())]); passo(0.2)
  const CARROS = pj.carros || 'carro62'                       // sprites dos carros: o render (carro62) ou os da variação ilustrada
  const IM = Object.assign({ tarde: 'planta-tarde.webp', noite: 'planta-noite.webp', teto: 'teto-tarde.webp', tetoNoite: 'teto-noite.webp' }, pj.imagens || {})
  const tem = {}
  let feitos = 0; const lista = [['tarde', IM.tarde], ['noite', IM.noite], ['teto', pj.teto ? IM.teto : null], ['tetoNoite', pj.teto ? IM.tetoNoite : null]]
  await Promise.all([...lista.map(async ([k, f]) => { tem[k] = f ? await carrega(pasta + f) : false; passo(0.2 + 0.6 * (++feitos / 8)) }),
    ...IMGS.map(async (c) => { await carrega(`dados/planta/${CARROS}-${c}.webp`); passo(0.2 + 0.6 * (++feitos / 8)) })])
  passo(1)

  // ---------------------------------------------------------- projeção: mundo (x, y, z em metros) → pixel da imagem
  const k = pj.pxm, sen = pj.cima[1], cos = pj.cima[2], aj = pj.ajuste || { sx: 1, sy: 1, dx: 0, dy: 0 }
  const W = pj.saida ? pj.saida.w : pj.w, H = pj.saida ? pj.saida.h : pj.h
  const P = (x, y, z = an.Z) => ({ x: (pj.w / 2 + (x - pj.cx) * k) * aj.sx + aj.dx, y: (pj.h / 2 - (y * sen + z * cos - pj.cy) * k) * aj.sy + aj.dy })
  const K = k * aj.sx, KY = k * aj.sy                          // px por metro na horizontal e na profundidade (antes do sen)

  // ---------------------------------------------------------- SVG: camadas na ordem de quem fica por cima
  const svg = no('svg', { class: 'mv-planta', role: 'img', 'aria-label': 'O posto visto de cima', preserveAspectRatio: 'none' })
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', touchAction: 'none', overflow: 'visible' })
  el.appendChild(svg)
  const defs = no('defs', {}, svg)
  defs.innerHTML = `
    <filter id="pi-brilho" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${(0.09 * K).toFixed(1)}"/></filter>
    <filter id="pi-sombra" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${(0.16 * K).toFixed(1)}"/></filter>
    <radialGradient id="pi-farol"><stop offset="0" stop-color="#EAF4FF" stop-opacity=".6"/><stop offset="1" stop-color="#EAF4FF" stop-opacity="0"/></radialGradient>
    <radialGradient id="pi-re"><stop offset="0" stop-color="#FF3020" stop-opacity=".85"/><stop offset="1" stop-color="#FF3020" stop-opacity="0"/></radialGradient>
    <radialGradient id="pi-alarme"><stop offset="0" stop-color="#FF2A1F" stop-opacity=".55"/><stop offset="1" stop-color="#FF2A1F" stop-opacity="0"/></radialGradient>`
  const gMundo = no('g', {}, svg)
  const imgDia = no('image', { href: pasta + IM.tarde, x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none' }, gMundo)
  const imgNoite = tem.noite ? no('image', { href: pasta + IM.noite, x: 0, y: 0, width: W, height: H, opacity: 0, preserveAspectRatio: 'none' }, gMundo) : null
  const gAneis = no('g', {}, gMundo), gCabos = no('g', {}, gMundo), gCarros = no('g', {}, gMundo), gBombas = no('g', {}, gMundo)
  // o teto sempre vem do render do Blender: na variação ilustrada ele é encaixado pelo mesmo ajuste
  // tetoRet: onde a imagem do teto cai, em pixels do render (a ilustrada é um recorte só do teto); sem ele, o render inteiro
  const tr = pj.tetoRet || [0, 0, pj.w, pj.h]
  const RT = { x: tr[0] * aj.sx + aj.dx, y: tr[1] * aj.sy + aj.dy, width: tr[2] * aj.sx, height: tr[3] * aj.sy, preserveAspectRatio: 'none' }
  const gTeto = no('g', { style: 'pointer-events:none' }, gMundo)
  const tetoDia = tem.teto ? no('image', { href: pasta + IM.teto, ...RT }, gTeto) : null
  const tetoNoite = tem.tetoNoite ? no('image', { href: pasta + IM.tetoNoite, ...RT, opacity: 0 }, gTeto) : null
  const gTotem = no('g', { style: 'pointer-events:none' }, gMundo)

  // ---------------------------------------------------------- bombas: área clicável e alarme de falha
  const bombas = an.bombas.map((b, bi) => {
    const caixas = an.oclusores.filter((o) => o.nome.startsWith(`bomba${bi}_`))
    const xs = caixas.flatMap((o) => [o.min[0], o.max[0]]), zs = caixas.flatMap((o) => [o.min[2], o.max[2]])
    const x0 = Math.min(...xs, b.x - 0.6), x1 = Math.max(...xs, b.x + 0.6), zt = Math.max(...zs, 2.4)
    const a = P(x0 - 0.1, b.y + 0.3, zt + 0.1), c = P(x1 + 0.1, b.y - 0.3, an.Z)
    const g = no('g', { style: 'cursor:pointer' }, gBombas)
    const alarme = no('ellipse', { cx: (a.x + c.x) / 2, cy: c.y - 0.2 * K, rx: (c.x - a.x) * 0.9, ry: 0.9 * K * sen, fill: 'url(#pi-alarme)', opacity: 0 }, g)
    const contorno = no('rect', { x: a.x, y: a.y, width: c.x - a.x, height: c.y - a.y, rx: 0.12 * K, fill: 'transparent', stroke: CORES.falha, 'stroke-width': (0.04 * K).toFixed(1), opacity: 0 }, g)
    const nome = NOME_BOMBA[b.modelo] + (an.bombas.length > 1 ? ' ' + (bi + 1) : '')
    g.addEventListener('click', () => { if (!arrastou) el.dispatchEvent(new CustomEvent('mv-bomba', { detail: { bomba: bi } })) })
    return { bi, modelo: b.modelo, nome, x: b.x, y: b.y, topo: zt, g, alarme, contorno, falha: false, sel: null }
  })
  // conectores: uma saída de cabo por (bomba, saída), como no 3D
  const conectores = []
  an.vagas.forEach((v, i) => {
    const chave = v.bomba + ':' + v.saida.map((n) => n.toFixed(3)).join(',')
    const ja = conectores.find((c) => c.chave === chave); if (ja) { ja.vagasNaturais.push(i); return }
    const b = an.bombas[v.bomba]
    conectores.push({ id: conectores.length, chave, bomba: v.bomba, dc: v.ponto === 'dc', s: v.saida,
      lado: v.saida[0] < b.x - 0.05 ? 'esquerda' : v.saida[0] > b.x + 0.05 ? 'direita' : 'centro', vagasNaturais: [i], uso: null })
  })

  // ---------------------------------------------------------- totem: a face com o preço de agora (a do render tem o preço fixo)
  let precoTxt = null, precoCaixa = null
  if (pj.preco) {
    // variação ilustrada: o totem é o da imagem; só o número do preço é trocado (caixa da cor do painel + texto)
    const r = pj.preco
    precoCaixa = no('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 3, fill: r.fundo || '#29303A' }, gTotem)
    precoTxt = no('text', { x: r.x + r.w / 2, y: r.base ?? r.y + r.h * 0.8, 'font-size': r.fonte ?? r.h * 0.78, 'font-weight': 800, 'text-anchor': 'middle', fill: '#F4F7F5', 'font-family': '"Instrument Sans", system-ui, sans-serif', 'letter-spacing': -0.5 }, gTotem)
    precoTxt.textContent = '2,20'
  } else if (an.totem && an.totem.cantos) {
    const cs = an.totem.cantos, xs = cs.map((c) => c[0]), zs = cs.map((c) => c[2]), yf = cs[0][1]
    const a = P(Math.min(...xs), yf, Math.max(...zs)), c = P(Math.max(...xs), yf, Math.min(...zs))
    const sx = (c.x - a.x) / 400, sy = (c.y - a.y) / 1200
    const f = no('g', { transform: `translate(${a.x.toFixed(2)} ${a.y.toFixed(2)}) scale(${sx.toFixed(5)} ${sy.toFixed(5)})` }, gTotem)
    const fonte = '"Barlow Condensed", "Arial Narrow", sans-serif'
    no('rect', { x: 0, y: 280, width: 400, height: 920, fill: '#11171A' }, f)
    no('rect', { x: 22, y: 280, width: 356, height: 894, rx: 26, fill: '#070B0C', stroke: '#1E272B', 'stroke-width': 3 }, f)
    const t = (x, y, s, peso, cor, txt, extra = {}) => { const e = no('text', { x, y, 'font-size': s, 'font-weight': peso, fill: cor, 'font-family': fonte, ...extra }, f); e.textContent = txt; return e }
    t(51, 340, 22, 700, '#8FA19A', 'PREÇO DO kWh', { 'letter-spacing': 3 })
    t(51, 410, 38, 700, '#F2FFF5', 'R$')
    precoTxt = t(98, 520, 168, 800, '#F2FFF5', '2,20', { 'letter-spacing': -6 })
    t(51, 585, 34, 700, '#3DF56A', 'por kWh')
    no('rect', { x: 51, y: 640, width: 298, height: 3, fill: '#1E272B' }, f)
    ;(an.totem.linhas || LINHAS_TOTEM.fast).forEach((txt, i) => { t(51, 730 + i * 90, 42, 600, '#DCE7E2', txt); no('circle', { cx: 338, cy: 716 + i * 90, r: 11, fill: '#03FF1F' }, f) })
    no('rect', { x: 51, y: 1040, width: 298, height: 3, fill: '#1E272B' }, f)
    t(200, 1090, 26, 600, '#8FA19A', 'Pague pelo app', { 'text-anchor': 'middle' }); t(200, 1125, 26, 600, '#8FA19A', 'ou cartão', { 'text-anchor': 'middle' })
  }

  // ---------------------------------------------------------- vagas: anel do estado, área clicável, carro e cabo
  const BW = an.BAY_W, BD = an.BAY_D
  let proxCor = 0
  const vagas = an.vagas.map((v, i) => {
    const x = v.x, y = v.ycarro, x0 = x - BW / 2, x1 = x + BW / 2
    const pa = P(x0 + 0.18, BD - 0.13), pb = P(x1 - 0.18, 0.13)
    const ret = { x: pa.x, y: pa.y, width: pb.x - pa.x, height: pb.y - pa.y, rx: 0.3 * K, ry: 0.3 * KY * sen, fill: 'none' }
    const anelG = no('rect', { ...ret, stroke: CORES.carregando, 'stroke-width': (0.16 * K).toFixed(1), opacity: 0, filter: 'url(#pi-brilho)' }, gAneis)
    const anel = no('rect', { ...ret, stroke: CORES.carregando, 'stroke-width': (0.05 * K).toFixed(1), opacity: 0 }, gAneis)
    const qa = P(x0, BD), qb = P(x1, 0)
    const area = no('rect', { x: qa.x, y: qa.y, width: qb.x - qa.x, height: qb.y - qa.y, fill: 'transparent', style: 'cursor:pointer' }, gAneis)
    area.addEventListener('click', () => { if (!arrastou) el.dispatchEvent(new CustomEvent('mv-vaga', { detail: { vaga: i, estado: vagas[i].estado } })) })
    const gc = no('g', { opacity: 0, style: 'pointer-events:none' }, gCarros)
    const farois = no('g', { opacity: 0 }, gc)
    for (const dx of [-0.55, 0.55]) no('ellipse', { cx: dx * K, cy: -(2.4 * sen + 0.55 * cos) * KY - 0.5 * KY * sen, rx: 0.42 * K, ry: 0.8 * KY * sen, fill: 'url(#pi-farol)' }, farois)
    const re = no('ellipse', { cx: 0, cy: (2.15 * sen - 0.5 * cos) * KY, rx: 1.05 * K, ry: 0.45 * KY * sen, fill: 'url(#pi-re)', opacity: 0 }, gc)
    // sombra de contato (os carros da variação ilustrada vêm sem sombra)
    if (pj.sombraCarro) no('rect', { x: -1.05 * K, y: -2.25 * KY * sen + 0.2 * KY, width: 2.1 * K, height: 4.5 * KY * sen, rx: 0.5 * K, fill: '#000', opacity: 0.38, filter: 'url(#pi-sombra)' }, gc)
    const img = no('image', { href: `dados/planta/${CARROS}-branco.webp`, x: -CAR.w / 2 * K, y: -CAR.h / 2 * KY, width: CAR.w * K, height: CAR.h * KY, preserveAspectRatio: 'none' }, gc)
    const cabo = no('path', { fill: 'none', stroke: '#0B0D0C', 'stroke-width': (0.075 * K).toFixed(1), 'stroke-linecap': 'round', pathLength: 1, 'stroke-dasharray': '1 1', 'stroke-dashoffset': 1 }, gCabos)
    const fluxo = no('path', { fill: 'none', stroke: CORES.carregando, 'stroke-width': (0.04 * K).toFixed(1), 'stroke-linecap': 'round', 'stroke-dasharray': `${(0.07 * K).toFixed(1)} ${(0.14 * K).toFixed(1)}`, opacity: 0 }, gCabos)
    return { i, dc: v.ponto === 'dc', nome: v.nome, bomba: v.bomba, lado: v.lado, pos: { x, y }, con: null, ficar: false, estado: 'vazia', t: 0, cy: y,
      pct: 18 + 30 * (i % 2), kw: POT[an.bombas[v.bomba].modelo][v.ponto === 'dc' ? 'dc' : 'ac'], anel, anelG, anelA: 0, gc, img, farois, re, cabo, fluxo, realce: false, pessoa: null, aviso: null }
  })
  // o teto e o totem ficam por cima dos carros
  gMundo.appendChild(gTeto); gMundo.appendChild(gTotem)

  // ---------------------------------------------------------- clima (canvas por cima) e selos
  const cnv = document.createElement('canvas')
  Object.assign(cnv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' })
  el.appendChild(cnv)
  const ctx = cnv.getContext('2d')
  const camadaSelos = document.createElement('div'); camadaSelos.className = 'mv-selos'; el.appendChild(camadaSelos)
  const selo = (cls) => { const d = document.createElement('div'); d.className = 'mv-selo ' + (cls || ''); camadaSelos.appendChild(d); return d }
  for (const b of bombas) { b.sel = selo('mv-selo-bomba'); b.sel.addEventListener('click', () => el.dispatchEvent(new CustomEvent('mv-bomba', { detail: { bomba: b.bi } }))) }
  for (const vg of vagas) {
    vg.sel = selo('mv-selo-carro')
    vg.sel.addEventListener('click', () => { if (vg.pessoa) el.dispatchEvent(new CustomEvent('mv-selo', { detail: { vaga: vg.i } })) })
    vg.info = selo('mv-selo-info'); vg.infoAte = -1; vg.info.addEventListener('click', () => { vg.infoAte = -1 })
  }
  const ouvintes = []
  const avisa = (vg) => { for (const f of ouvintes) f({ vaga: vg.i, nome: vg.nome, estado: vg.estado }) }

  // ---------------------------------------------------------- vista: 100% = 70% do espaço; zoom na roda (no ponto do mouse), arrasto
  const zoom = { k: 1, alvo: 1, cx: W / 2, cy: H / 2, acx: null }
  let Wc = 1, Hc = 1, s0 = 1, s = 1, vb = { x: 0, y: 0 }, q0 = { l: 0, t: 0, w: 1, h: 1 }, gradeChave = ''
  function tamanho() {
    Wc = Math.max(1, el.clientWidth); Hc = Math.max(1, el.clientHeight)
    const mg = (getComputedStyle(el).getPropertyValue('--mv-margem').trim() || '0').split(/\s+/).map(parseFloat)
    const [t, r, b, l] = [mg[0], mg[1] ?? mg[0], mg[2] ?? mg[0], mg[3] ?? mg[1] ?? mg[0]].map((v) => v || 0)
    q0 = { l, t, w: Math.max(1, Wc - l - r), h: Math.max(1, Hc - t - b) }
    s0 = Math.min(q0.w / W, q0.h / H) * (Wc < 560 ? 0.96 : CABE)          // no celular a planta usa quase todo o espaço
    const d = Math.min(2, devicePixelRatio || 1); cnv.width = Math.round(Wc * d); cnv.height = Math.round(Hc * d)
    aplicaVista()
  }
  function aplicaVista() {
    s = s0 * zoom.k
    if (zoom.k <= 1.001 && foco < 0.05) { zoom.cx = lerp(zoom.cx, W / 2, 0.2); zoom.cy = lerp(zoom.cy, H / 2, 0.2) }
    zoom.cx = clamp(zoom.cx, 0, W); zoom.cy = clamp(zoom.cy, 0, H)
    const cxp = q0.l + q0.w / 2, cyp = q0.t + q0.h / 2
    vb = { x: zoom.cx - cxp / s, y: zoom.cy - cyp / s }
    svg.setAttribute('viewBox', `${vb.x.toFixed(2)} ${vb.y.toFixed(2)} ${(Wc / s).toFixed(2)} ${(Hc / s).toFixed(2)}`)
    const kt = s / s0, gx = -vb.x * s, gy = -vb.y * s, ch = kt.toFixed(3) + gx.toFixed(1) + gy.toFixed(1)
    if (ch !== gradeChave) { gradeChave = ch; el.style.setProperty('--grade-k', kt.toFixed(3)); el.style.setProperty('--grade-x', gx.toFixed(1) + 'px'); el.style.setProperty('--grade-y', gy.toFixed(1) + 'px') }
  }
  const tela = (p) => ({ x: (p.x - vb.x) * s, y: (p.y - vb.y) * s })
  const limita = (v) => clamp(v, ZOOM_MIN, ZOOM_MAX)
  let arrasto = null, arrastou = false, foco = 0, focoAlvo = 0, bombaFoco = 0
  el.addEventListener('wheel', (e) => {
    e.preventDefault()
    const r = el.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top
    zoom.acx = vb.x + mx / s; zoom.acy = vb.y + my / s; zoom.amx = mx; zoom.amy = my
    zoom.alvo = limita(zoom.alvo * Math.exp(-e.deltaY * 0.0015)); if (zoom.alvo < 1.05) focoAlvo = 0
    cursor()
  }, { passive: false })
  el.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('.mv-selo')) return; arrasto = { x: e.clientX, y: e.clientY }; arrastou = false })
  el.addEventListener('pointermove', (e) => {
    if (!arrasto) return
    const dx = e.clientX - arrasto.x, dy = e.clientY - arrasto.y
    if (!arrastou && Math.hypot(dx, dy) < 5) return
    arrastou = true
    if (zoom.k > 1.02) { zoom.cx -= dx / s; zoom.cy -= dy / s; zoom.acx = null; focoAlvo = 0 }
    arrasto = { x: e.clientX, y: e.clientY }
  })
  const solta = () => { arrasto = null; setTimeout(() => { arrastou = false }, 0) }
  el.addEventListener('pointerup', solta); el.addEventListener('pointercancel', solta); el.addEventListener('pointerleave', solta)
  el.addEventListener('dblclick', () => { zoom.alvo = 1; focoAlvo = 0; zoom.acx = null; cursor() })
  function cursor() { el.style.cursor = zoom.alvo > 1.02 ? 'grab' : '' }

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
      const cor = COR_IMG[String(opc.cor || '').toLowerCase()] || IMGS[proxCor++ % IMGS.length]
      vg.img.setAttribute('href', `dados/planta/${CARROS}-${cor}.webp`)
      vg.pct = 12 + ((vg.i * 37 + proxCor * 23) % 40)
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

  // ---------------------------------------------------------- hora do dia e clima
  let hora = opcoes.hora ?? 14, noite = 0, por = 0
  const chuva = { k: 0, alvo: 0 }, nuvem = { k: 0, alvo: 0 }
  function aplicaHora() {
    const { a, b, t } = periodoDaHora(hora)
    const peso = (p) => lerp(a === p ? 1 : 0, b === p ? 1 : 0, t)
    noite = peso('noite'); por = peso('por')
    const manha = peso('manha'), cinza = Math.max(chuva.k, 0.6 * nuvem.k)
    if (imgNoite) imgNoite.setAttribute('opacity', noite.toFixed(3))
    if (tetoNoite) tetoNoite.setAttribute('opacity', noite.toFixed(3))
    // pôr do sol e manhã: o render da tarde aquecido; nuvem e chuva: menos cor e mais escuro
    const f = []
    if (por > 0.01) f.push(`sepia(${(0.35 * por).toFixed(2)}) saturate(${(1 + 0.25 * por).toFixed(2)}) hue-rotate(${(-10 * por).toFixed(1)}deg) brightness(${(1 - 0.12 * por).toFixed(2)})`)
    if (manha > 0.01) f.push(`sepia(${(0.12 * manha).toFixed(2)}) brightness(${(1 + 0.03 * manha).toFixed(2)})`)
    imgDia.style.filter = f.join(' ')
    // de noite os carros (sprites de dia) ficam mais escuros e frios, como o resto da cena
    gCarros.style.filter = noite > 0.01 ? `brightness(${(1 - 0.32 * noite).toFixed(2)}) saturate(${(1 - 0.2 * noite).toFixed(2)}) hue-rotate(${(8 * noite).toFixed(1)}deg)` : ''
    if (precoCaixa && pj.preco.fundoNoite) precoCaixa.setAttribute('fill', mistura(pj.preco.fundo, pj.preco.fundoNoite, noite))
    svg.style.filter = cinza > 0.01 ? `saturate(${(1 - 0.32 * cinza).toFixed(2)}) brightness(${(1 - 0.16 * cinza).toFixed(2)})` : ''
  }
  const pingos = []
  function desenhaClima(dt, tempo) {
    const d = cnv.width / Wc
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, Wc, Hc)
    if (nuvem.k > 0.01) {
      for (let j = 0; j < 3; j++) {
        const px = ((tempo * 0.35 + j * 7.3) % 22) - 11, py = 0.5 + j * 2.8
        const p = tela(P(px, py)), r = (3.4 + j) * K * s
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r)
        g.addColorStop(0, `rgba(0,0,0,${(0.22 * nuvem.k).toFixed(3)})`); g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g; ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r)
      }
    }
    if (chuva.k < 0.01) { pingos.length = 0; return }
    const novos = 26 * chuva.k * dt * 10
    for (let j = 0; j < novos; j++) pingos.push({ x: lerp(-4.3, 4.6, Math.random()), y: lerp(-1.7, 7.1, Math.random()), t: 0, d: 0.35 + Math.random() * 0.25 })
    ctx.lineWidth = 1
    for (let j = pingos.length - 1; j >= 0; j--) {
      const p = pingos[j]; p.t += dt
      if (p.t > p.d) { pingos.splice(j, 1); continue }
      const f = p.t / p.d, q = tela(P(p.x, p.y)), r = Math.max(1, (0.02 + f * 0.12) * K * s)
      ctx.strokeStyle = `rgba(215,228,242,${(0.5 * (1 - f) * (1 - f) * chuva.k).toFixed(3)})`
      ctx.beginPath(); ctx.ellipse(q.x, q.y, r, r * sen, 0, 0, Math.PI * 2); ctx.stroke()
    }
    ctx.strokeStyle = `rgba(215,228,245,${(0.17 * chuva.k).toFixed(3)})`
    ctx.beginPath()
    for (let j = 0; j < 90 * chuva.k; j++) {
      const x = (Math.sin(j * 91.7) * 0.5 + 0.5) * Wc, y0 = ((Math.sin(j * 37.3) * 0.5 + 0.5) * Hc + tempo * (380 + (j % 5) * 40)) % (Hc + 40) - 20
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
  function item(div, p, on) {
    if (div.dataset.mw == null || div.dataset.mh !== div.dataset.h) { div.dataset.mw = div.offsetWidth; div.dataset.mh = div.dataset.h }
    return { div, on, x: p.x, y: p.y, w: Number(div.dataset.mw), h: div.offsetHeight || 32, sobe: 0 }
  }
  function arruma(itens) {
    const vis = itens.filter((i) => i.on).sort((a, b) => b.y - a.y)
    for (let i = 1; i < vis.length; i++) for (let j = 0; j < i; j++) {
      const a = vis[i], b = vis[j], folga = 6, baseA = a.y - a.sobe, topoB = b.y - b.sobe - b.h
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 + folga && baseA > topoB - folga && baseA - a.h < b.y - b.sobe) a.sobe += baseA - (topoB - folga)
    }
    for (const it of itens) {
      it.div.style.transform = `translate(${it.x}px, ${it.y - it.sobe}px) translate(-50%, -100%)`
      it.div.style.setProperty('--haste', `${7 + it.sobe}px`)
      it.div.classList.toggle('on', it.on)
    }
  }
  let tempo = 0
  function selos() {
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
      itens.push(item(vg.sel, tela(P(vg.pos.x, vg.cy - 0.6, an.Z + 1.9)), on))
      itens.push(item(vg.info, tela(P(vg.pos.x, vg.pos.y - 1.4, an.Z + 0.3)), tempo < vg.infoAte))
    }
    for (const b of bombas) {
      const emFoco = foco > 0.6 && bombaFoco === b.bi && zoom.k > 1.35
      const h = b.falha ? `<b class="mv-ic mv-ic-falha">${ICONE_ALERTA}</b><span>${b.nome} · Falha de comunicação</span><em class="mv-link">Ver detalhes</em>`
        : `<b class="mv-ic">${ICONE_BOMBA}</b><span>${b.nome} · Online</span><em class="mv-link">Ver detalhes</em>`
      if (b.sel.dataset.h !== h) { b.sel.innerHTML = h; b.sel.dataset.h = h }
      b.sel.classList.toggle('falha', b.falha); b.sel.classList.add('clicavel')
      itens.push(item(b.sel, tela(P(b.x, b.y, b.topo + 0.25)), b.falha || emFoco))
    }
    arruma(itens)
  }

  // ---------------------------------------------------------- quadro
  function vaga(vg, dt) {
    vg.t += dt
    let y = vg.pos.y, a = 1, re = 0
    if (vg.estado === 'chegando') {
      const q = clamp01(vg.t / T_CHEGA), e = easeOut(q)
      y = vg.pos.y - D_CHEGADA * (1 - e); a = suave(clamp01(q / 0.25))
      if (q >= 1) muda(vg, 'conectando')
    } else if (vg.estado === 'saindo') {
      const q = clamp01(vg.t / T_SAI), e = easeInOut(q)
      y = vg.pos.y - D_SAIDA * e; a = 1 - suave(clamp01((q - 0.75) / 0.25)); re = 1
      if (q >= 1) { muda(vg, 'vazia'); liberaConector(vg); vg.con = null }
    }
    if (vg.estado === 'vazia') a = 0
    vg.cy = y
    const c = P(vg.pos.x, y, an.Z)
    vg.gc.setAttribute('transform', `translate(${c.x.toFixed(2)} ${c.y.toFixed(2)})`)
    vg.gc.setAttribute('opacity', a.toFixed(3))
    vg.farois.setAttribute('opacity', (Math.max(noite, 0.6 * chuva.k) * (vg.estado === 'vazia' ? 0 : 1)).toFixed(2))
    vg.re.setAttribute('opacity', re || (vg.estado === 'desconectando' && vg.t > T_DESCONECTA * 0.6) ? '0.9' : '0')
    let f = 0
    if (vg.estado === 'conectando') { f = easeInOut(clamp01(vg.t / T_CONECTA)); if (vg.t >= T_CONECTA) muda(vg, bombas[vg.bomba].falha ? 'falha' : 'carregando') }
    else if (['carregando', 'falha'].includes(vg.estado)) f = 1
    else if (vg.estado === 'desconectando') { f = 1 - easeInOut(clamp01(vg.t / T_DESCONECTA)); if (vg.t >= T_DESCONECTA) { liberaConector(vg); muda(vg, vg.ficar ? 'concluido' : 'saindo') } }
    const cn = conectores[vg.con]
    if (cn && f > 0) {
      const de = P(cn.s[0], cn.s[1], cn.s[2]), ate = P(vg.pos.x + (vg.lado > 0 ? -PORTA.x : PORTA.x), y + PORTA.y, an.Z + PORTA.z)
      const meio = P((cn.s[0] + vg.pos.x + (vg.lado > 0 ? -PORTA.x : PORTA.x)) / 2, (cn.s[1] + y + PORTA.y) / 2, an.Z + 0.12)   // o cabo pende quase até o chão
      const d = `M${de.x.toFixed(1)} ${de.y.toFixed(1)}Q${meio.x.toFixed(1)} ${meio.y.toFixed(1)} ${ate.x.toFixed(1)} ${ate.y.toFixed(1)}`
      if (vg.cabo.getAttribute('d') !== d) { vg.cabo.setAttribute('d', d); vg.fluxo.setAttribute('d', d) }
      vg.cabo.setAttribute('stroke-dashoffset', (1 - f).toFixed(3)); vg.cabo.setAttribute('opacity', '1')
      vg.fluxo.setAttribute('opacity', vg.estado === 'carregando' ? '0.95' : vg.estado === 'falha' ? '0.8' : '0')
      vg.fluxo.setAttribute('stroke', vg.estado === 'falha' ? CORES.falha : CORES.carregando)
      vg.fluxo.setAttribute('stroke-dashoffset', (-tempo * 0.6 * K).toFixed(1))
    } else { vg.cabo.setAttribute('opacity', '0'); vg.fluxo.setAttribute('opacity', '0') }
    const cor = vg.estado === 'carregando' ? CORES.carregando : vg.estado === 'falha' ? CORES.falha : vg.estado === 'concluido' && !vg.realce ? CORES.concluido : vg.realce ? CORES.carregando : CORES.conectando
    const alvo = ({ carregando: 0.75 + 0.25 * Math.sin(tempo * 2.4), falha: 0.55 + 0.45 * Math.sin(tempo * 6), conectando: 0.6, chegando: 0.35 * suave(clamp01(vg.t / T_CHEGA)), desconectando: 0.35, concluido: 0.55 }[vg.estado] || 0) + (vg.realce ? 0.5 : 0)
    vg.anelA = lerp(vg.anelA, clamp01(alvo), Math.min(1, dt * 6))
    for (const r of [vg.anel, vg.anelG]) { r.setAttribute('stroke', cor); r.setAttribute('opacity', vg.anelA.toFixed(3)) }
    if (vg.estado === 'carregando') vg.pct = Math.min(100, vg.pct + dt * 0.9)
  }
  function quadro(dt) {
    tempo += dt
    const kAnt = zoom.k
    zoom.k = lerp(zoom.k, zoom.alvo, Math.min(1, dt * 6))
    foco = lerp(foco, focoAlvo, Math.min(1, dt * 3.2))
    if (focoAlvo > 0.5) { const b = bombas[bombaFoco], p = P(b.x, b.y - 1.4, an.Z + 0.8); zoom.cx = lerp(zoom.cx, p.x, Math.min(1, dt * 4)); zoom.cy = lerp(zoom.cy, p.y, Math.min(1, dt * 4)) }
    else if (zoom.acx != null && Math.abs(zoom.k - kAnt) > 1e-5) {
      const sN = s0 * zoom.k, cxp = q0.l + q0.w / 2, cyp = q0.t + q0.h / 2
      zoom.cx = zoom.acx - (zoom.amx - cxp) / sN; zoom.cy = zoom.acy - (zoom.amy - cyp) / sN
    }
    aplicaVista()
    // ao aproximar, o teto da cobertura quase some (para ver os carros embaixo)
    gTeto.setAttribute('opacity', (((pj.tetoOpacidade ?? 0.3) + 0.12 * noite) * (1 - 0.8 * suave(clamp01((zoom.k - 1.1) / 0.8)))).toFixed(3))
    for (const vg of vagas) vaga(vg, dt)
    for (const b of bombas) {
      const al = b.falha ? 0.55 + 0.45 * Math.sin(tempo * 5.5) : 0
      b.alarme.setAttribute('opacity', al.toFixed(2)); b.contorno.setAttribute('opacity', (al * 0.9).toFixed(2))
    }
    let mudou = false
    for (const c of [chuva, nuvem]) if (Math.abs(c.k - c.alvo) > 0.001) { c.k = lerp(c.k, c.alvo, Math.min(1, dt * 1.6)); if (Math.abs(c.k - c.alvo) < 0.002) c.k = c.alvo; mudou = true }
    if (mudou) aplicaHora()
    desenhaClima(dt, tempo)
    selos()
  }
  let ultimo = performance.now()
  function laco(agora) { const dt = Math.min(0.1, (agora - ultimo) / 1000); ultimo = agora; quadro(dt); requestAnimationFrame(laco) }
  new ResizeObserver(tamanho).observe(el); tamanho()
  aplicaHora(); cursor()
  requestAnimationFrame(laco)

  return {
    posto: an.posto, visao: '2d',
    quadroImagem: () => ({ x: q0.l, y: q0.t, w: q0.w, h: q0.h }),
    _telaDaVaga: (i) => { const p = tela(P(vagas[i].pos.x, vagas[i].pos.y)), r = el.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y } },   // testes
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
    setPreco(v) { if (precoTxt) precoTxt.textContent = v },
    setChuva(on, imediato) { chuva.alvo = on ? 1 : 0; nuvem.alvo = on ? 1 : nuvem.alvo; if (imediato) { chuva.k = chuva.alvo; nuvem.k = nuvem.alvo; aplicaHora() } },
    getChuva: () => chuva.alvo > 0.5,
    setClima({ nuvens = 0, chuva: ch = 0 } = {}, imediato) { nuvem.alvo = clamp01(nuvens); chuva.alvo = clamp01(ch); if (imediato) { nuvem.k = nuvem.alvo; chuva.k = chuva.alvo; aplicaHora() } },
    setZoom(on, bi = 0) { bombaFoco = bi; focoAlvo = on ? 1 : 0; zoom.alvo = on ? 2.0 : 1; zoom.acx = null; cursor() },
    setZoomNivel(v) { zoom.alvo = limita(Math.abs(v - 1) < 0.08 ? 1 : v); if (zoom.alvo < 1.05) focoAlvo = 0; zoom.acx = null; cursor() },
    zoomLimites: { min: ZOOM_MIN, max: ZOOM_MAX },
    getZoom: () => zoom.alvo,
    avancar(dt, passos = 1) { for (let i = 0; i < passos; i++) quadro(dt) },
    canvas: svg,
  }
}
