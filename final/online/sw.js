// Painel do eletroposto iGreen · V3 · o servidor no navegador (pasta online/)
//
// O app.mjs refeito como service worker, para o pacote abrir numa hospedagem só de arquivos (GitHub Pages, um bucket,
// uma CDN), sem Node. Faz as mesmas três coisas que o app.mjs:
//   1. o mapa dos endereços: as páginas e os motores (app/site), os dados (app/dados), o montador (web) e as peças (lego)
//      respondem nos mesmos endereços que o app.mjs usa, só que dentro de online/: painel.html, dados/..., montador/web/...,
//      montador/lego/...;
//   2. a API do construtor (api/maquete/reservar, arquivo e concluir, e as antigas api/montagens e api/fila), igual à de
//      app/fila-maquetes.mjs, só que gravando no Cache Storage DESTE navegador: o que um visitante monta fica só com ele;
//   3. o segundo cadastro, o primeiro acesso (online/primeiro-acesso/...), como o `--dados primeiro-acesso/dados` do app.mjs.
// Em produção isso é trabalho do backend (README, "Levar para o CRM"). A assinatura e a descrição abaixo são as mesmas do
// construtor e de app/fila-maquetes.mjs: mudou lá, mude aqui (ARQUITETURA.md, invariante 8).
'use strict'

const AQUI = new URL('./', self.location).href                 // .../online/
const PACOTE = new URL('../', self.location).href              // a raiz do pacote
const LOCAL = 'igreen-v3-online'                               // o Cache Storage com o que o construtor gravou
// o que o primeiro acesso lê sempre de app/dados (as imagens fixas), como o COMUM do app.mjs
const COMUM = /^(bombas|carregamento|carros-leve|construtor|planta)\/|^(carro\.glb|carro-leve\.glb|carro\.json|logo-word\.png)$/
const PROPRIOS = new Set(['', 'index.html', 'sw.js', 'entrar.js', 'README.md'])     // os arquivos desta pasta, direto da rede
const CADASTROS = {
  exemplo: { pre: AQUI, postos: PACOTE + 'app/dados/postos.json', dados: (rel) => PACOTE + 'app/dados/' + rel },
  primeiro: { pre: AQUI + 'primeiro-acesso/', postos: PACOTE + 'primeiro-acesso/inicial/postos.json', dados: (rel) => (COMUM.test(rel) ? PACOTE + 'app/dados/' + rel : null) },
}
const TIPOS = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', svg: 'image/svg+xml', glb: 'model/gltf-binary',
  mp4: 'video/mp4', webm: 'video/webm', woff2: 'font/woff2' }
const tipo = (rel) => TIPOS[(rel.split('.').pop() || '').toLowerCase()] || 'application/octet-stream'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url)
  if (u.origin !== self.location.origin || !u.href.startsWith(AQUI)) return      // fontes, clima, o resto do site: direto
  let rel = decodeURIComponent(u.pathname.slice(new URL(AQUI).pathname.length)), cad = CADASTROS.exemplo
  if (rel === 'primeiro-acesso') return e.respondWith(Response.redirect(AQUI + 'primeiro-acesso/' + u.search, 302))
  if (rel.startsWith('primeiro-acesso/')) { cad = CADASTROS.primeiro; rel = rel.slice('primeiro-acesso/'.length) }
  else if (PROPRIOS.has(rel)) return
  e.respondWith(atende(e.request, cad, rel, u).catch((err) => new Response(`erro no servidor do navegador: ${err.message}`, { status: 500 })))
})

async function atende(req, cad, rel, u) {
  if (rel.startsWith('api/')) return api(req, cad, rel.slice(4), u)
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null, { status: 405 })
  if (rel.startsWith('dados/')) return dados(req, cad, rel.slice(6))
  const mt = rel.match(/^montador\/(web|lego|lego-lateral)\/(.+)$/)      // (9/11) lego-lateral: as peças das vagas paralelas
  if (mt) return daRede(req, `${PACOTE}${mt[1]}/${mt[2]}`, rel)
  return daRede(req, PACOTE + 'app/site/' + (rel === '' ? 'painel.html' : rel), rel)
}

// Um arquivo do pacote, devolvido como resposta nova no endereço pedido: assim cada módulo tem um endereço só (o three.js,
// os motores e o montador não são carregados duas vezes) e os caminhos relativos continuam dentro de online/. Vídeo vai
// por redirecionamento: o navegador pede por partes (Range) direto no arquivo.
async function daRede(req, alvo, rel) {
  if (/\.(mp4|webm)$/i.test(rel)) return Response.redirect(alvo, 302)
  const r = await fetch(alvo, { cache: req.cache === 'only-if-cached' ? 'default' : req.cache, credentials: 'same-origin' })
  const h = new Headers({ 'Content-Type': r.headers.get('content-type') || tipo(rel) })
  for (const k of ['last-modified', 'etag']) if (r.headers.get(k)) h.set(k, r.headers.get(k))
  return new Response(req.method === 'HEAD' ? null : r.body, { status: r.status, statusText: r.statusText, headers: h })
}

