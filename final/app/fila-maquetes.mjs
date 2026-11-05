// O cadastro das maquetes da V2 (2/11): a parte da fila-maquetes.mjs da V1 que o app das peças soltas usa, copiada para
// a V2 não ler nada da V1. Aqui não há Blender nem o gerador da prova-pecas: o construtor monta a maquete no navegador
// (web/montar-soltas.js) e o servidor só guarda os arquivos e o cadastro:
//   reservar        dá a pasta do formato (ou "pronto", se ele já existe) e guarda a montagem do posto;
//   guardarArquivo  grava cada arquivo que o navegador montou;
//   concluir        cadastra a maquete e liga a ela os postos que esperavam.
// A assinatura e a descrição são as mesmas da V1 (o construtor calcula a mesma assinatura).
import fs from 'node:fs'
import path from 'node:path'

// a mesma assinatura do construtor (construtor.html, assinatura()). Cada bomba é modelo e vagas; a que foge da regra de
// antes (o posto com cobertura cobre todas menos o Mobi) leva uma marca: "c" coberta ou "s" sem
const coberta = (m, b) => (b.coberta !== undefined ? !!b.coberta : !!m.cobertura && b.modelo !== 'mobi')
const marca = (m, b) => { const antes = !!m.cobertura && b.modelo !== 'mobi', agora = coberta(m, b); return agora === antes ? '' : agora ? 'c' : 's' }
export function assinatura(m) {
  const lista = (f) => (f === 'fundos' && !m.ilha ? [] : (m.fileiras && m.fileiras[f]) || [])
  const fila = (f) => lista(f).map((b) => b.modelo + b.vagas + marca(m, b)).join(',')
  const cob = [...lista('frente'), ...lista('fundos')].some((b) => coberta(m, b))
  return `${cob ? 1 : 0}|${fila('frente')}|${fila('fundos')}`
}
const fnv = (s) => { let h = 0x811c9dc5; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0 } return h.toString(16).padStart(8, '0') }
const descricao = (m) => {
  const n = (m.fileiras.frente || []).length + (m.ilha ? (m.fileiras.fundos || []).length : 0)
  const lista = [...(m.fileiras.frente || []), ...(m.ilha ? m.fileiras.fundos || [] : [])], cobertas = lista.filter((b) => coberta(m, b)).length
  const cob = !cobertas ? 'sem cobertura' : cobertas === lista.length ? 'com cobertura' : 'cobertura em parte'
  return `${n} bomba${n > 1 ? 's' : ''}${m.ilha ? ' em ilha' : ''} · ${cob}`
}

