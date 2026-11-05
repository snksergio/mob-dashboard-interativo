// V3 em Lego (3/11): a fileira montada com peças soltas que se repetem (lego/<vista>/lego.json, ferramentas/preparar-lego.mjs).
// Cada peça é uma imagem que vai no lugar dela, deslocada vagas inteiras (uma vaga = 384 × 150 px no 3D), numa destas
// camadas, nesta ordem:
//   1. chão (o mesmo coberto ou não): lateral esquerda, um bloco por vaga em faixas (rua, piso, vaga, calçada, canteiro)
//      e lateral direita;
//   2. cobertura (só coberto): o que ela faz no chão, multiplicando (sombra) e somando (luz das lâmpadas), nas pontas
//      (2 vagas), no meio e, entre duas bombas, a viga;
//   3. as sombras (multiplicam) e as luzes (somam) das peças de pé; 4. as peças de pé, de trás para a frente;
//   5. o teto (camada à parte, como no painel): pontas, meio e viga entre bombas.
// Uma peça pode valer só para algumas colunas (do meio de uma vaga ao meio da seguinte): o pixel diz a coluna pelo ponto
// do chão (ou do teto) que enxerga, a mesma conta da V2.
import { paraTela, brilho } from './base/compor.js'

const LIN = new Float32Array(256)                 // byte sRGB -> luz linear (x2: as imagens guardam a luz pela metade)
for (let i = 0; i < 256; i++) { const v = i / 255; LIN[i] = 2 * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) }
const RAZ = LIN.slice(); RAZ[188] = 1               // a sombra: o byte 188 é "não muda" (razão 1)
const PILAR_PONTA = 0.2 / 2.7                       // o pilar da ponta fica 20 cm para fora da primeira (e da última) divisa
const COSTURA = 0.25                                // ilha: a luz de um trecho se mistura com a do vizinho 1/4 de vaga para cada lado da divisa
export function planejarLego(L, m) {
  const fila = m.fileiras.frente, bombaDaVaga = [], bombas = [], cobV = []
  fila.forEach((b, i) => {
    const c = b.coberta !== undefined ? !!b.coberta : !!m.cobertura
    bombas.push({ ...b, anc: bombaDaVaga.length, c }); for (let q = 0; q < b.vagas; q++) { bombaDaVaga.push(i); cobV.push(c) }
  })
  const NU = bombaDaVaga.length, DU = L.du, coberto = cobV.some(Boolean)
  const tipo = (k) => (bombaDaVaga[k - 1] === bombaDaVaga[k] ? 'dentro' : 'entre')
  const camadas = []
  // a peça r (retângulo na grade do posto-exemplo, coluna k de lá) posta na coluna kp (pode ser fracionária): anda (kp - k) vagas
  const poe = (r, kp, k, modo, alvo, extra = {}) => { if (r) camadas.push({ r, dx: Math.round((kp - k) * DU[0]), dy: Math.round((kp - k) * DU[1]), modo, alvo, ...extra }) }
  // 1. o chão (cada peça vem com uma sobra de ~8 px e é cortada exato na coluna dela)
  const noChao = (a, b) => ({ cols: [a, b], z: 'z' }), noTeto = (a, b) => ({ cols: [a, b], z: 'zteto' })
  // (a lateral direita tem 2 colunas: a luz do totem passa da última; num posto de 1 vaga, só a última)
  const chaoDir = NU >= 2 ? NU - 1 : NU
  poe(L.chao.esq, 0, L.chao.esq.k, 'cobre', 'fundo', noChao(0, 0))
  for (let k = 1; k < chaoDir; k++) for (const f of Object.values(L.chao.meio.faixas)) poe(f, k, L.chao.meio.k, 'cobre', 'fundo', noChao(k, k))
  poe(L.chao.dir, NU, L.chao.dir.k, 'cobre', 'fundo', noChao(chaoDir, NU))
  // os trechos cobertos (bombas cobertas lado a lado: cobertura bomba a bomba), cada um das colunas a até b. Cada trecho
  // é uma cobertura com as mesmas peças: pontas de 2 colunas (num trecho curto, cada ponta fica com as dela), meio e viga.
  // A ponta que cai no meio do posto é outra peça (a margem de lá é 40 cm, não 60, e o pilar fica na divisa), e a vaga
  // descoberta ao lado recebe o que a cobertura faz nela (a sombra; à noite, a luz das lâmpadas que vaza)
  const trechos = []
  for (let q = 0; q < NU; q++) if (cobV[q] && (q === 0 || !cobV[q - 1])) { let e = q; while (e + 1 < NU && cobV[e + 1]) e++; trechos.push([q, e + 1]) }
  const props = []
  const prop = (c, kf, extra = {}) => { const passos = kf - (c.ref === 'D' ? c.nu : c.anc); props.push({ c, passos, dx: Math.round(passos * DU[0]), dy: Math.round(passos * DU[1]), prof: c.prof + passos * L.dprof, ...extra }) }
  const tetos = []
  // o posto todo coberto de 1 ou 2 vagas: a cobertura pequena inteira (sombra, luz e teto), de um posto-exemplo do tamanho dele
  const pequena = trechos.length === 1 && trechos[0][0] === 0 && trechos[0][1] === NU && NU <= 2 && L.pequena ? L.pequena[NU === 1 ? '1' : `2${tipo(1)}`] : null
  if (pequena) {
    for (const nome of ['sombra', 'luz']) poe(pequena[nome], 0, pequena.k, nome === 'sombra' ? 'multiplica' : 'soma', 'fundo')
    prop(L.props.pilar.c1, -PILAR_PONTA); prop(L.props.pilar.c1, NU + PILAR_PONTA)
    if (NU === 2 && tipo(1) === 'entre') prop(L.props.pilar.c1, 1)
    tetos.push([pequena.teto, 0, pequena.k, {}])
  }
  if (!pequena) trechos.forEach(([a, b], t) => {
    const n = b - a + 1, eAte = n >= 4 ? a + 1 : a, dDe = n >= 4 ? b - 1 : a + 1
    const C = L.cobertura, cE = a > 0 ? C.esqDentro : C.esq, cD = b < NU ? C.dirDentro : C.dir
    // as vizinhas descobertas: até 1 coluna à esquerda e 2 à direita, sem passar da coluna da cobertura do lado
    const fimAnt = t > 0 ? trechos[t - 1][1] : -1, iniProx = t + 1 < trechos.length ? trechos[t + 1][0] : NU + 1
    const foraE = a > 0 && a - 1 > fimAnt ? [a - 1, a - 1] : null
    const foraD = b < NU ? [b + 1, Math.min(b + 2, iniProx - 1, NU)] : null
    // 2. a cobertura sobre o chão: as pontas, o meio, a viga em cada divisa entre bombas dentro do trecho e as vizinhas
    for (const nome of ['sombra', 'luz']) {
      const modo = nome === 'sombra' ? 'multiplica' : 'soma'
      poe(cE[nome], a, cE.k, modo, 'fundo', noChao(a, eAte))
      for (let k = eAte + 1; k < dDe; k++) poe(C.meio[nome], k, C.meio.k, modo, 'fundo', noChao(k, k))
      poe(cD[nome], b, cD.k, modo, 'fundo', noChao(dDe, b))
      for (let k = a + 1; k < b; k++) if (tipo(k) === 'entre') poe(C.viga[nome], k, C.viga.k, modo, 'fundo', noChao(k, k))
      if (foraE) poe(C.esqFora[nome], a, C.esqFora.k, modo, 'fundo', noChao(...foraE))
      if (foraD && foraD[1] >= foraD[0]) poe(C.dirFora[nome], b, C.dirFora.k, modo, 'fundo', noChao(...foraD))
    }
    // os pilares do trecho: nas pontas (fora 20 cm na ponta do posto, na divisa no meio dele) e entre bombas
    prop(L.props.pilar.c1, a > 0 ? a : -PILAR_PONTA); prop(L.props.pilar.c1, b < NU ? b : NU + PILAR_PONTA)
    for (let k = a + 1; k < b; k++) if (tipo(k) === 'entre') prop(L.props.pilar.c1, k)
    // 5. o teto do trecho (camada à parte): a coluna da ponta que cai numa divisa entre bombas leva a viga no lugar do
    // teto da ponta (o teto é vidro: um por cima do outro dobraria)
    const T = L.teto, tE = a > 0 ? T.esqDentro : T.esq, tD = b < NU ? T.dirDentro : T.dir
    const vigaEsq = eAte > a && tipo(eAte) === 'entre', vigaDir = dDe < b && dDe !== eAte && tipo(dDe) === 'entre'
    tetos.push([tE, a, tE.k, noTeto(a, vigaEsq ? eAte - 1 : eAte)])
    for (let k = eAte + 1; k < dDe; k++) { const tt = tipo(k) === 'entre' ? T.viga : T.meio; tetos.push([tt, k, tt.k, noTeto(k, k)]) }
    tetos.push([tD, b, tD.k, noTeto(vigaDir ? dDe + 1 : dDe, b)])
    if (vigaEsq) tetos.push([T.viga, eAte, T.viga.k, noTeto(eAte, eAte)])
    if (vigaDir) tetos.push([T.viga, dDe, T.viga.k, noTeto(dDe, dDe)])
    // (3/11, noite) o letreiro da ponta direita passa para a coluna do lado: com a viga nela, vai por cima (inteiro)
    if (vigaDir && b === NU && T.letreiroDir && T.letreiroDir.arq) tetos.push([T.letreiroDir, b, T.letreiroDir.k, {}])
  })
  // 3 e 4. as peças de pé: a mesma bomba de cada modelo em toda bomba dele (coberta ou não; a de 1 vaga, meia vaga para a
  // esquerda), a árvore e o totem (cobertos se a bomba da ponta deles for coberta)
  // (bi: a bomba na ordem do painel, para a máscara dos estados: falha, desligada)
  bombas.forEach((b, bi) => {
    const cb = b.c ? 'c1' : 'c0', c = L.props[`bomba-${b.modelo}`][cb]
    if (b.vagas === 2) { prop(c, b.anc, { tipo: 'bomba', bi }); return }
    // a de 1 vaga: a mesma imagem, meia vaga para a esquerda; a sombra e a luz no chão, as da bomba de 1 vaga
    prop({ ...c, sombra: null, luzimg: null }, b.anc - 0.5, { tipo: 'bomba', bi })
    prop(L.props[`efeito1-${b.modelo}`][cb], b.anc)
  })
  // (3/11, noite) num posto de 1 ou 2 vagas, a sombra e a luz no chão da árvore e do totem são as do posto desse tamanho
  const cA = cobV[0] ? 'c1' : 'c0', cT = cobV[NU - 1] ? 'c1' : 'c0', eA = L.props[`efeitoArvore-n${NU}`], eT = L.props[`efeitoTotem-n${NU}`]
  if (eA) { prop({ ...L.props.arvore[cA], sombra: null, luzimg: null }, 0); prop(eA[cA], 0) } else prop(L.props.arvore[cA], 0)
  if (eT) { prop({ ...L.props.totem[cT], sombra: null, luzimg: null }, NU); prop(eT[cT], NU) } else prop(L.props.totem[cT], NU)
  // (3/11, noite) a luz das peças de pé vem de um posto-exemplo maior e se espalha pelas vagas do lado, levando junto o
  // logo, as faixas e os batentes que ela ilumina: perto da ponta de um posto ela caía onde não há vaga (um logo
  // fantasma na lateral). Na faixa das vagas, a luz que lá caía numa vaga e aqui cai fora das vagas fica de fora (a
  // borda cai na faixa pintada); a que já era da lateral (a do totem, a da árvore) fica. Fora dessa faixa o chão é igual
  // ao longo do posto. As sombras não levam o desenho do chão
  // (a faixa vai do piso da frente, com a rampa, ao fim da vaga: a rampa acompanha as vagas e a luz guarda o desenho dela)
  const vagas = (p) => ({ faixas: [[-2.05, 4.95, 0, NU * L.passo, 0, (p.c.nu || L.nu) * L.passo]], desloc: p.passos * L.passo, suave: 0.6 })
  for (const p of props) if (p.c.sombra) camadas.push({ r: p.c.sombra, dx: p.dx, dy: p.dy, modo: 'multiplica', alvo: 'fundo' })
  for (const p of props) if (p.c.luzimg) camadas.push({ r: p.c.luzimg, dx: p.dx, dy: p.dy, modo: 'soma', alvo: 'fundo', vagas: vagas(p) })
  for (const p of props.sort((x, y) => y.prof - x.prof)) if (p.c.spr) camadas.push({ r: p.c.spr, dx: p.dx, dy: p.dy, modo: 'cobre', alvo: 'fundo', peca: true, tipo: p.tipo, bi: p.bi })
  for (const [r, kp, k, cols] of tetos) poe(r, kp, k, 'cobre', 'teto', cols)
  // o quadro: o chão, o teto e as peças de pé, com a folga de 16 px (as sombras e as luzes ficam dentro dele). Assim a
  // moldura é a mesma de dia e de noite, como o painel espera (ele troca as camadas de um horário pelas do outro)
  const rs = camadas.filter((c) => c.modo === 'cobre').map((c) => [c.r, c.dx, c.dy]), folga = L.vista === 'planta' ? 63 : 16   // (a folga do Blender, como a V2)
  const gx0 = Math.min(...rs.map(([r, dx]) => r.gx0 + dx)) - folga, gy0 = Math.min(...rs.map(([r, , dy]) => r.gy0 + dy)) - folga
  const gx1 = Math.max(...rs.map(([r, dx]) => r.gx0 + dx + r.w)) + folga, gy1 = Math.max(...rs.map(([r, , dy]) => r.gy0 + dy + r.h)) + folga
  return { quadro: { gx0, gy0, W: gx1 - gx0, H: gy1 - gy0 }, nu: NU, coberto, camadas, expo: L.expo }
}

