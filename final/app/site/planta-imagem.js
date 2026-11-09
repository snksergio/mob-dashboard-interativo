// iGreen · Painel V1 · visão 2D em imagens: o posto visto do alto (~62°), feito de camadas renderizadas,
// e o que muda ao vivo (carros, cabos, anéis das vagas, preço do totem, chuva, selos) por cima.
// Mesmo contrato do maquete.js (criarMaquete): o painel não sabe qual visão está desenhando.
//
// Camadas (dados/<posto>/<pasta>/, geradas por blender/maquete_topo.py):
//   planta-tarde.webp, planta-noite.webp   o posto vazio, de dia e de noite
//   teto-tarde.webp, teto-noite.webp       o teto da cobertura (translúcido por cima dos carros; some ao aproximar)
//   planta.json                            a projeção mundo (metros) → pixel da imagem; "ajuste" opcional (variação ilustrada)
// Carros: dados/planta/carro62-<cor>.webp (blender/carro_planta.py, o mesmo carro v2 da maquete, no mesmo ângulo e escala).
import { telaVista, desenhoTela, brilhoLuzes, caixasDe } from './estado-bomba.js'
import { arranja, esquece, fatorParaGrupo } from './selos.js'

// (4/11) escreve um atributo só quando o valor muda: o quadro mexia em ~150 atributos por quadro mesmo com a cena parada,
// e cada escrita no SVG faz o navegador recalcular e repintar. Use só em atributos que nenhum outro lugar escreve
const at = (el, k, v) => { const c = el._at || (el._at = {}); if (c[k] !== v) { c[k] = v; el.setAttribute(k, v) } }
const NS = 'http://www.w3.org/2000/svg'
// as mesmas chaves de hora do 3D (V2, cópia do app, 1/11: com a manhã e o pôr do sol na maquete, os 4 horários; a 2D usa
// a imagem da tarde e a da noite com o tom de cada um, como antes da V1)
const CHAVES2 = [[0, 'noite'], [5.5, 'noite'], [7, 'tarde'], [17.4, 'tarde'], [18.8, 'noite'], [24, 'noite']]
const CHAVES4 = [[0, 'noite'], [5, 'noite'], [7.5, 'manha'], [10, 'manha'], [12.5, 'tarde'], [16.5, 'tarde'], [17.8, 'por'], [18.6, 'por'], [19.6, 'noite'], [24, 'noite']]
let CHAVES = CHAVES2
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
const CAR = { w: 2.8, h: 5.6, lw: 5.6, lh: 3.6 }                // metros do quadro do render do carro (carro_planta.py); lw/lh: o de lado
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
  const pr = await fetch(base + 'pronto.json').then((r) => (r.ok ? r.json() : null)).catch(() => null), hs = (pr && pr.horarios) || []
  CHAVES = hs.includes('manha') && hs.includes('por') ? CHAVES4 : CHAVES2
  const passo = (f) => opcoes.aoProgresso && opcoes.aoProgresso(f)
  const [an, pj] = await Promise.all([fetch(base + 'ancoras.json').then((r) => r.json()), fetch(pasta + 'planta.json').then((r) => r.json())]); passo(0.2)
  const CARROS = pj.carros || 'carro62'                       // sprites dos carros: o render (carro62) ou os da variação ilustrada
  const IM = Object.assign({ tarde: 'planta-tarde.webp', noite: 'planta-noite.webp', teto: 'teto-tarde.webp', tetoNoite: 'teto-noite.webp' }, pj.imagens || {})
  // (4/11, V3) a 2D nos horários que a maquete tem (pronto.json, horarios2d): tarde e noite sempre; manhã e pôr do sol
  // quando as peças deles existiam na montagem. As camadas de cada horário: o chão, o teto e (ilha) "sobre". Como no 3D,
  // as do horário de agora vêm primeiro; as outras, em segundo plano depois que o posto aparece
  const ORDEM = ['tarde', 'manha', 'por', 'noite']             // de baixo para cima no SVG
  const P2 = ORDEM.filter((p) => p === 'tarde' || p === 'noite' || ((pr && pr.horarios2d) || []).includes(p))
  const arqDe = (k, p) => (k === 'chao' ? (p === 'tarde' ? IM.tarde : p === 'noite' ? IM.noite : `planta-${p}.webp`)
    : k === 'teto' ? (p === 'tarde' ? IM.teto : p === 'noite' ? IM.tetoNoite : `teto-${p}.webp`) : `sobre-${p}.webp`)
  const TIPOS = ['chao', ...(pj.teto ? ['teto'] : []), ...(pj.sobre ? ['sobre'] : [])]
  // (só o horário mais perto da hora de agora; o outro do cruzamento chega em segundo plano)
  const INI2 = (() => { const { a, b, t } = periodoDaHora(opcoes.hora ?? 14), ok = (p) => (P2.includes(p) ? p : p === 'por' ? 'noite' : 'tarde'); return [ok(t < 0.5 ? a : b)] })()
  const tem = {}                                               // tem[tipo + horário]: a imagem já chegou
  // ilha (maquete v14): a camada "sobre" (bombas de trás e pilares do meio) e os carros virados para os fundos (CARROS + "r")
  const ILHA = !!an.ILHA
  let feitos = 0; const lista = INI2.flatMap((p) => TIPOS.map((k) => [k, p]))
  const carrosPre = ILHA ? IMGS.flatMap((c) => [`${CARROS}-${c}`, `${CARROS}r-${c}`]) : IMGS.map((c) => `${CARROS}-${c}`)
  const total = lista.length + carrosPre.length
  await Promise.all([...lista.map(async ([k, p]) => { tem[k + p] = await carrega(pasta + arqDe(k, p)); passo(0.2 + 0.6 * (++feitos / total)) }),
    ...carrosPre.map(async (n) => { await carrega(`dados/planta/${n}.webp`); passo(0.2 + 0.6 * (++feitos / total)) })])
  passo(1)

  // ---------------------------------------------------------- projeção: mundo (x, y, z em metros) → pixel da imagem
  const k = pj.pxm, sen = pj.cima[1], cos = pj.cima[2], aj = pj.ajuste || { sx: 1, sy: 1, dx: 0, dy: 0 }
  const W = pj.saida ? pj.saida.w : pj.w, H = pj.saida ? pj.saida.h : pj.h
  const P = (x, y, z = an.Z) => ({ x: (pj.w / 2 + (x - pj.cx) * k) * aj.sx + aj.dx, y: (pj.h / 2 - (y * sen + z * cos - pj.cy) * k) * aj.sy + aj.dy })
  const K = k * aj.sx, KY = k * aj.sy                          // px por metro na horizontal e na profundidade (antes do sen)
  // ilha: as vagas de trás vêm "de frente" no ancoras.json; o giro de 180° em volta de (CX, Y_MID) as leva ao lugar delas
  const mundo = (fil, x, y) => (fil === 'fundos' ? [2 * an.CX - x, 2 * an.Y_MID - y] : [x, y])
  const PV = (vg, x, y, z = an.Z) => { const [wx, wy] = mundo(vg.fileira, x, y); return P(wx, wy, z) }

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
  // as camadas de cada horário (camada[tipo][horário]): um <image> cada, na ORDEM (tarde embaixo); a que ainda não chegou
  // fica sem href (o horário mais parecido que já está aqui entra no lugar, ver aplicaHora)
  const camada = { chao: {}, teto: {}, sobre: {} }
  const gChao = no('g', {}, gMundo)
  const gAneis = no('g', {}, gMundo), gCabos = no('g', {}, gMundo), gCarros = no('g', {}, gMundo), gBombas = no('g', {}, gMundo)
  // ilha: as bombas de trás ficam na frente dos carros dos fundos (camada "sobre", logo acima dos carros)
  const gSobre = no('g', { style: 'pointer-events:none' }, gMundo), gSobreImg = no('g', {}, gSobre)
  // o teto sempre vem do render do Blender: na variação ilustrada ele é encaixado pelo mesmo ajuste
  // tetoRet: onde a imagem do teto cai, em pixels do render (a ilustrada é um recorte só do teto); sem ele, o render inteiro
  const tr = pj.tetoRet || [0, 0, pj.w, pj.h]
  const RT = { x: tr[0] * aj.sx + aj.dx, y: tr[1] * aj.sy + aj.dy, width: tr[2] * aj.sx, height: tr[3] * aj.sy, preserveAspectRatio: 'none' }
  const gTeto = no('g', { style: 'pointer-events:none' }, gMundo)
  for (const k of TIPOS) for (const p of P2) {
    const attrs = k === 'teto' ? { ...RT } : { x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none' }
    camada[k][p] = no('image', { ...attrs, opacity: 0, ...(tem[k + p] ? { href: pasta + arqDe(k, p) } : {}) }, k === 'chao' ? gChao : k === 'teto' ? gTeto : gSobreImg)
  }
  // os outros horários, em segundo plano, depois que o posto aparece (4/11: medido num celular com 4G, começar antes
  // disputava a banda com o que o painel ainda baixava para abrir), um arquivo de cada vez
  // (5/11) no celular (toque) ou em aparelho com pouca memória, os horários vêm sob demanda: cada um são ~2285 × 2253 de
  // chão (e, na ilha, a camada "sobre" do mesmo tamanho), ~20 MB cada imagem aberta; os quatro somavam ~185 MB. Lá, os
  // outros horários só vão para o cache do navegador (o arquivo) e entram na planta quando a hora chega neles; o horário
  // fora de uso há mais de 10 s sai da planta (a memória volta). No computador, tudo como antes
  const ECONOMIA = matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory || 8) <= 4
  setTimeout(async () => {
    for (const p of P2) for (const k of TIPOS) {
      if (tem[k + p]) continue
      if (ECONOMIA) { await fetch(pasta + arqDe(k, p)).then((r) => r.blob()).catch(() => null); continue }
      if (await carrega(pasta + arqDe(k, p))) { camada[k][p].setAttribute('href', pasta + arqDe(k, p)); tem[k + p] = true; aplicaHora() }
    }
  }, 5000)
  const daMaquete = (p) => (P2.includes(p) ? p : p === 'por' ? 'noite' : 'tarde')   // o horário que a maquete não tem: o parecido
  const carregandoP = {}, usoEm = {}
  function garante(p) {
    p = daMaquete(p)
    if (TIPOS.every((k) => tem[k + p])) return Promise.resolve()
    if (!carregandoP[p]) carregandoP[p] = Promise.all(TIPOS.map(async (k) => {
      if (tem[k + p]) return
      if (await carrega(pasta + arqDe(k, p))) { camada[k][p].setAttribute('href', pasta + arqDe(k, p)); tem[k + p] = true }
    })).then(() => { delete carregandoP[p] })
    return carregandoP[p]
  }
  function libera() {
    if (!ECONOMIA) return
    const { a, b } = periodoDaHora(hora), agora = performance.now(), A = daMaquete(a), B = daMaquete(b)
    usoEm[A] = usoEm[B] = agora
    for (const p of P2) if (p !== A && p !== B && agora - (usoEm[p] || 0) > 10000) for (const k of TIPOS) if (tem[k + p]) { camada[k][p].removeAttribute('href'); tem[k + p] = false }
  }
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
  if (an.conectores) for (const c of an.conectores) {     // v14: a lista vem pronta (saída "de frente", como as vagas)
    const b = an.bombas[c.bomba], bx = c.fileira === 'fundos' ? 2 * an.CX - b.x : b.x
    conectores.push({ id: conectores.length, chave: c.bomba + ':' + c.ponto + ':' + conectores.length, bomba: c.bomba, dc: c.ponto === 'dc', s: c.saida, fileira: c.fileira,
      lado: c.saida[0] < bx - 0.05 ? 'esquerda' : c.saida[0] > bx + 0.05 ? 'direita' : 'centro', vagasNaturais: [...c.vagas], uso: null })
  }
  else an.vagas.forEach((v, i) => {
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
    const fileira = v.fileira || 'frente', tras = fileira === 'fundos', lat = v.lateral || null   // (9/11) vagas paralelas
    const x = v.x, y = v.ycarro, x0 = x - BW / 2, x1 = x + BW / 2
    // retângulos da vaga: os cantos vão para o mundo (na fileira de trás, girados) e o retângulo é o que os contém
    const caixa = (ax, ay, bx, by) => { const [p, q] = [mundo(fileira, ax, ay), mundo(fileira, bx, by)]; const a = P(Math.min(p[0], q[0]), Math.max(p[1], q[1])), b = P(Math.max(p[0], q[0]), Math.min(p[1], q[1])); return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y } }
    const bz = lat && lat.baia, [bx0, bx1, by0, by1] = bz ? [bz.cx - bz.w / 2, bz.cx + bz.w / 2, bz.cy - bz.h / 2, bz.cy + bz.h / 2] : [x0, x1, 0, BD]
    const ret = { ...(bz ? caixa(bx0 + 0.13, by1 - 0.18, bx1 - 0.13, by0 + 0.18) : caixa(x0 + 0.18, BD - 0.13, x1 - 0.18, 0.13)), rx: 0.3 * K, ry: 0.3 * KY * sen, fill: 'none' }
    const anelG = no('rect', { ...ret, stroke: CORES.carregando, 'stroke-width': (0.16 * K).toFixed(1), opacity: 0, filter: 'url(#pi-brilho)' }, gAneis)
    const anel = no('rect', { ...ret, stroke: CORES.carregando, 'stroke-width': (0.05 * K).toFixed(1), opacity: 0 }, gAneis)
    const area = no('rect', { ...caixa(bx0, by1, bx1, by0), fill: 'transparent', style: 'cursor:pointer' }, gAneis)
    area.addEventListener('click', () => { if (!arrastou) el.dispatchEvent(new CustomEvent('mv-vaga', { detail: { vaga: i, estado: vagas[i].estado } })) })
    const gc = no('g', { opacity: 0, style: 'pointer-events:none' }, gCarros)
    // na fileira de trás o carro vem de frente para a câmera: faróis embaixo e ré em cima (o mesmo desenho, espelhado)
    // (nas vagas paralelas o carro olha para a direita: faróis à direita, ré à esquerda)
    const gLuz = no('g', tras ? { transform: 'scale(1 -1)' } : lat ? { transform: `rotate(90) scale(${(KY * sen / K).toFixed(3)} ${(K / (KY * sen)).toFixed(3)})` } : {}, gc)
    const farois = no('g', { opacity: 0 }, gLuz)
    for (const dx of [-0.55, 0.55]) no('ellipse', { cx: dx * K, cy: -(2.4 * sen + 0.55 * cos) * KY - 0.5 * KY * sen, rx: 0.42 * K, ry: 0.8 * KY * sen, fill: 'url(#pi-farol)' }, farois)
    const re = no('ellipse', { cx: 0, cy: (2.15 * sen - 0.5 * cos) * KY, rx: 1.05 * K, ry: 0.45 * KY * sen, fill: 'url(#pi-re)', opacity: 0 }, gLuz)
    // sombra de contato (os carros da variação ilustrada vêm sem sombra)
    if (pj.sombraCarro) no('rect', { x: -1.05 * K, y: -2.25 * KY * sen + 0.2 * KY, width: 2.1 * K, height: 4.5 * KY * sen, rx: 0.5 * K, fill: '#000', opacity: 0.38, filter: 'url(#pi-sombra)' }, gc)
    // (o carro de lado é o render deitado: 5,6 × 3,6 m em vez de 2,8 × 5,6)
    const [cw, ch] = lat ? [CAR.lw, CAR.lh] : [CAR.w, CAR.h]
    const img = no('image', { href: `dados/planta/${CARROS}${tras ? 'r' : lat ? 'l' : ''}-branco.webp`, x: -cw / 2 * K, y: -ch / 2 * KY, width: cw * K, height: ch * KY, preserveAspectRatio: 'none' }, gc)
    const cabo = no('path', { fill: 'none', stroke: '#0B0D0C', 'stroke-width': (0.075 * K).toFixed(1), 'stroke-linecap': 'round', pathLength: 1, 'stroke-dasharray': '1 1', 'stroke-dashoffset': 1 }, gCabos)
    const fluxo = no('path', { fill: 'none', stroke: CORES.carregando, 'stroke-width': (0.04 * K).toFixed(1), 'stroke-linecap': 'round', 'stroke-dasharray': `${(0.07 * K).toFixed(1)} ${(0.14 * K).toFixed(1)}`, opacity: 0 }, gCabos)
    return { i, dc: v.ponto === 'dc', nome: v.nome, bomba: v.bomba, lado: v.lado, fileira, pos: { x, y }, con: null, ficar: false, estado: 'vazia', t: 0, cy: y, cx: x, lat, dEntra: 0, dSai: null,
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
  let centroAlvo = null                       // tocar num grupo de selos: o ponto que a vista leva ao meio (abreGrupo)
  let Wc = 1, Hc = 1, s0 = 1, s = 1, vb = { x: 0, y: 0 }, q0 = { l: 0, t: 0, w: 1, h: 1 }, gradeChave = ''
  function tamanho() {
    Wc = Math.max(1, el.clientWidth); Hc = Math.max(1, el.clientHeight)
    const mg = (getComputedStyle(el).getPropertyValue('--mv-margem').trim() || '0').split(/\s+/).map(parseFloat)
    const [t, r, b, l] = [mg[0], mg[1] ?? mg[0], mg[2] ?? mg[0], mg[3] ?? mg[1] ?? mg[0]].map((v) => v || 0)
    q0 = { l, t, w: Math.max(1, Wc - l - r), h: Math.max(1, Hc - t - b) }
    // no celular a planta usa quase todo o espaço; --mv-cabe no CSS manda por cima (a tela cheia do painel usa)
    const cabeCss = parseFloat(getComputedStyle(el).getPropertyValue('--mv-cabe'))
    s0 = Math.min(q0.w / W, q0.h / H) * (cabeCss > 0 ? cabeCss : Wc < 560 ? 0.96 : CABE)
    const d = Math.min(2, devicePixelRatio || 1); cnv.width = Math.round(Wc * d); cnv.height = Math.round(Hc * d)
    aplicaVista()
  }
  function aplicaVista() {
    s = s0 * zoom.k
    if (zoom.k <= 1.001 && foco < 0.05 && !centroAlvo) { zoom.cx = lerp(zoom.cx, W / 2, 0.2); zoom.cy = lerp(zoom.cy, H / 2, 0.2) }
    zoom.cx = clamp(zoom.cx, 0, W); zoom.cy = clamp(zoom.cy, 0, H)
    const cxp = q0.l + q0.w / 2, cyp = q0.t + q0.h / 2
    vb = { x: zoom.cx - cxp / s, y: zoom.cy - cyp / s }
    svg.setAttribute('viewBox', `${vb.x.toFixed(2)} ${vb.y.toFixed(2)} ${(Wc / s).toFixed(2)} ${(Hc / s).toFixed(2)}`)
    const kt = s / s0, gx = -vb.x * s, gy = -vb.y * s, ch = kt.toFixed(3) + gx.toFixed(1) + gy.toFixed(1)
    if (ch !== gradeChave) { gradeChave = ch; el.style.setProperty('--grade-k', kt.toFixed(3)); el.style.setProperty('--grade-x', gx.toFixed(1) + 'px'); el.style.setProperty('--grade-y', gy.toFixed(1) + 'px') }
  }
  const tela = (p) => ({ x: (p.x - vb.x) * s, y: (p.y - vb.y) * s })
  const limita = (v) => clamp(v, ZOOM_MIN, ZOOM_MAX)
  // focoAlvo: o modo "Ver as bombas" (os selos de todas); segue: a vista acompanha a bomba em foco. Arrastar a vista só
  // solta o acompanhamento; antes zerava o foco e os selos sumiam ao arrastar (29/10)
  let arrasto = null, arrastou = false, foco = 0, focoAlvo = 0, bombaFoco = 0, segue = false
  el.addEventListener('wheel', (e) => {
    e.preventDefault(); centroAlvo = null
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
    if (zoom.k > 1.02) { zoom.cx -= dx / s; zoom.cy -= dy / s; zoom.acx = null; segue = false; centroAlvo = null }
    arrasto = { x: e.clientX, y: e.clientY }
  })
  const solta = () => { arrasto = null; setTimeout(() => { arrastou = false }, 0) }
  el.addEventListener('pointerup', solta); el.addEventListener('pointercancel', solta); el.addEventListener('pointerleave', solta)
  el.addEventListener('dblclick', () => { zoom.alvo = 1; focoAlvo = 0; zoom.acx = null; cursor() })
  // (4/11) pinça no celular (dois dedos): aproxima e afasta em volta do meio dos dedos, como a roda do mouse (a 2D é a
  // vista do celular e só tinha os botões − e +)
  const dedos = new Map(); let pinca = null
  el.addEventListener('pointerdown', (e) => {
    dedos.set(e.pointerId, e)
    if (dedos.size === 2) { const [a, b] = [...dedos.values()]; pinca = { d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z0: zoom.alvo }; arrasto = null; arrastou = true }
  })
  el.addEventListener('pointermove', (e) => {
    if (!dedos.has(e.pointerId)) return
    dedos.set(e.pointerId, e)
    if (dedos.size !== 2 || !pinca || pinca.d0 < 10) return
    const [a, b] = [...dedos.values()], r = el.getBoundingClientRect(), mx = (a.clientX + b.clientX) / 2 - r.left, my = (a.clientY + b.clientY) / 2 - r.top
    zoom.acx = vb.x + mx / s; zoom.acy = vb.y + my / s; zoom.amx = mx; zoom.amy = my; centroAlvo = null
    zoom.alvo = limita(pinca.z0 * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinca.d0); if (zoom.alvo < 1.05) focoAlvo = 0
    cursor()
  })
  const tiraDedo = (e) => { dedos.delete(e.pointerId); if (dedos.size < 2) pinca = null }
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(t, tiraDedo)
  function cursor() { el.style.cursor = zoom.alvo > 1.02 ? 'grab' : '' }

  // ---------------------------------------------------------- estados das vagas (os mesmos do 3D)
  function muda(vg, estado) { vg.estado = estado; vg.t = 0; avisa(vg) }
  // (9/11) vagas paralelas: a faixa livre atrás da vaga (antes) ou à frente dela, como no 3D
  const faixaLivre = (vg, antes) => vagas.every((o) => o === vg || !o.lat || o.lat.faixa !== vg.lat.faixa || (antes ? o.lat.ordem > vg.lat.ordem : o.lat.ordem < vg.lat.ordem) || o.estado === 'vazia')
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
      vg.img.setAttribute('href', `dados/planta/${CARROS}${vg.fileira === 'fundos' ? 'r' : vg.lat ? 'l' : ''}-${cor}.webp`)
      vg.pct = 12 + ((vg.i * 37 + proxCor * 23) % 40)
      if (vg.lat) vg.dEntra = faixaLivre(vg, true) ? 6.5 : 0.9
      muda(vg, 'chegando')
    }
    if (acao === 'sair' && ['carregando', 'falha'].includes(vg.estado)) { if (opc.ficar != null) vg.ficar = !!opc.ficar; muda(vg, 'desconectando') }
    else if (acao === 'sair' && vg.estado === 'concluido') muda(vg, 'saindo')
    return true
  }
  // (3/11, noite, V3) o estado de cada bomba na imagem: planta/estados.png diz em que pixels está cada bomba (vermelho =
  // número dela) e o quanto ali é luz acesa (verde). Em falha, as luzes dela ficam vermelhas (piscando); desligada,
  // apagam. Uma camada por bomba, feita na hora, por cima de tudo menos o teto. Sem a máscara (maquete antiga), nada muda
  const estMask = await new Promise((ok) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); ok(g.getImageData(0, 0, c.width, c.height)) }; im.onerror = () => ok(null); im.src = pasta + 'estados.png' })
  const gEstados = no('g', { style: 'pointer-events:none' }, gSobre)
  // uma camada da bomba b: `corDe(aceso)` dá [r, g, b, a] de cada pixel dela (aceso: o quanto ali acende, 0..255)
  // (4/11) só o retângulo da bomba (antes, uma imagem do tamanho da maquete inteira por bomba e por estado)
  const camadaEstado = (b, corDe, estilo) => {
    const m = estMask, cx = caixasDe(m)[b.bi + 1]; if (!cx) return null
    const [x0, y0, x1, y1] = cx, bw = x1 - x0 + 1, bh = y1 - y0 + 1, sx = W / m.width, sy = H / m.height
    const c = document.createElement('canvas'); c.width = bw; c.height = bh
    const g = c.getContext('2d'), id = g.createImageData(bw, bh)
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const p = ((y + y0) * m.width + x + x0) * 4
      if (m.data[p] === b.bi + 1) { const v = corDe(m.data[p + 1]); if (v) id.data.set(v, (y * bw + x) * 4) }
    }
    g.putImageData(id, 0, 0)
    return no('image', { href: c.toDataURL('image/png'), x: x0 * sx, y: y0 * sy, width: bw * sx, height: bh * sy, opacity: 0, preserveAspectRatio: 'none', ...(estilo ? { style: estilo } : {}) }, gEstados)
  }
  // (4/11, pedido do Sergio) o brilho de LED em volta das luzes da bomba em falha (vermelho, desfocado)
  const camadaBrilho = (b) => {
    const h = brilhoLuzes(estMask, new Set([b.bi + 1]), 4, 2.6); if (!h) return null
    const c = document.createElement('canvas'); c.width = h.w; c.height = h.h
    const g = c.getContext('2d'), id = g.createImageData(c.width, c.height)
    for (let p = 0; p < h.d.length; p++) if (h.d[p] > 0.004) id.data.set([255, 52, 34, Math.round(h.d[p] * 255)], p * 4)
    g.putImageData(id, 0, 0)
    return no('image', { href: c.toDataURL('image/png'), x: 0, y: 0, width: W, height: H, opacity: 0, preserveAspectRatio: 'none' }, gEstados)
  }
  // (4/11) o desenho na tela da bomba (estado-bomba.js): a tela projetada na imagem (a projeção é afim: três cantos bastam)
  const camadaTela = (b, tipo) => {
    const tv = telaVista(an, b.bi); if (!tv) return null
    const a = P(tv.x - tv.w / 2, tv.y, tv.z + tv.h / 2), d = P(tv.x + tv.w / 2, tv.y, tv.z + tv.h / 2), e = P(tv.x - tv.w / 2, tv.y, tv.z - tv.h / 2)
    const href = desenhoTela(tipo, tv.w, tv.h, 192).toDataURL('image/png')
    return no('image', { href, x: 0, y: 0, width: 1, height: 1, opacity: 0, preserveAspectRatio: 'none', transform: `matrix(${d.x - a.x} ${d.y - a.y} ${e.x - a.x} ${e.y - a.y} ${a.x} ${a.y})` }, gEstados)
  }
  const estadoImg = (b) => {
    if (!estMask) return
    if (b.falha && !b.imgFalha) {
      b.imgFalha = camadaEstado(b, (ac) => (ac ? [255, 42, 31, ac] : null)); b.imgBrilho = camadaBrilho(b); b.telaFalha = camadaTela(b, 'falha')
    }
    // desligada: não preta. A bomba perde a cor (mistura "saturação" com cinza: fica a luz e a forma, sem cor) e o que
    // acendia vira um cinza de plástico apagado; na tela, o liga/desliga
    if (b.inativa && !b.imgInativa) {
      b.imgSemCor = camadaEstado(b, () => [128, 128, 128, 220], 'mix-blend-mode:saturation')
      b.imgInativa = camadaEstado(b, (ac) => (ac ? [96, 104, 102, ac] : null)); b.telaInativa = camadaTela(b, 'desligada')
    }
    const off = b.inativa && !b.falha
    for (const im of [b.imgSemCor, b.imgInativa]) if (im) im.setAttribute('opacity', off ? '1' : '0')
    if (b.telaInativa) b.telaInativa.setAttribute('opacity', off ? '0.96' : '0')
    if (!b.falha) for (const im of [b.imgFalha, b.imgBrilho, b.telaFalha]) if (im) im.setAttribute('opacity', '0')
  }
  function setFalha(on, bi) {
    for (const b of bombas) if (bi === undefined || b.bi === bi) { b.falha = on; estadoImg(b) }
    for (const vg of vagas) {
      const f = bombas[vg.bomba].falha
      if (f && vg.estado === 'carregando') muda(vg, 'falha'); else if (!f && vg.estado === 'falha') muda(vg, 'carregando')
    }
  }
  function setInativa(on, bi) { for (const b of bombas) if (bi === undefined || b.bi === bi) { b.inativa = on; estadoImg(b) } }

  // ---------------------------------------------------------- hora do dia e clima
  let hora = opcoes.hora ?? 14, noite = 0, por = 0
  const chuva = { k: 0, alvo: 0 }, nuvem = { k: 0, alvo: 0 }
  function aplicaHora() {
    const { a, b, t } = periodoDaHora(hora)
    const peso = (p) => lerp(a === p ? 1 : 0, b === p ? 1 : 0, t)
    noite = peso('noite'); por = peso('por')
    const manha = peso('manha'), cinza = Math.max(chuva.k, 0.6 * nuvem.k)
    // (4/11) cada tipo de camada: o horário de baixo (na ORDEM) inteiro e o de cima por cima com o peso dele. O horário
    // que a maquete não tem (ou que ainda não chegou) usa o mais parecido que já está aqui
    const VIZ = { manha: ['tarde', 'noite'], tarde: ['manha', 'noite'], por: ['tarde', 'noite'], noite: ['por', 'tarde'] }
    const usa = (k, p) => (tem[k + p] ? p : (VIZ[p] || []).find((q) => tem[k + q]) || 'tarde')
    for (const k of TIPOS) {
      const A = usa(k, a), B = usa(k, b)
      for (const p of P2) {
        const o = A === B ? (p === A ? 1 : 0) : ORDEM.indexOf(A) < ORDEM.indexOf(B) ? (p === A ? 1 : p === B ? t : 0) : (p === B ? 1 : p === A ? 1 - t : 0)
        camada[k][p].setAttribute('opacity', o.toFixed(3))
      }
    }
    // pôr do sol e manhã sem a imagem deles: o render da tarde aquecido (como antes); nuvem e chuva: menos cor e mais escuro
    const f = []
    if (por > 0.01 && usa('chao', 'por') !== 'por') f.push(`sepia(${(0.35 * por).toFixed(2)}) saturate(${(1 + 0.25 * por).toFixed(2)}) hue-rotate(${(-10 * por).toFixed(1)}deg) brightness(${(1 - 0.12 * por).toFixed(2)})`)
    if (manha > 0.01 && usa('chao', 'manha') !== 'manha') f.push(`sepia(${(0.12 * manha).toFixed(2)}) brightness(${(1 + 0.03 * manha).toFixed(2)})`)
    camada.chao.tarde.style.filter = f.join(' ')
    // de noite os carros (sprites de dia) ficam mais escuros e frios, como o resto da cena
    // (4/11) e no pôr do sol, com a 2D dele, um pouco mais escuros e quentes (o carro branco ficava branco de dia na cena laranja)
    const fc = []
    if (noite > 0.01) fc.push(`brightness(${(1 - 0.32 * noite).toFixed(2)}) saturate(${(1 - 0.2 * noite).toFixed(2)}) hue-rotate(${(8 * noite).toFixed(1)}deg)`)
    if (por > 0.01 && tem['chao' + 'por']) fc.push(`sepia(${(0.32 * por).toFixed(2)}) brightness(${(1 - 0.14 * por).toFixed(2)})`)
    gCarros.style.filter = fc.join(' ')
    if (precoCaixa && pj.preco.fundoNoite) precoCaixa.setAttribute('fill', mistura(pj.preco.fundo, pj.preco.fundoNoite, noite))
    svg.style.filter = cinza > 0.01 ? `saturate(${(1 - 0.32 * cinza).toFixed(2)}) brightness(${(1 - 0.16 * cinza).toFixed(2)})` : ''
  }
  const pingos = []
  let efeitos = true, leve = false      // configuração visual do painel (setVisual): leve reduz as animações
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
    if (chuva.k < 0.01 || !efeitos) { pingos.length = 0; return }      // sem efeitos (configuração visual): sem os pingos
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
    const fim = vg.prog && vg.prog.modo === 'meta' ? ` · ${vg.prog.fim}` : ''
    const linha = vg.estado === 'falha' ? `${tipo} · Interrompida` : vg.estado === 'conectando' ? `${tipo} · Conectando` : vg.estado === 'concluido' ? 'Terminou · ainda na vaga' : `${tipo} · ${vg.kw} kW${fim}${vg.aviso ? ` <em class="mv-aviso">${vg.aviso}</em>` : ''}`
    // o anel: o caminho até o fim da recarga que o painel manda (prog: o valor definido, a bateria ou "até encher" sem
    // fim conhecido, que gira); sem prog, a bateria no DC
    const pr = vg.estado !== 'carregando' ? null : vg.prog || (vg.dc ? { modo: 'bateria', p: vg.pct } : null)
    const anel = !pr ? '' : pr.modo === 'livre' ? '<i class="mv-pct livre">∞</i>' : `<i class="mv-pct${pr.modo === 'meta' ? ' definido' : ''}" style="--p:${Math.round(pr.p)}">${Math.round(pr.p)}%</i>`
    return `<b class="mv-av">${ps.iniciais}</b><span class="mv-tx"><b>${ps.nome}</b><small>${linha}</small></span>${anel}`
  }
  // (4/11) o arranjo (medir, subir o de trás, agrupar os amontoados como pinos de mapa) está em selos.js, o mesmo do 3D
  const item = (div, p, on, agrupa = false) => ({ div, on, agrupa, x: p.x, y: p.y })
  // tocar num grupo: a vista aproxima em volta dele (o grupo vai para o meio) até os selos caberem separados
  // Depois do toque, os selos não se juntam de novo até a vista afastar abaixo desse zoom (semGrupo)
  let semGrupo = null
  function abreGrupo(g) {
    zoom.alvo = limita(zoom.alvo * fatorParaGrupo(g, Wc)); semGrupo = zoom.alvo * 0.97
    centroAlvo = { x: vb.x + g.x / s, y: vb.y + g.y / s, t: 0 }
    zoom.acx = null; focoAlvo = 0; segue = false; cursor()
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
      itens.push(item(vg.sel, tela(PV(vg, vg.lat ? vg.cx : vg.pos.x, vg.lat ? vg.pos.y : vg.cy - 0.6, an.Z + 1.9)), on, true))
      itens.push(item(vg.info, tela(PV(vg, vg.pos.x, vg.pos.y - 1.4, an.Z + 0.3)), tempo < vg.infoAte))
    }
    for (const b of bombas) {
      const emFoco = foco > 0.6 && zoom.k > 1.05            // "Ver as bombas": o selo em todas, não só na do foco (29/10), até voltar a 100%
      const h = b.falha ? `<b class="mv-ic mv-ic-falha">${ICONE_ALERTA}</b><span>${b.nome} · Falha de comunicação</span><em class="mv-link">Ver detalhes</em>`
        : b.inativa ? `<b class="mv-ic">${ICONE_BOMBA}</b><span>${b.nome} · Desligada</span><em class="mv-link">Ver detalhes</em>`
        : `<b class="mv-ic">${ICONE_BOMBA}</b><span>${b.nome} · Online</span><em class="mv-link">Ver detalhes</em>`
      if (b.sel.dataset.h !== h) { b.sel.innerHTML = h; b.sel.dataset.h = h }
      b.sel.classList.toggle('falha', b.falha); b.sel.classList.add('clicavel')
      itens.push(item(b.sel, tela(P(b.x, b.y, b.topo + 0.25)), b.falha || emFoco))
    }
    if (semGrupo && zoom.alvo < semGrupo * 0.8) semGrupo = null
    arranja(itens, { camada: camadaSelos, agrupar: zoom.k < (semGrupo || ZOOM_MAX) * 0.97, aoAbrir: abreGrupo })
  }

  // ---------------------------------------------------------- quadro
  function vaga(vg, dt) {
    vg.t += dt
    let y = vg.pos.y, x = vg.pos.x, a = 1, re = 0
    // (9/11) vagas paralelas: entra e sai para a frente (+X); trajeto inteiro com a faixa livre, senão um deslize curto
    if (vg.lat && !leve && (vg.estado === 'chegando' || vg.estado === 'saindo')) {
      if (vg.estado === 'chegando') {
        const D = vg.dEntra || 0.9, longe = D > 2, T = longe ? 3.6 : 1.6, q = clamp01(vg.t / T), e = easeOut(q)
        x = vg.pos.x - D * (1 - e); a = suave(clamp01(q / (longe ? 0.25 : 0.7)))
        if (q >= 1) muda(vg, 'conectando')
      } else {
        if (vg.dSai == null) vg.dSai = faixaLivre(vg, false) ? 7 : 0.9
        const D = vg.dSai, longe = D > 2, T = longe ? 4.2 : 1.6, q = clamp01(vg.t / T), e = easeInOut(q)
        x = vg.pos.x + D * e; a = 1 - suave(clamp01((q - (longe ? 0.75 : 0.3)) / (longe ? 0.25 : 0.7)))
        if (q >= 1) { muda(vg, 'vazia'); liberaConector(vg); vg.con = null; vg.dSai = null }
      }
    } else if (vg.estado === 'chegando' && leve) {
      const q = clamp01(vg.t / 1.0); a = suave(q)
      if (q >= 1) muda(vg, 'conectando')
    } else if (vg.estado === 'saindo' && leve) {
      const q = clamp01(vg.t / 0.9); a = 1 - suave(q)
      if (q >= 1) { muda(vg, 'vazia'); liberaConector(vg); vg.con = null }
    } else if (vg.estado === 'chegando') {
      const q = clamp01(vg.t / T_CHEGA), e = easeOut(q)
      y = vg.pos.y - D_CHEGADA * (1 - e); a = suave(clamp01(q / 0.25))
      if (q >= 1) muda(vg, 'conectando')
    } else if (vg.estado === 'saindo') {
      const q = clamp01(vg.t / T_SAI), e = easeInOut(q)
      y = vg.pos.y - D_SAIDA * e; a = 1 - suave(clamp01((q - 0.75) / 0.25)); re = 1
      if (q >= 1) { muda(vg, 'vazia'); liberaConector(vg); vg.con = null }
    }
    if (vg.estado === 'vazia') { a = 0; vg.dSai = null }
    vg.cy = y; vg.cx = x
    const c = PV(vg, x, y, an.Z)
    at(vg.gc, 'transform', `translate(${c.x.toFixed(2)} ${c.y.toFixed(2)})`)
    at(vg.gc, 'opacity', a.toFixed(3))
    at(vg.farois, 'opacity', (Math.max(noite, 0.6 * chuva.k) * (vg.estado === 'vazia' ? 0 : 1)).toFixed(2))
    at(vg.re, 'opacity', re || (vg.estado === 'desconectando' && vg.t > T_DESCONECTA * 0.6) ? '0.9' : '0')
    let f = 0
    if (vg.estado === 'conectando') { f = leve ? 1 : easeInOut(clamp01(vg.t / T_CONECTA)); if (leve || vg.t >= T_CONECTA) muda(vg, bombas[vg.bomba].falha ? 'falha' : 'carregando') }   // leve: sem a animação do cabo
    else if (['carregando', 'falha'].includes(vg.estado)) f = 1
    else if (vg.estado === 'desconectando') { f = leve ? 0 : 1 - easeInOut(clamp01(vg.t / T_DESCONECTA)); if (leve || vg.t >= T_DESCONECTA) { liberaConector(vg); muda(vg, vg.ficar ? 'concluido' : 'saindo') } }
    const cn = conectores[vg.con]
    if (cn && f > 0) {
      // a tomada no carro (nas vagas paralelas, o carro virado para +X: o local (x, y) vai para (y, −x)); nas vagas de
      // trás da ilha o cabo sai por trás da bomba (a saída espelhada no eixo)
      const lx = vg.lado > 0 ? -PORTA.x : PORTA.x, [tx, ty] = vg.lat ? [x + PORTA.y, y - lx] : [x + lx, y + PORTA.y]
      const sy = vg.lat && vg.lat.s > 0 ? 2 * vg.lat.eixo - cn.s[1] : cn.s[1]
      const de = PV(vg, cn.s[0], sy, cn.s[2]), ate = PV(vg, tx, ty, an.Z + PORTA.z)
      const meio = PV(vg, (cn.s[0] + tx) / 2, (sy + ty) / 2, an.Z + 0.12)   // o cabo pende quase até o chão
      const d = `M${de.x.toFixed(1)} ${de.y.toFixed(1)}Q${meio.x.toFixed(1)} ${meio.y.toFixed(1)} ${ate.x.toFixed(1)} ${ate.y.toFixed(1)}`
      at(vg.cabo, 'd', d); at(vg.fluxo, 'd', d)
      at(vg.cabo, 'stroke-dashoffset', (1 - f).toFixed(3)); at(vg.cabo, 'opacity', '1')
      at(vg.fluxo, 'opacity', vg.estado === 'carregando' ? '0.95' : vg.estado === 'falha' ? '0.8' : '0')
      at(vg.fluxo, 'stroke', vg.estado === 'falha' ? CORES.falha : CORES.carregando)
      at(vg.fluxo, 'stroke-dashoffset', (leve ? 0 : -tempo * 0.6 * K).toFixed(1))
    } else { at(vg.cabo, 'opacity', '0'); at(vg.fluxo, 'opacity', '0') }
    const cor = vg.estado === 'carregando' ? CORES.carregando : vg.estado === 'falha' ? CORES.falha : vg.estado === 'concluido' && !vg.realce ? CORES.concluido : vg.realce ? CORES.carregando : CORES.conectando
    const alvo = ({ carregando: leve ? 0.85 : 0.75 + 0.25 * Math.sin(tempo * 2.4), falha: leve ? 0.95 : 0.55 + 0.45 * Math.sin(tempo * 6), conectando: 0.6, chegando: 0.35 * suave(clamp01(vg.t / T_CHEGA)), desconectando: 0.35, concluido: 0.55 }[vg.estado] || 0) + (vg.realce ? 0.5 : 0)
    vg.anelA = lerp(vg.anelA, clamp01(alvo), Math.min(1, dt * 6))
    const op = vg.anelA.toFixed(2)
    at(vg.anel, 'stroke', cor); at(vg.anel, 'opacity', op); at(vg.anelG, 'stroke', cor); at(vg.anelG, 'opacity', op)
    if (vg.estado === 'carregando') vg.pct = Math.min(100, vg.pct + dt * 0.9)
  }
  function quadro(dt) {
    tempo += dt
    const kAnt = zoom.k
    zoom.k = lerp(zoom.k, zoom.alvo, Math.min(1, dt * 6))
    foco = lerp(foco, focoAlvo, Math.min(1, dt * 3.2))
    if (focoAlvo > 0.5 && segue) { const b = bombas[bombaFoco], p = P(b.x, b.y - 1.4 * (an.bombas[bombaFoco].fileira === 'fundos' ? -1 : 1), an.Z + 0.8); zoom.cx = lerp(zoom.cx, p.x, Math.min(1, dt * 4)); zoom.cy = lerp(zoom.cy, p.y, Math.min(1, dt * 4)) }
    else if (centroAlvo) { const q = Math.min(1, dt * 4); zoom.cx = lerp(zoom.cx, centroAlvo.x, q); zoom.cy = lerp(zoom.cy, centroAlvo.y, q); if ((centroAlvo.t += dt) > 1.2) centroAlvo = null }   // o grupo de selos tocado vai para o meio
    else if (zoom.acx != null && Math.abs(zoom.k - kAnt) > 1e-5) {
      const sN = s0 * zoom.k, cxp = q0.l + q0.w / 2, cyp = q0.t + q0.h / 2
      zoom.cx = zoom.acx - (zoom.amx - cxp) / sN; zoom.cy = zoom.acy - (zoom.amy - cyp) / sN
    }
    aplicaVista()
    // ao aproximar, o teto da cobertura quase some (para ver os carros embaixo)
    at(gTeto, 'opacity', (((pj.tetoOpacidade ?? 0.3) + 0.12 * noite) * (1 - 0.8 * suave(clamp01((zoom.k - 1.1) / 0.8)))).toFixed(3))
    for (const vg of vagas) vaga(vg, dt)
    for (const b of bombas) {
      const al = b.falha ? (leve ? 0.85 : 0.55 + 0.45 * Math.sin(tempo * 5.5)) : 0      // leve: a base fica vermelha, sem piscar
      at(b.alarme, 'opacity', al.toFixed(2)); at(b.contorno, 'opacity', (al * 0.9).toFixed(2))
      if (b.imgFalha && b.falha) b.imgFalha.setAttribute('opacity', (0.95 * al).toFixed(2))
      // (4/11) o brilho em volta (de dia leve, à noite mais forte) e o desenho da tela (pulsa sem sumir)
      if (b.imgBrilho && b.falha) b.imgBrilho.setAttribute('opacity', (al * (0.45 + 0.55 * noite)).toFixed(2))
      if (b.telaFalha && b.falha) b.telaFalha.setAttribute('opacity', (leve ? 1 : 0.93 + 0.07 * Math.sin(tempo * 5.5)).toFixed(2))
    }
    let mudou = false
    for (const c of [chuva, nuvem]) if (Math.abs(c.k - c.alvo) > 0.001) { c.k = lerp(c.k, c.alvo, Math.min(1, dt * 1.6)); if (Math.abs(c.k - c.alvo) < 0.002) c.k = c.alvo; mudou = true }
    if (mudou) aplicaHora()
    desenhaClima(dt, tempo)
    selos()
  }
  let ultimo = performance.now()
  // (4/11) ritmo, como o do 3D: com algo se mexendo (carro chegando, conectando ou saindo, zoom, arrasto, chuva) até 60
  // quadros por segundo; parada (só o anel e o fluxo do cabo pulsando), 30; no leve, 30 e 12; fora da tela, nenhum.
  // Antes a 2D desenhava em todo quadro da tela (60, ou 120 num celular de 120 Hz) mesmo parada
  let naTela = true
  new IntersectionObserver(([e]) => { naTela = e.isIntersecting }).observe(el)
  const movendo = () => Math.abs(zoom.k - zoom.alvo) > 0.002 || Math.abs(foco - focoAlvo) > 0.002 || arrasto || dedos.size > 0 || centroAlvo ||
    chuva.k > 0.002 || Math.abs(chuva.k - chuva.alvo) > 0.001 || Math.abs(nuvem.k - nuvem.alvo) > 0.001 ||
    vagas.some((vg) => vg.estado === 'chegando' || vg.estado === 'conectando' || vg.estado === 'desconectando' || vg.estado === 'saindo')
  function laco(agora) {
    requestAnimationFrame(laco)
    if (!naTela) return
    const mexe = movendo()
    if (agora - ultimo < (leve ? (mexe ? 1000 / 30 : 1000 / 12) : mexe ? 1000 / 60 : 1000 / 30) - 2) return
    const dt = Math.min(0.1, (agora - ultimo) / 1000); ultimo = agora; quadro(dt)
  }
  new ResizeObserver(() => { esquece(camadaSelos); tamanho() }).observe(el); tamanho()
  aplicaHora(); cursor()
  requestAnimationFrame(laco)

  return {
    posto: an.posto, visao: '2d',
    quadroImagem: () => ({ x: q0.l, y: q0.t, w: q0.w, h: q0.h }),
    _telaDaVaga: (i) => { const p = tela(PV(vagas[i], vagas[i].pos.x, vagas[i].pos.y)), r = el.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y } },   // testes
    vagas: vagas.map((v) => ({ nome: v.nome, dc: v.dc, bomba: v.bomba, kw: v.kw, natural: (conectores.find((c) => c.vagasNaturais.includes(v.i)) || {}).id })),
    conectores: conectores.map((c) => ({ id: c.id, bomba: c.bomba, dc: c.dc, lado: c.lado, vagasNaturais: [...c.vagasNaturais] })),
    conectorDa: (i) => vagas[i].con,
    conectorLivre: (i) => { const c = livreNaBomba(vagas[i]); return c ? c.id : null },
    bombas: bombas.map((b) => ({ nome: b.nome, modelo: b.modelo })),
    estado: (i) => vagas[i].estado,
    falha: (bi) => bombas[bi].falha,
    evento, setFalha, setInativa, temEstadosNaImagem: !!estMask,
    setDados(i, d) { const vg = vagas[i]; if (d.kw != null) vg.kw = d.kw; if (d.pct != null) vg.pct = d.pct; if (d.prog !== undefined) vg.prog = d.prog; if (d.pessoa !== undefined) vg.pessoa = d.pessoa; if (d.aviso !== undefined) vg.aviso = d.aviso },
    getDados: (i) => ({ kw: vagas[i].kw, pct: vagas[i].pct }),
    setRealce(i) { for (const vg of vagas) vg.realce = vg.i === i },
    mostrarVaga(i, html, seg = 5) { const vg = vagas[i]; if (vg.info.dataset.h !== html) { vg.info.innerHTML = html; vg.info.dataset.h = html } vg.infoAte = tempo + seg },
    ouvir(f) { ouvintes.push(f) },
    // um horário que ainda não está na planta (celular): a troca espera ele ficar pronto, em vez de mostrar o vizinho
    setHora(h) {
      hora = h; const { a, b } = periodoDaHora(h), falta = [a, b].filter((p) => !TIPOS.every((k) => tem[k + daMaquete(p)]))
      if (!falta.length) { aplicaHora(); libera() } else Promise.all(falta.map(garante)).then(() => { if (hora === h) { aplicaHora(); libera() } })
    },
    getHora: () => hora,
    setPreco(v) { if (precoTxt) precoTxt.textContent = v },
    setChuva(on, imediato) { chuva.alvo = on ? 1 : 0; nuvem.alvo = on ? 1 : nuvem.alvo; if (imediato) { chuva.k = chuva.alvo; nuvem.k = nuvem.alvo; aplicaHora() } },
    getChuva: () => chuva.alvo > 0.5,
    // configuração visual do painel: na 2D, só os efeitos contam (a qualidade é a do 3D)
    setVisual({ qualidade, efeitos: e } = {}) { if (qualidade) { leve = qualidade === 'leve'; efeitos = !leve } if (e != null) efeitos = !!e },
    setClima({ nuvens = 0, chuva: ch = 0 } = {}, imediato) { nuvem.alvo = clamp01(nuvens); chuva.alvo = clamp01(ch); if (imediato) { nuvem.k = nuvem.alvo; chuva.k = chuva.alvo; aplicaHora() } },
    setZoom(on, bi = 0) { bombaFoco = bi; focoAlvo = on ? 1 : 0; segue = on; zoom.alvo = on ? 2.0 : 1; zoom.acx = null; cursor() },
    setZoomNivel(v) { zoom.alvo = limita(Math.abs(v - 1) < 0.08 ? 1 : v); if (zoom.alvo < 1.05) focoAlvo = 0; zoom.acx = null; cursor() },
    zoomLimites: { min: ZOOM_MIN, max: ZOOM_MAX },
    getZoom: () => zoom.alvo,
    avancar(dt, passos = 1) { for (let i = 0; i < passos; i++) quadro(dt) },
    canvas: svg,
  }
}