export function criarFila(raiz) {
  const dados = path.join(raiz, 'dados'), arqPostos = path.join(dados, 'postos.json')
  const lerPostos = () => JSON.parse(fs.readFileSync(arqPostos, 'utf8'))
  function gravarPostos(reg) {
    // guarda a versão anterior antes de trocar (o cadastro nunca é perdido)
    const arq = path.join(dados, '_arquivo'); fs.mkdirSync(arq, { recursive: true })
    fs.copyFileSync(arqPostos, path.join(arq, `postos-${new Date().toISOString().replace(/[:.]/g, '-')}.json`))
    fs.writeFileSync(arqPostos, JSON.stringify(reg, null, 2))
  }
  function salvarMontagem(postoId, montagem) {
    const pasta = path.join(dados, 'montagens'); fs.mkdirSync(pasta, { recursive: true })
    const arq = path.join(pasta, `${postoId}.json`)
    if (fs.existsSync(arq)) {                         // a montagem anterior vai para o arquivo
      const a = path.join(pasta, '_arquivo'); fs.mkdirSync(a, { recursive: true })
      fs.copyFileSync(arq, path.join(a, `${postoId}-${Date.now()}.json`))
    }
    fs.writeFileSync(arq, JSON.stringify(montagem, null, 2))
    return `montagens/${postoId}.json`
  }
  // já existe maquete deste formato? (só as das peças soltas, montadas no navegador)
  const prontaDe = (reg, ass) => reg.maquetes.find((q) => q.assinatura === ass && fs.existsSync(path.join(dados, q.pasta, 'ancoras.json')))

  // sem postoId é o catálogo: a maquete de um formato fica pronta antes de algum posto pedir (a montagem fica em
  // dados/montagens/_catalogo/<pasta>.json e nenhum posto muda)
  const catalogo = path.join(dados, 'montagens', '_catalogo')
  function reservar({ postoId, montagem }) {
    const reg = lerPostos(), posto = postoId ? reg.postos.find((p) => p.id === postoId) : null
    if (postoId && !posto) return { erro: 'posto desconhecido' }
    if (!montagem || !montagem.fileiras || !(montagem.fileiras.frente || []).length) return { erro: 'montagem vazia' }
    const ass = assinatura(montagem)
    if (!posto) {
      const pronta = prontaDe(reg, ass); if (pronta) return { estado: 'pronto', maquete: pronta.pasta }
      const pasta = 'm-' + fnv(ass + '|pecas')
      fs.mkdirSync(catalogo, { recursive: true }); fs.writeFileSync(path.join(catalogo, `${pasta}.json`), JSON.stringify(montagem, null, 2))
      fs.mkdirSync(path.join(dados, pasta, 'planta'), { recursive: true })
      return { estado: 'montar', maquete: pasta }
    }
    posto.montagem = salvarMontagem(postoId, { ...montagem, postoId })
    posto.cobertura = !!montagem.cobertura; posto.ilha = !!montagem.ilha
    const pronta = prontaDe(reg, ass)
    if (pronta) { posto.maquete = pronta.pasta; posto.equip = descricao(montagem); delete posto.pendente; gravarPostos(reg); return { estado: 'pronto', maquete: pronta.pasta } }
    const pasta = 'm-' + fnv(ass + '|pecas')
    posto.pendente = pasta; gravarPostos(reg); fs.mkdirSync(path.join(dados, pasta, 'planta'), { recursive: true })
    return { estado: 'montar', maquete: pasta }
  }
  function guardarArquivo(pasta, arq, buf) {
    // (3/11, noite, V3) também o png da máscara das bombas (estados.png)
    if (!/^m-[0-9a-f]{8}$/.test(pasta) || !/^(planta\/)?[a-z0-9_-]+\.(webp|json|glb|jpg|png)$/.test(arq)) return { erro: 'nome inválido' }
    if (!fs.existsSync(path.join(dados, pasta))) return { erro: 'pasta não reservada' }
    fs.mkdirSync(path.dirname(path.join(dados, pasta, arq)), { recursive: true })
    fs.writeFileSync(path.join(dados, pasta, arq), buf); return { ok: true }
  }
  function concluir({ postoId, maquete }) {
    const reg = lerPostos(), posto = postoId ? reg.postos.find((p) => p.id === postoId) : null
    const doCatalogo = !postoId && /^m-[0-9a-f]{8}$/.test(maquete || '') && fs.existsSync(path.join(catalogo, `${maquete}.json`))
    if (!doCatalogo && (!posto || posto.pendente !== maquete)) return { erro: 'nada reservado para este posto' }
    const montagem = JSON.parse(fs.readFileSync(doCatalogo ? path.join(catalogo, `${maquete}.json`) : path.join(dados, posto.montagem), 'utf8')), ass = assinatura(montagem)
    for (const a of ['ancoras.json', 'fundo-tarde.webp', 'teto-noite.webp', 'planta/planta.json']) if (!fs.existsSync(path.join(dados, maquete, a))) return { erro: `falta ${a}` }
    reg.maquetes = reg.maquetes.filter((q) => q.pasta !== maquete)
    reg.maquetes.push({ pasta: maquete, assinatura: ass, modelo: 'pecas', ilha: !!montagem.ilha, nome: descricao(montagem) })
    for (const p of reg.postos) if (p.pendente === maquete) { p.maquete = maquete; p.equip = descricao(montagem); delete p.pendente }
    gravarPostos(reg); console.log('maquete pronta', maquete, '(montada no navegador)')
    return { estado: 'pronto', maquete }
  }
  return { reservar, guardarArquivo, concluir }
}
