// Vagas paralelas ("bomba lateral", passo 3, 9/11): os arquivos de dados do painel (âncoras, luzes de cada horário,
// pistolas e cabos, projeção da 2D) para um posto deste modelo, sem abrir o Blender. O mesmo papel do
// dados-sem-blender.js da fileira e da ilha, com as mesmas regras do maquete_lateral.py (web/lateral-plano.js).
//
// A bomba é a mesma do molde (a fileira de 6 bombas que passou uma vez pelo Blender), sempre virada para a rua (−Y):
// as caixas que escondem o carro, as saídas dos cabos e as pistolas guardadas vêm do molde, deslocadas da bomba do
// molde (x, Y = 5,55) para a bomba do posto (xc, eixo da ilha).
//
// O que muda no painel (ancoras.lateral = true):
//   - cada vaga tem o centro do carro (x, y), o rumo (o carro fica virado para +X, paralelo à ilha), a baia (para o
//     anel), o lado da ilha em que está (s: −1 na frente, +1 atrás), a beira do meio-fio (yBorda), a faixa (a fila de
//     vagas daquele lado da ilha, para o carro não passar por cima de outro ao chegar e sair) e a ordem nela;
//   - nas vagas de trás o cabo sai por trás da bomba (o corpo dela o esconde) e desce na beira de trás da ilha.
import { plano } from '../lateral-plano.js'
import { enxugar, gravarGlb } from './dados-sem-blender.js'

const Z = 0.14, FX_H = 0.15, ZC = Z + FX_H, RH = 0.3, PXM = 180.48, PXM_PLANTA = 140
const CH_Y = 5.55                                   // o y das bombas do molde (Y_CAB + 0,55)
const TIPOS2 = { fast: ['ac', 'dc'], ultra: ['dc_e', 'dc_d'], mobi: ['ac', 'ac_b'] }, TIPO1 = { fast: 'dc', ultra: 'dc_e', mobi: 'ac' }

// o posto: o plano de lateral-plano.js com as vagas de cada bomba (as mesmas do maquete_lateral.py)
export function layoutLateral(m, M, zteto) {
  const pl = plano({ ilhas: m.ilhas }, M), vagas = [], CAN_H = zteto - Z - RH / 2
  const meio = (s) => s * (M.isl_w / 2 + 0.05 + M.bay_w / 2)
  for (const il of pl.ilhas) for (const b of il.bombas) {
    b.vagas = []
    const tipos = b.disp === 'unica' ? [TIPO1[b.modelo]] : TIPOS2[b.modelo]
    const lista = b.disp === 'fila' ? [[b.xc - M.bay_l / 2, b.lados[0]], [b.xc + M.bay_l / 2, b.lados[0]]] : b.lados.map((s) => [b.xc, s])
    lista.forEach(([x, s], k) => {
      const i = vagas.length
      vagas.push({ i, x, y: il.y + meio(s), s, ilha: il.i, bomba: b.n, k, tipo: tipos[k] || tipos[0], coberta: !!b.coberta && b.lados.includes(s), modelo: b.modelo })
      b.vagas.push(i)
    })
  }
  // as faixas: as vagas de um mesmo lado de uma ilha, em ordem de x (o carro entra pela esquerda e sai pela direita)
  const faixas = new Map()
  for (const v of vagas) { const f = `${v.ilha}${v.s < 0 ? 'f' : 't'}`; if (!faixas.has(f)) faixas.set(f, []); faixas.get(f).push(v) }
  for (const [f, vs] of faixas) vs.sort((a, b) => a.x - b.x).forEach((v, o) => { v.faixa = f; v.ordem = o })
  const bombas = pl.ilhas.flatMap((il) => il.bombas.map((b) => ({ ...b, ilha: il.i, y: il.y })))
  return { pl, M, vagas, bombas, CAN_H, zr: Z + CAN_H, LAJE: pl.laje, X0: pl.laje.x0, X1: pl.laje.x1 }
}

