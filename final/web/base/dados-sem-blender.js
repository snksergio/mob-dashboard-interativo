// iGreen · maquete por peças: os arquivos de dados da maquete (âncoras, luzes de cada horário, pistolas e cabos,
// projeção da 2D) sem abrir o Blender, a partir da montagem. Roda no navegador ou no Node (não lê disco).
//
// As posições saem das mesmas regras da v14 e do pecas.py: a fileira é centrada em x = 0, cada vaga anda 2,7 m, a bomba
// fica no meio das suas vagas, a cobertura passa 0,6 m da ponta (0,4 m ao lado de uma vaga sem cobertura). O que é medida
// de peça vem dos moldes (moldes/, um posto com todos os modelos que passou uma vez pelo Blender, rodar-moldes.sh):
// as caixas de cada bomba, os nomes e as posições das pistolas e cabos, as luzes de cada horário e a panorâmica.
// Ilha (28/10): a fileira dos fundos é a da frente construída no estilo da frente em xb(x) = 2·CX − x e girada 180° em
// volta de (CX, Y_MID), como na v14; as âncoras dela ficam nesse estilo da frente (o painel gira), o resto no mundo.
// Os pilares das duas metades da cobertura ficam no eixo do meio, um só onde dois cairiam a menos de 30 cm (pecas.py).

export const HORARIOS = ['tarde', 'manha', 'por', 'noite']
const BAY_W = 2.6, BAY_D = 5.0, PASSO = BAY_W + 0.1, Z = 0.14, FX_H = 0.15, AP_Y0 = -1.8, RAMPA_L = 1.0, CAN_H = 3.5, RH = 0.3
const Y_BOCA = 0, Y_CAB = BAY_D, FX_Y0 = Y_CAB + 0.05, Y_MID = Y_CAB + 1.4
const CANT_Y0 = Y_CAB + 1.1, CH_Y = Y_CAB + 0.55, MARG_E = 1.9, MARG_D = 2.2, PXM = 180.48, PXM_PLANTA = 140
const TIPOS2 = { fast: ['ac', 'dc'], ultra: ['dc_e', 'dc_d'], mobi: ['ac', 'ac_b'] }, TIPO1 = { fast: 'dc', ultra: 'dc_e', mobi: 'ac' }
const ZC = Z + FX_H

