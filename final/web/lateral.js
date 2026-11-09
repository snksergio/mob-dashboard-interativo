// Vagas paralelas ("bomba lateral", passo 2, 9/11): o montador no navegador. Monta um horário de uma vista com as
// peças de Lego do modelo (lego-lateral/<vista>-<horário>/, cortadas por ferramentas/lateral-lego.mjs) e devolve as
// camadas em luz linear pré-multiplicada, como o montarLego da V3 (o Worker faz o brilho, a cor e o webp).
//
// A diferença para a V3: o posto pode ser bem maior que um quadro inteiro (8 ilhas passam de 15 mil px de largura), então
// a montagem já sai na resolução final (até `max` px de largura). Cada peça entra reduzida por média de área (ou
// ampliada, as sombras e luzes guardadas em meia resolução) e amostrada com bilinear no lugar dela; o deslocamento de
// uma peça continua inteiro na grade cheia, e a conta de "a que célula o pixel pertence" é feita no centro do pixel final.
//
// Ordem, a mesma validada contra o render inteiro (ferramentas/lateral-lego.mjs montar):
//   1. o chão, célula por célula (cada pixel da célula do ponto do chão que ele enxerga), com a cor do chão ao lado;
//   2. as sombras (multiplicam: longe x perto) dos trechos do teto e das peças de pé;
//   3. as luzes: a luz pura da peça (irradiância) vezes a cor do chão do posto montado;
//   4. as peças de pé, da mais funda para a mais próxima (e, à noite, a máscara das bombas para falha e desligada);
//   5. o teto, numa camada à parte: os trechos do mais fundo para o mais próximo, a árvore e o totem por cima do teto
//      que fica atrás deles, o letreiro por último.
import { cam, plano, altasDo, celulas } from './lateral-plano.js'

const LIN = new Float32Array(256), DEC = new Float32Array(256)   // byte sRGB -> linear (LIN x2: a luz guardada pela metade)
for (let i = 0; i < 256; i++) { const v = i / 255, l = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; LIN[i] = 2 * l; DEC[i] = l }
const MULT = () => {}                                             // o "f" das sombras: multiplica o fundo direto, no laço

// o quadro do posto na grade cheia (a caixa das peças do chão, das peças de pé e do teto no lugar delas, com 16 px de
// folga) e a escala para caber em `max`
export function quadroLateral(L, layout, max = 3600) {
  const C = cam(L), M = L.medidas, pl = plano(layout, M)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const poe = (q, dx, dy) => { if (!q) return; const [DX, DY] = C.px(dx, dy), e = q.escala || 1; x0 = Math.min(x0, q.gx0 + DX); y0 = Math.min(y0, q.gy0 + DY); x1 = Math.max(x1, q.gx0 + DX + q.w * e); y1 = Math.max(y1, q.gy0 + DY + q.h * e) }
  for (const c of celulas(pl, M)) { const p = L.chao[c.tipo]; if (p) poe(p, c.ax - p.anc[0], c.ay - p.anc[1]) }
  for (const t of pl.trechos) { const p = L.trechos[t.chave]; if (p) poe(p.spr, t.a - p.anc[0], t.y - p.anc[1]) }
  for (const a of altasDo(pl)) { const p = L.props[a.chave]; if (p) poe(p.spr, a.anc[0] - p.anc[0], a.anc[1] - p.anc[1]) }
  const gx0 = Math.floor(x0) - 16, gy0 = Math.floor(y0) - 16, Wf = Math.ceil(x1) + 16 - gx0, Hf = Math.ceil(y1) + 16 - gy0
  const s = Math.min(1, max / Wf)
  return { gx0, gy0, Wf, Hf, s, W: Math.max(1, Math.round(Wf * s)), H: Math.max(1, Math.round(Hf * s)) }
}