// floreira de canto (maquete_v14.floreira_canto, a mesma do maquete_lateral.py): encostada na laje, na frente
function floreira(LAJE, lado, w, d) {
  const xa = LAJE.x0 + 0.12, xb = LAJE.x1 - 0.12, m = 0.15, y0 = LAJE.y0 + 0.12
  const [x0, x1] = lado < 0 ? [xa + m, xa + m + w] : [xb - m - w, xb - m]
  return { x0, x1, y0: y0 + m, y1: y0 + m + d, zt: Z + 0.4 - 0.03 }
}
// a saída do cabo de cada conector, no estilo do molde (dados-sem-blender.js), na bomba (x, y do eixo)
function saida(modelo, t, x, y) {
  if (modelo === 'fast') { const xx = x - 0.02, zb = ZC + 0.06; return t === 'dc' ? [xx + 0.25, y - 0.205, zb + 0.94] : [xx - 0.305, y - 0.125, zb + 0.59] }
  if (modelo === 'mobi') return [x - 0.03, y - 0.12, ZC + 1.0]
  return [x + (t === 'dc_d' ? 0.43 : -0.43), y + 0.05, ZC + 1.0]
}

// ---------------------------------------------------------------- âncoras (ancoras.json)
export function ancorasLateral(m, MO, L, quadro) {
  const oclusores = []
  const caixa = (nome, cilindro, min, max) => oclusores.push({ nome, cilindro, min, max })
  const box = (nome, sx, sy, sz, x, y, z) => caixa(nome, false, [x - sx / 2, y - sy / 2, z], [x + sx / 2, y + sy / 2, z + sz])
  const molde = (b) => { const nv = b.disp === 'unica' ? 1 : 2, k = `${b.modelo}${nv}`; if (!MO.bomba[k]) throw new Error(`o molde não tem a bomba ${k}`); return MO.bomba[k] }
  // frente: as floreiras dos cantos e o totem
  const fe = floreira(L.LAJE, -1, 1.2, 1.25), ft = floreira(L.LAJE, 1, 1.5, 1.3)
  caixa('floreira_esq', false, [fe.x0, fe.y0, Z], [fe.x1, fe.y1, Z + 0.4])
  caixa('floreira_totem', false, [ft.x0, ft.y0, Z], [ft.x1, ft.y1, Z + 0.4])
  const tx = (ft.x0 + ft.x1) / 2 + 0.05, ty = ft.y1 - 0.42
  box('totem_plinto', 1.16, 0.56, 0.14, tx, ty, ft.zt)
  box('totem_corpo', 0.92, 0.34, 3.0, tx, ty, ft.zt + 0.14)
  // pilares (base e coluna), no eixo de cada ilha
  L.pl.pilares.forEach((p, k) => { const nome = `cob_i${p.ilha}_pilar${k}`; box(nome + '_base', 0.62, 0.62, 0.3, p.x, p.y, ZC); box(nome, 0.24, 0.24, L.zr + RH - 0.02 - (ZC + 0.3), p.x, p.y, ZC + 0.3) })
  // bombas: as caixas do molde levadas para cada bomba, e os frades dos lados (no eixo da ilha, como no maquete_lateral)
  const bombas = L.bombas.map((b) => {
    const mo = molde(b), dx = b.xc - mo.x, dy = b.y - CH_Y
    for (const c of mo.caixas) caixa(`bomba${b.n}${c.suf}`, false, [c.min[0] + b.xc, c.min[1] + dy, c.min[2]], [c.max[0] + b.xc, c.max[1] + dy, c.max[2]])
    for (const s of [-1, 1]) { const fx = b.xc + s * 0.86, fy = b.y; caixa(`frade_bomba${b.n}_${s + 1}`, true, [fx - 0.075, fy - 0.075, ZC], [fx + 0.075, fy + 0.075, ZC + 0.82]) }
    return { modelo: b.modelo, x: b.xc, y: b.y, topo: [b.xc + 0.15, b.y, mo.topo], base: [b.xc, b.y, ZC], vagas: b.vagas, fileira: 'frente', vagasN: b.vagas.length,
      ilha: b.ilha, disp: b.disp, lados: b.lados, coberta: !!b.coberta, dx }
  })
  const pecas = (b, t) => molde(b).pecas[t].map((s) => `${b.modelo}${b.n}${s}`)
  const vagas = L.vagas.map((v) => {
    const b = L.bombas[v.bomba], yb = b.y - v.s * (L.M.isl_w / 2)                 // a beira do meio-fio, do lado da vaga
    return { nome: `P${v.i + 1}`, x: v.x, y: v.y, ycarro: v.y, rumo: 0, bomba: v.bomba, ponto: v.tipo.split('_')[0], fileira: 'frente',
      xMundo: v.x, saida: saida(b.modelo, v.tipo, b.xc, b.y), pecas: pecas(b, v.tipo),
      // a tomada do lado da ilha: com o carro virado para +X, a ilha fica à esquerda dele na frente e à direita atrás
      lado: v.s < 0 ? 1 : -1,
      lateral: { ilha: v.ilha, s: v.s, yBorda: yb, eixo: b.y, faixa: v.faixa, ordem: v.ordem, coberta: v.coberta, baia: { cx: v.x, cy: v.y, w: L.M.bay_l, h: L.M.bay_w } } }
  })
  const conectores = []
  for (const b of L.bombas) {
    const tipos = b.modelo === 'mobi' ? ['ac'] : TIPOS2[b.modelo]
    tipos.forEach((t, k) => {
      // as vagas naturais de cada conector: a k-ésima vaga da bomba (o Mobi, com um conector só, alcança as duas)
      const nat = b.modelo === 'mobi' || b.vagas.length === 1 ? [...b.vagas] : [b.vagas[Math.min(k, b.vagas.length - 1)]]
      conectores.push({ bomba: b.n, ponto: t.split('_')[0], saida: saida(b.modelo, t, b.xc, b.y), pecas: pecas(b, t), vagas: nat, fileira: 'frente' })
    })
  }
  // o painel do totem: a face (0,78 × 2,34 m, de frente para a rua) e as linhas de potência
  const fz = ft.zt + 0.14 + 0.2 + 1.17, fy = ty - 0.172
  const cantos = [[tx - 0.39, fy, fz - 1.17], [tx + 0.39, fy, fz - 1.17], [tx - 0.39, fy, fz + 1.17], [tx + 0.39, fy, fz + 1.17]]
  const pot = { fast: [['DC', 40], ['AC', 7]], ultra: [['DC', 80]], mobi: [['AC', 7]] }
  const tipos = [...new Map(L.bombas.flatMap((b) => pot[b.modelo]).map((t) => [t.join(), t])).values()].sort((a, b) => (a[0] !== 'DC') - (b[0] !== 'DC') || b[1] - a[1])
  const linhas = [...tipos.slice(0, 2).map(([t, k]) => `${t} · ${k} kW`), `${L.vagas.length} vaga${L.vagas.length > 1 ? 's' : ''}`]
  const LJ = L.LAJE
  return {
    versao: 'lateral', lateral: true, por_pecas: true, sem_blender: true, quadro: { ...quadro, pxm: PXM }, camera: camera(MO, quadro, PXM),
    posto: { modelo: 'lateral', bombas: L.bombas.map((b) => b.modelo), cobertura: L.bombas.some((b) => b.coberta), ilha: false, ilhas: m.ilhas },
    Z, FX_H, BAY_W: L.M.bay_w, BAY_L: L.M.bay_l, BAY_D: L.M.bay_l, CX: (LJ.x0 + LJ.x1) / 2, Y_MID: (LJ.y0 + LJ.y1) / 2, ILHA: false, laje: LJ,
    // o chão do pátio (sem rampa: as rampas ficam nas laterais) e as ilhas, para o cabo e a sombra do carro
    AP_Y0: LJ.y0 - 10, RAMPA_L: 1, FX_Y0: -1e6, FX_Y1: 1e6, Y_CAB: 0, Y_BOCA: 0, RX: [LJ.x0, LJ.x1],
    ilhas: L.pl.ilhas.map((il) => ({ y: il.y, x0: -L.M.isl_m, x1: il.comp + L.M.isl_m, w: L.M.isl_w })),
    bombas, vagas, conectores, totem: { cantos, linhas }, oclusores,
  }
}
// câmera na grade de pixels (pecas.enquadrar): a rotação é a do molde (a mesma câmera fixa); a origem da grade é x = 0
function camera(MO, q, pxm) {
  const R = MO.cameraR, D = [R[0][2], R[1][2], R[2][2]], t = [D[0] * 90, D[1] * 90, D[2] * 90]
  return { matriz: [[...R[0], t[0]], [...R[1], t[1]], [...R[2], t[2]], [0, 0, 0, 1]], escala: q.w / pxm, shift_x: 0.5 + q.gx0 / q.w, shift_y: -(q.gy0 + q.h / 2) / q.w, largura: q.w, altura: q.h }
}