// ---------------------------------------------------------------- vagas, bombas, coberturas (maquete_v14.py e pecas.py)
export function layout(m) {
  const ilha = !!(m.ilha && (m.fileiras.fundos || []).length)
  // a bomba é coberta se ela diz (`coberta`, desde 29/10); se não, a regra de antes: a cobertura do posto, menos o Mobi
  const cob = (b) => (b.coberta !== undefined ? !!b.coberta : m.cobertura !== false && b.modelo !== 'mobi')
  const filF = (m.fileiras.frente || []).map((b) => ({ modelo: b.modelo, nv: Number(b.vagas), coberta: cob(b) }))
  const filT = ilha ? m.fileiras.fundos.map((b) => ({ modelo: b.modelo, nv: Number(b.vagas), coberta: cob(b) })) : []
  const fil = [...filF, ...filT], FIL = fil.map((_, bi) => (bi < filF.length ? 'frente' : 'fundos'))   // índice global: frente, depois fundos
  const bombas = fil.map((b) => b.modelo)
  const larg = (l) => { const n = l.reduce((a, b) => a + b.nv, 0); return n ? n * PASSO - 0.1 : 0 }
  const LARG = Math.max(larg(filF), larg(filT)), X_ESQ = -LARG / 2, X_DIR = X_ESQ + LARG
  const vagas = [], vesq = [], vfil = []
  for (const f of ['frente', 'fundos']) {        // as duas fileiras começam no mesmo x
    let k = 0
    fil.forEach((b, bi) => { if (FIL[bi] !== f) return; for (const t of b.nv === 2 ? TIPOS2[b.modelo] : [TIPO1[b.modelo]]) { vagas.push([bi, t]); vfil.push(f); vesq.push(X_ESQ + k++ * PASSO) } })
  }
  const N = vagas.length, bayX = (i) => vesq[i] + BAY_W / 2
  const vagasDa = (bi) => vagas.flatMap(([b], i) => (b === bi ? [i] : []))
  const bombaX = fil.map((_, bi) => { const vs = vagasDa(bi); return (vesq[vs[0]] + vesq[vs[vs.length - 1]] + BAY_W) / 2 })
  const X0 = X_ESQ - MARG_E, X1 = X_DIR + MARG_D, CX = (X0 + X1) / 2, B0 = X_ESQ - 0.05, BK = (k) => B0 + k * PASSO
  const xb = (x, f) => (f === 'frente' ? x : 2 * CX - x)
  // por fileira: as vagas (índices globais), a cobertura e a bomba de cada uma, e os trechos cobertos
  const IDX = { frente: [], fundos: [] }; vfil.forEach((f, i) => IDX[f].push(i))
  const cobR = {}, bombaR = {}, segsR = {}
  for (const f of ['frente', 'fundos']) {
    cobR[f] = IDX[f].map((i) => fil[vagas[i][0]].coberta); bombaR[f] = IDX[f].map((i) => vagas[i][0]); segsR[f] = []
    for (let i = 0; i < cobR[f].length;) { if (!cobR[f][i]) { i++; continue } let j = i; while (j + 1 < cobR[f].length && cobR[f][j + 1]) j++; segsR[f].push([i, j]); i = j + 1 }
  }
  const rx = (f) => { const vs = IDX[f]; return vs.length ? [vesq[vs[0]] - 0.35, vesq[vs[vs.length - 1]] + BAY_W + 0.35] : [X_ESQ - 0.35, X_ESQ + BAY_W + 0.35] }
  const FX_Y1 = ilha ? 2 * Y_MID - FX_Y0 : Y_CAB + 2.05
  return { ilha, fil, FIL, bombas, vagas, vesq, vfil, N, bayX, vagasDa, bombaX, X_ESQ, X_DIR, X0, X1, CX, B0, BK, xb, IDX, cobR, bombaR, segsR,
    cobU: cobR.frente, segs: segsR.frente, nuR: { frente: IDX.frente.length, fundos: IDX.fundos.length }, rx, FX_Y1,
    RX0: rx('frente')[0], RX1: rx('frente')[1], LAJE: { x0: X0, x1: X1, y0: AP_Y0 - 0.12, y1: ilha ? 2 * Y_MID - (AP_Y0 - 0.12) : FX_Y1 + 0.3 } }
}
// o que é construído no estilo da frente em p e girado 180° em volta de (CX, Y_MID) vai para gira(p)
const gira = (L, p) => [2 * L.CX - p[0], 2 * Y_MID - p[1], p[2]]
const giraCaixa = (L, min, max) => { const a = gira(L, min), b = gira(L, max); return [[Math.min(a[0], b[0]), Math.min(a[1], b[1]), min[2]], [Math.max(a[0], b[0]), Math.max(a[1], b[1]), max[2]]] }
// floreira de canto (maquete_v14.floreira_canto): encostada na laje, na frente
function floreira(L, lado, w, d) {
  const xa = L.LAJE.x0 + 0.12, xb = L.LAJE.x1 - 0.12, m = 0.15
  const [x0, x1] = lado < 0 ? [xa + m, xa + m + w] : [xb - m - w, xb - m]
  return { x0, x1, y0: AP_Y0 + m, y1: AP_Y0 + m + d, zt: Z + 0.4 - 0.03 }
}
// cobertura de um trecho da fileira f (pecas.build_cobertura_mod): i0..i1 são vagas da fileira; x0/x1 no mundo e, na
// ilha, até o eixo do meio, com os pilares nele
function cobertura(L, i0, i1, f = 'frente') {
  const me = i0 === 0 ? 0.6 : 0.4, md = i1 === L.nuR[f] - 1 ? 0.6 : 0.4
  const x0 = L.BK(i0) + 0.05 - me, x1 = L.BK(i1 + 1) - 0.05 + md, y0 = Y_BOCA + 0.25, y1 = L.ilha ? Y_MID : Y_CAB + 0.9, zr = Z + CAN_H
  const divs = []
  for (let i = i0 + 1; i <= i1; i++) if (L.bombaR[f][i] !== L.bombaR[f][i - 1]) divs.push(i)
  return { x0, x1, y0, y1, cy: (y0 + y1) / 2, zr, yp: L.ilha ? Y_MID : Y_CAB + 0.45, ztopo: zr + RH - 0.02, divs }
}
// os pilares de todas as coberturas, na ordem do pecas.py (frente, depois fundos; em cada trecho o da esquerda, o da
// direita e os das divisas), sem o que cairia a menos de 30 cm de outro na ilha: nome e x do mundo
function pilares(L) {
  const out = []
  for (const [f, sig] of [['frente', 'f'], ['fundos', 't']]) L.segsR[f].forEach(([i0, i1], k) => {
    const c = cobertura(L, i0, i1, f), nome = `cobertura_${sig}${k}`
    for (const [n, x] of [[nome + '_pilar0', c.x0 + 0.35], [nome + '_pilar1', c.x1 - 0.35], ...c.divs.map((i) => [`${nome}_pilar_d${i}`, L.BK(i)])]) {
      if (L.ilha && out.some((p) => Math.abs(p.x - x) < 0.3)) continue
      out.push({ nome: n, x, c })
    }
  })
  return out
}

