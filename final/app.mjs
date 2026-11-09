// O app da V3 (3/11): o painel, o construtor e meu posto da V2 (copiados para app/site e app/dados), com o montador da
// V3 (web/montar-soltas.js: todo posto, fileira ou ilha, 3D e 2D, sai das peças de Lego em lego/). Separado da V1 e da
// V2: nada delas é lido nem escrito.
//   - app/site/   as páginas e os motores (cópia das da V2, com o que a V3 acrescentou: horários, estados da bomba);
//   - app/dados/  o cadastro (postos.json), as montagens e as maquetes (remontadas pela V3);
//   - /montador/web/ e /montador/lego/  o montador e as peças (o construtor pede /montador/web/montar-soltas.js);
//   - /api/maquete/...  o construtor reserva a pasta, manda cada arquivo que montou e conclui (app/fila-maquetes.mjs).
// O mesmo arquivo serve o pacote para o time (proposta-02/v3-pacote, ferramentas/empacotar.mjs).
// (4/11) --dados <pasta>: outro cadastro (ex.: primeiro-acesso/dados, o dono que ainda não montou o posto). O cadastro,
// as montagens e as maquetes ficam nela; as imagens fixas (bombas, carros, carregamento, construtor) vêm de app/dados.
// Uso: node app.mjs [porta=5299] [--dados <pasta>]  →  http://localhost:5299/painel.html
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { criarFila } from './app/fila-maquetes.mjs'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2), iDados = args.indexOf('--dados')
const app = path.join(aqui, 'app'), site = path.join(app, 'site'), comum = path.join(app, 'dados')
const dados = iDados >= 0 ? path.resolve(aqui, args[iDados + 1]) : comum
const porta = Number(args.find((a) => /^\d+$/.test(a)) || 5299)
// o que vem sempre de app/dados (as imagens fixas), mesmo com outro cadastro
const COMUM = /^(bombas|carregamento|carros-leve|construtor|planta)\/|^(carro\.glb|carro-leve\.glb|carro\.json|logo-word\.png)$/
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2' }
const fila = criarFila(path.dirname(dados))                 // (a fila usa <raiz>/dados)
const json = (res, cod, obj) => { res.writeHead(cod, { 'Content-Type': tipos['.json'], 'Cache-Control': 'no-cache' }); res.end(JSON.stringify(obj)) }
const corpo = (req) => new Promise((ok, falha) => {
  const partes = []; let tam = 0
  req.on('data', (d) => { tam += d.length; if (tam > 64e6) { req.destroy(); falha(new Error('grande demais')) } else partes.push(d) })
  req.on('end', () => ok(Buffer.concat(partes))); req.on('error', falha)
})
const dentro = (base, rel) => { const a = path.normalize(path.join(base, rel)); return a === base || a.startsWith(base + path.sep) ? a : null }
// (4/11) cache: o navegador guarda cada arquivo e, na próxima vez, só pergunta se mudou (Last-Modified / ETag): sem
// mudança, a resposta é um 304 vazio e ele usa a cópia dele. Remontar um posto muda a data dos arquivos dele, então a
// cópia velha nunca é usada (o mesmo que a produção deve fazer; ver LEIA-ME, "Cache em produção")
// (4/11) compressão: o texto (js, json, html, css, svg) e os modelos 3D (glb) vão com brotli (ou gzip, se o navegador
// não aceita brotli). Medido num celular médio com 4G: o three.js caiu de 2 MB para ~0,5 MB. Imagens e vídeos já vêm
// comprimidos e vão como estão. A versão comprimida fica guardada na memória até o arquivo mudar
const COMPRIME = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.glb'])
const comprimidos = new Map()
function comprime(arq, st, conteudo, enc) {
  const k = `${arq}|${st.mtimeMs}|${enc}`
  if (!comprimidos.has(k)) {
    comprimidos.set(k, enc === 'br' ? zlib.brotliCompressSync(conteudo, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } }) : zlib.gzipSync(conteudo, { level: 6 }))
    if (comprimidos.size > 400) comprimidos.delete(comprimidos.keys().next().value)
  }
  return comprimidos.get(k)
}
const envia = (res, arq, req) => fs.stat(arq, (err, st) => {
  if (err || !st.isFile()) { res.writeHead(404); return res.end('não achei') }
  const ext = path.extname(arq).toLowerCase(), aceita = (req && req.headers['accept-encoding']) || ''
  const enc = COMPRIME.has(ext) && st.size > 1024 ? (/\bbr\b/.test(aceita) ? 'br' : /\bgzip\b/.test(aceita) ? 'gzip' : null) : null
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}${enc ? '-' + enc : ''}"`, quando = new Date(Math.floor(st.mtimeMs / 1000) * 1000).toUTCString()
  const cab = { 'Content-Type': tipos[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag, 'Last-Modified': quando, ...(COMPRIME.has(ext) ? { Vary: 'Accept-Encoding' } : {}) }
  if (req && (req.headers['if-none-match'] === etag || (!req.headers['if-none-match'] && req.headers['if-modified-since'] === quando))) { res.writeHead(304, cab); return res.end() }
  fs.readFile(arq, (e2, conteudo) => {
    if (e2) { res.writeHead(404); return res.end('não achei') }
    if (enc) { conteudo = comprime(arq, st, conteudo, enc); cab['Content-Encoding'] = enc }
    res.writeHead(200, cab); res.end(conteudo)
  })
})

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), url = decodeURIComponent(u.pathname)
  if (req.method === 'POST' && url.startsWith('/api/maquete/')) {
    try {
      const b = await corpo(req)
      const r = url === '/api/maquete/reservar' ? fila.reservar(JSON.parse(b)) : url === '/api/maquete/concluir' ? fila.concluir(JSON.parse(b))
        : url === '/api/maquete/arquivo' ? fila.guardarArquivo(u.searchParams.get('pasta') || '', u.searchParams.get('arq') || '', b) : { erro: 'não achei' }
      return json(res, r.erro ? 400 : 200, r)
    } catch (e) { return json(res, 400, { erro: String(e.message || e) }) }
  }
  if (url.startsWith('/api/')) {
    if (url === '/api/fila') return json(res, 200, [])
    if (req.method === 'POST' && url === '/api/montagens') {
      try {
        const r = fila.reservar(JSON.parse(await corpo(req)))
        if (r.estado === 'pronto' || r.erro) return json(res, r.erro ? 400 : 200, r)
      } catch (e) { return json(res, 400, { erro: String(e.message || e) }) }
    }
    const est = url.match(/^\/api\/montagens\/([\w-]+)$/)
    if (est) {
      const p = JSON.parse(fs.readFileSync(path.join(dados, 'postos.json'), 'utf8')).postos.find((x) => x.id === est[1])
      return p ? json(res, 200, { estado: p.maquete ? 'pronto' : 'sem-maquete', maquete: p.maquete }) : json(res, 404, { erro: 'posto desconhecido' })
    }
    return json(res, 400, { erro: 'este app não tem a fila do Blender: a maquete é montada no navegador' })
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end() }
  // (9/11) e /montador/lego-lateral/: as peças das vagas paralelas
  const mt = url.match(/^\/montador\/(web|lego|lego-lateral)\/(.+)$/)
  if (mt) { const a = dentro(path.join(aqui, mt[1]), mt[2]); return a ? envia(res, a, req) : (res.writeHead(403), res.end()) }
  if (url.startsWith('/dados/')) {
    const rel = url.slice(7), a = dentro(dados !== comum && COMUM.test(rel) ? comum : dados, rel)
    return a ? envia(res, a, req) : (res.writeHead(403), res.end())
  }
  let arq = dentro(site, url === '/' ? 'painel.html' : url.slice(1))
  if (!arq) { res.writeHead(403); return res.end() }
  if (fs.existsSync(arq) && fs.statSync(arq).isDirectory()) arq = path.join(arq, 'painel.html')
  envia(res, arq, req)
}).listen(porta, () => console.log(`V3 (Lego) em http://localhost:${porta}/painel.html${dados !== comum ? ` (cadastro: ${path.relative(aqui, dados)})` : ''}`))
