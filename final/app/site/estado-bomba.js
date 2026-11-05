// (4/11, V3) A bomba em falha ou desligada, sem imagem nova de render: o que o 3D (maquete.js) e a 2D (planta-imagem.js)
// desenham por cima da maquete.
//   - telaVista: onde fica a tela da bomba, pelos oclusores do ancoras.json (a moldura e as costas da tela, em metros).
//     As duas câmeras olham do lado da frente (-y): na fileira da frente se vê a face da tela; na dos fundos (girada 180°),
//     as costas, onde o desenho também entra (como uma tela dos dois lados), para a falha aparecer em qualquer bomba;
//   - desenhoTela: o desenho da tela num canvas. Falha: um triângulo de alerta numa tela vermelha. Desligada: o símbolo
//     de liga/desliga cinza numa tela apagada (cinza-azulado escuro, não preto);
//   - brilhoLuzes: o brilho de LED em volta das partes acesas da bomba (o verde de estados.png, desfocado), para a luz
//     vermelha da falha "vazar" um pouco para fora da bomba, como um LED forte.

// a parte visível da tela da bomba bi: centro (x, y, z), largura e altura (m), e o y do plano onde o desenho fica (um
// pouco à frente do oclusor, para ele não esconder o desenho)
export function telaVista(an, bi) {
  const b = an.bombas[bi], oc = (an.oclusores || []).filter((o) => o.nome.startsWith(`bomba${bi}_`))
  const mold = oc.find((o) => /_tela(_alto)?_moldura$/.test(o.nome)), cost = oc.find((o) => /_tela(_alto)?_costas$/.test(o.nome))
  if (!mold) return null
  const fundos = b.fileira === 'fundos'
  // frente: a face (a moldura tem 2,5 cm de borda); fundos: as costas (a caixa de trás, menor que a moldura)
  const r = fundos && cost ? { x0: cost.min[0], x1: cost.max[0], z0: cost.min[2], z1: cost.max[2], y: cost.min[1] }
    : fundos ? { x0: mold.min[0] + 0.06, x1: mold.max[0] - 0.06, z0: mold.min[2] + 0.06, z1: mold.max[2] - 0.06, y: mold.min[1] }
      : { x0: mold.min[0] + 0.025, x1: mold.max[0] - 0.025, z0: mold.min[2] + 0.025, z1: mold.max[2] - 0.025, y: mold.min[1] }
  return { x: (r.x0 + r.x1) / 2, y: r.y - 0.004, z: (r.z0 + r.z1) / 2, w: r.x1 - r.x0, h: r.z1 - r.z0, fundos }
}

// o desenho da tela, do tamanho dela (w × h em metros), com `px` pixels de largura
export function desenhoTela(tipo, w, h, px = 256) {
  const W = px, H = Math.max(16, Math.round((px * h) / w)), c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d'), m = Math.min(W, H), cx = W / 2, cy = H / 2
  if (tipo === 'falha') {
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.65)
    gr.addColorStop(0, '#8E140C'); gr.addColorStop(1, '#300604')
    g.fillStyle = gr; g.fillRect(0, 0, W, H)
    // triângulo de alerta (cantos redondos) com a exclamação
    const s = m * 0.66, ty = cy + s * 0.03
    g.lineJoin = 'round'; g.lineWidth = s * 0.13; g.fillStyle = g.strokeStyle = '#FF5A47'
    g.beginPath(); g.moveTo(cx, ty - s * 0.47); g.lineTo(cx + s * 0.54, ty + s * 0.43); g.lineTo(cx - s * 0.54, ty + s * 0.43); g.closePath(); g.fill(); g.stroke()
    g.fillStyle = '#300604'
    g.beginPath(); g.roundRect(cx - s * 0.06, ty - s * 0.2, s * 0.12, s * 0.37, s * 0.06); g.fill()
    g.beginPath(); g.arc(cx, ty + s * 0.29, s * 0.07, 0, Math.PI * 2); g.fill()
  } else {
    g.fillStyle = '#2A3331'; g.fillRect(0, 0, W, H)
    const r = m * 0.25
    g.strokeStyle = '#A3AFAA'; g.lineWidth = m * 0.075; g.lineCap = 'round'
    g.beginPath(); g.arc(cx, cy + r * 0.08, r, -Math.PI / 2 + 0.78, Math.PI * 1.5 - 0.78); g.stroke()
    g.beginPath(); g.moveTo(cx, cy - r * 1.15); g.lineTo(cx, cy - r * 0.05); g.stroke()
  }
  return c
}