// redução por média de área com fator f < 1 (em cada eixo), num buffer de ch canais
function reduz(d, w, h, ch, f) {
  const w2 = Math.max(1, Math.ceil(w * f)), h2 = Math.max(1, Math.ceil(h * f))
  // (9/11) os pesos em listas planas (antes, um par [início, pesos] por pixel): as mesmas contas, na mesma ordem
  const pesos = (n, n2) => {
    const ini = new Int32Array(n2), off = new Int32Array(n2 + 1), todos = []
    for (let i = 0; i < n2; i++) {
      const a = i / f, b = Math.min(n, (i + 1) / f), i0 = Math.floor(a), i1 = Math.min(n, Math.ceil(b)), p = []
      let t = 0; for (let k = i0; k < i1; k++) { const v = Math.min(b, k + 1) - Math.max(a, k); p.push(v); t += v }
      ini[i] = i0; for (const v of p) todos.push(v / (t || 1)); off[i + 1] = todos.length
    }
    return { ini, off, P: Float64Array.from(todos) }
  }
  const px = pesos(w, w2), py = pesos(h, h2), tmp = new Float32Array(w2 * h * ch), out = new Float32Array(w2 * h2 * ch)
  const xI = px.ini, xO = px.off, xP = px.P, yI = py.ini, yO = py.off, yP = py.P
  for (let y = 0; y < h; y++) {
    const ly = y * w
    for (let x = 0; x < w2; x++) {
      const k0 = xO[x], k1 = xO[x + 1], o = (y * w2 + x) * ch
      for (let k = k0, i = (ly + xI[x]) * ch; k < k1; k++, i += ch) { const pk = xP[k]; for (let c = 0; c < ch; c++) tmp[o + c] += d[i + c] * pk }
    }
  }
  for (let y = 0; y < h2; y++) {
    const k0 = yO[y], k1 = yO[y + 1], ly0 = yI[y] * w2
    for (let x = 0; x < w2; x++) {
      const o = (y * w2 + x) * ch
      for (let k = k0, i = (ly0 + x) * ch; k < k1; k++, i += w2 * ch) { const pk = yP[k]; for (let c = 0; c < ch; c++) out[o + c] += tmp[i + c] * pk }
    }
  }
  return { w: w2, h: h2, d: out }
}

