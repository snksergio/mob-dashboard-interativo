// iGreen · prova "maquete por peças": monta a maquete de um formato juntando as peças renderizadas antes (pecas/<cena>/).
// Chão e teto: cada vaga vem de uma cena da biblioteca em que ela tem a mesma vizinhança (cobertura dela e das vizinhas;
// no teto, também as divisas entre bombas). O pixel é recortado pelo ponto do chão (ou do teto) que ele enxerga, então
// a costura cai entre vagas iguais nas duas cenas. Peças altas (bombas, pilares, árvore, totem): a sombra multiplica o
// chão e a imagem da peça vai por cima, da mais funda para a mais próxima. Tudo em luz linear; no fim, o Khronos PBR
// Neutral e o sRGB, como o Blender faz. As imagens vêm em sRGB da luz / 2 (exposição -1 no Blender).
import { estrutura, chaveVaga, pontaE, pontaD, pecasDe, papelDe, W_PADRAO, chaveMetade, pontaIE, pontaID, pecasIlha, pilarDe, FAIXAS_ILHA } from './chaves.js'
export { estrutura }
// Ilha: o chão e o teto de cada vaga vêm em faixas (FAIXAS_ILHA: a frente, o começo dos fundos e o resto dos fundos),
// contadas do eixo do meio (y = 6,4 m); o pixel escolhe a faixa pelo y do ponto que enxerga. As peças dos fundos ficam
// atrás das do meio (pilares e árvore), e essas atrás das da frente
const Y_MEIO = 6.4
function faixaDe(y) {                      // por pixel: um laço simples, sem criar nada
  const d = y - Y_MEIO
  for (let i = 0; i < FAIXAS_ILHA.length; i++) if (d < FAIXAS_ILHA[i][2]) return FAIXAS_ILHA[i][0]
  return FAIXAS_ILHA[FAIXAS_ILHA.length - 1][0]
}

// ---------------------------------------------------------------- PNG lido byte a byte (o canvas pré-multiplica e perde
// precisão nas bordas transparentes; aqui o valor é o que o Blender gravou)
export async function lerPng(url) {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`não achei ${url}`)
  const buf = new Uint8Array(await resp.arrayBuffer()), dv = new DataView(buf.buffer)
  let p = 8, w = 0, h = 0, tipo = 0
  const idat = []
  while (p < buf.length) {
    const len = dv.getUint32(p), t = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7])
    if (t === 'IHDR') {
      w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); tipo = buf[p + 17]
      if (buf[p + 16] !== 8 || buf[p + 20] !== 0) throw new Error(`${url}: só PNG de 8 bits sem entrelaçamento`)
    } else if (t === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len))
    else if (t === 'IEND') break
    p += 12 + len
  }
  const raw = new Uint8Array(await new Response(new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())
  const c = { 6: 4, 2: 3, 4: 2, 0: 1 }[tipo]
  const L = w * c, d = new Uint8Array(w * h * 4)
  let ant = new Uint8Array(L), cur = new Uint8Array(L)
  for (let y = 0, q = 0; y < h; y++) {
    const f = raw[q++]
    for (let i = 0; i < L; i++) {
      const x = raw[q++], a = i >= c ? cur[i - c] : 0, b = ant[i], ab = i >= c ? ant[i - c] : 0
      let v = x
      if (f === 1) v = x + a
      else if (f === 2) v = x + b
      else if (f === 3) v = x + ((a + b) >> 1)
      else if (f === 4) { const pp = a + b - ab, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - ab); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : ab) }
      cur[i] = v
    }
    for (let x = 0, o = y * w * 4, s = 0; x < w; x++, o += 4, s += c) {
      if (c >= 3) { d[o] = cur[s]; d[o + 1] = cur[s + 1]; d[o + 2] = cur[s + 2]; d[o + 3] = c === 4 ? cur[s + 3] : 255 }
      else { d[o] = d[o + 1] = d[o + 2] = cur[s]; d[o + 3] = c === 2 ? cur[s + 1] : 255 }
    }
    const t = ant; ant = cur; cur = t
  }
  return { w, h, d }
}

// webp (biblioteca empacotada): o decodificador do navegador, sem pré-multiplicar nem converter a cor. O canvas guarda
// pré-multiplicado, então só os pixels semitransparentes (a borda da laje) perdem um pouco de precisão. No Node quem
// decodifica é globalThis.lerWebpNode (ffmpeg, nas ferramentas)
export async function lerWebp(url) {
  if (globalThis.lerWebpNode) return globalThis.lerWebpNode(url)
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`não achei ${url}`)
  const bmp = await createImageBitmap(await resp.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const cv = new OffscreenCanvas(bmp.width, bmp.height), g = cv.getContext('2d', { willReadFrequently: true })
  g.drawImage(bmp, 0, 0)
  const id = g.getImageData(0, 0, bmp.width, bmp.height); bmp.close()
  return { w: id.width, h: id.height, d: new Uint8Array(id.data.buffer) }
}