// desfoque de caixa de raio r, numa direção (passo 1: linhas; passo W: colunas), com soma corrida
function caixa(de, para, n, linhas, passo, salto, r) {
  const k = 1 / (2 * r + 1)
  for (let l = 0; l < linhas; l++) {
    const o = l * salto
    let s = 0
    for (let i = -r; i <= r; i++) s += de[o + Math.min(n - 1, Math.max(0, i)) * passo]
    for (let i = 0; i < n; i++) {
      para[o + i * passo] = s * k
      s += de[o + Math.min(n - 1, i + r + 1) * passo] - de[o + Math.max(0, i - r) * passo]
    }
  }
}
// o retângulo de cada bomba na máscara (medido uma vez): só ali há o que desfocar
export function caixasDe(m) {
  if (m.__caixas) return m.__caixas
  const W = m.width, H = m.height, cx = {}
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const id = m.data[(y * W + x) * 4]; if (!id) continue
    const c = cx[id] || (cx[id] = [x, y, x, y]); if (x < c[0]) c[0] = x; if (y < c[1]) c[1] = y; if (x > c[2]) c[2] = x; if (y > c[3]) c[3] = y
  }
  return (m.__caixas = cx)
}
// o brilho em volta das luzes das bombas `ids` (números de estados.png, 1 = a primeira), de 0 a 1, numa grade `passo`
// vezes menor que a máscara ({ d, w, h }): três passadas de caixa de raio r (quase uma gaussiana), vezes `ganho` (as
// luzes são finas: desfocadas, ficam fracas). (4/11) Só no retângulo das bombas pedidas e na grade menor (o brilho é
// desfocado, não perde nada): num celular médio, ligar a falha travava a tela ~0,4 s com a imagem inteira
export function brilhoLuzes(m, ids, r = 6, ganho = 2.6, passo = 2) {
  const W = m.width, H = m.height, w = Math.ceil(W / passo), h = Math.ceil(H / passo), cx = caixasDe(m)
  const rr = Math.max(1, Math.round(r / passo)), mg = 3 * rr + 2
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (const id of ids) { const c = cx[id]; if (!c) continue; x0 = Math.min(x0, (c[0] / passo) | 0); y0 = Math.min(y0, (c[1] / passo) | 0); x1 = Math.max(x1, (c[2] / passo) | 0); y1 = Math.max(y1, (c[3] / passo) | 0) }
  if (x1 < 0) return null
  x0 = Math.max(0, x0 - mg); y0 = Math.max(0, y0 - mg); x1 = Math.min(w - 1, x1 + mg); y1 = Math.min(h - 1, y1 + mg)
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, a = new Float32Array(bw * bh), b = new Float32Array(bw * bh)
  // o maior "aceso" de cada bloco passo × passo (as luzes finas não somem ao reduzir)
  let algum = false
  for (let y = y0 * passo; y < Math.min(H, (y1 + 1) * passo); y++) for (let x = x0 * passo; x < Math.min(W, (x1 + 1) * passo); x++) {
    const p = (y * W + x) * 4, id = m.data[p]; if (!id || !ids.has(id)) continue
    const v = m.data[p + 1] / 255, q = (((y / passo) | 0) - y0) * bw + (((x / passo) | 0) - x0); if (v > a[q]) { a[q] = v; algum = true }
  }
  if (!algum) return null
  for (let k = 0; k < 3; k++) { caixa(a, b, bw, bh, 1, bw, rr); caixa(b, a, bh, bw, bw, 1, rr) }
  const d = new Float32Array(w * h)
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) d[(y + y0) * w + x + x0] = Math.min(1, a[y * bw + x] * ganho)
  return { d, w, h }
}

// os pixels de uma imagem (a máscara estados.png), sem mexer nas cores
export function pixelsDe(im) {
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0)
  return g.getImageData(0, 0, c.width, c.height)
}
