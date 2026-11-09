// Vagas paralelas ("bomba lateral", 9/11): a geometria comum ao corte das peças (ferramentas/lateral-lego.mjs, no Node)
// e à montagem no navegador (web/lateral.js). Sem nada de Node nem de navegador: só contas.
//   cam(L)            a câmera fixa do Blender (a mesma conta do pecas.py; origem em x = 0, y = 0)
//   plano(layout, M)  o posto pelas regras do maquete_lateral.py: ilhas, bombas, trechos do teto, pilares, letreiro
//   altasDo(plano)    as peças de pé (bombas, pilares, árvore, totem, letreiro), cada uma com a chave e a âncora
//   celulas(plano, M) as células do chão (âncora + retângulo relativo a ela)
// Grade de 1,35 m: vaga 5,4 m (4 passos), fila de duas vagas da mesma bomba 10,8 m (8), ladrilho entre bombas 1,35 m,
// eixo a eixo entre ilhas 8,1 m (6). Na câmera fixa, 1,35 m em X ou em Y é um deslocamento inteiro de pixels.

export const P = 1.35
const I = 1e6

export function cam(L) {
  const [rx, ry, rz] = L.rv, [ux, uy, uz] = L.uv, [fx, fy, fz] = L.fv, S = L.pxm
  return {
    // o ponto do plano z visto no centro do pixel (gx, gy) da grade
    chao: (gx, gy, z) => { const a = (gx + 0.5) / S, b = (gy + 0.5) / S, t = (z - a * rz + b * uz) / fz; return [a * rx - b * ux + t * fx, a * ry - b * uy + t * fy] },
    // o pixel da grade de um ponto do mundo (contínuo)
    grade: (x, y, z) => [(x * rx + y * ry + z * rz) * S, -(x * ux + y * uy + z * uz) * S],
    // o deslocamento, em pixels da grade, de um deslocamento (dx, dy) no chão (inteiro nos passos de 1,35 m)
    px: (dx, dy) => [Math.round((dx * rx + dy * ry) * S), Math.round(-(dx * ux + dy * uy) * S)],
    prof: (dx, dy) => dx * fx + dy * fy,
  }
}

export function plano(layout, M) {
  const span = (b) => (b.disp === 'fila' ? 2 * M.bay_l : M.bay_l)
  const lados = (b) => (b.disp === 'dois' ? [-1, 1] : [b.lado === 'tras' ? 1 : -1])
  const pitch = M.isl_w + 2 * (0.05 + M.bay_w) + M.sep, fora = M.isl_w / 2 + 0.05 + M.bay_w - 0.25
  let n = 0
  const ilhas = layout.ilhas.map((il, i) => {
    let x = 0
    const bombas = il.bombas.map((b, j) => { const L = span(b), o = { ...b, x0: x, x1: x + L, xc: x + L / 2, lados: lados(b), j, n: n++ }; x += L + M.sep_x; return o })
    return { i, y: i * pitch, comp: x - M.sep_x, bombas }
  })
  const xFim = Math.max(...ilhas.map((il) => il.comp))
  // (9/11, Sergio) a última ilha sem vaga atrás (ou a primeira sem vaga na frente) não deixa a faixa da vaga sobrando: a
  // laje recua 2 passos de 1,35 m desse lado (um número inteiro de pixels na câmera fixa: as peças do chão só mudam de
  // lugar). Fica ~2,35 m de piso da borda da ilha à borda da laje, como os 2,2 m da frente das vagas
  const recuoF = ilhas[0].bombas.some((b) => b.lados.includes(-1)) ? 0 : 2 * P
  const recuoT = ilhas.at(-1).bombas.some((b) => b.lados.includes(1)) ? 0 : 2 * P
  const yv0 = ilhas[0].y - M.isl_w / 2 - 0.05 - M.bay_w + recuoF, yv1 = ilhas.at(-1).y + M.isl_w / 2 + 0.05 + M.bay_w - recuoT
  const laje = { x0: -M.ap - 0.12, x1: xFim + M.ap + 0.12, y0: yv0 - M.m_fr, y1: yv1 + M.m_fu }
  // os trechos do teto e os pilares (build_coberturas_laterais) e o letreiro (o primeiro teto da ilha mais da frente)
  const trechos = [], pilares = []; let letreiro = null
  for (const il of ilhas) {
    const pil = new Set(), bs = il.bombas
    for (const lado of [-1, 1]) {
      const tem = bs.map((b) => !!b.coberta && b.lados.includes(lado)); let fimPrimeiro = null
      const T = (tipo, j, a, b) => trechos.push({ ilha: il.i, y: il.y, lado, tipo, j, a, b,
        chave: `cob/${lado < 0 ? 'f' : 't'}/${tipo}${tipo === 'c' ? '/' + (b - a).toFixed(2) : ''}` })
      bs.forEach((b, j) => {
        if (!tem[j]) return
        if (j === 0) { T('pe', j, b.x0 - 0.6, b.x0); pil.add(+(b.x0 + 0.35).toFixed(3)) }
        else if (!tem[j - 1]) { T('fe', j, b.x0 - M.sep_x / 2, b.x0); pil.add(+(b.x0 - M.sep_x / 2).toFixed(3)) }
        T('c', j, b.x0, b.x1)
        if (j + 1 < bs.length && tem[j + 1]) { T('dv', j, b.x1, bs[j + 1].x0); pil.add(+((b.x1 + bs[j + 1].x0) / 2).toFixed(3)) }
        else {
          let xf
          if (j === bs.length - 1) { T('pd', j, b.x1, b.x1 + 0.6); pil.add(+(b.x1 - 0.35).toFixed(3)); xf = b.x1 + 0.6 }
          else { T('fd', j, b.x1, b.x1 + M.sep_x / 2); pil.add(+(b.x1 + M.sep_x / 2).toFixed(3)); xf = b.x1 + M.sep_x / 2 }
          if (fimPrimeiro === null) fimPrimeiro = xf
        }
      })
      if (!letreiro && fimPrimeiro !== null) letreiro = { x: fimPrimeiro, y: il.y, lado, y0: lado < 0 ? il.y - fora : il.y }
    }
    for (const x of [...pil].sort((a, b) => a - b)) pilares.push({ x, y: il.y, ilha: il.i })
  }
  return { ilhas, xFim, laje, trechos, pilares, letreiro, pitch, fora, recuoF, recuoT }
}