async function dados(req, cad, rel) {
  if (rel === 'postos.json') return json(await lerPostos(cad))
  const local = await (await caixa()).match(chave(cad, rel))
  if (local) return local
  const alvo = cad.dados(rel)
  return alvo ? daRede(req, alvo, rel) : new Response('não achei', { status: 404 })
}

async function api(req, cad, rota, u) {
  try {
    if (req.method === 'POST' && rota.startsWith('maquete/')) {
      const r = rota === 'maquete/reservar' ? await reservar(cad, await req.json())
        : rota === 'maquete/concluir' ? await concluir(cad, await req.json())
        : rota === 'maquete/arquivo' ? await guardarArquivo(cad, u.searchParams.get('pasta') || '', u.searchParams.get('arq') || '', await req.blob())
        : { erro: 'não achei' }
      return json(r, r.erro ? 400 : 200)
    }
    if (rota === 'fila') return json([])
    if (req.method === 'POST' && rota === 'montagens') {
      const r = await reservar(cad, await req.json())
      if (r.estado === 'pronto' || r.erro) return json(r, r.erro ? 400 : 200)
    }
    const est = rota.match(/^montagens\/([\w-]+)$/)
    if (est) {
      const p = (await lerPostos(cad)).postos.find((x) => x.id === est[1])
      return p ? json({ estado: p.maquete ? 'pronto' : 'sem-maquete', maquete: p.maquete }) : json({ erro: 'posto desconhecido' }, 404)
    }
    return json({ erro: 'este app não tem a fila do Blender: a maquete é montada no navegador' }, 400)
  } catch (err) { return json({ erro: String(err.message || err) }, 400) }
}
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': TIPOS.json, 'Cache-Control': 'no-cache' } })

// ---------------------------------------------------------------- o cadastro (o mesmo de app/fila-maquetes.mjs)
const coberta = (m, b) => (b.coberta !== undefined ? !!b.coberta : !!m.cobertura && b.modelo !== 'mobi')
const marca = (m, b) => { const antes = !!m.cobertura && b.modelo !== 'mobi', agora = coberta(m, b); return agora === antes ? '' : agora ? 'c' : 's' }
// (9/11) vagas paralelas: "L|" e, por ilha (separadas por "/"), cada bomba: modelo, disposição (u, d, f), lado (F, T) e "c"
const ehLateral = (m) => !!m && m.modelo === 'lateral'
function assinaturaLateral(m) {
  const bomba = (b) => b.modelo + { unica: 'u', dois: 'd', fila: 'f' }[b.disp] + (b.disp === 'dois' ? '' : b.lado === 'tras' ? 'T' : 'F') + (b.coberta ? 'c' : '')
  return 'L|' + (m.ilhas || []).map((il) => (il.bombas || []).map(bomba).join(',')).join('/')
}
function assinatura(m) {
  if (ehLateral(m)) return assinaturaLateral(m)
  const lista = (f) => (f === 'fundos' && !m.ilha ? [] : (m.fileiras && m.fileiras[f]) || [])
  const fila = (f) => lista(f).map((b) => b.modelo + b.vagas + marca(m, b)).join(',')
  const cob = [...lista('frente'), ...lista('fundos')].some((b) => coberta(m, b))
  return `${cob ? 1 : 0}|${fila('frente')}|${fila('fundos')}`
}
const fnv = (s) => { let h = 0x811c9dc5; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0 } return h.toString(16).padStart(8, '0') }
const descricao = (m) => {
  if (ehLateral(m)) {
    const bs = (m.ilhas || []).flatMap((il) => il.bombas || []), n = bs.length, k = (m.ilhas || []).length, cobertas = bs.filter((b) => b.coberta).length
    const cob = !cobertas ? 'sem cobertura' : cobertas === n ? 'com cobertura' : 'cobertura em parte'
    return `${n} bomba${n > 1 ? 's' : ''} em ${k} ilha${k > 1 ? 's' : ''} · vagas paralelas · ${cob}`
  }
  const n = (m.fileiras.frente || []).length + (m.ilha ? (m.fileiras.fundos || []).length : 0)
  const lista = [...(m.fileiras.frente || []), ...(m.ilha ? m.fileiras.fundos || [] : [])], cobertas = lista.filter((b) => coberta(m, b)).length
  const cob = !cobertas ? 'sem cobertura' : cobertas === lista.length ? 'com cobertura' : 'cobertura em parte'
  return `${n} bomba${n > 1 ? 's' : ''}${m.ilha ? ' em ilha' : ''} · ${cob}`
}

