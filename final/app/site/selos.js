// Selos sobre a maquete (o 3D de maquete.js e a 2D de planta-imagem.js usam este arranjo)
//
// (4/11, V3) Desempenho: antes, a cada quadro, cada selo media a própria altura (offsetHeight, o que obriga o navegador a
// refazer o layout no meio do quadro) e reescrevia posição, haste e classe mesmo sem nada mudar. Agora o tamanho só é
// medido quando o conteúdo do selo muda, e a posição só é escrita quando muda (arredondada a meio pixel).
//
// Agrupar: com o posto afastado (celular, posto grande), os selos de carros que se amontoam viram um selo só com o número
// de carros, como os pinos de um mapa. Tocar nele aproxima a vista até os selos caberem separados. Os selos das bombas e
// os avisos rápidos (mostrarVaga) nunca se juntam; um grupo com carro em falha fica vermelho.

const FOLGA = 6
const ICONE_CARROS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 10.5V8.2l1.3-3.1a1.5 1.5 0 0 1 1.4-.9h4.6a1.5 1.5 0 0 1 1.4.9L13 8.2v2.3M2.5 10.5h11v1.8h-2v-1M4.5 11.3v1h-2v-1.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>'

// tamanho do selo: medido de novo só quando o texto ou a classe (fora o "on") mudam, ou depois de esquece()
export function mede(div) {
  const chave = (div.dataset.h || '') + '|' + div.className.replace(/(^|\s)on(?=\s|$)/, '')
  if (div._medida !== chave) { div._medida = chave; div._w = div.offsetWidth; div._h = div.offsetHeight || 32 }
  return { w: div._w, h: div._h }
}
export function esquece(camada) { for (const d of camada.children) d._medida = null }   // a tela mudou de tamanho (a fonte do selo muda no celular)

// escreve posição, haste e visibilidade, só o que mudou
function escreve(it) {
  const d = it.div
  if (!it.on && d._on === false) return                   // apagado e já estava: fica onde está (sem trabalho)
  const x = Math.round(it.x * 2) / 2, y = Math.round((it.y - it.sobe) * 2) / 2
  const t = `translate(${x}px, ${y}px) translate(-50%, -100%)`
  if (d._t !== t) { d._t = t; d.style.transform = t }
  const hs = `${Math.round(7 + it.sobe)}px`
  if (d._hs !== hs) { d._hs = hs; d.style.setProperty('--haste', hs) }
  if (d._on !== it.on) { d._on = it.on; d.classList.toggle('on', it.on) }
}

// as caixas dos selos (presas embaixo, no ponto de cada um) se cruzam? (para o grupo vale também o vizinho logo acima ou
// abaixo, a até duas alturas: com o posto pequeno na tela, a fileira de trás fica colada na da frente e os selos dela
// subiriam em escada por cima dos da frente)
const cruzam = (a, b) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + FOLGA && Math.abs(a.y - b.y) < a.h + b.h + FOLGA

// quanto aproximar para os selos de um grupo caberem separados (a distância entre eles cresce com o zoom; o selo não)
export function fatorParaSeparar(membros) {
  let f = 1
  for (let i = 0; i < membros.length; i++) for (let j = i + 1; j < membros.length; j++) {
    const a = membros[i], b = membros[j], dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y)
    const fx = dx < 0.5 ? Infinity : ((a.w + b.w) / 2 + FOLGA) / dx, fy = dy < 0.5 ? Infinity : (Math.max(a.h, b.h) + FOLGA) / dy
    f = Math.max(f, Math.min(fx, fy))
  }
  return f * 1.08
}
// o zoom do toque num grupo: o bastante para separar, mas sem passar do que cabe na largura da vista (no celular uma
// fileira de 4 carros, separada de vez, ficaria mais larga que a tela). O que ainda se cruzar sobe (escada de selos)
export function fatorParaGrupo(g, largura) {
  const fs = fatorParaSeparar(g.membros), xs = g.membros.map((m) => m.x)
  const vao = Math.max(...xs) - Math.min(...xs), wMax = Math.max(...g.membros.map((m) => m.w))
  const cabe = vao < 1 ? fs : (largura * 0.92 - wMax) / vao
  return Math.max(1.3, Math.min(fs, cabe))
}

// o arranjo do quadro. itens: { div, on, x, y, agrupa }. opc: { camada, agrupar, minimo, aoAbrir(grupo) }
// grupo: { x, y, membros: [{ x, y, w, h }] } em pixels da tela, para o motor aproximar a vista
export function arranja(itens, opc) {
  for (const it of itens) { const m = mede(it.div); it.w = m.w; it.h = m.h; it.sobe = 0 }
  const grupos = []
  if (opc.agrupar) {
    // do selo da frente (mais embaixo na tela) para trás: cada um que ainda está solto chama os soltos que cruzam com ele
    const cand = itens.filter((i) => i.on && i.agrupa).sort((a, b) => b.y - a.y), usado = new Set()
    for (const c of cand) {
      if (usado.has(c)) continue
      const g = [c]
      for (const d of cand) if (d !== c && !usado.has(d) && cruzam(c, d)) g.push(d)
      if (g.length < (opc.minimo || 3)) continue
      for (const d of g) { usado.add(d); d.on = false }
      grupos.push(g)
    }
  }
  // um selo de grupo por grupo (os divs são reaproveitados de um quadro para o outro)
  const camada = opc.camada, pool = camada._grupos || (camada._grupos = [])
  const itensGrupo = grupos.map((g, k) => {
    let div = pool[k]
    if (!div) {
      div = document.createElement('div'); div.className = 'mv-selo mv-grupo clicavel'; camada.appendChild(div); pool.push(div)
      div.addEventListener('click', () => { if (div._grupo && opc.aoAbrir) opc.aoAbrir(div._grupo) })
    }
    const falha = g.some((i) => i.div.classList.contains('falha'))
    const html = `<b class="mv-ic">${ICONE_CARROS}</b><span><b>${g.length}</b> carros</span>`
    if (div.dataset.h !== html) { div.innerHTML = html; div.dataset.h = html; div.setAttribute('aria-label', `${g.length} carros aqui. Toque para aproximar`) }
    div.classList.toggle('falha', falha)
    const x = g.reduce((a, i) => a + i.x, 0) / g.length, y = g.reduce((a, i) => a + i.y, 0) / g.length
    div._grupo = { x, y, membros: g.map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h })) }
    const m = mede(div)
    return { div, on: true, x, y, w: m.w, h: m.h, sobe: 0 }
  })
  for (let k = grupos.length; k < pool.length; k++) { const d = pool[k]; d._grupo = null; if (d._on !== false) { d._on = false; d.classList.remove('on') } }
  // os que ainda se cruzam: o da frente fica, o de trás sobe e a haste estica até o carro
  const todos = itens.concat(itensGrupo)
  const vis = todos.filter((i) => i.on).sort((a, b) => b.y - a.y)
  for (let i = 1; i < vis.length; i++) for (let j = 0; j < i; j++) {
    const a = vis[i], b = vis[j], baseA = a.y - a.sobe, topoB = b.y - b.sobe - b.h
    if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 + FOLGA && baseA > topoB - FOLGA && baseA - a.h < b.y - b.sobe) a.sobe += baseA - (topoB - FOLGA)
  }
  for (const it of todos) escreve(it)
  return grupos.length
}
