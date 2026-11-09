// Um horário de uma vista da maquete, montado num Worker com as peças de Lego da V3: baixa as imagens que o plano usa,
// monta fundo e teto (lego.js, montarLego), aplica o brilho da noite e a cor (os mesmos do compor.js da V1), reduz para
// no máximo MAX px de largura e converte para webp. Mesma conversa do montar-worker.js da V1.
import { paraTela, brilho, lerWebp } from './base/compor.js'
import { montarLego } from './lego.js'
import { montarLateral } from './lateral.js'     // (9/11) vagas paralelas: monta já na resolução final

const medida = { bytes: 0, arquivos: 0 }
const agora = () => performance.now()

// redução por média de área (a mesma do montar-worker.js da V1), com o alfa pré-multiplicado para a borda não escurecer
function reduzir(rgba, w, h, w2, h2) {
  const pesos = (n, n2) => {
    const s = n / n2, out = []
    for (let i = 0; i < n2; i++) {
      const a = i * s, b = (i + 1) * s, i0 = Math.floor(a), i1 = Math.min(n, Math.ceil(b)), p = []
      for (let k = i0; k < i1; k++) p.push(Math.min(b, k + 1) - Math.max(a, k))
      out.push([i0, p, s])
    }
    return out
  }
  const px = pesos(w, w2), py = pesos(h, h2), tmp = new Float32Array(w2 * h * 4), out = new Uint8ClampedArray(w2 * h2 * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w2; x++) {
    const [x0, p, s] = px[x]; let r = 0, g = 0, b = 0, a = 0
    for (let k = 0; k < p.length; k++) { const i = (y * w + x0 + k) * 4, al = rgba[i + 3] * p[k]; r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al; a += al }
    const o = (y * w2 + x) * 4; tmp[o] = r / s; tmp[o + 1] = g / s; tmp[o + 2] = b / s; tmp[o + 3] = a / s
  }
  for (let y = 0; y < h2; y++) {
    const [y0, p, s] = py[y]
    for (let x = 0; x < w2; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let k = 0; k < p.length; k++) { const i = ((y0 + k) * w2 + x) * 4; r += tmp[i] * p[k]; g += tmp[i + 1] * p[k]; b += tmp[i + 2] * p[k]; a += tmp[i + 3] * p[k] }
      const o = (y * w2 + x) * 4
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = a / s }
    }
  }
  return out
}
// 2D à noite (pedido do Sergio, 31/10): o painel fica quase preto atrás da maquete, e o contorno do recorte (a borda da
// laje, a ponta da copa da árvore) saltava como uma linha clara. Só junto do contorno de fora (o que encosta num pixel
// totalmente transparente): o alfa espalha 1 px (média 3 × 3) e a cor escurece numa faixa de R px, mais escura junto do
// fundo (fator `borda` no contorno, 1 a R px para dentro), para a borda sumir no escuro. O vidro do teto e o resto da
// imagem não mudam (lá o alfa varia, mas não encosta em zero)
function suavizarContorno(px, W, H, R = 5, borda = 0.35) {
  const N = W * H, a0 = new Uint8Array(N), dist = new Uint8Array(N).fill(255)
  for (let i = 0; i < N; i++) { a0[i] = px[i * 4 + 3]; if (!a0[i]) dist[i] = 0 }
  // distância (em px, xadrez) até o fundo transparente, até R: R passadas de "vizinho do anel anterior"
  for (let d = 1; d <= R; d++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (dist[i] !== 255) continue
    let perto = false
    for (let dy = -1; dy <= 1 && !perto; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < W && dist[yy * W + xx] === d - 1) { perto = true; break } } }
    if (perto) dist[i] = d
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = i * 4, d = dist[i]
    if (d === 255) continue                               // longe do contorno: nada muda
    if (d === 0) {                                        // fora: ganha um pouco de alfa (o contorno espalha), em preto
      let s = 0, n = 0
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < W) { s += a0[yy * W + xx]; n++ } } }
      if (s) { px[o] = px[o + 1] = px[o + 2] = 0; px[o + 3] = Math.round((s / n) * borda) }
      continue
    }
    const k = borda + (1 - borda) * ((d - 1) / R)        // 1 px dentro: `borda`; R px dentro: quase 1
    px[o] *= k; px[o + 1] *= k; px[o + 2] *= k
  }
  return px
}
// (3/11, noite) compressão: a transparência das camadas (o vidro do teto, as bordas) em degraus de 8 (32 níveis) e a cor
// zerada onde é toda transparente. O webp guarda a transparência sem perda, e com menos níveis ela fica bem menor: o teto
// caiu 36-41% (de ~1,1 MB para ~0,7 MB por horário) com a cor igual (erro médio 0,25 de 255, o mesmo de antes)
function enxugaAlfa(px) {
  for (let o = 0; o < px.length; o += 4) {
    const a = px[o + 3]
    if (!a) { px[o] = px[o + 1] = px[o + 2] = 0; continue }
    if (a < 255) px[o + 3] = Math.max(1, Math.min(254, Math.round(a / 8) * 8))
  }
  return px
}
async function webp(rgba, w, h, q, max) {
  if (w > max) { const w2 = max, h2 = Math.round((h * max) / w); rgba = reduzir(rgba, w, h, w2, h2); w = w2; h = h2 }
  enxugaAlfa(rgba)
  const cv = new OffscreenCanvas(w, h); cv.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0)
  return cv.convertToBlob({ type: 'image/webp', quality: q })
}