// ---------------------------------------------------------------- cor
const LIN = new Float32Array(256)            // byte sRGB -> luz linear (x2: as imagens guardam a luz pela metade)
for (let i = 0; i < 256; i++) { const v = i / 255; LIN[i] = 2 * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) }
const N_OETF = 4096, OETF = new Uint8Array(N_OETF + 1)
for (let i = 0; i <= N_OETF; i++) { const l = i / N_OETF; OETF[i] = Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)) }
// Khronos PBR Neutral (a mesma transformação de vista das maquetes do painel)
function pbrNeutral(c) {
  const ini = 0.8 - 0.04, desat = 0.15
  const x = Math.min(c[0], c[1], c[2]), off = x < 0.08 ? x - 6.25 * x * x : 0.04
  c[0] -= off; c[1] -= off; c[2] -= off
  const pico = Math.max(c[0], c[1], c[2])
  if (pico < ini) return c
  const d = 1 - ini, novo = 1 - (d * d) / (pico + d - ini), s = novo / pico
  const g = 1 - 1 / (desat * (pico - novo) + 1)
  for (let k = 0; k < 3; k++) c[k] = c[k] * s * (1 - g) + novo * g
  return c
}
// buffer linear pré-multiplicado -> RGBA de tela (cor reta, como o PNG que o Blender grava); expo: a exposição do
// horário (a noite da maquete usa +0,45), aplicada antes do PBR Neutral, como no Blender
export function paraTela(buf, W, H, expo = 0) {
  const out = new Uint8ClampedArray(W * H * 4), c = [0, 0, 0], ganho = 2 ** expo
  for (let o = 0; o < out.length; o += 4) {
    const a = buf[o + 3]
    if (a < 1 / 512) continue
    c[0] = Math.max(0, (ganho * buf[o]) / a); c[1] = Math.max(0, (ganho * buf[o + 1]) / a); c[2] = Math.max(0, (ganho * buf[o + 2]) / a)
    pbrNeutral(c)
    for (let k = 0; k < 3; k++) out[o + k] = OETF[Math.round(Math.min(1, Math.max(0, c[k])) * N_OETF)]
    out[o + 3] = Math.round(Math.min(1, a) * 255)
  }
  return out
}

// ---------------------------------------------------------------- biblioteca
// a biblioteca empacotada traz os índices de todas as cenas num arquivo só (indices.json): na rede, centenas de
// arquivinhos pesam mais que os bytes
export async function carregarBiblioteca(base, nomes) {
  const cenas = []
  const junto = await fetch(`${base}/indices.json`, { cache: 'no-store' }).catch(() => null)
  if (junto && junto.ok) {
    const todos = await junto.json()
    for (const nome of nomes) if (todos[nome]) cenas.push({ nome, ind: todos[nome], imgs: new Map() })
    return { base, cenas }
  }
  for (const nome of nomes) {
    const r = await fetch(`${base}/${nome}/indice.json`, { cache: 'no-store' })
    if (r.ok) cenas.push({ nome, ind: await r.json(), imgs: new Map() })
  }
  return { base, cenas }
}
// k: a vaga, para o chão e o teto. Na biblioteca empacotada (ferramentas/empacotar.mjs) cada vaga tem o seu pedaço,
// "chao-v<k>" (só a faixa daquela vaga); na biblioteca inteira, a camada é uma só para a cena toda
// o nome do pedaço: o da faixa (ilha), o da vaga (fileira empacotada) ou a camada inteira
function nomePedaco(cena, nome, k, h = '') {
  const a = cena.ind.arquivos
  if (k === undefined) return nome
  return a[`${nome}-v${k}${h}`] ? `${nome}-v${k}${h}` : a[`${nome}-v${k}`] ? `${nome}-v${k}` : nome
}
export function imagem(bib, cena, nome, k, h = '') {
  nome = nomePedaco(cena, nome, k, h)
  if (!cena.imgs.has(nome)) {
    const info = cena.ind.arquivos[nome]
    if (!info) throw new Error(`${cena.nome} não tem ${nome}`)
    const arq = info.arq || `${nome}.png`, ler = arq.endsWith('.webp') ? lerWebp : lerPng
    // escala: a imagem foi guardada menor (a sombra, que é suave, vai pela metade); gx0/gy0 seguem na grade inteira
    cena.imgs.set(nome, ler(`${bib.base}/${cena.nome}/${arq}`).then((im) => ({ ...im, gx0: info.gx0, gy0: info.gy0, escala: info.escala || 1 })))
  }
  return cena.imgs.get(nome)
}
// chão e teto usam a mesma chave (a vizinhança da vaga); as peças altas, a chave de pecasDe (e a longa, quando a peça
// tem), calculada aqui para a cena de origem e casada com as imagens do indice.json pelo tipo, papel e âncora.
// Na biblioteca empacotada, "fatias" diz quais vagas (-1 e nu são as pontas) têm pedaço de chão e teto
export function indexar(bib, fontes, W) {
  const vagas = new Map(), pecas = new Map()
  const por = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v) }
  for (const cena of bib.cenas) {
    const e = cena.ind
    if (fontes && !fontes.includes(cena.nome)) continue
    if (e.ilha) {
      // fatias da ilha: k e a faixa ('F', 'M' ou 'T'); -1 e nu são as pontas, inteiras
      const lista = e.fatias || (e.arquivos.chao && e.arquivos.teto ? [-1, e.nu, ...Array.from({ length: e.nu }, (_, k) => FAIXAS_ILHA.map(([h]) => [k, h])).flat()] : [])
      for (const fa of lista) {
        if (!Array.isArray(fa)) por(vagas, fa < 0 ? pontaIE(e, W) : pontaID(e, W), { cena, k: fa })
        else por(vagas, chaveMetade(e, fa[1], fa[0], W), { cena, k: fa[0], h: fa[1] })
      }
      // as peças pelo tipo, a fileira e a âncora; o pilar pelo x (divisa e classe), que vira a âncora dele
      for (const q of pecasIlha(e)) {
        const p = (e.pecas || []).find((x) => x.tipo === q.tipo && (q.tipo === 'pilar'
          ? (({ b, cls }) => b === q.ancora && cls === q.papel)(pilarDe(x, e.passo)) : (x.fileira || 'frente') === q.fileira && x.ancora === q.ancora))
        if (p) por(pecas, q.chave, { cena, p: q.tipo === 'pilar' ? { ...p, ancora: q.ancora } : p })
      }
      continue
    }
    if (e.fatias) {
      for (const k of e.fatias) por(vagas, k < 0 ? pontaE(e, W) : k >= e.nu ? pontaD(e, W) : chaveVaga(e, k, W), { cena, k })
    } else if (e.arquivos.chao && e.arquivos.teto) {   // um catálogo pode ter só peças altas (o plano não pediu as camadas)
      for (let k = 0; k < e.nu; k++) por(vagas, chaveVaga(e, k, W), { cena, k })
      por(vagas, pontaE(e, W), { cena, k: -1 }); por(vagas, pontaD(e, W), { cena, k: e.nu })
    }
    for (const q of pecasDe(e)) {
      const p = (e.pecas || []).find((x) => x.tipo === q.tipo && (x.papel || papelDe(x)) === q.papel && x.ancora === q.ancora)
      if (p) { por(pecas, q.chave, { cena, p }); if (q.longe) por(pecas, q.longe, { cena, p }) }
    }
  }
  return { vagas, pecas }
}