// ---------------------------------------------------------------- luzes de um horário (luzes-<horário>.json)
// as posições saem das regras do maquete_lateral.py; as propriedades de cada tipo, do molde
export function luzesLateral(m, MO, L, per) {
  const { lz, porTipo } = MO.luz[per], lista = [], FORA = L.pl.fora, zr = L.zr
  const fe = floreira(L.LAJE, -1, 1.2, 1.25), ft = floreira(L.LAJE, 1, 1.5, 1.3)
  lista.push(['canteiro', [fe.x1 - 0.2, fe.y0 + 0.2, fe.zt + 0.1]], ['canteiro', [ft.x0 + 0.25, ft.y0 + 0.12, ft.zt + 0.12]])
  // a árvore, na floreira do canto de trás à esquerda
  const X0 = L.LAJE.x0, yb = L.LAJE.y1, ax = X0 + 0.97, ay = yb - 0.97
  lista.push(['arvore', MO.arvore ? [ax, ay, MO.arvore[2]] : null])
  // os trechos de teto: os spots do corpo de cada bomba (a 1,35 m do começo e de 2,7 em 2,7 m), nas duas vigas compridas
  for (const t of L.pl.trechos) {
    if (t.tipo !== 'c') continue
    const y0 = t.lado < 0 ? t.y - FORA : t.y, y1 = t.lado < 0 ? t.y : t.y + FORA
    for (let k = 0; k < Math.floor((t.b - t.a) / 2.7 + 1e-6); k++) for (const sy of [y0 + 0.08, y1 - 0.08]) lista.push(['spot', [t.a + 1.35 + 2.7 * k, sy, zr - 0.03]])
  }
  // o forro: uma luz em cada vaga coberta
  for (const v of L.vagas) if (v.coberta) lista.push(['forro', [v.x, v.y, zr - 0.02]])
  // o letreiro, na frente do primeiro teto da ilha mais da frente
  const lt = L.pl.letreiro
  if (lt) lista.push(['letreiro', [lt.x - 1.22, lt.y0 + 0.08 - 0.9, zr + RH + 0.3]])
  const saida = lz.luzes.filter((l) => l.nome === 'sol' || l.nome === 'preenchimento')
  lista.forEach(([tipo, pos], k) => { const t = porTipo[tipo]; if (t && pos) saida.push({ ...t, nome: `${tipo}${k}`, pos }) })
  return { ...lz, luzes: saida }
}