// a bomba muda com o teto da frente (o sol e os spots chegam nela por ali): c0 / cf
export const chaveBomba = (b) => `bomba/${b.modelo}/c${b.coberta && b.lados.includes(-1) ? 'f' : '0'}`

export function altasDo(pl) {
  const out = []
  for (const il of pl.ilhas) for (const b of il.bombas) out.push({ chave: chaveBomba(b), anc: [b.xc, il.y], ilha: il.i, bomba: b.j, n: b.n })
  // o pilar muda com o teto em volta dele: só da frente, só de trás ou dos dois lados
  for (const q of pl.pilares) {
    const tem = (lado) => pl.trechos.some((t) => t.ilha === q.ilha && t.lado === lado && t.a - 0.01 <= q.x && q.x <= t.b + 0.01)
    out.push({ chave: `pilar/${tem(-1) ? 'f' : ''}${tem(1) ? 't' : ''}`, anc: [q.x, q.y], ilha: q.ilha })
  }
  out.push({ chave: 'arvore', anc: [pl.laje.x0, pl.laje.y1] }, { chave: 'totem', anc: [pl.laje.x1, pl.laje.y0] })
  if (pl.letreiro) out.push({ chave: 'letreiro', anc: [pl.letreiro.x, pl.letreiro.y0] })
  return out
}

// fonte: a célula pode servir de modelo para recortar a peça (as laterais e a ponta da primeira faixa, perto das
// floreiras, não)
export function celulas(pl, M) {
  const H = pl.pitch / 2, out = [], n = pl.ilhas.length, X = pl.xFim, i0 = pl.ilhas[0].y, iN = pl.ilhas.at(-1).y
  // (9/11) com o recuo da laje, a faixa da primeira ilha começa rF mais para dentro e a da última termina rT antes; a tira da
  // frente, a dos fundos, os cantos e as tiras de borda das laterais vão junto (as mesmas peças, no lugar novo)
  const rF = pl.recuoF || 0, rT = pl.recuoT || 0, f0 = i0 + rF, fN = iN - rT
  const add = (tipo, ax, ay, r, fonte = true) => out.push({ tipo, ax, ay, r, fonte })
  for (const il of pl.ilhas) {
    // (a moita da floreira da frente, vista de cima, entra na lateral e na ponta da primeira faixa: as peças dessas
    // células vêm de uma faixa do meio)
    const y = il.y, meio = il.i > 0 && il.i < n - 1
    const a = il.i === 0 ? -H + rF : -H, b2 = il.i === n - 1 ? H - rT : H
    add('lado-e', -P, y, [-I, 0, a, b2], meio)
    add('ponta-e', -P, y, [0, P, a, b2], il.i > 0)
    il.bombas.forEach((b, j) => {
      add(`mod/${b.disp}${b.disp === 'dois' ? '' : b.lados[0] < 0 ? '/f' : '/t'}`, b.x0, y, [0, b.x1 - b.x0, a, b2])
      if (j + 1 < il.bombas.length) add('junta', b.x1, y, [0, M.sep_x, a, b2])
    })
    // (à direita, a sombra da floreira do totem entra na primeira faixa logo depois do fim da maior ilha)
    const limpa = (x0) => il.i > 0 || x0 < X - 0.01
    add('ponta-d', il.comp, y, [0, P, a, b2], limpa(il.comp))
    for (let k = Math.round((il.comp + P) / P); k < Math.round((X + P) / P); k++) add('vazio', k * P, y, [0, P, a, b2], limpa(k * P))
    add('lado-d', X + P, y, [0, I, a, b2], meio)
  }
  for (let k = 0; k < Math.round(X / P); k++) { add('frente', k * P, f0, [0, P, -I, -H]); add('fundo', k * P, fN, [0, P, H, I]) }
  add('canto-fe', 0, f0, [-I, 0, -I, -H]); add('canto-fd', X, f0, [0, I, -I, -H])
  add('canto-te', 0, fN, [-I, 0, H, I]); add('canto-td', X, fN, [0, I, H, I])
  // por cima das laterais (e da tira de 1,35 m vizinha, com a ponta ou o vazio) da primeira e da última faixa, numa
  // tira de 2,7 m junto da borda
  add('lado-e/0', -P, f0, [-I, P, -H, -H + 2 * P]); add('lado-d/0', X + P, f0, [-P, I, -H, -H + 2 * P])
  add('lado-e/n', -P, fN, [-I, 0, H - 2 * P, H]); add('lado-d/n', X + P, fN, [0, I, H - 2 * P, H])
  return out
}