// ---------------------------------------------------------------- montagem
// de que cena vem cada vaga (chão e teto) e cada peça alta de um formato, sem baixar nenhuma imagem
function escolher(bib, montagem, fontes, W) {
  const e = estrutura(montagem), idx = indexar(bib, fontes, W), faltam = [], usadas = []
  if (!bib.cenas.length) return { faltam: ['todas: a biblioteca ainda não foi renderizada'], e }
  const g = bib.cenas[0].ind                       // grade, câmera e medidas (iguais em todas as cenas)
  const fonte = (tab, chave, kt, rotulo, img) => {
    const f = (tab.get(chave) || [])[0]
    if (!f) { faltam.push(`${rotulo} (vizinhança ${chave})`); return null }
    usadas.push({ rotulo, cena: f.cena.nome, de: (f.k < 0 ? 'ponta esquerda' : f.k >= f.cena.ind.nu ? 'ponta direita' : `vaga ${f.k + 1}`) + (f.h ? ` ${f.h}` : '') })
    return { cena: f.cena, img, du: kt - f.k, k: f.k, h: f.h }
  }
  const ilha = e.ilha
  const NOME_FAIXA = { F: 'frente', N: 'fim da frente', M: 'começo dos fundos', T: 'fundos' }
  const fatias = (img, nome) => ilha ? {
    E: fonte(idx.vagas, pontaIE(e, W), -1, `${nome}: ponta esquerda`, img),
    D: fonte(idx.vagas, pontaID(e, W), e.nu, `${nome}: ponta direita`, img),
    faixas: Object.fromEntries(FAIXAS_ILHA.map(([h]) => [h, Array.from({ length: e.nu }, (_, k) => fonte(idx.vagas, chaveMetade(e, h, k, W), k, `${nome}: vaga ${k + 1}, ${NOME_FAIXA[h]}`, img))])),
  } : {
    E: fonte(idx.vagas, pontaE(e, W), -1, `${nome}: ponta esquerda`, img),
    D: fonte(idx.vagas, pontaD(e, W), e.nu, `${nome}: ponta direita`, img),
    u: Array.from({ length: e.nu }, (_, k) => fonte(idx.vagas, chaveVaga(e, k, W), k, `${nome}: vaga ${k + 1}`, img)),
  }
  const fChao = fatias('chao', 'chão'), fTeto = fatias('teto', 'teto')
  const pecas = []
  // sem a peça exata, uma aproximada: a bomba do mesmo modelo, vagas, cobertura e lado direito (o que muda a luz
  // dela é a sombra da cobertura da direita); o pilar do mesmo papel (e da mesma ponta, no da direita)
  const parecida = (k) => {
    const [t, a, b] = k.split('|'), ok = (x) => {
      const [tx, ax, bx] = x.split('|')
      if (tx !== t) return false
      if (t === 'pilar-d') return (ax === 'C') === (a === 'C')
      if (t.startsWith('pilar')) return true
      return ax === a && (b === undefined || (bx && bx.slice(-1) === b.slice(-1)))
    }
    for (const [kk, v] of idx.pecas) if (ok(kk)) return v[0]
    return null
  }
  for (const q of ilha ? pecasIlha(e) : pecasDe(e)) {
    // a chave longa primeiro (o pilar da ponta, a árvore e o totem com as bombas até duas vagas); sem ela, a curta
    const longa = q.longe && (idx.pecas.get(q.longe) || [])[0]
    let f = longa || (idx.pecas.get(q.chave) || [])[0], aprox = false
    if (!f && !ilha && (f = parecida(q.chave))) aprox = true
    if (!f) { faltam.push(`${q.rotulo} (${q.chave})`); continue }
    usadas.push({ rotulo: q.rotulo, cena: f.cena.nome, de: f.p.id + (aprox ? ' (aproximada)' : q.longe && !longa ? ' (chave curta)' : ''), aprox })
    pecas.push({ ...q, cena: f.cena, p: f.p, du: q.ancora - f.p.ancora })
  }
  if (faltam.length) return { faltam, e }
  const desl = (du) => [Math.round(du * g.du[0]), Math.round(du * g.du[1])]
  const todasDe = (f) => [...(f.u || Object.values(f.faixas).flat()), f.E, f.D]
  return { e, g, fChao, fTeto, pecas, usadas, desl, todas: [...todasDe(fChao), ...todasDe(fTeto)] }
}
// a moldura de um formato só pelos índices (o retângulo de cada pedaço posto: chão, teto e peças), sem baixar imagem:
// com ela, cada horário pode montar direto na moldura comum (montar(..., { quadro }))
export function planejar(bib, montagem, { fontes, W = W_PADRAO } = {}) {
  const s = escolher(bib, montagem, fontes, W)
  if (s.faltam) return s
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const cobre = (cena, nome, k, du, h = '') => {
    const r = cena.ind.arquivos[nomePedaco(cena, nome, k, h)], [dx, dy] = s.desl(du)
    if (r.w * r.h <= 1) return                         // pedaço vazio (o teto de uma vaga sem cobertura): 1 px no canto da cena
    x0 = Math.min(x0, r.gx0 + dx); y0 = Math.min(y0, r.gy0 + dy); x1 = Math.max(x1, r.gx0 + dx + r.w); y1 = Math.max(y1, r.gy0 + dy + r.h)
  }
  for (const f of s.todas) cobre(f.cena, f.img, f.k, f.du, f.h)
  for (const q of s.pecas) cobre(q.cena, q.p.spr, undefined, q.du)
  return { e: s.e, quadro: { gx0: x0, gy0: y0, W: x1 - x0, H: y1 - y0 } }
}
// fontes: nomes das cenas que podem dar peças (padrão: todas com peças). Devolve { faltam } se a biblioteca não cobre o formato.
// sem: camadas a deixar de fora, para achar a origem de uma diferença ('sombra', 'luz', 'pecas').
// quadro: a moldura em que montar (padrão: a que cobre tudo o que foi posto)
// sombra: 'produto' (cada razão multiplica o chão: certo com uma fonte de luz só, o sol) ou 'soma' (o que cada peça
// tira de luz se soma: com muitas lâmpadas, peças diferentes tapam lâmpadas diferentes do mesmo ponto, e o produto das
// razões deixava o chão claro demais)
// sobre: as peças que vão também numa camada só delas, transparente (a 2D da ilha: as bombas dos fundos e os pilares
// do meio ficam na frente dos carros dos fundos, como a camada "sobre" da v14)
export async function montar(bib, montagem, { fontes, W = W_PADRAO, sem = [], quadro: qDado, sombra = 'produto', sobre: daSobre = null } = {}) {
  const t0 = performance.now()
  const s = escolher(bib, montagem, fontes, W)
  if (s.faltam) return s
  const { e, g, fChao, fTeto, pecas, usadas, desl, todas } = s
  // carrega o que falta (as imagens ficam guardadas: montar de novo é só a conta)
  await Promise.all([
    ...todas.map(async (f) => { f.im = await imagem(bib, f.cena, f.img, f.k, f.h); [f.dx, f.dy] = desl(f.du) }),
    ...pecas.map(async (q) => {
      q.spr = await imagem(bib, q.cena, q.p.spr); q.som = await imagem(bib, q.cena, q.p.sombra); [q.dx, q.dy] = desl(q.du)
      if (q.p.luz) q.luz = await imagem(bib, q.cena, q.p.luz)       // à noite: a luz que a peça joga no chão
      // ordem de desenho: onde duas peças se cobrem, a árvore fica atrás do pilar da ponta, o pilar atrás do frade da
      // bomba vizinha e o totem na frente de tudo; dentro do mesmo tipo, da mais funda para a mais próxima. Na ilha,
      // antes vêm as bombas dos fundos, depois os pilares do meio, a árvore (no canteiro do meio, 0,7 m à esquerda do
      // primeiro pilar e mais perto da câmera: a copa passa na frente dele), as bombas da frente e o totem
      const grupo = e.ilha ? (q.tipo === 'bomba' ? (q.fileira === 'fundos' ? 0 : 3) : { pilar: 1, arvore: 2, totem: 4 }[q.tipo]) : { arvore: 0, pilar: 1, bomba: 2, totem: 3 }[q.tipo]
      q.ordem = grupo * 1000 - (q.p.prof + q.du * g.passo * g.fv[0])
    }),
  ])
  const t1 = performance.now()

  // quadro: tudo o que foi posto (na biblioteca empacotada as pontas não cobrem mais o posto inteiro: entram todos)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const cobre = (im, dx, dy) => { if (im.w * im.h <= 1) return; x0 = Math.min(x0, im.gx0 + dx); y0 = Math.min(y0, im.gy0 + dy); x1 = Math.max(x1, im.gx0 + dx + im.w); y1 = Math.max(y1, im.gy0 + dy + im.h) }
  for (const f of todas) cobre(f.im, f.dx, f.dy)
  for (const q of pecas) cobre(q.spr, q.dx, q.dy)
  const quadro = qDado || { gx0: x0, gy0: y0, W: x1 - x0, H: y1 - y0 }

  const fundo = new Float32Array(quadro.W * quadro.H * 4), teto = new Float32Array(quadro.W * quadro.H * 4)
  fatiar(fundo, quadro, g, g.Z, fChao, e.nu)
  fatiar(teto, quadro, g, g.zteto, fTeto, e.nu)
  if (!sem.includes('sombra') && sombra !== 'produto') {
    // grupos: dentro de um grupo as razões se multiplicam; entre grupos, o que cada grupo tira de luz se soma. 'soma':
    // cada peça é um grupo; 'fileiras' (ilha à noite): as peças da frente, as dos fundos e as do meio
    const grupoDe = (q) => (sombra === 'soma' ? q : q.tipo === 'bomba' ? q.fileira : q.tipo === 'totem' ? 'frente' : 'meio')
    const grupos = new Map()
    for (const q of pecas) { const g = grupoDe(q); if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(q) }
    const tira = new Float32Array(quadro.W * quadro.H * 3), um = new Float32Array(quadro.W * quadro.H * 4)
    for (const lista of grupos.values()) {
      um.fill(1)
      for (const q of lista) multiplicar(um, quadro, q.som, q.dx, q.dy)
      for (let i = 0, o = 0; i < tira.length; i += 3, o += 4) for (let k = 0; k < 3; k++) tira[i + k] += 1 - um[o + k]
    }
    for (let i = 0, o = 0; i < tira.length; i += 3, o += 4) for (let k = 0; k < 3; k++) if (tira[i + k]) fundo[o + k] *= Math.max(0, 1 - tira[i + k])
  } else if (!sem.includes('sombra')) for (const q of pecas) multiplicar(fundo, quadro, q.som, q.dx, q.dy)
  if (!sem.includes('luz')) for (const q of pecas) if (q.luz) somar(fundo, quadro, q.luz, q.dx, q.dy)
  const emOrdem = [...pecas].sort((a, b) => a.ordem - b.ordem)
  if (!sem.includes('pecas')) for (const q of emOrdem) sobrepor(fundo, quadro, q.spr, q.dx, q.dy)
  let camSobre = null
  if (daSobre) { camSobre = new Float32Array(quadro.W * quadro.H * 4); for (const q of emOrdem) if (daSobre(q)) sobrepor(camSobre, quadro, q.spr, q.dx, q.dy) }
  return { e, quadro, fundo, teto, sobre: camSobre, usadas, expo: g.expo || 0, ms: { carregar: t1 - t0, montar: performance.now() - t1 } }
}
// luz de uma peça (tela, LEDs): soma no chão, que já tem a luz do resto do posto (luz se soma, sombra se multiplica).
// Longe da peça, a imagem de luz tem um resto de ruído (1 a 3 de 255) que, somado de várias peças, clareava as áreas
// escuras da noite: abaixo do limiar (no byte mais forte do pixel), a luz é zero
export let LIMIAR_LUZ = 2
export function limiarLuz(v) { LIMIAR_LUZ = v }
function somar(buf, Q, im, dx, dy) {
  const ox = im.gx0 + dx - Q.gx0, oy = im.gy0 + dy - Q.gy0
  for (let sy = Math.max(0, -oy); sy < Math.min(im.h, Q.H - oy); sy++) {
    for (let sx = Math.max(0, -ox); sx < Math.min(im.w, Q.W - ox); sx++) {
      const i = (sy * im.w + sx) * 4, a = im.d[i + 3]
      if (!a || Math.max(im.d[i], im.d[i + 1], im.d[i + 2]) <= LIMIAR_LUZ) continue
      const al = a / 255, o = ((sy + oy) * Q.W + sx + ox) * 4
      buf[o] += LIN[im.d[i]] * al; buf[o + 1] += LIN[im.d[i + 1]] * al; buf[o + 2] += LIN[im.d[i + 2]] * al
    }
  }
}