// ================================================================ a ilha (3/11)
// Fase 1: as duas fileiras do mesmo tamanho. Fase 2 (3/11, noite): cada metade (F, a frente; T, os fundos) com a sua
// fileira, de qualquer tamanho, e a cobertura bomba a bomba, sempre com peças que se reaproveitam (o pedido do Sergio:
// nada de peça para um formato só, como a V2). O chão de cada metade vai coluna a coluna pelo tipo (E, V, D, Fim, X, Z:
// preparar-lego.mjs). A cobertura vai por trechos cobertos de cada metade: a ponta de fora (na ponta da fileira) de i1,
// a ponta de dentro (no meio da fileira, ao lado de uma bomba descoberta) dos mistos, o meio e a viga de i1 onde as duas
// metades têm cobertura e as peças "só" (de i3/i4: a coluna inteira, com a viga do eixo e o que ela faz na outra metade)
// onde só esta tem; depois de cada ponta, a sobra dela no chão (fora); a fileira toda de 1 ou 2 vagas coberta, inteira
// (curta: as lâmpadas ficam em outro lugar)
// (a bomba é coberta se ela diz; se não, a regra de antes do app: a cobertura do posto, menos o Mobi; dados-sem-blender)
const cobIlha = (m, b) => (b.coberta !== undefined ? !!b.coberta : m.cobertura !== false && b.modelo !== 'mobi')
// (3/11, noite) toda ilha sai do Lego, também a bomba a bomba: a luz de cada trecho se mistura suave com a do vizinho
// (COSTURA). À noite ela fica mais clara que a V2 entre dois trechos cobertos, mas contínua (o Sergio aceitou assim)
export const ilhaLego = (m) => !!(m.ilha && (m.fileiras.frente || []).length && (m.fileiras.fundos || []).length)
export function planejarLegoIlha(L, m) {
  const I = L.ilha, DU = L.du, P = L.passo
  const fila = (lista) => { const bv = [], bs = [], cv = []; lista.forEach((b, i) => { const c = cobIlha(m, b); bs.push({ ...b, vagas: Number(b.vagas), anc: bv.length, c }); for (let q = 0; q < Number(b.vagas); q++) { bv.push(i); cv.push(c) } }); return { bv, bs, cv } }
  const R = { F: fila(m.fileiras.frente), T: fila(m.fileiras.fundos) }, n = { F: R.F.bv.length, T: R.T.bv.length }
  const NU = Math.max(n.F, n.T), outro = { F: 'T', T: 'F' }
  const coberto = [...R.F.cv, ...R.T.cv].some(Boolean)
  const tipo = (h, k) => (R[h].bv[k - 1] === R[h].bv[k] ? 'dentro' : 'entre')
  // os trechos cobertos de cada metade, [a, b] de vaga a vaga; a coluna k (do meio da vaga k-1 ao da k) está sob a
  // cobertura de uma metade se cai num trecho dela
  const trechos = {}
  for (const h of ['F', 'T']) { trechos[h] = []; const cv = R[h].cv; for (let q = 0; q < cv.length; q++) if (cv[q] && (q === 0 || !cv[q - 1])) { let e = q; while (e + 1 < cv.length && cv[e + 1]) e++; trechos[h].push([q, e + 1]) } }
  const cobCol = (h, k) => trechos[h].some(([a, b]) => k >= a && k <= b), cobVaga = (h, j) => j >= 0 && j < n[h] && R[h].cv[j]
  // as colunas de um trecho [a, b]: a ponta esquerda, o meio e a ponta direita (de fora, 2 colunas; de dentro, 1)
  const partes = (a, b, fora) => { const len = b - a; if (len === 1) return { e: [a, a], m: [], d: [b, b] }; if (len === 2) return { e: [a, a], m: [a + 1], d: [b, b] }; const d0 = fora ? b - 1 : b; return { e: [a, a + 1], m: Array.from({ length: d0 - a - 2 }, (_, i) => a + 2 + i), d: [d0, b] } }
  const camadas = []
  const poe = (r, kp, k, modo, alvo, extra = {}) => { if (r && r.arq) camadas.push({ r, dx: Math.round((kp - k) * DU[0]), dy: Math.round((kp - k) * DU[1]), modo, alvo, ...extra }) }
  const noChao = (a, b, lado) => ({ cols: [a, b], z: 'z', ...(lado ? { lado } : {}) }), noTeto = (a, b, lado) => ({ cols: [a, b], z: 'zteto', ...(lado ? { lado } : {}) })
  // 1. o chão de cada metade (as peças já vêm cortadas na metade), coluna a coluna pelo tipo. As laterais têm 2 colunas
  // quando a 2ª é vaga (a luz das lâmpadas da ponta passa da 1ª); a da direita sem fileira (Z), quando a penúltima é laje
  let pontaCortada = false
  for (const h of ['F', 'T']) {
    const C = I.chao[h], nh = n[h], e = nh >= 2 ? 1 : 0
    poe(C.E, 0, C.E.k, 'cobre', 'fundo', noChao(0, e))
    if (nh === NU) {
      const d = nh >= 2 && NU - 1 > e ? NU - 1 : NU
      for (let k = e + 1; k < d; k++) poe(C.V, k, C.V.k, 'cobre', 'fundo', noChao(k, k))
      poe(C.D, NU, C.D.k, 'cobre', 'fundo', noChao(d, NU))
      if (d === NU) pontaCortada = true
    } else {
      const z = NU - 1 > nh ? NU - 1 : NU
      for (let k = e + 1; k < nh; k++) poe(C.V, k, C.V.k, 'cobre', 'fundo', noChao(k, k))
      poe(C.Fim, nh, C.Fim.k, 'cobre', 'fundo', noChao(nh, nh))
      for (let k = nh + 1; k < z; k++) poe(C.X, k, C.X.k, 'cobre', 'fundo', noChao(k, k))
      poe(C.Z, NU, C.Z.k, 'cobre', 'fundo', noChao(z, NU))
      if (z === NU) pontaCortada = true
    }
  }
  const props = []
  const prop = (c, kf, extra = {}) => { if (!c) return; const passos = kf - (c.ref === 'D' ? c.nu : c.anc); props.push({ c, passos, dx: Math.round(passos * DU[0]), dy: Math.round(passos * DU[1]), prof: c.prof + passos * L.dprof, ...extra }) }
  if (coberto) {
    // 2. a cobertura sobre o chão. Cada lado monta, coluna a coluna, a lista das peças de luz e sombra que valem ali; as
    // colunas seguidas com a mesma lista viram um trecho, e cada trecho se mistura suave com o vizinho numa faixa de meia
    // vaga em volta da divisa (COSTURA; as peças da cobertura da ilha vêm com margem para isso). Sem isso, onde a peça
    // de um trecho coberto encontrava a de um descoberto, a luz mudava de uma vez na divisa (bordas retas, à noite)
    const C = I.cobertura, D = I.dentro || {}
    const lista = { F: Array.from({ length: NU + 1 }, () => []), T: Array.from({ length: NU + 1 }, () => []) }
    const usado = { F: new Array(NU + 1).fill(false), T: new Array(NU + 1).fill(false) }, vigas = []
    const poeC = (h, p, kp, a, b) => { if (!p || a > b) return; for (let k = Math.max(0, a); k <= Math.min(NU, b); k++) { lista[h][k].push({ p, kp }); usado[h][k] = true } }
    // a sobra de uma ponta de dentro (a coluna inteira) vale deste lado e, se ele está descoberto ali, do outro (a luz
    // passa o eixo). Numa coluna, as sobras da própria metade somam (as duas pontas vizinhas iluminam a vaga do meio); a
    // que passa o eixo só entra sem nenhuma da própria. Não conta como coberta: a cobertura do outro lado, se houver, soma
    const sobra = { F: [], T: [] }
    const anota = (s, k, p, kp, prio) => {
      if (!p || k < 0 || k > NU) return
      const a = sobra[s][k]
      if (!a || prio < a.prio) sobra[s][k] = { prio, lista: [{ p, kp }] }
      else if (prio === a.prio && prio === 0) a.lista.push({ p, kp })
    }
    for (const h of ['F', 'T']) {
      const o = outro[h], nh = n[h], So = I.so[h]
      const poeSobra = (p, kp, k) => { anota(h, k, p, kp, 0); if (!cobCol(o, k)) anota(o, k, p, kp, 1) }
      trechos[h].forEach(([a, b], ti) => {
        const len = b - a, oL = a === 0, oR = b === nh, prox = ti + 1 < trechos[h].length ? trechos[h][ti + 1][0] : Infinity, ant = ti > 0 ? trechos[h][ti - 1][1] : -Infinity
        // a fileira toda coberta de 1 ou 2 vagas: inteira, com a sobra de 1 coluna
        if (oL && oR && len <= 2 && I.curta[h][len]) { poeC(h, I.curta[h][len], 0, 0, Math.min(len + 1, NU)); return }
        const pt = partes(a, b, oR), pE = oL ? C.esq : D[h] && D[h].esq
        const pD = oR ? (b === NU && !cobCol(o, NU) && !cobCol(o, NU - 1) ? So.dir : C.dir) : D[h] && D[h].dir
        poeC(h, pE, a, ...pt.e); poeC(h, pD, b, ...pt.d)
        for (const k of pt.m) poeC(h, cobCol(o, k) ? C.meio : So.meio, k, k, k)
        // a sobra depois das pontas: a de dentro (na vaga descoberta do lado), a do fim da fileira no meio da laje
        if (!oL && D[h] && a - 1 > ant) poeSobra(D[h].foraEsq, a, a - 1)
        if (!oR && D[h] && b + 1 < prox) poeSobra(D[h].foraDir, b, b + 1)
        if (oR && b < NU) poeC(h, I.fora[h], b + 1, b + 1, Math.min(b + 2, NU))
        // as vigas entre bombas dentro do trecho (onde a outra metade não tem cobertura, a viga "só"): por cima, na coluna
        for (let k = a + 1; k < b; k++) if (tipo(h, k) === 'entre') vigas.push([cobCol(o, k) ? C[`viga${h}`] : So.viga, k, h])
      })
    }
    for (const s of ['F', 'T']) {
      const SoO = I.so[outro[s]]
      for (let k = 0; k <= NU; k++) {
        if (usado[s][k]) continue
        if (sobra[s][k]) lista[s][k].push(...sobra[s][k].lista)
        // as colunas deste lado sem cobertura dele, sob a do outro: o que a outra faz aqui (na laje ou na vaga)
        if (cobCol(outro[s], k)) lista[s][k].push(k >= NU - 1 ? { p: SoO.dir, kp: NU } : { p: SoO.meio, kp: k })
      }
    }
    const chave = (l) => l.map(({ p, kp }) => `${(p.sombra || p.luz || {}).arq}@${kp}`).join(',')
    for (const nm of ['sombra', 'luz']) {
      const modo = nm === 'sombra' ? 'multiplica' : 'soma'
      for (const s of ['F', 'T']) for (let k0 = 0; k0 <= NU;) {
        let k1 = k0; const ch = chave(lista[s][k0]); while (k1 + 1 <= NU && chave(lista[s][k1 + 1]) === ch) k1++
        // (a luz da peça que no posto-exemplo dela caía numa vaga e aqui cai onde não há vaga fica de fora)
        for (const { p, kp } of lista[s][k0]) {
          const f = p.filas, vg = f && nm === 'luz' ? { faixas: [[-2.05, 4.95, 0, n.F * P, 0, f.F * P], [2 * I.ym - 4.95, 2 * I.ym + 2.05, 0, n.T * P, 0, f.T * P]], desloc: (kp - p.k) * P, suave: 0.6 } : null
          poe(p[nm], kp, p.k, modo, 'fundo', { z: 'z', lado: s, costura: { k0, k1, nu: NU }, ...(vg ? { vagas: vg } : {}) })
        }
        k0 = k1 + 1
      }
      for (const [v, k, h] of vigas) if (v) poe(v[nm], k, v.k, modo, 'fundo', noChao(k, k, h))
    }
    // (3/11, noite) o canteiro da ponta direita do eixo vai por cima da luz da cobertura quando, na lateral direita, ela
    // vem de um posto-exemplo em que ali não era a ponta (a cobertura curta, a sobra, a do outro lado): sem isso os
    // arbustos sumiam à noite
    const alinhada = ({ p, kp }) => { const f = p.filas; return f && Math.max(f.F, f.T) - p.k === NU - kp }
    const fora = ['F', 'T'].some((s) => lista[s][NU].some((x) => !alinhada(x)))
    const ob = I.objetoPonta && I.objetoPonta[cobCol('F', NU) || cobCol('T', NU) || cobCol('F', NU - 1) || cobCol('T', NU - 1) ? 'c1' : 'c0']
    if ((fora || pontaCortada) && ob && ob.arq) poe(ob, NU, ob.k, 'cobre', 'fundo')
  } else if (pontaCortada && I.objetoPonta && I.objetoPonta.c0 && I.objetoPonta.c0.arq) poe(I.objetoPonta.c0, NU, I.objetoPonta.c0.k, 'cobre', 'fundo')
  if (coberto) {
    // os pilares do eixo: em cada trecho, nas pontas (20 cm para fora na ponta da fileira; na divisa no meio dela) e nas
    // divisas entre bombas; um só onde dois cairiam a menos de 30 cm. Com a cobertura só de um lado, o pilar "só"
    const ks = [], ponta = (h, a, b) => [a === 0 ? -PILAR_PONTA : a, b === n[h] ? b + PILAR_PONTA : b]
    const pilar = (k) => { if (!ks.some((x) => Math.abs(x - k) < 0.3 / P)) ks.push(k) }
    for (const h of ['F', 'T']) for (const [a, b] of trechos[h]) { const [x0, x1] = ponta(h, a, b); pilar(x0); pilar(x1); for (let k = a + 1; k < b; k++) if (tipo(h, k) === 'entre') pilar(k) }
    for (const kf of ks) prop(I.props.pilar.c1, kf, { tipo: 'pilar' })
  }
  // 3 e 4. as bombas: a da frente de cada modelo e a de trás (virada), coberta ou não; a de 1 vaga, a mesma imagem meia
  // vaga para a esquerda, com a sombra e a luz no chão de uma bomba de 1 vaga da ilha (a da de 2 vagas deslocada punha à
  // noite o logo e as faixas da vaga meia vaga fora do lugar)
  // (bi: a bomba na ordem do painel, a frente e depois os fundos, para a máscara dos estados: falha, desligada)
  let bi = 0
  for (const [bs, pre, ef, fileira] of [[R.F.bs, 'bomba', 'efeito1', 'frente'], [R.T.bs, 'bombaT', 'efeitoT1', 'fundos']]) for (const b of bs) {
    const cb = b.c ? 'c1' : 'c0', c = I.props[`${pre}-${b.modelo}`][cb], e = I.props[`${ef}-${b.modelo}`]
    if (b.vagas === 2 || !e) { prop(c, b.anc - (b.vagas === 1 ? 0.5 : 0), { tipo: 'bomba', fileira, bi: bi++ }); continue }
    prop({ ...c, sombra: null, luzimg: null }, b.anc - 0.5, { tipo: 'bomba', fileira, bi: bi++ })
    prop(e[cb], b.anc)
  }
  // a árvore e o totem: a imagem de i1 (coberta se uma cobertura chega na ponta deles); a sombra e a luz no chão, as da
  // ilha do mesmo tamanho (1, 2 ou 3+ vagas) e, no totem, com a fileira da frente chegando nele ou não
  const cA = cobCol('F', 0) || cobCol('T', 0) ? 'c1' : 'c0', cT = cobCol('F', NU) || cobCol('T', NU) ? 'c1' : 'c0'
  const ncl = `n${Math.min(NU, 3)}`, ea = (I.props.efeitoArvore || {})[ncl], et = (I.props.efeitoTotem || {})[`${ncl}|v${n.F === NU ? 1 : 0}`] || (I.props.efeitoTotem || {})[`${ncl}|v1`]
  if (ea) { prop({ ...I.props.arvore[cA], sombra: null, luzimg: null }, 0, { tipo: 'arvore' }); prop(ea[cA], 0) } else prop(I.props.arvore[cA], 0, { tipo: 'arvore' })
  if (et) { prop({ ...I.props.totem[cT], sombra: null, luzimg: null }, NU, { tipo: 'totem' }); prop(et[cT], NU) } else prop(I.props.totem[cT], NU, { tipo: 'totem' })
  // (a luz das peças de pé como na fileira: aqui nas vagas da frente e nas de trás, cada fileira até onde ela vai)
  // (cada faixa com as vagas da fileira dela aqui e no posto-exemplo da peça)
  const vagas = (p) => { const f = p.c.filas || { F: p.c.nu || I.nu, T: p.c.nu || I.nu }; return { faixas: [[-2.05, 4.95, 0, n.F * P, 0, f.F * P], [2 * I.ym - 4.95, 2 * I.ym + 2.05, 0, n.T * P, 0, f.T * P]], desloc: p.passos * P, suave: 0.6 } }
  for (const p of props) if (p.c.sombra) camadas.push({ r: p.c.sombra, dx: p.dx, dy: p.dy, modo: 'multiplica', alvo: 'fundo' })
  for (const p of props) if (p.c.luzimg) camadas.push({ r: p.c.luzimg, dx: p.dx, dy: p.dy, modo: 'soma', alvo: 'fundo', vagas: vagas(p) })
  for (const p of props.sort((x, y) => y.prof - x.prof)) if (p.c.spr) camadas.push({ r: p.c.spr, dx: p.dx, dy: p.dy, modo: 'cobre', alvo: 'fundo', peca: true, tipo: p.tipo, fileira: p.fileira, bi: p.bi })
  // 5. o teto, metade a metade e trecho a trecho: as pontas (de fora de i1, cortadas na metade; de dentro dos mistos), o
  // meio e a viga de i1 onde as duas metades têm cobertura; onde só esta tem, a coluna "só" inteira (com a viga do eixo);
  // a fileira toda de 1 ou 2 vagas, inteira (curta). O teto é vidro: onde vai a viga, ela vai no lugar do meio (um por
  // cima do outro dobraria)
  if (coberto) {
    const T = I.teto, D = I.dentro || {}
    for (const h of ['F', 'T']) {
      const o = outro[h], nh = n[h], So = I.so[h].teto, viga = T[`viga${h}`], meio = T[`meio${h}`]
      // a coluna k do meio: com as duas metades cobertas, o meio ou a viga desta; só ela, a coluna "só" inteira
      const col = (k, eViga) => { const p = cobCol(o, k) ? (eViga ? viga : meio) : eViga ? So.viga : So.meio; poe(p, k, p.k, 'cobre', 'teto', noTeto(k, k, cobCol(o, k) ? h : null)) }
      for (const [a, b] of trechos[h]) {
        const len = b - a, oL = a === 0, oR = b === nh
        if (oL && oR && len <= 2 && I.curta[h][len]) {
          const cu = I.curta[h][len].teto
          if (len === 2 && tipo(h, 1) === 'entre') { poe(cu, 0, cu.k, 'cobre', 'teto', noTeto(0, 0)); poe(cu, 0, cu.k, 'cobre', 'teto', noTeto(2, 2)); col(1, true) }
          else poe(cu, 0, cu.k, 'cobre', 'teto', noTeto(0, len))
          continue
        }
        const pt = partes(a, b, oR), pE = oL ? T.esq : D[h] && D[h].esq.teto
        const soP = oR && b === NU && !cobCol(o, NU) && !cobCol(o, NU - 1), pD = oR ? (soP ? So.dir : T.dir) : D[h] && D[h].dir.teto
        // a ponta de 2 colunas com a 2ª numa divisa entre bombas: a 2ª vai como viga
        const vE = pt.e[1] > pt.e[0] && tipo(h, pt.e[1]) === 'entre', vD = pt.d[1] > pt.d[0] && tipo(h, pt.d[0]) === 'entre'
        if (pE) poe(pE, a, pE.k, 'cobre', 'teto', noTeto(pt.e[0], vE ? pt.e[0] : pt.e[1], h))
        if (vE) col(pt.e[1], true)
        for (const k of pt.m) col(k, tipo(h, k) === 'entre')
        if (pD) poe(pD, b, pD.k, 'cobre', 'teto', noTeto(vD ? pt.d[1] : pt.d[0], pt.d[1], soP ? null : h))
        if (vD) col(pt.d[0], true)
        // (3/11, noite) o letreiro da ponta passa para a coluna do lado: com a viga nela, vai por cima (o da frente na
        // ponta direita dela, o dos fundos na esquerda)
        if (vD && h === 'F' && oR) poe(T.letreiroDir, b, T.letreiroDir.k, 'cobre', 'teto')
        if (vE && h === 'T' && oL) poe(T.letreiroEsq, 0, T.letreiroEsq.k, 'cobre', 'teto')
      }
    }
  }
  const rs = camadas.filter((c) => c.modo === 'cobre').map((c) => [c.r, c.dx, c.dy]), folga = L.vista === 'planta' ? 63 : 16
  const gx0 = Math.min(...rs.map(([r, dx]) => r.gx0 + dx)) - folga, gy0 = Math.min(...rs.map(([r, , dy]) => r.gy0 + dy)) - folga
  const gx1 = Math.max(...rs.map(([r, dx]) => r.gx0 + dx + r.w)) + folga, gy1 = Math.max(...rs.map(([r, , dy]) => r.gy0 + dy + r.h)) + folga
  return { quadro: { gx0, gy0, W: gx1 - gx0, H: gy1 - gy0 }, nu: NU, coberto, ilha: true, ym: I.ym, camadas, expo: L.expo }
}
// a fileira ou a ilha, pela montagem
export const planejar = (L, m) => (m.ilha && (m.fileiras.fundos || []).length ? planejarLegoIlha(L, m) : planejarLego(L, m))