self.onmessage = async ({ data: t }) => {
  const ms = {}, T0 = agora()
  medida.bytes = 0; medida.arquivos = 0
  try {
    const ler = async (arq) => {
      const im = await lerWebp(t.base + arq)
      medida.bytes += im.w * im.h; medida.arquivos++
      return im
    }
    let t1 = agora()
    // a ilha leva uma camada a mais, como na V1: na 2D, "sobre" (as bombas dos fundos, os pilares e a árvore, por cima
    // dos carros dos fundos); no 3D, só a árvore, recortada, que o painel põe na frente do primeiro carro dos fundos
    const filtro = t.sobre ? (p) => (p.tipo === 'bomba' && p.fileira === 'fundos') || p.tipo === 'pilar' || p.tipo === 'arvore'
      : t.arvore ? (p) => p.tipo === 'arvore' : null
    // (3/11, noite) na noite de cada vista, também a máscara das bombas (a mesma em todo horário): à noite se vê o que acende
    // (9/11) as vagas paralelas vêm do montarLateral, já na resolução final (t.layout, sem plano: ele planeja sozinho)
    const res = t.lateral ? await montarLateral(t.indice, t.layout, ler, { max: t.max, mascara: t.per === 'noite', quadro: t.quadro })
      : await montarLego(t.indice, t.plano, ler, filtro, { mascara: t.per === 'noite' })
    const { fundo, teto, sobre, mascara, aceso } = res
    ms['juntar as peças'] = agora() - t1
    const { W, H } = t.lateral ? res.quadro : t.plano.quadro, expo = t.lateral ? t.indice.expo || 0 : t.plano.expo, arquivos = {}
    if (mascara) {
      // estados.png, pela metade: no vermelho, o número da bomba de cada pixel (0: nenhuma; o painel lê o mais próximo);
      // no verde, o quanto ali é luz acesa da bomba (a média)
      const w = Math.ceil(W / 2), h = Math.ceil(H / 2), px = new Uint8ClampedArray(w * h * 4)
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let id = 0, ac = 0, n = 0
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const xx = 2 * x + dx, yy = 2 * y + dy; if (xx >= W || yy >= H) continue; n++; ac += aceso[yy * W + xx]; if (!id && mascara[yy * W + xx]) id = mascara[yy * W + xx] }
        const o = (y * w + x) * 4; px[o] = id; px[o + 1] = n ? ac / n : 0; px[o + 3] = 255
      }
      const cv = new OffscreenCanvas(w, h); cv.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0)
      arquivos[`${t.pasta}estados.png`] = await cv.convertToBlob({ type: 'image/png' })
    }
    const camadas = [[t.nomes[0], fundo], [t.nomes[1], teto]]           // sem cobertura o teto vai vazio (o painel lê os dois)
    if (sobre && t.sobre) camadas.push(['sobre', sobre])
    for (const [nome, buf] of camadas) {
      t1 = agora()
      if (t.brilho && nome !== 'sobre') brilho(buf, W, H)
      const tela = paraTela(buf, W, H, expo); ms['brilho e cor'] = (ms['brilho e cor'] || 0) + agora() - t1
      if (t.vista === 'planta' && t.brilho && t.contorno !== false) suavizarContorno(tela, W, H)   // 2D à noite (teto e "sobre" também)
      // (4/11) o teto da 2D vai pela metade da largura: o painel o mostra a ~30% de opacidade por cima de tudo (não se vê a
      // diferença) e ele era o maior arquivo da 2D (~870 KB, mais que o chão); medido num celular com 4G, o que atrasava abrir
      const max = t.vista === 'planta' && nome === 'teto' ? Math.min(t.max, Math.ceil(W / 2)) : t.max
      t1 = agora(); arquivos[`${t.pasta}${nome}-${t.per}.webp`] = await webp(tela, W, H, t.qualidade, max); ms['converter para webp'] = (ms['converter para webp'] || 0) + agora() - t1
    }
    if (sobre && t.arvore) {
      // a árvore vai recortada (só o retângulo dela) com o lugar no quadro em frações (u da esquerda, v de baixo), como na V1
      const tela = paraTela(sobre, W, H, expo)
      let x0 = W, y0 = H, x1 = -1, y1 = -1
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (tela[(y * W + x) * 4 + 3] > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
      if (x1 >= 0) {
        x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(W - 1, x1 + 2); y1 = Math.min(H - 1, y1 + 2)
        const w = x1 - x0 + 1, h = y1 - y0 + 1, rec = new Uint8ClampedArray(w * h * 4)
        for (let y = 0; y < h; y++) rec.set(tela.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4), y * w * 4)
        const f = W > t.max ? t.max / W : 1
        arquivos[`arvore-${t.per}.webp`] = await webp(rec, w, h, 0.92, f < 1 ? Math.round(w * f) : w)
        arquivos[`arvore-${t.per}.json`] = new Blob([JSON.stringify({ u0: x0 / W, u1: (x1 + 1) / W, v0: 1 - (y1 + 1) / H, v1: 1 - y0 / H })], { type: 'application/json' })
      }
    }
    self.postMessage({ ok: true, arquivos, ms, total: agora() - T0, medida: { ...medida }, ...(t.lateral ? { quadro: res.quadro, faltas: res.faltas, bombas: res.bombas } : {}) })
  } catch (e) { self.postMessage({ ok: false, erro: String(e.message || e), ms, medida: { ...medida } }) }
}