// cada pixel pega a vaga do ponto do plano (chão ou teto) que ele enxerga (na ilha, também a metade, pelo y)
function fatiar(buf, Q, g, z, f, nu) {
  const { rv, uv, pxm, passo } = g, det = rv[0] * uv[1] - rv[1] * uv[0]
  for (let y = 0; y < Q.H; y++) {
    const v = -(Q.gy0 + y + 0.5) / pxm - uv[2] * z
    for (let x = 0; x < Q.W; x++) {
      const u = (Q.gx0 + x + 0.5) / pxm - rv[2] * z
      const k = Math.floor((u * uv[1] - rv[1] * v) / det / passo)
      const s = k < 0 ? f.E : k >= nu ? f.D : f.faixas ? f.faixas[faixaDe((rv[0] * v - u * uv[0]) / det)][k] : f.u[k], im = s.im
      const sx = Q.gx0 + x - s.dx - im.gx0, sy = Q.gy0 + y - s.dy - im.gy0
      if (sx < 0 || sy < 0 || sx >= im.w || sy >= im.h) continue
      const i = (sy * im.w + sx) * 4, a = im.d[i + 3]
      if (!a) continue
      const al = a / 255, o = (y * Q.W + x) * 4
      buf[o] = LIN[im.d[i]] * al; buf[o + 1] = LIN[im.d[i + 1]] * al; buf[o + 2] = LIN[im.d[i + 2]] * al; buf[o + 3] = al
    }
  }
}
// sombra de uma peça: a razão (com / sem a peça) multiplica a luz do chão. Na biblioteca empacotada, onde a razão é ~1
// o pixel vem transparente e fica como está (as sombras inteiras são opacas: nada muda nelas)
function multiplicar(buf, Q, im, dx, dy) {
  if (im.escala > 1) return multiplicarMenor(buf, Q, im, dx, dy)
  const ox = im.gx0 + dx - Q.gx0, oy = im.gy0 + dy - Q.gy0
  for (let sy = Math.max(0, -oy); sy < Math.min(im.h, Q.H - oy); sy++) {
    for (let sx = Math.max(0, -ox); sx < Math.min(im.w, Q.W - ox); sx++) {
      const i = (sy * im.w + sx) * 4, o = ((sy + oy) * Q.W + sx + ox) * 4
      if (!im.d[i + 3]) continue
      buf[o] *= LIN[im.d[i]]; buf[o + 1] *= LIN[im.d[i + 1]]; buf[o + 2] *= LIN[im.d[i + 2]]
    }
  }
}
// sombra guardada menor (escala 2): o fator de cada ponto (transparente = 1) interpolado no pixel inteiro
function multiplicarMenor(buf, Q, im, dx, dy) {
  const s = im.escala, ox = im.gx0 + dx - Q.gx0, oy = im.gy0 + dy - Q.gy0, w = im.w, h = im.h
  const F = new Float32Array(w * h * 3), neutro = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    if (!im.d[i * 4 + 3]) { F[i * 3] = F[i * 3 + 1] = F[i * 3 + 2] = 1; neutro[i] = 1 }
    else { F[i * 3] = LIN[im.d[i * 4]]; F[i * 3 + 1] = LIN[im.d[i * 4 + 1]]; F[i * 3 + 2] = LIN[im.d[i * 4 + 2]] }
  }
  for (let sy = Math.max(0, -oy); sy < Math.min(h * s, Q.H - oy); sy++) {
    const fy = Math.min(h - 1, Math.max(0, (sy + 0.5) / s - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0
    for (let sx = Math.max(0, -ox); sx < Math.min(w * s, Q.W - ox); sx++) {
      const fx = Math.min(w - 1, Math.max(0, (sx + 0.5) / s - 0.5)), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0
      const a = y0 * w + x0, b = y0 * w + x1, c = y1 * w + x0, d = y1 * w + x1
      if (neutro[a] && neutro[b] && neutro[c] && neutro[d]) continue
      const o = ((sy + oy) * Q.W + sx + ox) * 4
      for (let k = 0; k < 3; k++) buf[o + k] *= (F[a * 3 + k] * (1 - tx) + F[b * 3 + k] * tx) * (1 - ty) + (F[c * 3 + k] * (1 - tx) + F[d * 3 + k] * tx) * ty
    }
  }
}
// a parte da luz que a peça tira (1 - razão), somada em 'tira' (3 canais por pixel); a sombra guardada menor é
// interpolada como em multiplicarMenor
function somarSombra(tira, Q, im, dx, dy) {
  const s = im.escala || 1, ox = im.gx0 + dx - Q.gx0, oy = im.gy0 + dy - Q.gy0, w = im.w, h = im.h
  const F = new Float32Array(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    if (!im.d[i * 4 + 3]) continue
    for (let k = 0; k < 3; k++) F[i * 3 + k] = 1 - LIN[im.d[i * 4 + k]]
  }
  for (let sy = Math.max(0, -oy); sy < Math.min(h * s, Q.H - oy); sy++) {
    const fy = Math.min(h - 1, Math.max(0, (sy + 0.5) / s - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0
    for (let sx = Math.max(0, -ox); sx < Math.min(w * s, Q.W - ox); sx++) {
      const fx = Math.min(w - 1, Math.max(0, (sx + 0.5) / s - 0.5)), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0
      const a = y0 * w + x0, b = y0 * w + x1, c = y1 * w + x0, d = y1 * w + x1, o = ((sy + oy) * Q.W + sx + ox) * 3
      for (let k = 0; k < 3; k++) tira[o + k] += (F[a * 3 + k] * (1 - tx) + F[b * 3 + k] * tx) * (1 - ty) + (F[c * 3 + k] * (1 - tx) + F[d * 3 + k] * tx) * ty
    }
  }
}
// imagem de uma peça por cima (o recorte do chão já tirou o que fica atrás do meio-fio, da faixa etc.)
function sobrepor(buf, Q, im, dx, dy) {
  const ox = im.gx0 + dx - Q.gx0, oy = im.gy0 + dy - Q.gy0
  for (let sy = Math.max(0, -oy); sy < Math.min(im.h, Q.H - oy); sy++) {
    for (let sx = Math.max(0, -ox); sx < Math.min(im.w, Q.W - ox); sx++) {
      const i = (sy * im.w + sx) * 4, a = im.d[i + 3]
      if (!a) continue
      const al = a / 255, r = 1 - al, o = ((sy + oy) * Q.W + sx + ox) * 4
      buf[o] = LIN[im.d[i]] * al + r * buf[o]; buf[o + 1] = LIN[im.d[i + 1]] * al + r * buf[o + 1]
      buf[o + 2] = LIN[im.d[i + 2]] * al + r * buf[o + 2]; buf[o + 3] = al + r * buf[o + 3]
    }
  }
}

// ---------------------------------------------------------------- brilho da noite (bloom)
// O mesmo papel do nó Glare "Bloom" da composição da v14 (limiar 1,3, força 0,22): o que passa do limiar é reduzido à
// metade várias vezes (média 2x2) e subido de volta somando os níveis (bilinear), e a soma entra por cima da imagem.
// Roda depois de juntar as peças, em luz linear (antes da exposição e do PBR Neutral, como no Blender).
// pesos: quanto cada nível (do mais fino ao mais largo) entra. Ajustado contra um render do Blender com o brilho
// (ferramentas/ajustar-brilho.mjs): o do Blender só soma luz e é um véu muito largo e fraco (+0,003 de luz até nas
// áreas escuras) além do halo das luzes fortes; esta aproximação tira ~30% da diferença. Para a maquete de verdade, o
// brilho exato é o do próprio compositor do Blender aplicado à imagem montada
export const BRILHO_PADRAO = { limiar: 1.3, forca: 0.4, niveis: 12, pesos: Array.from({ length: 12 }, (_, n) => 1.25 ** n) }
// A pirâmide começa na metade da resolução: o nível inteiro pesa 1 em ~55 (menos de 2% do brilho) e era a maior parte da
// conta e da memória (uma imagem a mais do tamanho da maquete). A soma final volta ao tamanho inteiro ponto a ponto
export function brilho(buf, W, H, opc = {}) {
  const { limiar, forca, niveis, pesos } = { ...BRILHO_PADRAO, ...opc }
  let w = W >> 1, h = H >> 1
  const d = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3
    for (const [yy, xx] of [[2 * y, 2 * x], [2 * y, 2 * x + 1], [2 * y + 1, 2 * x], [2 * y + 1, 2 * x + 1]]) {
      const o = (yy * W + xx) * 4, m = Math.max(buf[o], buf[o + 1], buf[o + 2])
      if (m > limiar) { const f = (m - limiar) / m / 4; d[i] += buf[o] * f; d[i + 1] += buf[o + 1] * f; d[i + 2] += buf[o + 2] * f }
    }
  }
  const pir = [{ d, w, h }]
  for (let n = 1; n < niveis - 1 && w > 2 && h > 2; n++) {
    const w2 = w >> 1, h2 = h >> 1, d2 = new Float32Array(w2 * h2 * 3), a = pir[pir.length - 1]
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) for (let k = 0; k < 3; k++) {
      const p = (yy, xx) => a.d[((yy) * a.w + xx) * 3 + k]
      d2[(y * w2 + x) * 3 + k] = (p(2 * y, 2 * x) + p(2 * y, 2 * x + 1) + p(2 * y + 1, 2 * x) + p(2 * y + 1, 2 * x + 1)) / 4
    }
    pir.push({ d: d2, w: w2, h: h2 }); w = w2; h = h2
  }
  // subida: cada nível recebe o de baixo ampliado (bilinear) e soma com o seu peso
  const amplia = (de, para) => {
    const out = new Float32Array(para.w * para.h * 3), sx = de.w / para.w, sy = de.h / para.h
    for (let y = 0; y < para.h; y++) {
      const fy = Math.min(de.h - 1, Math.max(0, (y + 0.5) * sy - 0.5)), y0 = Math.floor(fy), y1 = Math.min(de.h - 1, y0 + 1), ty = fy - y0
      for (let x = 0; x < para.w; x++) {
        const fx = Math.min(de.w - 1, Math.max(0, (x + 0.5) * sx - 0.5)), x0 = Math.floor(fx), x1 = Math.min(de.w - 1, x0 + 1), tx = fx - x0
        for (let k = 0; k < 3; k++) {
          const v = (yy, xx) => de.d[(yy * de.w + xx) * 3 + k]
          out[(y * para.w + x) * 3 + k] = (v(y0, x0) * (1 - tx) + v(y0, x1) * tx) * (1 - ty) + (v(y1, x0) * (1 - tx) + v(y1, x1) * tx) * ty
        }
      }
    }
    return out
  }
  // pir[n] é o nível n + 1 (o peso dele é ps[n + 1]); a norma é a mesma de antes, com o nível inteiro
  const ps = (pesos || Array.from({ length: niveis }, () => 1)).slice(1)
  let acc = { d: pir[pir.length - 1].d.map((v) => v * ps[pir.length - 1]), w: pir[pir.length - 1].w, h: pir[pir.length - 1].h }
  for (let n = pir.length - 2; n >= 0; n--) {
    const up = amplia(acc, pir[n]), dn = pir[n].d
    for (let i = 0; i < up.length; i++) up[i] += dn[i] * ps[n]
    acc = { d: up, w: pir[n].w, h: pir[n].h }
  }
  const norma = (pesos || Array.from({ length: niveis }, () => 1)).reduce((s, v) => s + v, 0), k = forca / norma
  for (let y = 0; y < H; y++) {
    const fy = Math.min(acc.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5)), y0 = Math.floor(fy), y1 = Math.min(acc.h - 1, y0 + 1), ty = fy - y0
    for (let x = 0; x < W; x++) {
      const fx = Math.min(acc.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), x0 = Math.floor(fx), x1 = Math.min(acc.w - 1, x0 + 1), tx = fx - x0, o = (y * W + x) * 4
      for (let c = 0; c < 3; c++) {
        const v = (acc.d[(y0 * acc.w + x0) * 3 + c] * (1 - tx) + acc.d[(y0 * acc.w + x1) * 3 + c] * tx) * (1 - ty) + (acc.d[(y1 * acc.w + x0) * 3 + c] * (1 - tx) + acc.d[(y1 * acc.w + x1) * 3 + c] * tx) * ty
        buf[o + c] += k * v
      }
    }
  }
  return buf
}