// junta as camadas em luz linear pré-multiplicada: devolve { fundo, teto, sobre } (Float32Array RGBA). sobre(c): as
// peças que vão também numa camada só delas (a ilha no painel: na 2D, as bombas de trás, os pilares e a árvore, por
// cima dos carros de trás; no 3D, só a árvore)
export async function montarLego(L, plano, ler, sobre = null, opc = {}) {
  const { gx0, gy0, W, H } = plano.quadro, imgs = new Map()
  const img = (arq) => { if (!imgs.has(arq)) imgs.set(arq, ler(arq)); return imgs.get(arq) }
  for (const c of plano.camadas) img(c.r.arq).catch(() => {})
  // a coluna de cada pixel do quadro no plano z (chão) ou zteto (teto): u = x / passo - 0.5 é linear em i e j; na
  // ilha, também o lado (frente ou fundos: o y do chão ou do teto antes ou depois do eixo, y_meio)
  const cam = L.camera, colDe = {}, ladoDe = {}, xDe = {}, yDe = {}
  for (const nome of ['z', 'zteto']) {
    const z = cam[nome], [rx, ry, rz] = cam.rv, [ux, uy, uz] = cam.uv, [fx, fy, fz] = cam.fv, P = cam.pxm
    const pt = (a, b) => { const t = (z - a * rz + b * uz) / fz; return [a * rx - b * ux + t * fx, a * ry - b * uy + t * fy + (cam.oy || 0)] }
    const p0 = pt((gx0 + 0.5) / P, (gy0 + 0.5) / P), pi = pt((gx0 + 1.5) / P, (gy0 + 0.5) / P), pj = pt((gx0 + 0.5) / P, (gy0 + 1.5) / P)
    const [x0, y0] = p0, xi = pi[0] - x0, xj = pj[0] - x0, yi = pi[1] - y0, yj = pj[1] - y0
    colDe[nome] = (i, j) => Math.max(0, Math.min(plano.nu, Math.floor((x0 + xi * i + xj * j) / L.passo - 0.5) + 1))
    ladoDe[nome] = (i, j) => (y0 + yi * i + yj * j < plano.ym ? 'F' : 'T')
    xDe[nome] = (i, j) => x0 + xi * i + xj * j
    yDe[nome] = (i, j) => y0 + yi * i + yj * j
  }
  // o filtro de cada camada: as colunas dela, se tiver a metade e, na luz das peças de pé, as vagas (no plano do chão:
  // dentro da faixa das vagas, só de x0 a x1)
  const dentro = (c) => {
    if (!c.cols && !c.lado && !c.vagas) return null
    const col = colDe[c.z || 'z'], lado = ladoDe[c.z || 'z'], xm = xDe[c.z || 'z'], ym = yDe[c.z || 'z']
    return (x, y) => {
      if (c.cols) { const k = col(x, y); if (k < c.cols[0] || k > c.cols[1]) return false }
      if (c.vagas && !c.vagas.suave) {
        // sobre uma vaga do posto-exemplo de onde a peça veio (x menos o deslocamento), mas aqui fora das vagas da fileira
        // daquela faixa
        const v = xm(x, y), V = c.vagas, k = v - V.desloc, w = ym(x, y)
        for (const [a, b, x0, x1, k0, k1] of V.faixas) if (w >= a && w < b && (v < x0 || v > x1) && k >= k0 && k <= k1) return false
      }
      return !c.lado || lado(x, y) === c.lado
    }
  }
  // (3/11, noite) o peso de uma peça de luz ou sombra da cobertura da ilha: 1 nas colunas k0 a k1 dela e, em volta de
  // cada divisa com outro trecho, uma rampa suave de 1 a 0 numa faixa de COSTURA vaga para cada lado (a do vizinho faz
  // o contrário: somam 1). Nas pontas do posto não some (não há vizinho)
  const suave = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
  // (3/11, noite) e, com vagas.suave, a luz de uma peça de pé ou da cobertura vale na faixa das vagas só onde "ter vaga"
  // é igual no posto-exemplo de onde ela veio e aqui: a luz guarda a cor do chão que iluminou (o logo e a pintura da
  // vaga, ou o cinza do piso). Onde lá era vaga e aqui não é, ela levava uma vaga fantasma; onde lá era piso e aqui é
  // vaga, um retângulo claro. Sempre com transição suave (vagas.suave metros), nunca com corte reto (o brilho do frade da
  // ponta terminava reto onde a fileira começa)
  const dentroSuave = (v, x0, x1, s) => suave((v - x0) / s + 0.5) * (1 - suave((v - x1) / s + 0.5))
  const fatorDe = (c) => {
    const V = c.vagas && c.vagas.suave ? c.vagas : null
    if (!c.costura && !V) return null
    const xm = xDe.z, ym = yDe.z, P = L.passo, cs = c.costura, cw = COSTURA * P
    const xl = cs ? (cs.k0 - 0.5) * P : 0, xr = cs ? (cs.k1 + 0.5) * P : 0
    return (x, y) => {
      const v = xm(x, y)
      let w = cs ? (cs.k0 > 0 ? suave((v - xl + cw) / (2 * cw)) : 1) * (cs.k1 < cs.nu ? 1 - suave((v - xr + cw) / (2 * cw)) : 1) : 1
      if (V && w) {
        const k = v - V.desloc, u = ym(x, y)
        for (const [a, b, x0, x1, k0v, k1v] of V.faixas) {
          const faixa = dentroSuave(u, a, b, 0.3); if (!faixa) continue
          w *= 1 - faixa * Math.abs(dentroSuave(v, x0, x1, V.suave) - dentroSuave(k, k0v, k1v, V.suave))
        }
      }
      return w
    }
  }
  const fundo = new Float32Array(W * H * 4), teto = new Float32Array(W * H * 4), camSobre = sobre ? new Float32Array(W * H * 4) : null
  // (3/11, noite) a máscara das bombas: em cada pixel, qual bomba aparece ali (1, 2, ...; 0 nenhuma). O painel usa para
  // mostrar a bomba em falha (as partes verdes acesas ficam vermelhas e piscam) ou desligada (apagam), sem imagem nova.
  // As peças de pé vão de trás para a frente: a da frente cobre a de trás (e o pilar, a árvore e o totem tiram a marca)
  // (e, junto, o quanto cada pixel da bomba é luz acesa: a tela, os LEDs, o anel dos frades; medido na imagem da bomba à
  // noite, onde só o que acende fica verde e claro. De dia a pintura verde do corpo parecia tela acesa)
  const mascara = opc.mascara ? new Uint8Array(W * H) : null, aceso = opc.mascara ? new Uint8Array(W * H) : null
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
  for (const c of plano.camadas) {
    const im = await img(c.r.arq), d = im.d, s = c.r.escala || 1
    const ox = c.r.gx0 + c.dx - gx0, oy = c.r.gy0 + c.dy - gy0, ok = dentro(c)
    const bufs = [c.alvo === 'teto' ? teto : fundo]; if (camSobre && c.modo === 'cobre' && sobre(c)) bufs.push(camSobre)
    if (s > 1) { menor(c, im, bufs[0], ox, oy, W, H, ok, fatorDe(c)); continue }
    const fat = c.modo === 'cobre' ? null : fatorDe(c)
    for (const buf of bufs) for (let y = Math.max(0, oy); y < Math.min(H, oy + c.r.h); y++) for (let x = Math.max(0, ox); x < Math.min(W, ox + c.r.w); x++) {
      if (ok && !ok(x, y)) continue
      const o = (y * W + x) * 4
      const q = ((y - oy) * im.w + (x - ox)) * 4, a = d[q + 3] / 255
      if (!a) continue
      const f = fat ? fat(x, y) : 1; if (!f) continue
      if (c.modo === 'cobre') { const k = 1 - a; for (let n = 0; n < 3; n++) buf[o + n] = LIN[d[q + n]] * a + buf[o + n] * k; buf[o + 3] = a + buf[o + 3] * k }
      else if (c.modo === 'multiplica') { for (let n = 0; n < 3; n++) buf[o + n] *= f === 1 ? RAZ[d[q + n]] : RAZ[d[q + n]] ** f }
      else { for (let n = 0; n < 3; n++) buf[o + n] += LIN[d[q + n]] * a * f }
    }
    if (mascara && c.peca && c.alvo === 'fundo') {
      const id = c.tipo === 'bomba' && c.bi !== undefined ? c.bi + 1 : 0
      for (let y = Math.max(0, oy); y < Math.min(H, oy + c.r.h); y++) for (let x = Math.max(0, ox); x < Math.min(W, ox + c.r.w); x++) {
        const q = ((y - oy) * im.w + (x - ox)) * 4; if (d[q + 3] <= 128) continue
        mascara[y * W + x] = id
        if (!id) { aceso[y * W + x] = 0; continue }
        const r = LIN[d[q]] / 2, g = LIN[d[q + 1]] / 2, b = LIN[d[q + 2]] / 2, lv = 0.2126 * r + 0.7152 * g + 0.0722 * b
        aceso[y * W + x] = Math.round(255 * sm(0.03, 0.15, g - Math.max(r, b)) * sm(0.04, 0.2, lv))
      }
    }
  }
  return { fundo, teto, sobre: camSobre, mascara, aceso }
}

