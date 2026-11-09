// O montador da V3 para o app (3/11): a mesma conversa do montar-soltas.js da V2 (o construtor chama montarMaquete e
// recebe os arquivos que o painel lê), com todo posto (fileira e ilha, de qualquer formato) montado com as peças de Lego
// (lego.js, lego/<vista>/). Desde 4/11 só as peças de Lego: o caminho da V2 saiu (já não era usado).
//   1. baixa os moldes e os índices (3D: tarde, noite, manhã e pôr do sol; 2D: tarde e noite);
//   2. planeja cada vista (lego.js, planejar: fileira ou ilha);
//   3. monta em Workers (montar-soltas-worker.js), em paralelo;
//   4. gera os dados (dados-sem-blender.js): âncoras, luzes, pistolas e cabos, projeção da 2D.
import * as D from './base/dados-sem-blender.js'
import { planejar } from './lego.js'

const raiz = new URL('../', import.meta.url).href                 // a pasta de cima (a que tem web/ e lego/)
const pecas = new URL('./base/', import.meta.url).href            // os moldes (cópia dos da V2)
export const HORARIOS = ['tarde', 'noite']
// (3/11, noite) a manhã e o pôr do sol, como a V2: no 3D, com as mesmas peças de Lego cortadas dos renders desses
// horários (o pôr do sol com o brilho, como a noite). (4/11) Na 2D também, quando as peças dela existem (lego/planta-manha
// e planta-por, dos renders da própria V3); sem elas, a 2D fica com a tarde e a noite (o painel põe o tom do horário)
const EXTRAS = ['manha', 'por'], TODOS = [...HORARIOS, ...EXTRAS]
const VISTAS = [
  ...TODOS.map((per) => ({ vista: '3d', per, nomes: ['fundo', 'teto'], pasta: '', qualidade: 0.9, brilho: per === 'noite' || per === 'por', opcional: EXTRAS.includes(per) })),
  ...TODOS.map((per) => ({ vista: 'planta', per, nomes: ['planta', 'teto'], pasta: 'planta/', qualidade: 0.86, brilho: per === 'noite' || per === 'por', opcional: true })),
]
export const ehIlha = (m) => !!(m.ilha && (m.fileiras.fundos || []).length)
// ilha sem fileira da frente: as bombas dos fundos vão para a frente, numa fileira (o mesmo que o construtor faz ao salvar)
const arruma = (m) => (m.ilha && !(m.fileiras.frente || []).length && (m.fileiras.fundos || []).length
  ? { ...m, ilha: false, fileiras: { ...m.fileiras, frente: m.fileiras.fundos, fundos: [] } } : m)
export function paralelos(pixels) {
  const nucleos = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4
  const mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 4
  return Math.max(1, Math.min(3, Math.floor(nucleos / 2), Math.floor((mem * 2 ** 30 * 0.25) / (pixels * 40))))
}
const guardados = new Map()
async function baixa(url, medida, grupo) {
  if (guardados.has(url)) return guardados.get(url)
  const r = await fetch(url); if (!r.ok) throw new Error(`não achei ${url}`)
  const b = await r.arrayBuffer(); medida.bytes[grupo] = (medida.bytes[grupo] || 0) + b.byteLength
  guardados.set(url, b); return b
}
const json = async (url, medida, grupo) => JSON.parse(new TextDecoder().decode(await baixa(url, medida, grupo)))

