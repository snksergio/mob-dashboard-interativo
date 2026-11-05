// iGreen · prova "maquete por peças": as chaves de contexto. Duas peças com a mesma chave têm a mesma luz e as mesmas
// sombras, então uma serve no lugar da outra. Usado pelo montador (compor.js) e pelo planejador da biblioteca.
//
// Chão e teto: a vaga k depende das vagas até W para cada lado (W = 2: a sombra do letreiro e a luz de preenchimento
// por baixo da cobertura alcançam duas vagas). Cada vaga é 0 (sem cobertura), 1 (com) ou C (fora do posto); entre
// duas vagas cobertas de bombas diferentes há uma divisa (d), com pilar e viga.
// Peças altas: a bomba depende do modelo, das vagas, da cobertura dela e do que há em cada lado (a cobertura da
// vizinha da direita faz sombra nela, o pilar da esquerda tira a luz de preenchimento); o pilar depende de quem fica
// à esquerda dele (a bomba vizinha tira a luz de preenchimento).
export const W_PADRAO = 2
// Uma bomba da montagem é coberta? Desde 29/10 cada bomba pode dizer (`coberta`), e o construtor diz em toda montagem
// nova (com cobertura, o Mobi também fica coberto). Sem `coberta`, vale a regra de antes: a cobertura do posto, menos o
// Mobi, que ficava sempre sem. A mesma regra no construtor, na fila, no catalogo.html, no dados-sem-blender e no Blender
export const coberta = (m, b) => (b.coberta !== undefined ? !!b.coberta : !!m.cobertura && b.modelo !== 'mobi')

// Ilha: a frente (F) e os fundos (T), cada fileira com as suas vagas (bomba e cobertura de cada uma). As duas começam no
// mesmo x e a vaga k dos fundos fica atrás da vaga k da frente; nu é a fileira mais comprida. As bombas têm o índice
// global (frente, depois fundos), como na v14
export function estrutura(m) {
  const fr = m.fileiras.frente, fu = (m.ilha && m.fileiras.fundos) || []
  const bombas = [...fr, ...fu].map((b) => ({ modelo: b.modelo, vagas: Number(b.vagas), coberta: coberta(m, b) }))
  const fila = (lista, off) => {
    const bomba_u = []
    lista.forEach((b, j) => { for (let k = 0; k < Number(b.vagas); k++) bomba_u.push(off + j) })
    return { bomba_u, n: bomba_u.length, cob: bomba_u.map((bi) => (bombas[bi].coberta ? 1 : 0)) }
  }
  const F = fila(fr, 0), T = fila(fu, fr.length)
  return { bombas, bomba_u: F.bomba_u, cob: F.cob, nu: Math.max(F.n, T.n), ilha: T.n > 0, F, T }
}
// as duas fileiras de uma estrutura ou de um indice.json (que guarda a frente em cob/bomba_u e os fundos em cob_t/bomba_t)
export function filas(e) {
  if (e.F) return e
  const F = { bomba_u: e.bomba_u, cob: e.cob, n: e.ilha ? e.nu_f : e.nu }
  const T = e.ilha ? { bomba_u: e.bomba_t, cob: e.cob_t, n: e.nu_t } : { bomba_u: [], cob: [], n: 0 }
  return { ...e, ilha: !!e.ilha, F, T }
}
export const est = (e, k) => (k < 0 || k >= e.nu ? 'C' : String(e.cob[k]))
// divisa na borda à esquerda da vaga k (entre k-1 e k)
export const divisa = (e, k) => k > 0 && k < e.nu && !!e.cob[k - 1] && !!e.cob[k] && e.bomba_u[k - 1] !== e.bomba_u[k]
function trecho(e, a, b) {           // vagas a..b com as bordas entre elas
  let s = ''
  for (let j = a; j <= b; j++) s += (j > a ? (divisa(e, j) ? 'd' : '.') : '') + est(e, j)
  return s
}
export const chaveVaga = (e, k, W = W_PADRAO) => trecho(e, k - W, k + W)
export const pontaE = (e, W = W_PADRAO) => 'E' + trecho(e, 0, W - 1)
export const pontaD = (e, W = W_PADRAO) => 'D' + trecho(e, e.nu - W, e.nu - 1)