// sombra (multiplica; transparente = 1) ou luz (soma; transparente = 0) guardada pela metade, interpolada no pixel
// inteiro (bilinear), com as colunas de amostra calculadas uma vez por imagem (a mesma conta do soltas-montar.js da V2)
function menor(c, im, buf, ox, oy, W, H, ok, fator = null) {
  const s = c.r.escala, w = im.w, h = im.h, d = im.d, soma = c.modo === 'soma'
  const F = new Float32Array(w * h * 3), N = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const q = i * 4, a = d[q + 3] / 255
    if (!a) { N[i] = 1; if (!soma) F[i * 3] = F[i * 3 + 1] = F[i * 3 + 2] = 1; continue }
    for (let k = 0; k < 3; k++) F[i * 3 + k] = soma ? LIN[d[q + k]] * a : RAZ[d[q + k]]
  }
  const sx0 = Math.max(0, -ox), sx1 = Math.min(c.r.w, W - ox), nx = Math.max(0, sx1 - sx0)
  const X0 = new Int32Array(nx), X1 = new Int32Array(nx), TX = new Float32Array(nx)
  for (let q = 0; q < nx; q++) { const fx = Math.min(w - 1, Math.max(0, (sx0 + q + 0.5) / s - 0.5)); X0[q] = Math.floor(fx); X1[q] = Math.min(w - 1, X0[q] + 1); TX[q] = fx - X0[q] }
  for (let sy = Math.max(0, -oy); sy < Math.min(c.r.h, H - oy); sy++) {
    const fy = Math.min(h - 1, Math.max(0, (sy + 0.5) / s - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0
    const l0 = y0 * w, l1 = y1 * w, base = ((sy + oy) * W + sx0 + ox) * 4
    for (let q = 0; q < nx; q++) {
      const a = l0 + X0[q], b = l0 + X1[q], cc = l1 + X0[q], dd = l1 + X1[q]
      if (N[a] && N[b] && N[cc] && N[dd]) continue
      if (ok && !ok(sx0 + q + ox, sy + oy)) continue
      const tx = TX[q], o = base + q * 4, a3 = a * 3, b3 = b * 3, c3 = cc * 3, d3 = dd * 3, f = fator ? fator(sx0 + q + ox, sy + oy) : 1
      if (!f) continue
      for (let k = 0; k < 3; k++) {
        const v = (F[a3 + k] * (1 - tx) + F[b3 + k] * tx) * (1 - ty) + (F[c3 + k] * (1 - tx) + F[d3 + k] * tx) * ty
        if (soma) buf[o + k] += v * f; else buf[o + k] *= f === 1 ? v : v ** f
      }
    }
  }
}

// lê uma imagem (RGBA de 8 bits, cor reta) e conta os bytes baixados
function leitor(base, conta) {
  return async (arq) => {
    const blob = await fetch(base + arq).then((r) => { if (!r.ok) throw new Error(`não achei ${arq}`); return r.blob() })
    conta.bytes += blob.size; conta.arquivos++
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
    const cv = new OffscreenCanvas(bmp.width, bmp.height), g = cv.getContext('2d', { willReadFrequently: true })
    g.drawImage(bmp, 0, 0); const id = g.getImageData(0, 0, bmp.width, bmp.height); bmp.close()
    return { w: id.width, h: id.height, d: new Uint8Array(id.data.buffer) }
  }
}

// monta um posto num horário com as peças de Lego e devolve as imagens prontas (o chão com as peças e, por cima, o teto)
export async function montarV3(m, per, vista = '3d') {
  const t0 = performance.now(), conta = { bytes: 0, arquivos: 0 }, base = `lego/${vista}-${per}/`
  const L = await fetch(base + 'lego.json').then((r) => r.json()), plano = planejar(L, m)
  const { fundo, teto } = await montarLego(L, plano, leitor(base, conta))
  const { W, H } = plano.quadro
  if (per === 'noite' || per === 'por') { brilho(fundo, W, H); brilho(teto, W, H) }
  const chao = document.createElement('canvas'); chao.width = W; chao.height = H
  chao.getContext('2d').putImageData(new ImageData(paraTela(fundo, W, H, plano.expo), W, H), 0, 0)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const g = cv.getContext('2d'); g.drawImage(chao, 0, 0)
  const tcv = new OffscreenCanvas(W, H); tcv.getContext('2d').putImageData(new ImageData(paraTela(teto, W, H, plano.expo), W, H), 0, 0)
  g.drawImage(tcv, 0, 0)
  return { canvas: cv, chao, quadro: plano.quadro, plano, bytes: conta.bytes, arquivos: conta.arquivos, ms: performance.now() - t0 }
}