// quadro: o mesmo para todos os horários de uma vista (o painel cruza as camadas de dois horários pixel a pixel)
export async function montarLateral(L, layout, ler, { max = 3600, mascara: comMascara = false, quadro = null } = {}) {
  const C = cam(L), M = L.medidas, pl = plano(layout, M), cels = celulas(pl, M), Q = quadro || quadroLateral(L, layout, max)
  const { W, H, s } = Q, N = W * H, faltas = new Set()
  // ---------------------------------------------------------------- peças preparadas (na escala da montagem)
  // tipo: 'cor' (luz linear pré-multiplicada + alfa), 'razao' (sombra; transparente = 1), 'irr' (luz pura, x k)
  const prontas = new Map()
  const prepara = (q, tipo) => {
    const chave = q.arq + '|' + tipo
    if (!prontas.has(chave)) prontas.set(chave, ler(q.arq).then((im) => {
      const e = q.escala || 1, f = s * e, ch = tipo === 'cor' ? 4 : 3, n = im.w * im.h, d = new Float32Array(n * ch), b = im.d
      // (9/11) um laço por tipo (antes o tipo era testado a cada pixel); as mesmas contas
      if (tipo === 'cor') for (let i = 0, j = 0, o = 0; i < n; i++, j += 4, o += 4) { const a = b[j + 3] / 255; d[o] = LIN[b[j]] * a; d[o + 1] = LIN[b[j + 1]] * a; d[o + 2] = LIN[b[j + 2]] * a; d[o + 3] = a }
      else if (tipo === 'razao') for (let i = 0, j = 0, o = 0; i < n; i++, j += 4, o += 3) { if (b[j + 3]) { d[o] = LIN[b[j]]; d[o + 1] = LIN[b[j + 1]]; d[o + 2] = LIN[b[j + 2]] } else d[o] = d[o + 1] = d[o + 2] = 1 }
      else { const k = q.k || 1; for (let i = 0, j = 0, o = 0; i < n; i++, j += 4, o += 3) { const a = b[j + 3] / 255; d[o] = DEC[b[j]] * k * a; d[o + 1] = DEC[b[j + 1]] * k * a; d[o + 2] = DEC[b[j + 2]] * k * a } }
      const r = f < 0.999 ? { ...reduz(d, im.w, im.h, ch, f), ch, fp: f, e } : { w: im.w, h: im.h, d, ch, fp: 1, e }
      r.vivo = vivos(r.d, r.w, r.h, ch, tipo === 'razao' ? 1 : 0)
      return r
    }))
    return prontas.get(chave)
  }
  // (9/11) em cada linha da peça preparada, da primeira à última coluna que não é exatamente neutra (sombra: 1 nos três
  // canais; cor e luz: 0 em todos). Fora disso a peça não muda nada (multiplicar por 1, somar 0, alfa 0) e o pixel é
  // pulado: o resultado é o mesmo, bit a bit, e a montagem fica bem mais rápida (sombras e luzes são quase vazias)
  function vivos(d, w, h, ch, neutro) {
    const x0 = new Int32Array(h).fill(w), x1 = new Int32Array(h).fill(-1)
    for (let y = 0; y < h; y++) {
      const o = y * w * ch
      let a = 0; while (a < w) { let k = o + a * ch, c = 0; for (; c < ch; c++) if (d[k + c] !== neutro) break; if (c < ch) break; a++ }
      if (a === w) continue
      let b = w - 1; while (b > a) { let k = o + b * ch, c = 0; for (; c < ch; c++) if (d[k + c] !== neutro) break; if (c < ch) break; b-- }
      x0[y] = a; x1[y] = b
    }
    return { x0, x1 }
  }
  // percorre os pixels finais que uma peça cobre, deslocada (dx, dy no chão), com a amostra bilinear dela:
  // f(i, v, X, Y), v = os ch valores no pixel (reaproveitado). (9/11) A amostra em x de cada coluna é calculada uma vez
  // (a mesma conta de antes) e os pixels cujas quatro amostras caem fora das colunas vivas das duas linhas são pulados
  async function cada(q, tipo, dx, dy, f) {
    const p = await prepara(q, tipo), [DX, DY] = C.px(dx, dy), ox = q.gx0 + DX - Q.gx0, oy = q.gy0 + DY - Q.gy0
    const e = p.e, fp = p.fp, ch = p.ch, d = p.d, w = p.w, h = p.h, v = new Float32Array(ch), V0 = p.vivo.x0, V1 = p.vivo.x1
    const X0 = Math.max(0, Math.floor(ox * s)), X1 = Math.min(W, Math.ceil((ox + q.w * e) * s)), Y0 = Math.max(0, Math.floor(oy * s)), Y1 = Math.min(H, Math.ceil((oy + q.h * e) * s))
    const nX = X1 - X0; if (nX <= 0 || Y1 <= Y0) return
    const XA = new Int32Array(nX).fill(-1), XB = new Int32Array(nX), TX = new Float64Array(nX)
    for (let k = 0; k < nX; k++) {
      const px = (((X0 + k + 0.5) / s - ox) / e) * fp - 0.5; if (px < -0.5 || px > w - 0.5) continue
      const fx = Math.min(w - 1, Math.max(0, px)), xa = fx | 0; XA[k] = xa; XB[k] = Math.min(w - 1, xa + 1); TX[k] = fx - xa
    }
    for (let Y = Y0; Y < Y1; Y++) {
      const py = (((Y + 0.5) / s - oy) / e) * fp - 0.5; if (py < -0.5 || py > h - 0.5) continue
      const fy = Math.min(h - 1, Math.max(0, py)), ya = fy | 0, yb = Math.min(h - 1, ya + 1), ty = fy - ya
      const c0 = Math.min(V0[ya], V0[yb]), c1 = Math.max(V1[ya], V1[yb]); if (c1 < c0) continue
      const lA = ya * w, lB = yb * w, base = Y * W + X0
      // a sombra (multiplica o fundo), sem chamar f a cada pixel: a mesma conta (a amostra arredondada para 32 bits, como
      // quando passava pelo v, e o produto guardado no fundo)
      if (f === MULT) {
        const ty1 = 1 - ty, B = fundo
        for (let k = 0; k < nX; k++) {
          const xa = XA[k]; if (xa < 0) continue
          const xb = XB[k]; if (xb < c0 || xa > c1) continue
          const tx = TX[k], tx1 = 1 - tx, a00 = (lA + xa) * 3, a01 = (lA + xb) * 3, a10 = (lB + xa) * 3, a11 = (lB + xb) * 3, o = (base + k) * 4
          B[o] *= Math.fround((d[a00] * tx1 + d[a01] * tx) * ty1 + (d[a10] * tx1 + d[a11] * tx) * ty)
          B[o + 1] *= Math.fround((d[a00 + 1] * tx1 + d[a01 + 1] * tx) * ty1 + (d[a10 + 1] * tx1 + d[a11 + 1] * tx) * ty)
          B[o + 2] *= Math.fround((d[a00 + 2] * tx1 + d[a01 + 2] * tx) * ty1 + (d[a10 + 2] * tx1 + d[a11 + 2] * tx) * ty)
        }
        continue
      }
      for (let k = 0; k < nX; k++) {
        const xa = XA[k]; if (xa < 0) continue
        const xb = XB[k]; if (xb < c0 || xa > c1) continue
        const tx = TX[k], a00 = (lA + xa) * ch, a01 = (lA + xb) * ch, a10 = (lB + xa) * ch, a11 = (lB + xb) * ch
        for (let c = 0; c < ch; c++) v[c] = (d[a00 + c] * (1 - tx) + d[a01 + c] * tx) * (1 - ty) + (d[a10 + c] * (1 - tx) + d[a11 + c] * tx) * ty
        f(base + k, v, X0 + k, Y)
      }
    }
  }
  // o ponto do plano z visto no centro de um pixel final (linear em X e Y)
  const plano_ = (z) => {
    const g = (X, Y) => C.chao(Q.gx0 + (X + 0.5) / s - 0.5, Q.gy0 + (Y + 0.5) / s - 0.5, z), p0 = g(0, 0), pX = g(1, 0), pY = g(0, 1)
    return { x0: p0[0], y0: p0[1], xX: pX[0] - p0[0], yX: pX[1] - p0[1], xY: pY[0] - p0[0], yY: pY[1] - p0[1] }
  }
  const PZ = plano_(L.Z)
  // baixa tudo o que o posto usa antes (em paralelo)
  const usadas = []
  for (const c of cels) { const p = L.chao[c.tipo]; if (p) { usadas.push(prepara(p, 'cor')); if (L.albedo?.[c.tipo]) usadas.push(prepara(L.albedo[c.tipo], 'cor')) } else faltas.add('chão ' + c.tipo) }
  const trechos = pl.trechos.map((t) => { const p = L.trechos[t.chave]; return { ...t, p, d: p ? [t.a - p.anc[0], t.y - p.anc[1]] : null } })
  const altas = altasDo(pl).map((a) => { const p = L.props[a.chave]; return { ...a, p, d: p ? [a.anc[0] - p.anc[0], a.anc[1] - p.anc[1]] : null } })
  for (const t of [...trechos, ...altas]) {
    if (!t.p) { faltas.add(t.chave); continue }
    if (t.p.sombraLonge) usadas.push(prepara(t.p.sombraLonge, 'razao')); if (t.p.sombra) usadas.push(prepara(t.p.sombra, 'razao'))
    if (t.p.luz) usadas.push(prepara(t.p.luz, t.p.luz.irr ? 'irr' : 'cor')); if (t.p.spr) usadas.push(prepara(t.p.spr, 'cor'))
  }
  await Promise.all(usadas)

  const fundo = new Float32Array(N * 4), FA = new Float32Array(N * 3), dono = new Int32Array(N)   // dono: a célula de cada pixel
  // 1. o chão
  for (let ci = 0; ci < cels.length; ci++) {
    const c = cels[ci], p = L.chao[c.tipo]; if (!p) continue
    const pa = L.albedo?.[c.tipo], [r0, r1, r2, r3] = c.r, dx = c.ax - p.anc[0], dy = c.ay - p.anc[1]
    await cada(p, 'cor', dx, dy, (i, v, X, Y) => {
      if (!v[3]) return
      const u = Math.round((PZ.x0 + PZ.xX * X + PZ.xY * Y - c.ax) * 1e4) / 1e4, w = Math.round((PZ.y0 + PZ.yX * X + PZ.yY * Y - c.ay) * 1e4) / 1e4
      if (u < r0 || u >= r1 || w < r2 || w >= r3) return
      const o = i * 4; fundo[o] = v[0]; fundo[o + 1] = v[1]; fundo[o + 2] = v[2]; fundo[o + 3] = v[3]; dono[i] = ci + 1
    })
    if (pa) await cada(pa, 'cor', dx, dy, (i, v) => { if (dono[i] !== ci + 1 || !v[3]) return; const o = i * 3; FA[o] = v[0] / v[3]; FA[o + 1] = v[1] / v[3]; FA[o + 2] = v[2] / v[3] })
  }
  const comPeca = [...trechos, ...altas].filter((t) => t.p)
  // 2. as sombras
  for (const t of comPeca) for (const q of [t.p.sombraLonge, t.p.sombra]) if (q) await cada(q, 'razao', ...t.d, MULT)
  // 3. as luzes
  for (const t of comPeca) {
    const q = t.p.luz; if (!q) continue
    if (q.irr) await cada(q, 'irr', ...t.d, (i, v) => { const o = i * 4; if (fundo[o + 3] < 0.98) return; const a = i * 3; fundo[o] += v[0] * FA[a]; fundo[o + 1] += v[1] * FA[a + 1]; fundo[o + 2] += v[2] * FA[a + 2] })
    else await cada(q, 'cor', ...t.d, (i, v) => { const o = i * 4; fundo[o] += v[0]; fundo[o + 1] += v[1]; fundo[o + 2] += v[2] })
  }
  // 4. as peças de pé, da mais funda para a mais próxima (e a máscara das bombas: o número de cada uma e o quanto ali é
  // luz acesa, como o montarLego da V3)
  const mascara = comMascara ? new Uint8Array(N) : null, aceso = comMascara ? new Uint8Array(N) : null
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
  const prof = (t) => t.p.prof + C.prof(...t.d)
  const sobre = (B, so) => (i, v) => {
    const a = v[3]; if (a <= 0) return
    const o = i * 4; if (so && !B[o + 3]) return
    const k = 1 - a; B[o] = B[o] * k + v[0]; B[o + 1] = B[o + 1] * k + v[1]; B[o + 2] = B[o + 2] * k + v[2]; B[o + 3] = B[o + 3] * k + a
  }
  for (const t of altas.filter((t) => t.p?.spr).sort((a, b) => prof(b) - prof(a))) {
    const bomba = t.chave.startsWith('bomba/'), poe = sobre(fundo)
    await cada(t.p.spr, 'cor', ...t.d, (i, v) => {
      poe(i, v)
      if (!mascara || v[3] <= 0.5) return
      if (!bomba) { mascara[i] = 0; aceso[i] = 0; return }
      mascara[i] = t.n + 1
      const r = v[0] / v[3] / 2, g = v[1] / v[3] / 2, b = v[2] / v[3] / 2, lv = 0.2126 * r + 0.7152 * g + 0.0722 * b
      aceso[i] = Math.round(255 * sm(0.03, 0.15, g - Math.max(r, b)) * sm(0.04, 0.2, lv))
    })
  }
  // 5. o teto
  const teto = new Float32Array(N * 4), naFrente = (t) => t.chave === 'arvore' || t.chave === 'totem'
  for (const t of [...trechos.filter((t) => t.p?.spr), ...altas.filter((t) => t.p?.spr && naFrente(t))].sort((a, b) => prof(b) - prof(a))) await cada(t.p.spr, 'cor', ...t.d, sobre(teto, naFrente(t)))
  const letr = altas.find((t) => t.chave === 'letreiro' && t.p?.spr); if (letr) await cada(letr.p.spr, 'cor', ...letr.d, sobre(teto))
  prontas.clear()
  return { fundo, teto, mascara, aceso, quadro: Q, faltas: [...faltas], bombas: pl.ilhas.flatMap((il) => il.bombas.map((b) => ({ n: b.n, ilha: il.i, j: b.j, modelo: b.modelo }))) }
}