// Chave longa: à noite, a luz das telas e da cobertura e, no pôr do sol, as sombras compridas alcançam duas vagas. O
// pilar da ponta, a árvore e o totem guardam também (em `longe`) as bombas das duas vagas do lado de fora deles, com a
// cobertura de cada uma (C fora do posto); o montador procura primeiro essa chave e, sem ela, a curta
function lado(e, a, b) {
  const out = []
  for (let k = a; k <= b; k++) {
    const s = k < 0 || k >= e.nu ? 'C' : `${e.bombas[e.bomba_u[k]].modelo}${e.bombas[e.bomba_u[k]].vagas}${e.cob[k]}#${e.bomba_u[k]}`
    if (out[out.length - 1] !== s) out.push(s)
  }
  return out.map((s) => s.replace(/#\d+$/, '')).join(',')
}

// as peças altas de um formato: tipo, papel, âncora (a vaga a partir da qual a peça é posta) e a chave
export function pecasDe(e) {
  const lista = [], tipoB = (bi) => `${e.bombas[bi].modelo}${e.bombas[bi].vagas}`
  e.bombas.forEach((b, bi) => {
    const us = e.bomba_u.flatMap((x, k) => (x === bi ? [k] : [])), u0 = us[0], u1 = us[us.length - 1]
    lista.push({ tipo: 'bomba', papel: 'bomba', ancora: u0, rotulo: `bomba ${bi + 1}`,
      chave: `${tipoB(bi)}|${e.cob[u0]}|${est(e, u0 - 1)}${est(e, u1 + 1)}` })
  })
  for (let i = 0; i < e.nu;) {
    if (!e.cob[i]) { i++; continue }
    let j = i
    while (j + 1 < e.nu && e.cob[j + 1]) j++
    // o pilar leva as duas bombas vizinhas: a da esquerda tira dele a luz de preenchimento e, à noite, a tela acesa
    // da bomba ao lado o ilumina (a de uma Mobi Fast, com a placa alta, clareia o pilar mais que a de uma Ultra)
    const ce = `pilar-e|${i === 0 ? 'C' : tipoB(e.bomba_u[i - 1])}|${tipoB(e.bomba_u[i])}`
    const cd = `pilar-d|${j === e.nu - 1 ? 'C' : tipoB(e.bomba_u[j + 1])}|${tipoB(e.bomba_u[j])}`
    lista.push({ tipo: 'pilar', papel: 'e', ancora: i, rotulo: 'pilar da ponta esquerda', chave: ce, longe: `${ce}|${lado(e, i - 2, i - 1)}` })
    lista.push({ tipo: 'pilar', papel: 'd', ancora: j, rotulo: 'pilar da ponta direita', chave: cd, longe: `${cd}|${lado(e, j + 1, j + 2)}` })
    for (let k = i + 1; k <= j; k++) {
      if (divisa(e, k)) lista.push({ tipo: 'pilar', papel: 'div', ancora: k, rotulo: `pilar entre as vagas ${k} e ${k + 1}`, chave: `pilar-div|${tipoB(e.bomba_u[k - 1])}|${tipoB(e.bomba_u[k])}` })
    }
    i = j + 1
  }
  lista.push({ tipo: 'arvore', papel: 'arvore', ancora: 0, rotulo: 'árvore', chave: `arvore|${e.cob[0]}`, longe: `arvore|${lado(e, 0, 1)}` })
  lista.push({ tipo: 'totem', papel: 'totem', ancora: e.nu, rotulo: 'totem', chave: `totem|${e.cob[e.nu - 1]}`, longe: `totem|${lado(e, e.nu - 2, e.nu - 1)}` })
  return lista
}
// ---------------------------------------------------------------- ilha: chão e teto por faixa
// Cada vaga k da ilha é cortada em faixas pelo y do ponto do chão (ou do teto), contado do eixo do meio (y = 6,4 m):
//   F  a frente, até 2 m antes do eixo: olha só a fileira da frente, até W vagas para cada lado, como a fileira simples
//      (a sombra do letreiro, que alcança duas vagas, cai a uns 3 m do eixo: fica toda aqui);
//   N  os 2 m da frente antes do eixo: à noite, os spots da cobertura dos fundos iluminam aqui;
//   M  os 3 m dos fundos depois do eixo (a cabeceira das vagas de trás): de dia, a cobertura da frente joga sombra aqui
//      (o sol vem da frente) e, à noite, os spots dela iluminam;
//   T  o resto dos fundos: só a fileira dos fundos, até W vagas para cada lado.
// N e M olham as duas fileiras, uma vaga para cada lado. Medido em 28/10 (ferramentas/ilha-cruzado.mjs, tarde e noite,
// tirando a cobertura de uma bomba de uma fileira): fora de N e M a outra fileira muda menos de 3,4 de 255 em média
// (de dia, nada) e no máximo 1,9% dos pixels acima de 10, à noite; dentro, a mudança vai até a vaga vizinha.
// As mesmas faixas estão no pecas.py (FAIXAS_PY), que corta os pedaços.
// Uma vaga da fileira mais curta que fica fora dela é pátio (P). As pontas da laje olham as duas fileiras. Chaves com I
// na frente: não se misturam com as da fileira simples
export const FAIXAS_ILHA = [['F', -Infinity, -2], ['N', -2, 0], ['M', 0, 3], ['T', 3, Infinity]]
const estI = (e, R, k) => (k < 0 || k >= e.nu ? 'C' : k >= R.n ? 'P' : String(R.cob[k]))
const divI = (R, k) => k > 0 && k < R.n && !!R.cob[k - 1] && !!R.cob[k] && R.bomba_u[k - 1] !== R.bomba_u[k]
function trechoI(e, R, a, b) {
  let s = ''
  for (let j = a; j <= b; j++) s += (j > a ? (divI(R, j) ? 'd' : '.') : '') + estI(e, R, j)
  return s
}
// da outra fileira, em N e M, só importa se há cobertura (a sombra dela de dia, os spots à noite): 1, 0 ou - (sem vaga)
const cobI = (R, a, b) => { let s = ''; for (let j = a; j <= b; j++) s += j < 0 || j >= R.n ? '-' : String(R.cob[j]); return s }
// a própria fileira entra com as divisas: a viga de divisa corre a cobertura inteira, até o eixo (a prova de 28/10
// sem elas perdia a viga no teto perto do eixo)
export function chaveMetade(e, h, k, W = W_PADRAO) {
  const f = filas(e)
  if (h === 'N') return 'IN:' + trechoI(f, f.F, k - 1, k + 1) + '/' + cobI(f.T, k - 1, k + 1)
  if (h === 'M') return 'IM:' + trechoI(f, f.T, k - 1, k + 1) + '/' + cobI(f.F, k - 1, k + 1)
  return `I${h}:` + trechoI(f, h === 'T' ? f.T : f.F, k - W, k + W)
}
export function pontaIE(e, W = W_PADRAO) { const f = filas(e); return 'IE:' + trechoI(f, f.F, 0, W - 1) + '/' + trechoI(f, f.T, 0, W - 1) }
export function pontaID(e, W = W_PADRAO) { const f = filas(e); return 'ID:' + trechoI(f, f.F, f.nu - W, f.nu - 1) + '/' + trechoI(f, f.T, f.nu - W, f.nu - 1) }

// ---------------------------------------------------------------- ilha: peças altas
// Os pilares ficam todos no eixo do meio (as duas metades da cobertura se apoiam neles). Cada trecho coberto de uma
// fileira põe um pilar em cada ponta e um em cada divisa entre bombas; a ponta da fileira sobra 0,6 m (pilar 0,2 m
// para fora da divisa), a ponta ao lado de uma vaga sem cobertura sobra 0,4 m (pilar na divisa). Um pilar a menos de
// 30 cm de outro já posto não entra (a frente põe primeiro), como no pecas.py. Cada pilar é a divisa b mais a classe:
// 'e' (0,2 m à esquerda, ponta esquerda de fileira), 'm' (na divisa) ou 'd' (0,2 m à direita)
export function pilaresIlha(e) {
  const f = filas(e), xs = [], out = [], OFF = { e: -0.2, m: 0, d: 0.2 }
  for (const [nome, R] of [['F', f.F], ['T', f.T]]) {
    for (let i = 0; i < R.n;) {
      if (!R.cob[i]) { i++; continue }
      let j = i
      while (j + 1 < R.n && R.cob[j + 1]) j++
      const lista = [[i, i === 0 ? 'e' : 'm'], [j + 1, j === R.n - 1 ? 'd' : 'm']]
      for (let k = i + 1; k <= j; k++) if (R.bomba_u[k] !== R.bomba_u[k - 1]) lista.push([k, 'm'])
      for (const [b, cls] of lista) {
        const x = b * 2.7 + OFF[cls]
        if (!xs.some((y) => Math.abs(x - y) < 0.3)) { xs.push(x); out.push({ b, cls, fileira: nome }) }
      }
      i = j + 1
    }
  }
  return out
}
// o pilar de um indice.json (pelo x do mundo que o pecas.py grava): a divisa e a classe
export function pilarDe(p, passo) { const b = Math.round(p.wx / passo), r = p.wx - b * passo; return { b, cls: r < -0.1 ? 'e' : r > 0.1 ? 'd' : 'm' } }
// As chaves das peças da ilha guardam só o que muda a luz delas, em três valores por vaga: coberta (1), sem cobertura
// (0) ou sem vaga (-, pátio ou fora da laje). A bomba: modelo, a própria cobertura, a das vizinhas da fileira e a da
// outra fileira atrás dela (a dos fundos fica na sombra da cobertura da frente: o sol vem da frente e da direita). O
// pilar do meio: a classe e a cobertura das quatro meias-vagas em volta, e se a bomba da frente ao lado é uma Mobi Fast
// (a placa alta acesa clareia o pilar à noite). A árvore e o totem: a cobertura das vagas da ponta
export function pecasIlha(e) {
  const f = filas(e), lista = []
  const c = (R, k) => (k < 0 || k >= R.n ? '-' : String(R.cob[k]))
  const fast = (R, k) => k >= 0 && k < R.n && f.bombas[R.bomba_u[k]].modelo === 'fast'
  for (const [h, R, O] of [['F', f.F, f.T], ['T', f.T, f.F]]) {
    for (const bi of [...new Set(R.bomba_u)]) {
      const us = R.bomba_u.flatMap((x, k) => (x === bi ? [k] : [])), u0 = us[0], u1 = us[us.length - 1]
      const outra = us.some((k) => k < O.n && O.cob[k]) ? 1 : 0          // a outra fileira tem cobertura atrás dela?
      lista.push({ tipo: 'bomba', papel: 'bomba', fileira: h === 'F' ? 'frente' : 'fundos', ancora: u0, rotulo: `bomba ${bi + 1}`,
        chave: `Ib${h}|${f.bombas[bi].modelo}${f.bombas[bi].vagas}|${R.cob[u0]}|${c(R, u0 - 1)}${c(R, u1 + 1)}|${outra}` })
    }
  }
  for (const q of pilaresIlha(f)) {
    const { b, cls } = q
    lista.push({ tipo: 'pilar', papel: cls, fileira: 'meio', ancora: b, rotulo: `pilar do meio na divisa ${b}`,
      chave: `Ipilar|${cls}|${c(f.F, b - 1)}${c(f.F, b)}${c(f.T, b - 1)}${c(f.T, b)}|${fast(f.F, b - 1) || fast(f.F, b) ? 'f' : '-'}` })
  }
  lista.push({ tipo: 'arvore', papel: 'arvore', fileira: 'frente', ancora: 0, rotulo: 'árvore', chave: `Iarvore|${c(f.F, 0)}${c(f.T, 0)}` })
  lista.push({ tipo: 'totem', papel: 'totem', fileira: 'frente', ancora: f.nu, rotulo: 'totem', chave: `Itotem|${c(f.F, f.nu - 2)}${c(f.F, f.nu - 1)}|${c(f.T, f.nu - 1)}` })
  return lista
}

// o papel de uma peça do indice.json (pelo id que o pecas.py dá)
export function papelDe(p) {
  if (p.tipo !== 'pilar') return p.tipo
  return /_pilar0$/.test(p.id) ? 'e' : /_pilar1$/.test(p.id) ? 'd' : 'div'
}