// (9/11) vagas paralelas ("bomba lateral"): montagem = { modelo: 'lateral', ilhas: [{ bombas: [{ modelo, disp, lado,
// coberta }] }] }. As peças são as de lego-lateral/<vista>-<horário>/ e cada Worker monta uma vista inteira já na
// resolução final (lateral.js); vistas: as mesmas (3D e planta, nos quatro horários). Os dados do painel (âncoras,
// luzes, cabos) deste modelo vêm no passo 3
export const ehLateral = (m) => m && m.modelo === 'lateral'
async function montarMaqueteLateral(montagem, { max = 3600, paralelo, aoProgresso = () => {}, sinal, contorno = true, vistas: soVistas = null } = {}) {
  const T0 = performance.now(), medida = { bytes: {} }, ms = {}
  const parar = () => { if (sinal && sinal.aborted) throw new DOMException('montagem cancelada', 'AbortError') }
  const base = (v) => raiz + `lego-lateral/${v.vista}-${v.per}/`
  const pedidas = VISTAS.filter((v) => !soVistas || soVistas.includes(`${v.vista}-${v.per}`))
  aoProgresso({ etapa: 'índices', feitos: 0, total: 1 })
  let t = performance.now()
  const indices = await Promise.all(pedidas.map((v) => json(base(v) + 'lego.json', medida, 'índices').catch((e) => { if (v.opcional) return null; throw e })))
  ms['índices'] = performance.now() - t
  parar()
  const fila = pedidas.map((v, i) => indices[i] && { ...v, lateral: true, base: base(v), indice: indices[i], layout: { ilhas: montagem.ilhas }, max, contorno }).filter(Boolean)
  // memória: cada Worker segura o fundo, o teto e a cor do chão (Float32) do quadro final; estimado pela vista 3D
  const P = paralelo || paralelos(max * Math.round(max * 0.6) * 1.2), arquivos = {}, quadros = {}
  let feitos = 0, faltas = new Set(), bombas = null
  aoProgresso({ etapa: 'montando', feitos, total: fila.length, paralelos: P })
  t = performance.now()
  await Promise.all(Array.from({ length: Math.min(P, fila.length) }, async () => {
    const w = new Worker(new URL('./montar-soltas-worker.js', import.meta.url), { type: 'module' })
    let desiste = null
    const aoCancelar = () => { w.terminate(); if (desiste) desiste(new DOMException('montagem cancelada', 'AbortError')) }
    if (sinal) sinal.addEventListener('abort', aoCancelar)
    try {
      while (fila.length) {
        parar()
        const tarefa = fila.shift()
        const r = await new Promise((ok, falha) => { desiste = falha; w.onmessage = (e) => ok(e.data); w.onerror = (e) => ok({ ok: false, erro: e.message }); w.postMessage(tarefa) })
        if (!r.ok) throw new Error(r.erro)
        Object.assign(arquivos, r.arquivos); quadros[`${tarefa.vista}-${tarefa.per}`] = r.quadro; (r.faltas || []).forEach((f) => faltas.add(f)); bombas = r.bombas
        for (const [k, v] of Object.entries(r.ms || {})) ms[`${tarefa.vista}-${tarefa.per}: ${k}`] = Math.round(v)
        aoProgresso({ etapa: 'montando', feitos: ++feitos, total: pedidas.length, paralelos: P })
      }
    } finally { w.terminate(); if (sinal) sinal.removeEventListener('abort', aoCancelar) }
  }))
  parar()
  ms['montar (em paralelo)'] = performance.now() - t
  const horarios = TODOS.filter((p) => pedidas.some((v) => v.vista === '3d' && v.per === p && quadros[`3d-${p}`]))
  const horarios2d = TODOS.filter((p) => pedidas.some((v) => v.vista === 'planta' && v.per === p && quadros[`planta-${p}`]))
  const js = (o) => new Blob([JSON.stringify(o)], { type: 'application/json' })
  arquivos['pronto.json'] = js({ lateral: true, por_pecas: true, lego: true, sem_blender: true, no_navegador: true, horarios, horarios2d, quadros, bombas, geradoEm: new Date().toISOString(), faltam: [...faltas] })
  return { arquivos, ms, total: performance.now() - T0, medida, paralelos: P, quadro: quadros[`3d-${horarios[0]}`] || null, quadros, faltas: [...faltas] }
}