// ---------------------------------------------------------------- moldes: o que é medida de peça, tirado do posto-molde
// moldes = { ancoras, luzes: { <horário>: luzes-<horário>.json }, planta: planta.json, glb: ArrayBuffer }
export function prepararMoldes(mo) {
  const L = layout(mo.ancoras.posto.fileiras && { cobertura: mo.ancoras.posto.cobertura, ilha: false, fileiras: mo.ancoras.posto.fileiras })
  const chave = (bi) => `${L.bombas[bi]}${L.fil[bi].nv}`
  const bomba = {}
  L.fil.forEach((b, bi) => {
    const k = chave(bi); if (bomba[k]) return
    const x = L.bombaX[bi], pre = `bomba${bi}`
    const caixas = mo.ancoras.oclusores.filter((o) => o.nome.startsWith(pre + '_')).map((o) => ({ suf: o.nome.slice(pre.length), min: [o.min[0] - x, o.min[1], o.min[2]], max: [o.max[0] - x, o.max[1], o.max[2]] }))
    const nb = `${b.modelo}${bi}`, tipos = b.modelo !== 'mobi' ? TIPOS2[b.modelo] : ['ac']
    const pecas = {}
    mo.ancoras.conectores.filter((c) => c.bomba === bi).forEach((c, j) => { pecas[tipos[j]] = c.pecas.map((n) => { if (!n.startsWith(nb + '_')) throw new Error(`peça fora do padrão: ${n}`); return n.slice(nb.length) }) })
    if (b.modelo === 'mobi') pecas.ac_b = pecas.ac
    const topo = mo.ancoras.bombas[bi].topo[2]
    bomba[k] = { bi, x, nb, caixas, pecas, topo }
  })
  // as luzes de cada horário: as propriedades de cada tipo (as posições saem das regras); a da árvore anda com X0. Só os
  // horários que vieram (a V1 do navegador traz só a tarde e a noite)
  const luz = {}
  for (const per of HORARIOS) {
    if (!mo.luzes[per]) continue
    const lz = mo.luzes[per], porTipo = {}
    for (const l of lz.luzes) { const t = l.nome.replace(/\d+$/, ''); if (!porTipo[t]) porTipo[t] = l }
    luz[per] = { lz, porTipo }
  }
  const arv = (luz.noite.porTipo.arvore || {}).pos
  return { L, bomba, luz, arvore: arv ? [arv[0] - L.X0, arv[1], arv[2]] : null, cameraR: mo.ancoras.camera.matriz.slice(0, 3).map((r) => r.slice(0, 3)),
    planta: mo.planta, glb: mo.glb }
}