// ---------------------------------------------------------------- referência e comparação
// uma imagem da cena (render inteiro) num quadro qualquer, em luz linear pré-multiplicada
export async function noQuadro(bib, cena, nome, Q) {
  const buf = new Float32Array(Q.W * Q.H * 4)
  sobrepor(buf, Q, await imagem(bib, cena, nome), 0, 0)
  return buf
}
export function juntar(teto, fundo) {        // teto por cima do fundo
  const out = new Float32Array(fundo.length)
  for (let o = 0; o < out.length; o += 4) {
    const r = 1 - teto[o + 3]
    out[o] = teto[o] + r * fundo[o]; out[o + 1] = teto[o + 1] + r * fundo[o + 1]; out[o + 2] = teto[o + 2] + r * fundo[o + 2]; out[o + 3] = teto[o + 3] + r * fundo[o + 3]
  }
  return out
}
// diferença em tela (as duas sobre o mesmo fundo de página): números e o mapa de calor
export function comparar(a, b, W, H, fundoPagina = [14, 19, 17]) {
  const mapa = new Uint8ClampedArray(W * H * 4)
  let n = 0, soma = 0, maior = 0, acima3 = 0, acima10 = 0, se = 0
  const sobre = (d, o, k) => (d[o + k] * d[o + 3] + fundoPagina[k] * (255 - d[o + 3])) / 255
  for (let o = 0; o < a.length; o += 4) {
    if (!a[o + 3] && !b[o + 3]) continue
    let dm = 0
    for (let k = 0; k < 3; k++) { const d = Math.abs(sobre(a, o, k) - sobre(b, o, k)); dm = Math.max(dm, d); se += d * d }
    n++; soma += dm; maior = Math.max(maior, dm)
    if (dm > 3) acima3++
    if (dm > 10) acima10++
    // mapa: o posto em cinza escuro e a diferença (x4) do amarelo ao vermelho
    const cinza = ((sobre(b, o, 0) + sobre(b, o, 1) + sobre(b, o, 2)) / 3) * 0.35
    if (dm <= 1.5) { mapa[o] = mapa[o + 1] = mapa[o + 2] = cinza }
    else {
      const t = Math.min(1, (dm * 4) / 255), m = Math.min(1, 0.4 + t)       // amarelo (pouca) a vermelho (muita)
      mapa[o] = cinza + (255 - cinza) * m; mapa[o + 1] = cinza + (220 * (1 - t) + 40 * t - cinza) * m; mapa[o + 2] = cinza * (1 - m)
    }
    mapa[o + 3] = 255
  }
  const mse = se / Math.max(1, n * 3)
  return { mapa, n, media: soma / Math.max(1, n), maior, p3: acima3 / Math.max(1, n), p10: acima10 / Math.max(1, n), psnr: mse ? 10 * Math.log10((255 * 255) / mse) : Infinity }
}