// ---------------------------------------------------------------- projeção da 2D (planta.json)
export function plantaLateral(m, MO, L, q) {
  return { elev: MO.planta.elev, pxm: PXM_PLANTA, w: q.w, h: q.h, cx: (q.gx0 + q.w / 2) / PXM_PLANTA, cy: -(q.gy0 + q.h / 2) / PXM_PLANTA,
    cima: MO.planta.cima, teto: L.pl.trechos.length > 0, sobre: false, sombraCarro: false, versao: 'lateral', lateral: true, por_pecas: true, sem_blender: true, quadro: { ...q, pxm: PXM_PLANTA } }
}

// ---------------------------------------------------------------- pistolas e cabos guardados (bomba_pecas.glb)
// os nós do molde de cada bomba, renomeados e levados para a bomba do posto (x e y); as malhas são as do molde
export function glbPecasLateral(m, MO, L) {
  const u8 = new Uint8Array(MO.glb), dv = new DataView(MO.glb)
  const tamJ = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + tamJ)))
  const o = 20 + tamJ, bin = u8.subarray(o + 8, o + 8 + dv.getUint32(o, true))
  const nos = []
  for (const b of L.bombas) {
    const nv = b.disp === 'unica' ? 1 : 2, mo = MO.bomba[`${b.modelo}${nv}`], dx = b.xc - mo.x, dy = b.y - CH_Y, de = mo.nb + '_', para = `${b.modelo}${b.n}_`
    json.nodes.forEach((n) => {
      if (!n.name || !n.name.startsWith(de)) return
      if (n.children || n.matrix) throw new Error(`nó do molde fora do padrão: ${n.name}`)
      const t = n.translation || [0, 0, 0]
      nos.push({ ...n, name: para + n.name.slice(de.length), translation: [t[0] + dx, t[1] + dy, t[2]] })
    })
  }
  const { json: out, bin: novoBin } = enxugar({ ...json, nodes: nos, scenes: [{ ...(json.scenes || [{}])[0], nodes: nos.map((_, i) => i) }], scene: 0 }, bin)
  return gravarGlb(out, novoBin)
}