// ---------------------------------------------------------------- âncoras (o ancoras.json do painel)
export function ancoras(m, MO, quadro) {
  const L = layout(m), oclusores = []
  const molde = (bi) => { const k = `${L.bombas[bi]}${L.fil[bi].nv}`; if (!MO.bomba[k]) throw new Error(`o molde não tem a bomba ${k}`); return MO.bomba[k] }
  const caixa = (nome, cilindro, min, max) => oclusores.push({ nome, cilindro, min, max })
  const frade = (nome, x, y, z) => caixa(nome, true, [x - 0.075, y - 0.075, z], [x + 0.075, y + 0.075, z + 0.82])
  const box = (nome, sx, sy, sz, x, y, z) => caixa(nome, false, [x - sx / 2, y - sy / 2, z], [x + sx / 2, y + sy / 2, z + sz])
  // frente: floreira à esquerda, totem na floreira da direita, os frades da rampa
  const fe = floreira(L, -1, 1.2, 1.25), ft = floreira(L, 1, 1.5, 1.3)
  caixa('floreira_esq', false, [fe.x0, fe.y0, Z], [fe.x1, fe.y1, Z + 0.4])
  caixa('floreira_totem', false, [ft.x0, ft.y0, Z], [ft.x1, ft.y1, Z + 0.4])
  const tx = (ft.x0 + ft.x1) / 2 + 0.05, ty = ft.y1 - 0.42
  box('totem_plinto', 1.16, 0.56, 0.14, tx, ty, ft.zt)
  box('totem_corpo', 0.92, 0.34, 3.0, tx, ty, ft.zt + 0.14)
  frade('frade_esq', L.RX0 + 0.12, AP_Y0 + RAMPA_L + 0.35, Z)
  frade('frade_dir', L.RX1 - 0.12, AP_Y0 + RAMPA_L + 0.35, Z)
  if (L.ilha) {        // nos fundos: a mesma floreira de canto e os frades da rampa de trás, girados
    const [a, b] = giraCaixa(L, [fe.x0, fe.y0, Z], [fe.x1, fe.y1, Z + 0.4]); caixa('floreira_tras', false, a, b)
    const [b0, b1] = L.rx('fundos'), yf = AP_Y0 + RAMPA_L + 0.35
    frade('frade_tras_e', b1 - 0.12, 2 * Y_MID - yf, Z); frade('frade_tras_d', b0 + 0.12, 2 * Y_MID - yf, Z)
  }
  // coberturas: os pilares (base e coluna) das pontas e das divisas entre bombas
  for (const { nome, x, c } of pilares(L)) { box(nome + '_base', 0.62, 0.62, 0.3, x, c.yp, ZC); box(nome, 0.24, 0.24, c.ztopo - (ZC + 0.3), x, c.yp, ZC + 0.3) }
  // bombas: as caixas do molde levadas para o x de cada uma, e os frades dos lados (as dos fundos, giradas)
  const bombas = L.fil.map((b, bi) => {
    const mo = molde(bi), x = L.bombaX[bi], tras = L.FIL[bi] === 'fundos', xc = L.xb(x, L.FIL[bi])
    const poe = (nome, cil, min, max) => { if (!tras) return caixa(nome, cil, min, max); const [a, z] = giraCaixa(L, min, max); caixa(nome, cil, a, z) }
    for (const c of mo.caixas) poe(`bomba${bi}${c.suf}`, false, [c.min[0] + xc, c.min[1], c.min[2]], [c.max[0] + xc, c.max[1], c.max[2]])
    for (const s of [-1, 1]) { const fx = xc + s * 0.86, fy = Y_CAB + 0.24; poe(`frade_bomba${bi}_${s + 1}`, true, [fx - 0.075, fy - 0.075, ZC], [fx + 0.075, fy + 0.075, ZC + 0.82]) }
    const y = tras ? 2 * Y_MID - CH_Y : CH_Y
    return { modelo: b.modelo, x, y, topo: [x + 0.15, y, mo.topo], base: [x, y, ZC], vagas: L.vagasDa(bi), fileira: L.FIL[bi], vagasN: b.nv }
  })
  const saida = (bi, t) => {     // no estilo da frente (na fileira dos fundos, em xb), como o painel lê
    const mdl = L.bombas[bi], x = L.xb(L.bombaX[bi], L.FIL[bi])
    if (mdl === 'fast') { const xx = x - 0.02, zb = ZC + 0.06; return t === 'dc' ? [xx + 0.25, CH_Y - 0.205, zb + 0.94] : [xx - 0.305, CH_Y - 0.125, zb + 0.59] }
    if (mdl === 'mobi') return [x - 0.03, CH_Y - 0.12, ZC + 1.0]
    return [x + (t === 'dc_d' ? 0.43 : -0.43), CH_Y + 0.05, ZC + 1.0]
  }
  const pecas = (bi, t) => molde(bi).pecas[t].map((s) => `${L.bombas[bi]}${bi}${s}`)
  const vagas = L.vagas.map(([bi, t], i) => {
    const f = L.vfil[i], xl = L.xb(L.bayX(i), f), xbl = L.xb(L.bombaX[bi], f)
    return { nome: `P${i + 1}`, x: xl, ycarro: Y_CAB - 0.35 - 2.1, bomba: bi, ponto: t.split('_')[0], fileira: f,
      xMundo: L.bayX(i), saida: saida(bi, t), pecas: pecas(bi, t), lado: xbl < xl - 1e-6 ? 1 : -1 }
  })
  const conectores = []
  L.fil.forEach((b, bi) => {
    for (const t of b.modelo !== 'mobi' ? TIPOS2[b.modelo] : ['ac']) {
      const nat = b.modelo === 'mobi' ? L.vagasDa(bi) : L.vagasDa(bi).filter((i) => L.vagas[i][1] === t)
      conectores.push({ bomba: bi, ponto: t.split('_')[0], saida: saida(bi, t), pecas: pecas(bi, t), vagas: nat, fileira: L.FIL[bi] })
    }
  })
  // o painel do totem: a face (0,78 × 2,34 m, de frente para a rua) e as linhas de potência
  const fz = ft.zt + 0.14 + 0.2 + 1.17, fy = ty - 0.172
  const cantos = [[tx - 0.39, fy, fz - 1.17], [tx + 0.39, fy, fz - 1.17], [tx - 0.39, fy, fz + 1.17], [tx + 0.39, fy, fz + 1.17]]
  const pot = { fast: [['DC', 40], ['AC', 7]], ultra: [['DC', 80]], mobi: [['AC', 7]] }
  const tipos = [...new Map(L.bombas.flatMap((x) => pot[x]).map((t) => [t.join(), t])).values()].sort((a, b) => (a[0] !== 'DC') - (b[0] !== 'DC') || b[1] - a[1])
  const linhas = [...tipos.slice(0, 2).map(([t, k]) => `${t} · ${k} kW`), `${L.N} vaga${L.N > 1 ? 's' : ''}`]
  return {
    versao: 'v14', por_pecas: true, sem_blender: true, quadro: { ...quadro, pxm: PXM }, camera: camera(L, MO, quadro, PXM),
    posto: { bombas: L.bombas, cobertura: L.fil.some((b) => b.coberta), ilha: L.ilha,
      fileiras: Object.fromEntries(['frente', 'fundos'].map((f) => [f, L.fil.filter((_, bi) => L.FIL[bi] === f).map((b) => ({ modelo: b.modelo, vagas: b.nv, coberta: b.coberta }))])) },
    Z, FX_H, FX_Y0, FX_Y1: L.FX_Y1, AP_Y0, RAMPA_L, RX: [L.RX0, L.RX1], Y_CAB, Y_BOCA, BAY_W, BAY_D, CX: L.CX, Y_MID, ILHA: L.ilha, laje: L.LAJE,
    bombas, vagas, conectores, totem: { cantos, linhas }, oclusores,
  }
}
// câmera na grade de pixels (pecas.enquadrar): a rotação é a do molde (fixa), a posição anda com o começo da fileira
function camera(L, MO, q, pxm) {
  const R = MO.cameraR, D = [R[0][2], R[1][2], R[2][2]], t = [L.B0 + D[0] * 90, D[1] * 90, D[2] * 90]
  return { matriz: [[...R[0], t[0]], [...R[1], t[1]], [...R[2], t[2]], [0, 0, 0, 1]], escala: q.w / pxm, shift_x: 0.5 + q.gx0 / q.w, shift_y: -(q.gy0 + q.h / 2) / q.w, largura: q.w, altura: q.h }
}