// o que este navegador gravou fica em Cache Storage, no endereço em que a página o lê (online/dados/... ou
// online/primeiro-acesso/dados/...); o resto vem do pacote
const caixa = () => caches.open(LOCAL)
const chave = (cad, rel) => cad.pre + 'dados/' + rel
async function grava(cad, rel, corpo, t = tipo(rel)) { await (await caixa()).put(chave(cad, rel), new Response(corpo, { headers: { 'Content-Type': t } })) }
async function lerJSON(cad, rel) {
  const l = await (await caixa()).match(chave(cad, rel))
  if (l) return l.json()
  const alvo = rel === 'postos.json' ? cad.postos : cad.dados(rel), r = alvo ? await fetch(alvo, { cache: 'no-cache' }) : null
  if (!r || !r.ok) throw new Error(`não achei ${rel}`)
  return r.json()
}
async function existe(cad, rel) {
  if (await (await caixa()).match(chave(cad, rel))) return true
  const alvo = cad.dados(rel)
  if (!alvo) return false
  try { return (await fetch(alvo, { method: 'HEAD', cache: 'no-cache' })).ok } catch { return false }
}
const lerPostos = (cad) => lerJSON(cad, 'postos.json')
const gravarPostos = (cad, reg) => grava(cad, 'postos.json', JSON.stringify(reg, null, 2))
async function prontaDe(cad, reg, ass) {
  for (const q of reg.maquetes) if (q.assinatura === ass && (await existe(cad, `${q.pasta}/ancoras.json`))) return q
  return null
}

async function reservar(cad, { postoId, montagem }) {
  const reg = await lerPostos(cad), posto = postoId ? reg.postos.find((p) => p.id === postoId) : null
  if (postoId && !posto) return { erro: 'posto desconhecido' }
  const vazia = ehLateral(montagem) ? !(montagem.ilhas || []).some((il) => (il.bombas || []).length) : !montagem || !montagem.fileiras || !(montagem.fileiras.frente || []).length
  if (!montagem || vazia) return { erro: 'montagem vazia' }
  const ass = assinatura(montagem), pasta = 'm-' + fnv(ass + '|pecas')
  if (!posto) {                                                  // o catálogo: a maquete de um formato, sem posto
    const pronta = await prontaDe(cad, reg, ass)
    if (pronta) return { estado: 'pronto', maquete: pronta.pasta }
    await grava(cad, `montagens/_catalogo/${pasta}.json`, JSON.stringify(montagem, null, 2))
    await grava(cad, `${pasta}/.reservada`, '1', 'text/plain')
    return { estado: 'montar', maquete: pasta }
  }
  posto.montagem = `montagens/${postoId}.json`
  await grava(cad, posto.montagem, JSON.stringify({ ...montagem, postoId }, null, 2))
  posto.cobertura = ehLateral(montagem) ? (montagem.ilhas || []).some((il) => (il.bombas || []).some((b) => b.coberta)) : !!montagem.cobertura
  posto.ilha = !!montagem.ilha; if (ehLateral(montagem)) posto.modelo = 'lateral'; else delete posto.modelo
  const pronta = await prontaDe(cad, reg, ass)
  if (pronta) {
    posto.maquete = pronta.pasta; posto.equip = descricao(montagem); delete posto.pendente
    await gravarPostos(cad, reg); return { estado: 'pronto', maquete: pronta.pasta }
  }
  posto.pendente = pasta; await gravarPostos(cad, reg); await grava(cad, `${pasta}/.reservada`, '1', 'text/plain')
  return { estado: 'montar', maquete: pasta }
}
async function guardarArquivo(cad, pasta, arq, blob) {
  if (!/^m-[0-9a-f]{8}$/.test(pasta) || !/^(planta\/)?[a-z0-9_-]+\.(webp|json|glb|jpg|png)$/.test(arq)) return { erro: 'nome inválido' }
  const reservada = await (await caixa()).match(chave(cad, `${pasta}/.reservada`))
  if (!reservada && !(await existe(cad, `${pasta}/ancoras.json`))) return { erro: 'pasta não reservada' }
  await grava(cad, `${pasta}/${arq}`, blob); return { ok: true }
}
async function concluir(cad, { postoId, maquete }) {
  const reg = await lerPostos(cad), posto = postoId ? reg.postos.find((p) => p.id === postoId) : null
  const doCatalogo = !postoId && /^m-[0-9a-f]{8}$/.test(maquete || '') && (await existe(cad, `montagens/_catalogo/${maquete}.json`))
  if (!doCatalogo && (!posto || posto.pendente !== maquete)) return { erro: 'nada reservado para este posto' }
  const montagem = await lerJSON(cad, doCatalogo ? `montagens/_catalogo/${maquete}.json` : posto.montagem), ass = assinatura(montagem)
  for (const a of ['ancoras.json', 'fundo-tarde.webp', 'teto-noite.webp', 'planta/planta.json']) if (!(await existe(cad, `${maquete}/${a}`))) return { erro: `falta ${a}` }
  reg.maquetes = reg.maquetes.filter((q) => q.pasta !== maquete)
  reg.maquetes.push({ pasta: maquete, assinatura: ass, modelo: 'pecas', ilha: !!montagem.ilha, ...(ehLateral(montagem) ? { lateral: true } : {}), nome: descricao(montagem) })
  for (const p of reg.postos) if (p.pendente === maquete) { p.maquete = maquete; p.equip = descricao(montagem); delete p.pendente }
  await gravarPostos(cad, reg)
  return { estado: 'pronto', maquete }
}