export async function montarMaquete(montagem, opcoes = {}) {
  if (ehLateral(montagem)) return montarMaqueteLateral(montagem, opcoes)
  return montarMaqueteFileira(montagem, opcoes)
}
async function montarMaqueteFileira(montagem, { max = 3600, paralelo, aoProgresso = () => {}, sinal, contorno = true } = {}) {
  const T0 = performance.now(), medida = { bytes: {} }, ms = {}
  const parar = () => { if (sinal && sinal.aborted) throw new DOMException('montagem cancelada', 'AbortError') }
  montagem = arruma(montagem)
  const ilha = ehIlha(montagem), lego = true
  // de onde sai cada vista: as peças de Lego dela (lego/<vista>-<horário>/lego.json)
  const fonte = (v) => ({ lego: true, base: raiz + `lego/${v.vista}-${v.per}/`, indice: 'lego.json' })
  aoProgresso({ etapa: 'moldes e índices', feitos: 0, total: 1 })
  let t = performance.now()
  const [moldes, indices] = await Promise.all([
    Promise.all([json(pecas + 'moldes/ancoras.json', medida, 'moldes'), json(pecas + 'moldes/planta/planta.json', medida, 'moldes'), baixa(pecas + 'moldes/bomba_pecas.glb', medida, 'moldes'),
      Promise.all(TODOS.map((p) => json(pecas + `moldes/luzes-${p}.json`, medida, 'moldes'))), Promise.all(TODOS.map((p) => baixa(pecas + `moldes/env-${p}.jpg`, medida, 'moldes')))]),
    Promise.all(VISTAS.map((v) => { const f = fonte(v); return json(f.base + f.indice, medida, 'índices').catch((e) => { if (v.opcional) return null; throw e }) })),
  ])
  ms['moldes e índices'] = performance.now() - t
  parar()
  t = performance.now()
  const vistas = [], ind = [], planos = []
  VISTAS.forEach((v, i) => {
    if (!indices[i]) return
    const f = fonte(v)
    vistas.push({ ...v, ...f }); ind.push(indices[i]); planos.push(planejar(indices[i], montagem))
  })
  // a moldura é a mesma nos dois horários de uma vista (o painel troca as camadas uma pela outra)
  const Q3 = planos[0].quadro, Q2 = (planos.find((_, i) => vistas[i].vista === 'planta') || {}).quadro
  ms['planejar'] = performance.now() - t
  const P = paralelo || paralelos(Q3.W * Q3.H), arquivos = {}
  let feitos = 0
  aoProgresso({ etapa: 'montando', feitos, total: vistas.length, paralelos: P })
  const fila = vistas.map((v, i) => ({ ...v, indice: ind[i], plano: planos[i], max, contorno, arvore: ilha && v.vista === '3d', sobre: ilha && v.vista === 'planta' }))
  t = performance.now()
  await Promise.all(Array.from({ length: Math.min(P, fila.length) }, async () => {
    const w = new Worker(new URL('./montar-soltas-worker.js', import.meta.url), { type: 'module' })
    let desiste = null
    const aoCancelar = () => { w.terminate(); if (desiste) desiste(new DOMException('montagem cancelada', 'AbortError')) }
    if (sinal) sinal.addEventListener('abort', aoCancelar)
    try {
      while (fila.length) {
        parar()
        const tarefa = fila.shift()
        const r = await new Promise((ok, falha) => { desiste = falha; w.onmessage = (e) => ok(e.data); w.onerror = (e) => ok({ ok: false, erro: e.message }); w.postMessage(tarefa) })
        if (!r.ok) throw new Error(r.erro)
        Object.assign(arquivos, r.arquivos)
        for (const [k, v] of Object.entries(r.ms || {})) ms[`${tarefa.vista}-${tarefa.per}: ${k}`] = Math.round(v)
        aoProgresso({ etapa: 'montando', feitos: ++feitos, total: vistas.length, paralelos: P })
      }
    } finally { w.terminate(); if (sinal) sinal.removeEventListener('abort', aoCancelar) }
  }))
  parar()
  ms['montar (em paralelo)'] = performance.now() - t
  t = performance.now()
  const [ancorasM, plantaM, glbM, luzesM, envM] = moldes
  const MO = D.prepararMoldes({ ancoras: ancorasM, planta: plantaM, glb: glbM, luzes: Object.fromEntries(TODOS.map((p, i) => [p, luzesM[i]])) })
  const js = (o) => new Blob([JSON.stringify(o)], { type: 'application/json' })
  const q = (Q) => ({ gx0: Q.gx0, gy0: Q.gy0, w: Q.W, h: Q.H })
  // os horários que saíram (tarde e noite sempre; manhã e pôr do sol se as peças deles existem)
  const horarios = TODOS.filter((p) => vistas.some((v) => v.vista === '3d' && v.per === p))
  const horarios2d = TODOS.filter((p) => vistas.some((v) => v.vista === 'planta' && v.per === p))
  arquivos['ancoras.json'] = js(D.ancoras(montagem, MO, q(Q3)))
  for (const per of horarios) arquivos[`luzes-${per}.json`] = js(D.luzes(montagem, MO, per))
  arquivos['bomba_pecas.glb'] = new Blob([D.glbPecas(montagem, MO)], { type: 'model/gltf-binary' })
  TODOS.forEach((p, i) => { if (horarios.includes(p)) arquivos[`env-${p}.jpg`] = new Blob([envM[i]], { type: 'image/jpeg' }) })
  if (Q2) arquivos['planta/planta.json'] = js(D.planta(montagem, MO, q(Q2)))
  const faltas = [...new Set(planos.flatMap((p) => p.faltas || []))]
  arquivos['pronto.json'] = js({ por_pecas: true, soltas: true, lego, sem_blender: true, no_navegador: true, horarios, horarios2d, geradoEm: new Date().toISOString(), faltam: [], aproximadas: faltas })
  ms['dados'] = performance.now() - t
  return { arquivos, ms, total: performance.now() - T0, medida, paralelos: P, quadro: q(Q3), quadro2d: Q2 ? q(Q2) : null, faltas }
}