// ---------------------------------------------------------------- luzes de um horário (luzes-<horário>.json)
// a lista na ordem do pecas.py (cerca, árvore, floreiras, coberturas): o nome de cada luz é o tipo e a posição na lista
export function luzes(m, MO, per) {
  const L = layout(m), { lz, porTipo } = MO.luz[per], lista = []
  const zc = ZC + 0.03
  if (!L.ilha) {
    for (let k = 0; k < L.N; k++) for (const j of [1, 3]) lista.push(['canteiro', [L.BK(k) + 0.27 + 0.54 * j + 0.22, CANT_Y0 - 0.02, zc + 0.12]])
    lista.push(['arvore', MO.arvore ? [L.X0 + MO.arvore[0], MO.arvore[1], MO.arvore[2]] : null])
  } else {
    // ilha (maquete_v14.build_meio_ilha): a luz de cada canteiro da ponta, e a árvore no canteiro da esquerda, no eixo
    for (const cb of [L.X_ESQ - 0.45, L.X1 - 0.7]) lista.push(['canteiro', [cb - 0.15, FX_Y0 + 0.32, zc + 0.12]])
    const xt = L.X0 + 0.5 + (L.X_ESQ - 0.45 - L.X0 - 0.5) / 2           // a mesma árvore da fileira, noutro lugar
    lista.push(['arvore', MO.arvore ? [xt + MO.arvore[0] - 0.62, MO.arvore[1] + Y_MID - (CANT_Y0 + Y_CAB + 1.9) / 2 - 0.1, MO.arvore[2]] : null])
  }
  const fe = floreira(L, -1, 1.2, 1.25), ft = floreira(L, 1, 1.5, 1.3)
  lista.push(['canteiro', [fe.x1 - 0.2, fe.y0 + 0.2, fe.zt + 0.1]], ['canteiro', [ft.x0 + 0.25, ft.y0 + 0.12, ft.zt + 0.12]])
  if (L.ilha) lista.push(['canteiro', gira(L, [fe.x1 - 0.2, fe.y0 + 0.2, fe.zt + 0.1])])
  // coberturas da frente e, girada, a dos fundos: um spot em cada divisa (na viga da frente e na de trás), a luz do
  // forro em cada vaga e o letreiro na ponta (a direita no estilo da frente; nos fundos, a esquerda do mundo)
  for (const f of ['frente', 'fundos']) for (const [i0, i1] of L.segsR[f]) {
    const c = cobertura(L, i0, i1, f), xs = [], poe = (p) => (f === 'fundos' ? gira(L, [L.xb(p[0], f), p[1], p[2]]) : p)
    for (let k = i0; k <= i1 + 1; k++) xs.push(L.BK(k))
    xs[0] += 0.05; xs[xs.length - 1] -= 0.05
    for (const sx of xs) for (const sy of [c.y0 + 0.08, c.y1 - 0.08]) lista.push(['spot', poe([sx, sy, c.zr - 0.03])])
    for (let i = i0; i <= i1; i++) lista.push(['forro', poe([L.BK(i) + 0.05 + BAY_W / 2, c.cy, c.zr - 0.02])])
    const xl = f === 'frente' ? c.x1 - 1.22 : L.xb(c.x0, f) - 1.22
    lista.push(['letreiro', f === 'fundos' ? gira(L, [xl, c.y0 + 0.08 - 0.9, c.zr + RH + 0.3]) : [xl, c.y0 + 0.08 - 0.9, c.zr + RH + 0.3]])
  }
  const saida = lz.luzes.filter((l) => l.nome === 'sol' || l.nome === 'preenchimento')
  lista.forEach(([tipo, pos], k) => { const t = porTipo[tipo]; if (t && pos) saida.push({ ...t, nome: `${tipo}${k}`, pos }) })
  return { ...lz, luzes: saida }
}

// ---------------------------------------------------------------- projeção da 2D (planta.json)
export function planta(m, MO, q) {
  const L = layout(m)
  return { elev: MO.planta.elev, pxm: PXM_PLANTA, w: q.w, h: q.h, cx: L.B0 + (q.gx0 + q.w / 2) / PXM_PLANTA, cy: -(q.gy0 + q.h / 2) / PXM_PLANTA,
    // a ilha tem a camada "sobre" (bombas dos fundos e pilares do meio, por cima dos carros dos fundos), como a v14
    cima: MO.planta.cima, teto: L.segs.length > 0, sobre: !!L.ilha, sombraCarro: false, versao: 'v14', por_pecas: true, sem_blender: true, quadro: { ...q, pxm: PXM_PLANTA } }
}

// ---------------------------------------------------------------- pistolas e cabos (bomba_pecas.glb)
// os nós do molde de cada bomba, renomeados e levados para o x da bomba; as malhas são as do molde (não duplicam), e só
// as que algum nó usa vão para o arquivo (o molde inteiro tem as seis bombas: 1,7 MB)
function enxugar(json, bin) {
  const mapa = (usados) => new Map([...usados].sort((a, b) => a - b).map((v, i) => [v, i]))
  const mM = mapa(new Set(json.nodes.map((n) => n.mesh).filter((x) => x !== undefined)))
  const meshes = [...mM.keys()].map((i) => json.meshes[i])
  const usA = new Set()
  for (const me of meshes) for (const p of me.primitives) { Object.values(p.attributes).forEach((a) => usA.add(a)); if (p.indices !== undefined) usA.add(p.indices) }
  const mA = mapa(usA), accessors = [...mA.keys()].map((i) => json.accessors[i])
  const mV = mapa(new Set(accessors.map((a) => a.bufferView).filter((x) => x !== undefined)))
  const partes = [], views = []
  let off = 0
  for (const vi of mV.keys()) {
    const v = json.bufferViews[vi], pedaco = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength)
    views.push({ ...v, buffer: 0, byteOffset: off }); partes.push(pedaco); off += v.byteLength
    const pad = (4 - (off % 4)) % 4; if (pad) { partes.push(new Uint8Array(pad)); off += pad }
  }
  const novoBin = new Uint8Array(off); let p = 0; for (const x of partes) { novoBin.set(x, p); p += x.length }
  const out = { ...json, meshes: meshes.map((me) => ({ ...me, primitives: me.primitives.map((pr) => ({ ...pr,
    attributes: Object.fromEntries(Object.entries(pr.attributes).map(([k, a]) => [k, mA.get(a)])), ...(pr.indices !== undefined ? { indices: mA.get(pr.indices) } : {}) })) })),
    accessors: accessors.map((a) => ({ ...a, ...(a.bufferView !== undefined ? { bufferView: mV.get(a.bufferView) } : {}) })), bufferViews: views,
    buffers: [{ byteLength: off }], nodes: json.nodes.map((n) => ({ ...n, mesh: mM.get(n.mesh) })) }
  if (json.images || json.textures) throw new Error('o molde das pistolas tem texturas: falta enxugar as imagens')
  return { json: out, bin: novoBin }
}
export function glbPecas(m, MO) {
  const L = layout(m), u8 = new Uint8Array(MO.glb), dv = new DataView(MO.glb)
  const tamJ = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + tamJ)))
  const o = 20 + tamJ, bin = u8.subarray(o + 8, o + 8 + dv.getUint32(o, true))
  const nos = []
  L.fil.forEach((b, bi) => {
    // na fileira dos fundos o nó vai para xb e gira 180° em volta de (CX, Y_MID): a posição passa por gira() e o
    // quatérnio (x, y, z, w) é multiplicado pelo de 180° em z, (0, 0, 1, 0): fica (-y, x, w, -z)
    const tras = L.FIL[bi] === 'fundos', mo = MO.bomba[`${b.modelo}${b.nv}`], dx = L.xb(L.bombaX[bi], L.FIL[bi]) - mo.x, de = mo.nb + '_', para = `${b.modelo}${bi}_`
    json.nodes.forEach((n) => {
      if (!n.name || !n.name.startsWith(de)) return
      if (n.children || n.matrix) throw new Error(`nó do molde fora do padrão: ${n.name}`)
      const t = n.translation || [0, 0, 0], p = [t[0] + dx, t[1], t[2]]
      if (!tras) return nos.push({ ...n, name: para + n.name.slice(de.length), translation: p })
      const [x, y, z, w] = n.rotation || [0, 0, 0, 1]
      nos.push({ ...n, name: para + n.name.slice(de.length), translation: gira(L, p), rotation: [-y, x, w, -z] })
    })
  })
  const { json: out, bin: novoBin } = enxugar({ ...json, nodes: nos, scenes: [{ ...(json.scenes || [{}])[0], nodes: nos.map((_, i) => i) }], scene: 0 }, bin)
  return gravarGlb(out, novoBin)
}
function gravarGlb(out, bin) {
  const enc = new TextEncoder(), j = enc.encode(JSON.stringify(out)), jp = (4 - (j.length % 4)) % 4, bp = (4 - (bin.length % 4)) % 4
  const total = 12 + 8 + j.length + jp + 8 + bin.length + bp, buf = new ArrayBuffer(total), d = new DataView(buf), b8 = new Uint8Array(buf)
  d.setUint32(0, 0x46546c67, true); d.setUint32(4, 2, true); d.setUint32(8, total, true)
  d.setUint32(12, j.length + jp, true); d.setUint32(16, 0x4e4f534a, true); b8.set(j, 20); b8.fill(0x20, 20 + j.length, 20 + j.length + jp)
  const ob = 20 + j.length + jp
  d.setUint32(ob, bin.length + bp, true); d.setUint32(ob + 4, 0x004e4942, true); b8.set(bin, ob + 8)
  return buf
}
