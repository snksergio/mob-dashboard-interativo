// iGreen · maquete viva · motor de composição (postos de 1 ou 2 bombas, misturadas; cobertura opcional)
// Camadas, na mesma câmera da maquete renderizada no Blender:
//   1. fundo do período (posto vazio, render do Cycles)
//   2. 3D ao vivo: carros, pistolas, cabos, anel da vaga, sombra do carro, preço no totem
//      (oclusores invisíveis escondem o que fica atrás de pilares, frades, totem e floreiras)
//   3. teto do período (cobertura de vidro, render do Cycles), por cima do carro
//   4. selos em HTML presos a pontos 3D (carro carregando, bomba com falha)
// A hora do dia cruza os renders vizinhos; a luz do carro acompanha (sol, céu, luzes da cena).
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { telaVista, desenhoTela, brilhoLuzes, pixelsDe } from './estado-bomba.js'
import { arranja, esquece, fatorParaGrupo } from './selos.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// V2 (peças soltas, cópia do app, 1/11): a maquete diz no pronto.json os horários que tem. Com a manhã e o pôr do sol, os
// 4 horários e as chaves de antes da V1 (capturas/maquete-antes-desempenho-backup.js); sem eles, só dia e noite, como a V1
export let PERIODOS = ['tarde', 'noite']
// [hora, período]: entre duas chaves iguais segura; entre diferentes cruza
const CHAVES2 = [[0, 'noite'], [5.5, 'noite'], [7, 'tarde'], [17.4, 'tarde'], [18.8, 'noite'], [24, 'noite']]
const CHAVES4 = [[0, 'noite'], [5, 'noite'], [7.5, 'manha'], [10, 'manha'], [12.5, 'tarde'], [16.5, 'tarde'], [17.8, 'por'], [18.6, 'por'], [19.6, 'noite'], [24, 'noite']]
let CHAVES = CHAVES2
export async function horariosDa(base) {
  const pr = await fetch(base + 'pronto.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)
  const h = (pr && pr.horarios) || []
  return h.includes('manha') && h.includes('por') ? ['tarde', 'noite', 'manha', 'por'] : ['tarde', 'noite']
}
const CORES = { carregando: '#3DFF6A', conectando: '#E9FFEF', falha: '#FF2A1F', aguardando: '#E9FFEF' }
const lerp = (a, b, t) => a + (b - a) * t
const clamp01 = (t) => Math.max(0, Math.min(1, t))
const clamp = (t, a, b) => Math.max(a, Math.min(b, t))
const suave = (t) => t * t * (3 - 2 * t)
const easeOut = (t) => 1 - Math.pow(1 - t, 3)
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const V = (a) => new THREE.Vector3(a[0], a[1], a[2])

export function periodoDaHora(h) {
  h = ((h % 24) + 24) % 24
  for (let i = 0; i < CHAVES.length - 1; i++) {
    const [h0, p0] = CHAVES[i], [h1, p1] = CHAVES[i + 1]
    if (h >= h0 && h <= h1) return { a: p0, b: p1, t: p0 === p1 ? 0 : suave((h - h0) / (h1 - h0)) }
  }
  return { a: 'noite', b: 'noite', t: 0 }
}

// ------------------------------------------------------------ materiais do carro (o que era shader no Blender)
const ZONAS_GLSL = `
varying vec3 vObj;
float zonaPreta(vec3 p){
  float e = max(0.004, 0.8 * length(fwidth(p)));
  float a = 1.0 - smoothstep(-e, e, p.z - (0.395 - 0.015 * p.y));
  float d1 = length(vec2(p.y - 1.371, p.z - 0.377)), d2 = length(vec2(p.y + 1.375, p.z - 0.377));
  float arcos = max(1.0 - smoothstep(0.5 - e, 0.5 + e, d1), 1.0 - smoothstep(0.5 - e, 0.5 + e, d2));
  float b = arcos * smoothstep(0.55 - e, 0.55 + e, abs(p.x)) * smoothstep(0.327 - e, 0.327 + e, p.z);
  float c = (1.0 - smoothstep(-1.94 - e, -1.94 + e, p.y)) * (1.0 - smoothstep(0.55 - e, 0.55 + e, p.z));
  float zt = p.z - 0.03 * p.x * p.x;
  float dd = smoothstep(2.03 - e, 2.03 + e, p.y) * (1.0 - smoothstep(0.56 - e, 0.56 + e, abs(p.x)))
           * smoothstep(0.405 - e, 0.405 + e, zt) * (1.0 - smoothstep(0.485 - e, 0.485 + e, zt));
  return max(max(a, b), max(c, dd));
}`
function pinturaZonas(cor) {
  const m = new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.05 })
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;')
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + ZONAS_GLSL)
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat zp = zonaPreta(vObj);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.0097, 0.0103, 0.0116), zp);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.58, zp);')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= (1.0 - zp);\n#endif')
  }
  m.customProgramCacheKey = () => 'zonas'
  return m
}
function calota() {
  const m = new THREE.MeshStandardMaterial({ color: '#EEF0F1', roughness: 0.35, side: THREE.DoubleSide })
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vLoc;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position.xy;')
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vLoc;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float r = length(vLoc); float ang = atan(vLoc.y, vLoc.x);
        float tt = ang * 0.63662 + 0.32 * r; float u = fract(tt); float wd = 0.5 * r + 0.12;
        // largura de um pixel em cada medida: a borda vira um degradê de 1 px (sem escadinha)
        float fr = max(fwidth(r), 1e-4);
        float ft = clamp(fwidth(tt), 1e-4, 0.08);                  // no corte do atan o fwidth explode: limita
        float dent = u < wd ? min(u, wd - u) : -min(u - wd, 1.0 - u); // distância com sinal até a borda da pá
        float pa = smoothstep(-ft, ft, dent) * smoothstep(0.22 - fr, 0.22 + fr, r) * (1.0 - smoothstep(0.93 - fr, 0.93 + fr, r));
        float esc = max(pa, max(1.0 - smoothstep(0.13 - fr, 0.13 + fr, r), smoothstep(0.975 - fr, 0.975 + fr, r)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.0080, 0.0091, 0.0103), esc);`)
  }
  m.customProgramCacheKey = () => 'calota'
  return m
}
function materialDoCarro(nome, corPintura, luzes) {
  if (nome.startsWith('c2_pintura_zonas')) return pinturaZonas(corPintura)
  if (nome.startsWith('c2_pintura')) return new THREE.MeshPhysicalMaterial({ color: corPintura, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.05 })
  if (nome.startsWith('c2_vidro')) return new THREE.MeshPhysicalMaterial({ color: '#08090B', roughness: 0.3, specularIntensity: 0.6 })
  if (nome.startsWith('c2_revest')) return new THREE.MeshStandardMaterial({ color: '#191B1D', roughness: 0.58 })
  if (nome.startsWith('c2_forro')) return new THREE.MeshStandardMaterial({ color: '#0D0E10', roughness: 0.85 })
  if (nome.startsWith('c2_macaneta')) return new THREE.MeshStandardMaterial({ color: '#6B7076', roughness: 0.38, metalness: 0.4 })
  if (nome.startsWith('c2_vinco')) return new THREE.MeshStandardMaterial({ color: '#9DA3A8', roughness: 0.5 })
  if (nome.startsWith('c2_pneu')) return new THREE.MeshStandardMaterial({ color: '#141517', roughness: 0.78 })
  if (nome.startsWith('c2_calota')) return calota()
  if (nome.startsWith('c2_led')) { const m = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#DCEBFF', emissiveIntensity: 6 }); luzes.farol.push(m); return m }
  if (nome.startsWith('c2_lanterna')) { const m = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#FF2A1E', emissiveIntensity: 3 }); luzes.lanterna.push(m); return m }
  return null
}

// ------------------------------------------------------------ texturas desenhadas no canvas
function texturaAnel(falha = false) {
  // contorno arredondado com brilho, para o chão da vaga (o tom vem da cor do material).
  // falha: contorno mais grosso e a vaga levemente tingida (o vermelho precisa cobrir o verde da pintura)
  const c = document.createElement('canvas'); c.width = 512; c.height = 1024
  const g = c.getContext('2d')
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath() }
  g.strokeStyle = '#fff'
  for (const [lw, a, blur] of falha ? [[34, 0.35, 30], [20, 0.7, 12], [12, 1, 0]] : [[26, 0.18, 30], [14, 0.4, 14], [6, 1, 0]]) { g.globalAlpha = a; g.lineWidth = lw; g.shadowColor = '#fff'; g.shadowBlur = blur; rr(40, 40, 432, 944, 60); g.stroke() }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
}
function texturaHalo() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64
  const g = c.getContext('2d'); const gr = g.createRadialGradient(128, 128, 2, 128, 128, 128)
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.save(); g.scale(1, 0.25); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); g.restore()
  return new THREE.CanvasTexture(c)
}
function texturaGlow() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256
  const g = c.getContext('2d'); const gr = g.createRadialGradient(128, 128, 4, 128, 128, 128)
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256)
  return new THREE.CanvasTexture(c)
}
function texturaSombra() {
  // sombra de contato: retângulo arredondado desfocado, do tamanho da planta do carro. Ela chega a zero antes da
  // borda do plano; o degradê antigo ainda estava a 70% na borda e o plano aparecia como um quadrado escuro
  const c = document.createElement('canvas'); c.width = 128; c.height = 256
  const g = c.getContext('2d'), fora = 400                      // desenha fora da tela e usa só a sombra desfocada
  g.shadowColor = '#000'; g.shadowBlur = 18; g.shadowOffsetX = fora
  g.fillStyle = '#000'; g.beginPath(); g.roundRect(64 - 44 - fora, 128 - 106, 88, 212, 36); g.fill()
  return new THREE.CanvasTexture(c)
}
const LINHAS_TOTEM = { fast: ['DC · 40 kW', 'AC · 7 kW', '2 vagas'], ultra: ['DC · 80 kW', '2 vagas'], mobi: ['AC · 7 kW', '1 vaga'] }
function desenhaTotem(canvas, preco, logo, linhas = LINHAS_TOTEM.fast) {
  // a mesma face do totem renderizada no Blender (assets/totem-face.html), com o preço que vem do painel
  const g = canvas.getContext('2d'); const S = canvas.width / 400
  g.setTransform(S, 0, 0, S, 0, 0)
  g.fillStyle = '#11171A'; g.fillRect(0, 0, 400, 1200)
  g.fillStyle = '#00A83C'; g.fillRect(0, 0, 400, 250)
  if (logo) { const lw = 290, lh = lw / 3.595; g.drawImage(logo, (400 - lw) / 2, 82, lw, lh) }
  const f = (peso, tam) => `${peso} ${tam}px "Barlow Condensed", "Arial Narrow", sans-serif`
  g.fillStyle = '#E9FFEF'; g.font = f(700, 22); g.textAlign = 'center'
  if ('letterSpacing' in g) g.letterSpacing = '3.5px'
  g.fillText('RECARGA ELÉTRICA', 200, 196)
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath() }
  g.fillStyle = '#070B0C'; rr(22, 280, 356, 894, 26); g.fill(); g.strokeStyle = '#1E272B'; g.lineWidth = 3; g.stroke()
  g.textAlign = 'left'; if ('letterSpacing' in g) g.letterSpacing = '3px'
  g.fillStyle = '#8FA19A'; g.font = f(700, 22); g.fillText('PREÇO DO kWh', 51, 340)
  if ('letterSpacing' in g) g.letterSpacing = '0px'
  g.fillStyle = '#F2FFF5'; g.font = f(700, 38); g.fillText('R$', 51, 410)
  g.font = f(800, 168); if ('letterSpacing' in g) g.letterSpacing = '-6px'
  g.fillText(preco, 98, 520)
  if ('letterSpacing' in g) g.letterSpacing = '0px'
  g.fillStyle = '#3DF56A'; g.font = f(700, 34); g.fillText('por kWh', 51, 585)
  g.fillStyle = '#1E272B'; g.fillRect(51, 640, 298, 3)
  g.fillStyle = '#DCE7E2'; g.font = f(600, 42)
  ;linhas.forEach((t, i) => {
    const y = 730 + i * 90; g.fillText(t, 51, y)
    g.fillStyle = '#03FF1F'; g.beginPath(); g.arc(338, y - 14, 11, 0, Math.PI * 2); g.fill(); g.fillStyle = '#DCE7E2'
  })
  g.fillStyle = '#1E272B'; g.fillRect(51, 1040, 298, 3)
  g.fillStyle = '#8FA19A'; g.font = f(600, 26); g.textAlign = 'center'
  g.fillText('Pague pelo app', 200, 1090); g.fillText('ou cartão', 200, 1125)
}

// ------------------------------------------------------------ geometria: cabo deitado no chão e pistola
function catmull(pts, n) {
  const out = []; const P = [pts[0], ...pts, pts[pts.length - 1]]
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]]
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t
      out.push(new THREE.Vector3().addScaledVector(p1, 2).addScaledVector(new THREE.Vector3().subVectors(p2, p0), t)
        .addScaledVector(new THREE.Vector3().copy(p0).multiplyScalar(2).addScaledVector(p1, -5).addScaledVector(p2, 4).sub(p3), t2)
        .addScaledVector(new THREE.Vector3().copy(p0).negate().addScaledVector(p1, 3).addScaledVector(p2, -3).add(p3), t3).multiplyScalar(0.5))
    }
  }
  out.push(pts[pts.length - 1].clone()); return out
}

export async function criarMaquete(el, opcoes = {}) {
  const base = opcoes.dados || 'dados/fast/'
  PERIODOS = await horariosDa(base); CHAVES = PERIODOS.length > 2 ? CHAVES4 : CHAVES2
  // progresso: cada arquivo baixado conta um passo (âncoras, luzes, camadas, panorâmicas, carro, peças e logo) e, no fim,
  // o aquecimento (as duas compilações e cada camada que sobe para a placa)
  // (3/11, noite) as camadas (chão, teto, árvore da ilha) do horário de agora vêm primeiro; as dos outros horários, em
  // segundo plano depois que o posto aparece. Até chegarem, o horário mais parecido entra no lugar (VIZINHO)
  // (4/11) só o horário mais perto da hora de agora (entre dois, antes vinham os dois: num celular com 4G, ~1,2 MB a mais
  // antes de abrir); o outro chega em segundo plano e, até lá, o mais perto fica no lugar dele (VIZINHO)
  const INI = (() => { const { a, b, t } = periodoDaHora(opcoes.hora ?? 14); return new Set([t < 0.5 ? a : b]) })()
  let feitos = 0; const TOTAL = 2 + PERIODOS.length * 2 + INI.size * 2 + 3 + 2 + INI.size * 2
  // (o que chega em segundo plano, depois do posto aparecer, não conta no progresso)
  let segundoPlano = false
  const passo = () => { if (segundoPlano) return; feitos++; if (opcoes.aoProgresso) opcoes.aoProgresso(Math.min(1, feitos / TOTAL)) }
  const json = (u) => fetch(u).then((r) => r.json()).then((d) => { passo(); return d })
  const an = await json(base + 'ancoras.json')
  const infoCarro = await json('dados/carro.json')
  const luzesP = {}; for (const p of PERIODOS) luzesP[p] = await json(base + `luzes-${p}.json`)

  // ---------------------------------------------------------- renderizador e câmera casada com a do Blender
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: !!opcoes.captura })
  renderer.setPixelRatio(Math.min(2, Math.max(1.5, window.devicePixelRatio || 1)))   // 1,5x em telas comuns: supersampling
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NeutralToneMapping            // o mesmo "Khronos PBR Neutral" do Blender
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.autoClear = false; renderer.setClearColor(0x000000, 0)
  el.appendChild(renderer.domElement)
  const ASPECTO = an.camera.largura / an.camera.altura
  // o canvas cobre o elemento todo; o quadro do render (img) fica centrado dentro das margens --mv-margem (t r b l).
  // Fora do quadro as camadas são transparentes, então aproximar mostra o entorno em vez de cortar numa borda reta.
  let img = { x: 0, y: 0, w: 1, h: 1 }, cnv = { w: 1, h: 1 }
  const jan = { U0: 0, V0: 0, U1: 1, V1: 1 }                  // o que o canvas mostra, em coordenadas do quadro (0..1)

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400)
  const m = an.camera.matriz
  new THREE.Matrix4().set(...m[0], ...m[1], ...m[2], ...m[3]).decompose(cam.position, cam.quaternion, cam.scale)
  cam.scale.set(1, 1, 1)
  const S = an.camera.escala, baseF = { l: an.camera.shift_x * S - S / 2, r: an.camera.shift_x * S + S / 2, b: an.camera.shift_y * S - S / (2 * ASPECTO), t: an.camera.shift_y * S + S / (2 * ASPECTO) }
  const zoom = { k: 1, alvo: 1, u: 0.5, v: 0.5 }          // janela: fator e centro (0..1 no quadro)
  function aplicaZoom() {
    const k = zoom.k, w = 1 / k
    // aproximado: a janela fica dentro do render (o arrasto para na borda); afastado: o render fica no centro, menor
    const canto = (c) => (w >= 1 ? 0.5 - w / 2 : Math.min(Math.max(c - w / 2, 0), 1 - w))
    const u0 = canto(zoom.u), v0 = canto(zoom.v)
    // a janela do zoom ocupa o lugar do quadro; as margens em volta mostram o que fica além dela
    jan.U0 = u0 - (img.x / img.w) * w; jan.U1 = jan.U0 + (cnv.w / img.w) * w
    jan.V0 = v0 - ((cnv.h - img.y - img.h) / img.h) * w; jan.V1 = jan.V0 + (cnv.h / img.h) * w
    cam.left = lerp(baseF.l, baseF.r, jan.U0); cam.right = lerp(baseF.l, baseF.r, jan.U1)
    cam.bottom = lerp(baseF.b, baseF.t, jan.V0); cam.top = lerp(baseF.b, baseF.t, jan.V1)
    cam.updateProjectionMatrix()
    for (const q of [quadFundo, quadTeto]) q.material.uniforms.janela.value.set(jan.U0, jan.V0, jan.U1, jan.V1)
    // grade de pontinhos (CSS do elemento): presa ao render, cresce com o zoom e anda com o arrasto
    const kTela = (cnv.w / img.w) / (jan.U1 - jan.U0), gx = (-jan.U0 / (jan.U1 - jan.U0)) * cnv.w, gy = cnv.h - (-jan.V0 / (jan.V1 - jan.V0)) * cnv.h
    const gChave = kTela.toFixed(3) + ' ' + gx.toFixed(1) + ' ' + gy.toFixed(1)
    if (gChave !== gradeChave) { gradeChave = gChave; el.style.setProperty('--grade-k', kTela.toFixed(3)); el.style.setProperty('--grade-x', gx.toFixed(1) + 'px'); el.style.setProperty('--grade-y', gy.toFixed(1) + 'px') }
  }
  let gradeChave = ''

  // ---------------------------------------------------------- camadas renderizadas (fundo e teto), com cruzamento de períodos
  const tl = new THREE.TextureLoader()
  // (9/11) a imagem que falha (rede, decodificação) tenta de novo uma vez; se falhar de novo, o erro sobe (o painel cai na
  // 2D) em vez de deixar o carregamento esperando para sempre
  const tex = (u) => new Promise((ok, falha) => {
    const pronto = (t) => { t.colorSpace = THREE.SRGBColorSpace; t.premultiplyAlpha = true; t.anisotropy = 4; passo(); ok(t) }
    tl.load(u, pronto, undefined, () => setTimeout(() => tl.load(u + (u.includes('?') ? '&' : '?') + 'de-novo=1', pronto, undefined,
      () => falha(new Error(`não deu para baixar ${u.split('/').pop()}`))), 800))
  })
  const ext = opcoes.ext || 'webp'
  const fundos = {}, tetos = {}, envs = {}
  const camadasDe = async (p) => { const [f, t] = await Promise.all([tex(base + `fundo-${p}.${ext}`), tex(base + `teto-${p}.${ext}`)]); fundos[p] = f; tetos[p] = t }
  await Promise.all([...INI].map(camadasDe))
  // o horário que ainda não chegou: o mais parecido que já está aqui
  const VIZINHO = { manha: ['tarde', 'noite', 'por'], tarde: ['manha', 'por', 'noite'], por: ['noite', 'tarde', 'manha'], noite: ['por', 'tarde', 'manha'] }
  const de = (arr, p) => arr[p] || (VIZINHO[p] || []).map((q) => arr[q]).find(Boolean) || Object.values(arr)[0]
  // (5/11) horários sob demanda no celular (toque) ou em aparelho com pouca memória: cada horário são duas camadas de
  // 3600 × 2314 (fundo e teto), ~66 MB na placa; com os quatro eram ~266 MB, e um celular simples tem de 200 a 500 MB
  // para tudo. Lá, só os dois horários em uso ficam na placa; os outros vão só para o cache do navegador (o arquivo) e
  // sobem quando a hora chega neles; o horário fora de uso há mais de 10 s é devolvido. No computador, tudo como antes
  const ECONOMIA = matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory || 8) <= 4
  const carregandoP = {}, usoEm = {}
  function garante(p) {
    if (fundos[p] || !PERIODOS.includes(p)) return Promise.resolve()
    if (!carregandoP[p]) carregandoP[p] = (async () => {
      await camadasDe(p).catch(() => null)
      if (copaU.carregaResto) await copaU.carregaResto(p)
      for (const t of [fundos[p], tetos[p]]) if (t) { if (t.image && t.image.decode) await t.image.decode().catch(() => null); renderer.initTexture(t) }
      delete carregandoP[p]
    })()
    return carregandoP[p]
  }
  function libera() {
    if (!ECONOMIA) return
    const { a, b } = periodoDaHora(hora), agora = performance.now()
    usoEm[a] = usoEm[b] = agora
    for (const p of Object.keys(fundos)) if (p !== a && p !== b && agora - (usoEm[p] || 0) > 10000) { fundos[p].dispose(); if (tetos[p]) tetos[p].dispose(); delete fundos[p]; delete tetos[p] }
  }
  const pmrem = new THREE.PMREMGenerator(renderer)
  // panorâmica do lugar do carro: a metade de baixo (o chão) escurece, porque o próprio carro faz sombra no chão
  // embaixo dele; sem isso o verde da vaga refletia demais na pintura branca
  const envDe = (u) => new Promise((ok) => {
    const im = new Image(); im.onload = () => {
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height
      const g = c.getContext('2d'); g.drawImage(im, 0, 0)
      const y0 = c.height * 0.64, gr = g.createLinearGradient(0, y0, 0, c.height)
      gr.addColorStop(0, 'rgba(18,20,19,0)'); gr.addColorStop(0.35, 'rgba(18,20,19,.5)'); gr.addColorStop(1, 'rgba(18,20,19,.8)')
      g.fillStyle = gr; g.fillRect(0, y0, c.width, c.height - y0)
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping; passo(); ok(t)
    }; im.onerror = () => { passo(); ok(null) }; im.src = u
  })
  await Promise.all(PERIODOS.map(async (p) => { const t = await envDe(base + `env-${p}.${ext === 'webp' ? 'jpg' : 'png'}`); if (t) envs[p] = pmrem.fromEquirectangular(t).texture }))

  const telaCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  // (3/11, noite, V3) o estado de cada bomba na própria imagem: estados.png diz em que pixels está cada bomba (vermelho =
  // número dela). Em falha, as partes verdes acesas dela (a tela, os LEDs, o anel dos frades) ficam vermelhas e piscam;
  // desligada, apagam. Sem a máscara (maquete antiga), nada muda.
  // (4/11, pedido do Sergio) falha: em volta das luzes vermelhas, um brilho leve de LED (tHalo.r, o verde da máscara
  // desfocado, mais forte à noite), como se a luz vazasse da própria imagem. Desligada: não fica preta; a bomba inteira
  // perde a cor (cinza, "fora de serviço") e o que acendia vira um cinza neutro de plástico apagado; à noite, a luz que ela
  // jogava no chão em volta (tHalo.g) também perde a cor e escurece um pouco
  const placa = () => new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { tA: { value: null }, tB: { value: null }, t: { value: 0 }, janela: { value: new THREE.Vector4(0, 0, 1, 1) }, opac: { value: 1 }, chuva: { value: 0 },
      tMask: { value: null }, temMask: { value: 0 }, estados: { value: new Array(16).fill(0) }, uT: { value: 0 }, piscar: { value: 1 },
      tHalo: { value: null }, temHalo: { value: 0 }, uNoite: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `uniform sampler2D tA, tB, tMask, tHalo; uniform float t, opac, chuva, temMask, uT, piscar, temHalo, uNoite; uniform float estados[16]; uniform vec4 janela; varying vec2 vUv;
      void main(){
        vec2 uv = janela.xy + vUv * (janela.zw - janela.xy);
        if (uv.x < 0. || uv.x > 1. || uv.y < 0. || uv.y > 1.) discard;     // fora do render
        vec4 c = mix(texture2D(tA, uv), texture2D(tB, uv), t);          // pré-multiplicado
        vec3 col = c.a > 1e-4 ? c.rgb / c.a : vec3(0.0);
        float pulso = mix(1.0, 0.55 + 0.45 * sin(uT * 5.5), piscar);
        if (temMask > 0.5) {
          vec4 mk = texture2D(tMask, uv);
          float id = floor(mk.r * 255.0 + 0.5), e = 0.0;
          for (int i = 0; i < 16; i++) if (float(i + 1) == id) e = estados[i];
          if (e > 0.5) {
            float lv = dot(col, vec3(0.2126, 0.7152, 0.0722));
            float aceso = mk.g;                                     // o que acende (medido à noite, na montagem)
            if (e < 1.5) col = mix(col, vec3(col.g * 1.15 + 0.03, col.g * 0.12, col.g * 0.08) * pulso, aceso);
            else {
              col = mix(col, vec3(lv) * vec3(0.93, 0.97, 0.98), 0.78);              // a bomba sem cor
              col = mix(col, vec3(0.19, 0.21, 0.215) + 0.12 * lv, aceso);           // o que acendia: plástico cinza apagado
            }
          }
        }
        if (temHalo > 0.5) {
          vec4 h = texture2D(tHalo, uv);
          // falha: o brilho vermelho em volta das luzes (de dia bem leve; à noite mais forte), pulsando junto
          col += vec3(1.0, 0.13, 0.07) * h.r * (0.22 + 0.5 * uNoite) * pulso;
          // desligada, à noite: a luz verde que ela jogava em volta perde a cor e escurece
          float lh = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(col, vec3(lh) * 0.82, h.g * uNoite * 0.8);
        }
        // dia nublado: menos cor, mais escuro e um pouco mais frio (o verde da marca perde menos que o resto)
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        float verde = smoothstep(0.08, 0.3, col.g - max(col.r, col.b));
        vec3 nub = mix(col, vec3(l), 0.48 * (1.0 - 0.6 * verde)) * vec3(0.84, 0.9, 0.98) * 0.68;
        col = mix(col, nub, chuva);
        gl_FragColor = vec4(col, c.a * opac);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  }))
  const quadFundo = placa(), quadTeto = placa()
  // a máscara das bombas (V3; opcional: a maquete antiga não tem)
  const mascaraB = await new Promise((ok) => tl.load(base + 'estados.png', (t) => { t.colorSpace = THREE.NoColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; ok(t) }, undefined, () => ok(null)))
  if (mascaraB) { quadFundo.material.uniforms.tMask.value = mascaraB; quadFundo.material.uniforms.temMask.value = 1 }
  // (4/11) o brilho em volta das luzes das bombas em falha (r) e a luz apagada em volta das desligadas (g), feitos na hora
  // a partir da máscara, quando um estado muda (DataTexture: a linha 0 é a de baixo, por isso a imagem vai de cabeça para baixo)
  const mascaraPx = mascaraB ? pixelsDe(mascaraB.image) : null
  let texHalo2 = null
  function atualizaHalo(falhas, inativas) {
    const u = quadFundo.material.uniforms
    if (!mascaraPx || (!falhas.size && !inativas.size)) { u.temHalo.value = 0; return }
    const f = falhas.size ? brilhoLuzes(mascaraPx, falhas, 6, 2.6) : null, d = inativas.size ? brilhoLuzes(mascaraPx, inativas, 14, 4) : null
    // (a grade do brilho é a metade da máscara: o brilho é desfocado, e a textura sobe 4 vezes mais leve)
    const w = Math.ceil(mascaraPx.width / 2), h = Math.ceil(mascaraPx.height / 2), px = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, o = ((h - 1 - y) * w + x) * 4
      px[o] = f ? f.d[p] * 255 : 0; px[o + 1] = d ? d.d[p] * 255 : 0; px[o + 3] = 255
    }
    if (texHalo2) texHalo2.dispose()
    texHalo2 = new THREE.DataTexture(px, w, h, THREE.RGBAFormat)
    texHalo2.magFilter = texHalo2.minFilter = THREE.LinearFilter; texHalo2.generateMipmaps = false; texHalo2.colorSpace = THREE.NoColorSpace; texHalo2.needsUpdate = true
    u.tHalo.value = texHalo2; u.temHalo.value = 1
  }
  const chuva = { k: 0, alvo: 0 }, nuvem = { k: 0, alvo: 0 }      // chuva: gotas e respingos; nuvem: só o céu fechado
  const quadChuva = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uK: { value: 0 }, uDpr: { value: 1 }, janela: quadFundo.material.uniforms.janela, tA: { value: null }, tB: { value: null }, tMix: { value: 0 }, aspecto: { value: 1 }, noite: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `uniform float uT, uK, uDpr, tMix, aspecto, noite; uniform vec4 janela; uniform sampler2D tA, tB; varying vec2 vUv;
      float h1(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      // uma camada de gotas: colunas estreitas e altas, cada célula com no máximo um risco que desce
      float gotas(vec2 px, float cel, float vel, float comp, float dens, float esp){
        vec2 q = px; q.x += q.y * 0.17;                                  // vento: as gotas descem inclinadas
        float alt = cel * 7.0;
        vec2 g = vec2(q.x / cel, q.y / alt + uT * vel);
        vec2 id = floor(g), f = fract(g);
        if (h1(id) > dens) return 0.0;
        float dx = abs(f.x - (0.15 + 0.7 * h1(id + 3.1))) * cel;        // distância ao risco, em pixels
        float y = f.y - h1(id + 9.7) * (1.0 - comp);
        if (y < 0.0 || y > comp) return 0.0;
        return (1.0 - y / comp) * smoothstep(esp, 0.0, dx);            // cabeça (embaixo) mais forte, rabo some
      }
      // respingos: anéis achatados (no chão) que abrem e somem, presos ao render
      float respingos(vec2 uv){
        vec2 g = vec2(uv.x * 38.0, uv.y * 38.0 / aspecto);
        vec2 id = floor(g), f = fract(g);
        float r = h1(id + 1.7); if (r > 0.6) return 0.0;
        float p = fract(uT * (1.4 + r) + h1(id + 5.3));
        if (p > 0.55) return 0.0;
        p /= 0.55;
        vec2 c = vec2(0.2 + 0.6 * h1(id + 2.2), 0.2 + 0.6 * h1(id + 8.8));
        vec2 d = (f - c) * vec2(1.0, 2.4);                               // achatado: o chão é visto de cima, inclinado
        float raio = 0.04 + p * 0.22, dist = length(d);
        float anel = smoothstep(0.06, 0.0, abs(dist - raio)) * (1.0 - p);
        float pingo = smoothstep(0.07, 0.0, dist) * (1.0 - smoothstep(0.0, 0.25, p));      // o pingo bate antes de abrir o anel
        return max(anel, pingo);
      }
      void main(){
        if (uK < 0.002) discard;
        vec2 px = gl_FragCoord.xy / uDpr;
        float a = gotas(px, 7.0, 11.0, 0.22, 0.32, 0.7) * 0.16 + gotas(px + 31.0, 12.0, 8.5, 0.3, 0.24, 0.9) * 0.26 + gotas(px + 77.0, 21.0, 6.2, 0.34, 0.12, 1.25) * 0.36;
        vec2 uv = janela.xy + vUv * (janela.zw - janela.xy);
        vec4 fc = vec4(0.0);
        if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) fc = mix(texture2D(tA, uv), texture2D(tB, uv), tMix);
        float sp = respingos(uv) * smoothstep(0.9, 1.0, fc.a);
        // sobre fundo escuro a gota é clara; sobre o piso claro, um cinza-azulado mais escuro (senão some)
        float claro = smoothstep(0.18, 0.5, dot(fc.rgb, vec3(0.2126, 0.7152, 0.0722)));
        vec3 corClara = mix(vec3(0.82, 0.88, 0.95), vec3(0.62, 0.72, 0.85), noite);
        vec3 cor = mix(corClara, vec3(0.16, 0.2, 0.26), claro);
        float alfa = clamp((a * (1.0 + 0.6 * claro) + sp * mix(0.55, 0.5, claro)) * uK, 0.0, 1.0);
        gl_FragColor = vec4(cor, alfa);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  }))
  const cenaChuva = new THREE.Scene(); cenaChuva.add(quadChuva)
  const cenaFundo = new THREE.Scene(); cenaFundo.add(quadFundo)
  const cenaTeto = new THREE.Scene(); cenaTeto.add(quadTeto)

  // ---------------------------------------------------------- cena ao vivo
  const cena = new THREE.Scene()
  const Z = an.Z, FX_H = an.FX_H, FX_Y0 = an.FX_Y0
  // (9/11) vagas paralelas: pátio plano (as rampas ficam nas laterais) e o topo das ilhas onde elas estão
  const LAT = !!an.lateral
  const naIlha = (x, y) => LAT && an.ilhas.some((il) => Math.abs(y - il.y) < il.w / 2 + 0.005 && x > il.x0 && x < il.x1)
  const chao = (x, y) => (LAT ? (naIlha(x, y) ? Z + FX_H : Z) : y > FX_Y0 - 0.005 ? Z + FX_H : chaoPatio(y))
  const chaoPatio = (y) => { if (LAT) return Z; const y0 = an.AP_Y0, y1 = an.AP_Y0 + an.RAMPA_L; return y >= y1 ? Z : y <= y0 ? 0.015 : lerp(0.015, Z, (y - y0) / (y1 - y0)) }
  // ilha (maquete v14): as vagas da fileira de trás vêm "de frente" no ancoras.json (como a fileira da frente); o quadro delas
  // gira 180° em volta de (CX, Y_MID), o mesmo giro que a v14 faz no Blender. Carro, pistola, cabo e anel vivem nesse quadro.
  const quadroTras = new THREE.Group()
  if (an.ILHA) { quadroTras.position.set(2 * an.CX, 2 * an.Y_MID, 0); quadroTras.rotation.z = Math.PI }
  const paraMundo = (fil, p) => (fil === 'fundos' ? new THREE.Vector3(2 * an.CX - p.x, 2 * an.Y_MID - p.y, p.z) : p.clone())
  // a laje (postos da v14) dá o tamanho do chão que recebe a sombra do carro e da área de sombra do sol
  const LJ = an.laje, ljC = LJ ? [(LJ.x0 + LJ.x1) / 2, (LJ.y0 + LJ.y1) / 2] : [0, 2], ljT = LJ ? [LJ.x1 - LJ.x0 + 2, LJ.y1 - LJ.y0 + 2] : [14, 14]

  // oclusores invisíveis: só escrevem profundidade (o que está atrás deles some, como no render)
  // (5/11) todos numa malha só: são fixos e iguais (só profundidade), e cada um era um pedido de desenho por quadro (~50
  // na ilha de 8 vagas). A profundidade que escrevem é a mesma
  const matOc = new THREE.MeshBasicMaterial({ colorWrite: false })
  {
    const geos = []
    for (const o of an.oclusores) {
      const mn = V(o.min), mx = V(o.max), c = mn.clone().add(mx).multiplyScalar(0.5), d = mx.clone().sub(mn)
      const g = o.cilindro ? new THREE.CylinderGeometry(d.x / 2, d.x / 2, d.z, 20).rotateX(Math.PI / 2) : new THREE.BoxGeometry(d.x, d.y, d.z)
      g.translate(c.x, c.y, c.z)
      for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k)
      geos.push(g.toNonIndexed())
    }
    if (geos.length) { const oc = new THREE.Mesh(mergeGeometries(geos), matOc); oc.renderOrder = -1; cena.add(oc) }
  }
  // Ilha (29/10, pedido do Sergio): a árvore do canteiro do meio fica na frente do primeiro carro dos fundos, mas o carro
  // é desenhado por cima do render e a árvore parecia passar por trás dele. O tronco vira um oclusor (sólido). A copa é
  // uma forma um pouco maior que ela que, onde há um carro atrás, desenha por cima a camada só da árvore (arvore-<horário>,
  // recortada das mesmas peças na montagem): só as folhas e o tronco cobrem o carro, e ele aparece nos vãos. A primeira
  // tentativa redesenhava o render inteiro naquela forma, a ~75%, e o chão e o pilar apareciam fantasmas sobre o carro.
  // Medidas do arvore_v8 (s = 0,85): tronco ~1,4 m, copa de ~1,15 m de raio entre ~1,7 e ~3,2 m. A posição vem da luz da
  // árvore (a base dela). Sem a camada (ilhas do Blender), fica só o tronco
  const luzArvore = an.ILHA && PERIODOS.map((p) => luzesP[p].luzes.find((L) => /^arvore/.test(L.nome))).find(Boolean)
  const copaU = { tela: { value: new THREE.Vector2(1, 1) } }
  if (luzArvore) {
    const [ax, ay, az] = luzArvore.pos, zb = az - 0.1
    const tronco = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.75, 12), matOc)
    tronco.rotation.x = Math.PI / 2; tronco.position.set(ax, ay, zb + 0.875); tronco.renderOrder = -1; cena.add(tronco)
    const rets = await Promise.all(PERIODOS.map((p) => fetch(base + `arvore-${p}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
    if (rets.every(Boolean)) {
      const arv = {}
      // (a do horário de agora primeiro; as outras vão com as camadas em segundo plano)
      await Promise.all(PERIODOS.map(async (p, i) => { if (INI.has(p)) arv[p] = { tex: await tex(base + `arvore-${p}.webp`), r: rets[i] } }))
      copaU.carregaResto = (p) => arv[p] ? Promise.resolve(arv[p].tex) : new Promise((ok) => tl.load(base + `arvore-${p}.webp`, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.premultiplyAlpha = true; t.anisotropy = 4; arv[p] = { tex: t, r: rets[PERIODOS.indexOf(p)] }; ok(t) }, undefined, () => ok(null)))
      const u = quadFundo.material.uniforms
      Object.assign(copaU, { aA: { value: null }, aB: { value: null }, rA: { value: new THREE.Vector4() }, rB: { value: new THREE.Vector4() }, t: u.t, janela: u.janela, chuva: u.chuva })
      copaU.horarios = (a, b) => { for (const [k, p] of [['A', a], ['B', b]]) { const x = de(arv, p); copaU['a' + k].value = x.tex; copaU['r' + k].value.set(x.r.u0, x.r.v0, x.r.u1, x.r.v1) } }
      const copa = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.ShaderMaterial({
        uniforms: copaU, transparent: true, depthWrite: false, toneMapped: false,
        vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform sampler2D aA, aB; uniform float t, chuva; uniform vec4 janela, rA, rB; uniform vec2 tela;
          vec4 le(sampler2D s, vec4 r, vec2 uv){ vec2 q = (uv - r.xy) / (r.zw - r.xy); return (q.x < 0. || q.x > 1. || q.y < 0. || q.y > 1.) ? vec4(0.) : texture2D(s, q); }
          void main(){
            vec2 uv = janela.xy + (gl_FragCoord.xy / tela) * (janela.zw - janela.xy);
            vec4 c = mix(le(aA, rA, uv), le(aB, rB, uv), t);                // pré-multiplicado
            if (c.a < 0.01) discard;
            vec3 col = c.rgb / c.a;
            float l = dot(col, vec3(0.2126, 0.7152, 0.0722));              // o mesmo dia nublado do fundo
            float verde = smoothstep(0.08, 0.3, col.g - max(col.r, col.b));
            col = mix(col, mix(col, vec3(l), 0.48 * (1.0 - 0.6 * verde)) * vec3(0.84, 0.9, 0.98) * 0.68, chuva);
            gl_FragColor = vec4(col, c.a);
            #include <colorspace_fragment>
          }`,
      }))
      copa.scale.set(1.25, 1.1, 0.9); copa.position.set(ax, ay, zb + 2.42); copa.renderOrder = 5; cena.add(copa)
    }
  }
  // sombra do carro: plano que só recebe sombra + sombra de contato macia
  const solo = new THREE.Mesh(new THREE.PlaneGeometry(ljT[0], ljT[1]), new THREE.ShadowMaterial({ opacity: 0.32 }))
  solo.position.set(ljC[0], ljC[1], Z + 0.003); solo.receiveShadow = true; cena.add(solo); if (an.ILHA) cena.add(quadroTras)
  const texSombra = texturaSombra(), texAnel = texturaAnel(), texAnelFalha = texturaAnel(true), texHalo = texturaHalo(), texGlow = texturaGlow()

  // luzes: sol e as da cena (uma por nome, com a força de cada período)
  const sol = new THREE.DirectionalLight('#ffffff', 1); sol.castShadow = true
  const ljM = Math.max(7, Math.max(ljT[0], ljT[1]) / 2 + 1)
  sol.shadow.mapSize.set(LJ ? 4096 : 2048, LJ ? 4096 : 2048); Object.assign(sol.shadow.camera, { left: -ljM, right: ljM, top: ljM, bottom: -ljM, near: 1, far: 60 + ljM })
  sol.shadow.bias = -0.0004; sol.shadow.normalBias = 0.02; sol.shadow.radius = 4
  cena.add(sol, sol.target)
  // As luzes da cena vão num conjunto fixo (29/10). O shader de cada material conta as luzes, e cada maquete tinha um
  // número delas (de 16 a 50): toda maquete nova compilava de novo os materiais do carro, ~0,5 a 1 s cada, com a página e
  // a tela de carregamento travadas por ~5 s. Com POOL_SPOT spots e POOL_PONTO pontos em toda maquete o shader é o mesmo,
  // e o navegador reaproveita o que já compilou (a segunda abertura de uma maquete travava ~0,5 s). Cada lugar do
  // conjunto recebe uma luz da maquete: as que mais iluminam os carros e, com sobra, as bombas (escolhaLuzes)
  const POOL_SPOT = 8, POOL_PONTO = 3
  const fontesLuz = {}                                            // nome -> a luz da maquete (posição, direção, tipo)
  for (const p of PERIODOS) for (const L of luzesP[p].luzes) if (L.nome !== 'sol' && !fontesLuz[L.nome]) fontesLuz[L.nome] = { ...L, p: V(L.pos), d: L.dir ? V(L.dir).normalize() : null, i: 0, cor: [1, 1, 1] }
  const novoLugar = (spot) => { const l = spot ? new THREE.SpotLight('#fff', 0, 0, 1, 0.6, 2) : new THREE.PointLight('#fff', 0, 0, 2); cena.add(l); if (l.target) cena.add(l.target); return { l, nome: null } }
  const lugaresSpot = Array.from({ length: POOL_SPOT }, () => novoLugar(true)), lugaresPonto = Array.from({ length: POOL_PONTO }, () => novoLugar(false))
  const forcaLuz = (L) => (L.tipo === 'AREA' ? L.energia / Math.PI : L.energia / (4 * Math.PI))

  // ---------------------------------------------------------- carro (GLB) e materiais
  // (5/11, V3, pedido do Sergio: o carro 3D pesava com muitos carros) Três mudanças, sem mudar o que se vê (comparado no
  // zoom máximo, 2,4×):
  // 1. carro-leve.glb: a mesma malha com 25 mil triângulos em vez de 68 mil (ferramentas/carro-leve.mjs; o carro.glb
  //    fica como está e serve de reserva);
  // 2. as 43 peças do carro viram uma malha por material (juntaPecas, abaixo): ~19 pedidos de desenho por carro em vez
  //    de ~47;
  // 3. a sombra do sol só é redesenhada quando algo muda (no laço, sombraSuja).
  // Medido num celular médio simulado (processador 4× mais lento), 7 carros: 820 → ~290 pedidos de desenho por quadro,
  // ~1 milhão → ~220 mil triângulos, 21 → ~12 ms de processador por quadro
  const gltf = await new GLTFLoader().loadAsync('dados/carro-leve.glb').catch(() => new GLTFLoader().loadAsync('dados/carro.glb')); passo()
  const molde = gltf.scene
  juntaPecas(molde)
  // junta as peças do mesmo material numa malha só, uma vez, no molde (os carros são cópias dele). Ficam soltas as rodas
  // e as calotas (giram) e as peças de pintura com zonas que têm posição própria (o desenho das zonas usa a posição da
  // peça). Só posição e normal vão para a malha junta (o carro não usa textura)
  function juntaPecas(raiz) {
    raiz.updateMatrixWorld(true)
    const grupos = new Map(), I = new THREE.Matrix4()
    raiz.traverse((o) => {
      if (!o.isMesh) return
      const nome = o.parent && o.parent !== raiz && !o.parent.isScene ? o.parent.name : o.name
      if (/_roda-?1_-?\d+$/.test(nome) || /_calota$/.test(nome)) return
      const nm = (o.material && o.material.name) || ''
      if (nm.startsWith('c2_pintura_zonas') && !o.matrixWorld.equals(I)) return
      if (!grupos.has(nm)) grupos.set(nm, []); grupos.get(nm).push(o)
    })
    for (const [nm, lista] of grupos) {
      if (lista.length < 2) continue
      const geos = lista.map((o) => {
        let g = o.geometry.clone().applyMatrix4(o.matrixWorld)
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k)
        return g
      })
      const todosIdx = geos.every((g) => g.index)
      const geo = mergeGeometries(todosIdx ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g)))
      if (!geo) continue                                         // não deu para juntar: as peças ficam como estão
      const m = new THREE.Mesh(geo, lista[0].material); m.name = 'junta_' + nm
      for (const o of lista) o.parent.remove(o)
      raiz.add(m)
    }
  }
  function novoCarro(cor, pai = cena) {
    const g = molde.clone(true); const luzes = { farol: [], lanterna: [] }; const mats = []; const rodas = []; const pintura = []; const malhas = []
    const sombraSol = new THREE.MeshDepthMaterial({ alphaHash: true })   // a sombra do sol some com o carro
    g.traverse((o) => {
      if (o.isMesh) {
        const nm = (o.material && o.material.name) || ''
        const mm = materialDoCarro(nm, cor, luzes)
        if (mm) o.material = mm; else o.material = o.material.clone()
        // sempre transparente: com opacidade 1 o resultado é o do opaco, e o carro surge e some sem trocar de modo
        // (cada troca opaco ↔ transparente compilava uma segunda versão de cada shader, ~0,5 s cada uma com 30 luzes)
        o.material.transparent = true
        if (nm.startsWith('c2_pintura')) pintura.push(o.material)
        o.castShadow = true; o.receiveShadow = true; o.customDepthMaterial = sombraSol; mats.push(o.material)
        o.userData.matOrig = o.material; malhas.push(o)
      }
      if (/_roda-?1_-?\d+$/.test(o.name)) rodas.push({ o, eixo: 'x', q0: o.quaternion.clone() })
      if (/_calota$/.test(o.name)) rodas.push({ o, eixo: 'z', q0: o.quaternion.clone() })
    })
    const raiz = new THREE.Group(); raiz.add(g)
    // para o carro andar para a frente (+y), o giro no mundo é negativo em torno de +x; o sinal de cada peça
    // vem do eixo de giro dela levado ao mundo. A escala espelhada vem antes da rotação e não muda o sentido
    for (const r of rodas) {
      const eixo = r.eixo === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)
      r.sinal = Math.sign(eixo.applyQuaternion(r.o.getWorldQuaternion(new THREE.Quaternion())).x) || 1
    }
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.34), new THREE.MeshBasicMaterial({ map: texHalo, color: '#FF3020', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, opacity: 0, side: THREE.DoubleSide }))
    halo.rotation.x = Math.PI / 2; halo.position.set(0, -2.13, 1.065); raiz.add(halo); luzes.halo = halo
    const sombra = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 4.7), new THREE.MeshBasicMaterial({ map: texSombra, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }))
    sombra.position.z = 0.004; sombra.renderOrder = 1; raiz.add(sombra)
    raiz.visible = false; pai.add(raiz)
    return { raiz, mats, luzes, rodas, sombra, sombraSol, pintura, malhas, cor, tras: pai !== cena, giro: 0, re: 0, spr: null }
  }
  function opacidadeCarro(c, a) {
    for (const mt of c.mats) mt.opacity = a
    if (c.spr) c.spr.uniforms.opac.value = a
    c.sombra.material.opacity = 0.5 * a * a                       // a de contato some antes do carro
    c.sombraSol.opacity = a
  }

  // ---------------------------------------------------------- carros em imagem (qualidade leve, 29/10, ideia do Sergio)
  // A câmera é fixa, então o carro pode vir pronto em imagem (blender/carro_sprites.py: o mesmo ângulo, 4 cores, as duas
  // direções, dia e noite, com e sem cobertura, com a luz do posto assada, inclusive a luz suave de cima à noite). O
  // carro 3D continua como forma (contorno e profundidade: bomba, pilar e árvore passam na frente dele certinho), mas
  // em vez de calcular luz, pintura e reflexo ele "veste" a imagem: cada pixel lê a imagem pela posição na tela, a
  // partir da origem do carro projetada. Um shader simples, que compila uma vez; as imagens só carregam no leve, e só as
  // das cores e direções em uso
  const SPR = { info: null, tex: new Map(), noite: 0, ligado: false }
  const NOMES_COR = { branco: '#E9EBED', prata: '#B9C0C6', grafite: '#4A5157', verde: '#1F8A4C' }
  const corMaisPerto = (hex) => {
    const c = new THREE.Color(hex); let melhor = 'branco', d0 = Infinity
    for (const [n, h] of Object.entries(NOMES_COR)) { const k = new THREE.Color(h), d = (c.r - k.r) ** 2 + (c.g - k.g) ** 2 + (c.b - k.b) ** 2; if (d < d0) { d0 = d; melhor = n } }
    return melhor
  }
  const texSprite = (nome) => {
    if (!SPR.tex.has(nome)) SPR.tex.set(nome, new Promise((ok) => tl.load(`dados/carros-leve/${nome}.webp`, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; ok(t) }, undefined, () => ok(null))))
    return SPR.tex.get(nome)
  }
  const matSprite = () => new THREE.ShaderMaterial({
    uniforms: { tD: { value: null }, tN: { value: null }, noite: { value: 0 }, opac: { value: 1 }, ancora: { value: new THREE.Vector2() }, escala: { value: 1 }, tam: { value: new THREE.Vector2(1, 1) } },
    transparent: true, toneMapped: false,
    vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tD, tN; uniform float noite, opac, escala; uniform vec2 ancora, tam;
      void main(){
        vec2 uv = (gl_FragCoord.xy - ancora) / (escala * tam) + 0.5;     // a origem do carro fica no meio da imagem
        vec4 c = mix(texture2D(tD, uv), texture2D(tN, uv), noite);
        if (c.a < 0.03) discard;
        gl_FragColor = vec4(c.rgb, c.a * opac);
        #include <colorspace_fragment>
      }`,
  })
  // liga ou desliga as imagens nos carros; ao ligar, espera as imagens das cores que estão nos carros agora
  async function usaSprites(on) {
    SPR.ligado = on
    if (on && !SPR.info) SPR.info = await fetch('dados/carros-leve/carros.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)
    if (on && !SPR.info) { SPR.ligado = false; return }                      // sem as imagens, fica o carro 3D
    for (const vg of vagas) await vesteCarro(vg.carro)
  }
  async function vesteCarro(c) {
    if (!SPR.ligado) { for (const o of c.malhas) o.material = o.userData.matOrig; return }
    const luz = an.posto && an.posto.cobertura ? 'cob' : 'sem', base = `${c.tras ? 'tras' : 'frente'}-${corMaisPerto(c.cor)}`
    const [d, n] = await Promise.all([texSprite(`${base}-dia-${luz}`), texSprite(`${base}-noite-${luz}`)])
    if (!d || !n || !SPR.ligado) return
    if (!c.spr) c.spr = matSprite()
    c.spr.uniforms.tD.value = d; c.spr.uniforms.tN.value = n; c.spr.uniforms.tam.value.set(SPR.info.w, SPR.info.h)
    c.spr.uniforms.opac.value = c.mats[0] ? c.mats[0].opacity : 1
    for (const o of c.malhas) o.material = c.spr
  }
  const pSpr = new THREE.Vector3()
  function atualizaSprites() {                                    // a cada quadro: onde a origem de cada carro cai na tela
    if (!SPR.ligado || !SPR.info) return
    const W = renderer.domElement.width, H = renderer.domElement.height, esc = W / (cam.right - cam.left) / SPR.info.pxm
    for (const vg of vagas) {
      const c = vg.carro; if (!c.spr || !c.raiz.visible) continue
      c.raiz.getWorldPosition(pSpr).project(cam)
      c.spr.uniforms.ancora.value.set((pSpr.x * 0.5 + 0.5) * W, (pSpr.y * 0.5 + 0.5) * H)
      c.spr.uniforms.escala.value = esc; c.spr.uniforms.noite.value = SPR.noite
    }
  }

  // ---------------------------------------------------------- carro parado como foto (5/11, aprovado pelo Sergio)
  // O carro parado na vaga (carregando ou terminou), inteiro (sem surgir nem sumir), longe de um alarme aceso e com a luz
  // estável é fotografado pelo próprio navegador, e o quadro passa a desenhar só um retângulo com a foto dele. Tudo o que
  // se mexe continua 3D (chegando, conectando, saindo, a ré, a luz vermelha da falha).
  //   - A foto sai em alta faixa, com 4 amostras por pixel (a borda suave da cena) e 1,5× a resolução do zoom máximo
  //     (até 1024 px), numa área de trabalho única; vira a foto do carro já com o tom da tela (Neutral, a fórmula do
  //     three.js) e em sRGB de 8 bits, com mipmap; e a profundidade de cada ponto vai junto (meio-float).
  //   - Desenhada, a foto escreve a profundidade do carro (gl_FragDepth): pilares, bombas e árvore continuam na frente.
  //     Ela vem depois do anel e da sombra de contato (renderOrder 2), para a borda não apagar a sombra.
  //   - Uma assinatura da luz (sol, exposição, reflexo, luzes do posto) e do carro (cor, faróis, lanternas) diz quando
  //     tirar outra foto: quando muda e depois fica 0,35 s parada.
  //   - Quando a sombra do sol é refeita, os carros em foto entram só nela, numa passada à parte (sombraSoParaFotos).
  // Medido num celular médio simulado (processador 4× mais lento), 7 carros parados: ~16,5 → ~7,3 ms por quadro. O
  // visual: 99,6% igual ao 3D (comparação de imagem), o mesmo brilho à noite. Sem float renderizável (raro), fica o 3D
  const CAMADA_FOTO = 5
  const FOTO = !opcoes.captura && renderer.extensions.has('EXT_color_buffer_float')
  const fotoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100); fotoCam.layers.set(CAMADA_FOTO)
  const camSombra = new THREE.OrthographicCamera(-0.001, 0.001, 0.001, -0.001, 0.1, 0.2); camSombra.position.set(0, 0, -1e4); camSombra.updateMatrixWorld()
  let luzesNaFoto = false, assinAnt = '', tLuz = -1, rascunho = null
  const corFundo = new THREE.Color(), cxF = new THREE.Box3(), pF = new THREE.Vector3()
  const quadCena = (frag, uniforms) => { const c = new THREE.Scene(); c.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: frag }))); return c }
  const camQuad = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const uTom = { tHdr: { value: null }, exposicao: { value: 1 } }, uProf = { tProf: { value: null } }
  const cenaTom = quadCena(`uniform sampler2D tHdr; uniform float exposicao; varying vec2 vUv;
    vec3 neutro(vec3 color) {
      const float StartCompression = 0.8 - 0.04; const float Desaturation = 0.15;
      color *= exposicao;
      float x = min(color.r, min(color.g, color.b)); float offset = x < 0.08 ? x - 6.25 * x * x : 0.04; color -= offset;
      float peak = max(color.r, max(color.g, color.b)); if (peak < StartCompression) return color;
      float d = 1. - StartCompression; float newPeak = 1. - d * d / (peak + d - StartCompression); color *= newPeak / peak;
      float g = 1. - 1. / (Desaturation * (peak - newPeak) + 1.); return mix(color, vec3(newPeak), g);
    }
    void main(){
      vec4 c = texture2D(tHdr, vUv);
      if (c.a < 0.0001) { gl_FragColor = vec4(0.0); return; }
      gl_FragColor = vec4(neutro(c.rgb / c.a) * c.a, c.a);       // pré-multiplicada: o mipmap mistura certo com o fundo
    }`, uTom)
  const cenaProf = quadCena('uniform sampler2D tProf; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tProf, vUv).x, 0.0, 0.0, 1.0); }', uProf)
  const matFoto = () => new THREE.ShaderMaterial({
    uniforms: { tCor: { value: null }, tProf: { value: null }, k0: { value: 0 }, k1: { value: 1 }, kMeio: { value: 0.5 } },
    transparent: true, depthWrite: true, depthTest: true, toneMapped: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tCor, tProf; uniform float k0, k1, kMeio; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tCor, vUv);
        if (c.a < 0.004) discard;
        // a profundidade: o ponto do carro mais perto da câmera em volta (na borda, o fundo da foto não conta)
        ivec2 tam = textureSize(tProf, 0), p = ivec2(vUv * vec2(tam));
        float d = 1.0;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) d = min(d, texelFetch(tProf, clamp(p + ivec2(i, j), ivec2(0), tam - 1), 0).x);
        gl_FragDepth = d < 0.99999 ? k0 + k1 * d : kMeio;
        gl_FragColor = vec4(c.rgb / c.a, c.a);                    // já veio com o tom da tela; falta só a cor de saída
        #include <colorspace_fragment>
      }`,
  })
  function assinaturaLuz() {
    const L = [...lugaresSpot, ...lugaresPonto].map((x) => x.l.intensity.toFixed(2) + ',' + x.l.position.x.toFixed(2) + ',' + x.l.position.y.toFixed(2) + ',' + x.l.color.getHexString()).join(';')
    return [sol.intensity.toFixed(3), sol.position.x.toFixed(2), sol.position.y.toFixed(2), sol.position.z.toFixed(2), renderer.toneMappingExposure.toFixed(3), cena.environmentIntensity.toFixed(3), cena.environment ? cena.environment.uuid : '', L].join('|')
  }
  function fotografa(c, ppu, assin) {
    if (!luzesNaFoto) { cena.traverse((o) => { if (o.isLight) o.layers.enable(CAMADA_FOTO) }); luzesNaFoto = true }
    // a caixa do carro vista pela câmera da maquete (mesma posição e direção): os limites da foto e a profundidade
    cxF.makeEmpty(); for (const m of c.malhas) cxF.expandByObject(m)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (let k = 0; k < 8; k++) {
      pF.set(k & 1 ? cxF.max.x : cxF.min.x, k & 2 ? cxF.max.y : cxF.min.y, k & 4 ? cxF.max.z : cxF.min.z).applyMatrix4(cam.matrixWorldInverse)
      x0 = Math.min(x0, pF.x); x1 = Math.max(x1, pF.x); y0 = Math.min(y0, pF.y); y1 = Math.max(y1, pF.y); z0 = Math.min(z0, pF.z); z1 = Math.max(z1, pF.z)
    }
    const mg = 0.04 * Math.max(x1 - x0, y1 - y0); x0 -= mg; x1 += mg; y0 -= mg; y1 += mg
    let w = Math.ceil((x1 - x0) * ppu * 1.5), h = Math.ceil((y1 - y0) * ppu * 1.5); const esc = Math.min(1, 1024 / Math.max(w, h)); w = Math.max(8, Math.round(w * esc)); h = Math.max(8, Math.round(h * esc))
    const perto = -z1 - 0.5, longe = -z0 + 0.5
    fotoCam.position.copy(cam.position); fotoCam.quaternion.copy(cam.quaternion); fotoCam.scale.copy(cam.scale)
    Object.assign(fotoCam, { left: x0, right: x1, bottom: y0, top: y1, near: perto, far: longe }); fotoCam.updateProjectionMatrix(); fotoCam.updateMatrixWorld(true)
    // a área de trabalho (uma só para todos os carros) e a foto de cada carro (cor com mipmap e profundidade)
    if (!rascunho) rascunho = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(w, h), generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })
    else if (rascunho.width !== w || rascunho.height !== h) rascunho.setSize(w, h)
    let f = c.foto
    if (!f || f.w !== w || f.h !== h) {
      if (f) { f.cor.dispose(); f.prof.dispose() }
      const cor = new THREE.WebGLRenderTarget(w, h, { colorSpace: THREE.SRGBColorSpace, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter })
      const prof = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: false, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter })
      if (!f) { const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), matFoto()); mesh.visible = false; mesh.renderOrder = 2; cena.add(mesh); f = c.foto = { mesh } }
      Object.assign(f, { cor, prof, w, h })
      f.mesh.material.uniforms.tCor.value = cor.texture; f.mesh.material.uniforms.tProf.value = prof.texture
    }
    // fotografa só o carro (camada própria), com as luzes da cena e a sombra do sol já pronta
    const vis = c.malhas.map((m) => m.visible)
    for (const m of c.malhas) { m.visible = true; m.layers.enable(CAMADA_FOTO) }
    const alvo0 = renderer.getRenderTarget(); renderer.getClearColor(corFundo); const a0 = renderer.getClearAlpha()
    renderer.setRenderTarget(rascunho); renderer.setClearColor(0x000000, 0); renderer.clear(true, true, false)
    renderer.render(cena, fotoCam)
    uTom.tHdr.value = rascunho.texture; uTom.exposicao.value = renderer.toneMappingExposure
    renderer.setRenderTarget(f.cor); renderer.clear(true, false, false); renderer.render(cenaTom, camQuad)
    uProf.tProf.value = rascunho.depthTexture
    renderer.setRenderTarget(f.prof); renderer.render(cenaProf, camQuad)
    renderer.setRenderTarget(alvo0); renderer.setClearColor(corFundo, a0)
    c.malhas.forEach((m, k) => { m.layers.disable(CAMADA_FOTO); m.visible = vis[k] })
    // o retângulo da foto: no lugar da caixa, virado para a câmera; a profundidade da foto vira a da maquete
    const u = f.mesh.material.uniforms, faixa = cam.far - cam.near
    u.k1.value = (longe - perto) / faixa; u.k0.value = (perto - cam.near) / faixa; u.kMeio.value = ((perto + longe) / 2 - cam.near) / faixa
    f.mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, -(perto + longe) / 2).applyMatrix4(cam.matrixWorld)
    f.mesh.quaternion.copy(cam.quaternion); f.mesh.scale.set(x1 - x0, y1 - y0, 1); f.mesh.updateMatrixWorld()
    f.ppu = ppu; f.assin = assin
  }
  // a cada quadro desenhado: quem pode virar foto, e a foto de quem precisa ser tirada de novo
  function atualizaFotos() {
    if (!FOTO) return
    const assin = assinaturaLuz()
    if (assin !== assinAnt) { assinAnt = assin; tLuz = tempo }
    const luzParada = tempo - tLuz > 0.35, alarme = luzAlarme.intensity > 0.01
    // pixels por metro no zoom máximo e na resolução mais alta do aparelho (PR0): não muda quando a resolução desce ou
    // sobe sozinha (senão, um quadro lento baixava a resolução, todas as fotos eram tiradas de novo e ele ficava mais lento)
    const ppu = ((cnv.w * PR0) / (cam.right - cam.left)) * (ZOOM_MAX / Math.max(0.5, zoom.k))
    for (const vg of vagas) {
      const c = vg.carro
      const parado = (vg.estado === 'carregando' || vg.estado === 'concluido') && c.raiz.visible && (c.mats[0] ? c.mats[0].opacity : 1) > 0.999
      // a luz vermelha do alarme pisca: o carro ao alcance dela (4 m) fica 3D enquanto ela estiver acesa
      const perto = alarme && c.raiz.getWorldPosition(pF).distanceTo(luzAlarme.position) < 4.6
      const usa = parado && !perto && luzParada && !SPR.ligado
      if (usa) {
        const a = assin + '#' + c.cor + c.luzes.farol.map((m) => m.emissiveIntensity.toFixed(2)).join() + c.luzes.lanterna.map((m) => m.emissiveIntensity.toFixed(2)).join()
        const f = c.foto
        if (!f || f.assin !== a || f.ppu < ppu * 0.9 || f.ppu > ppu * 1.12) fotografa(c, ppu, a)
      }
      if (c.fotoOn !== usa) { c.fotoOn = usa; for (const m of c.malhas) m.visible = !usa; if (c.foto) c.foto.mesh.visible = usa }
    }
  }
  // a sombra do sol vai ser refeita neste quadro: os carros em foto voltam por um instante, só para ela, numa passada
  // com uma câmera que não enxerga nada (não desenha na tela; o quadro é limpo logo depois)
  function sombraSoParaFotos() {
    const on = vagas.filter((vg) => vg.carro.fotoOn).map((vg) => vg.carro)
    if (!on.length) return
    for (const c of on) { for (const m of c.malhas) m.visible = true; c.foto.mesh.visible = false }
    renderer.render(cena, camSombra)
    for (const c of on) { for (const m of c.malhas) m.visible = false; c.foto.mesh.visible = true }
  }
  renderer.domElement.addEventListener('webglcontextrestored', () => { for (const vg of vagas) if (vg.carro.foto) vg.carro.foto.assin = '' })

  // ---------------------------------------------------------- peças da bomba em repouso (pistola guardada e cabos)
  const pecas = await new GLTFLoader().loadAsync(base + 'bomba_pecas.glb').catch(() => null); passo()
  const porNome = {}
  if (pecas) {
    pecas.scene.traverse((o) => { if (o.isMesh) o.castShadow = true; if (o.name) porNome[o.name] = o })
    cena.add(pecas.scene)
  }
  const pecasDe = (nomes) => nomes.map((n) => porNome[n] || porNome[n.replace(/[\[\]\.:\/ ]/g, '_')]).filter(Boolean)

  // ---------------------------------------------------------- pistola plugada e cabo ao vivo
  const matPlast = new THREE.MeshStandardMaterial({ color: '#15191A', roughness: 0.42 })
  const matVerde = new THREE.MeshStandardMaterial({ color: '#00A83C', roughness: 0.38 })
  function novaPistola(porta, n, escala = 1, pai = cena) {
    const u = new THREE.Vector3(n.x, n.y, 0).normalize(), w = new THREE.Vector3(0, 0, 1), v = new THREE.Vector3().crossVectors(u, w).normalize()
    const base = new THREE.Matrix4().makeBasis(v, u, w)
    const g = new THREE.Group()
    const peca = (geo, mat, centro, inclina = 0) => {
      const mm = new THREE.Mesh(geo, mat); mm.castShadow = true
      const q = new THREE.Quaternion().setFromRotationMatrix(base).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), inclina))
      mm.quaternion.copy(q); mm.position.copy(centro); g.add(mm); return mm
    }
    const s = escala
    const bico = peca(new THREE.CylinderGeometry(0.03 * s, 0.03 * s, 0.09 * s, 20), matPlast, porta.clone().addScaledVector(u, 0.035 * s))
    bico.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), u))
    peca(new THREE.BoxGeometry(0.075 * s, 0.15 * s, 0.09 * s), matPlast, porta.clone().addScaledVector(u, 0.145 * s).addScaledVector(w, 0.012 * s))
    peca(new THREE.BoxGeometry(0.078 * s, 0.02 * s, 0.092 * s), matVerde, porta.clone().addScaledVector(u, 0.10 * s).addScaledVector(w, 0.012 * s))
    peca(new THREE.BoxGeometry(0.06 * s, 0.065 * s, 0.19 * s), matPlast, porta.clone().addScaledVector(u, 0.215 * s).addScaledVector(w, -0.075 * s), -24 * Math.PI / 180)
    const fim = porta.clone().addScaledVector(u, 0.255 * s).addScaledVector(w, -0.165 * s)
    g.visible = false; pai.add(g)
    return { g, fim, u }
  }
  function matCabo() {
    const mt = new THREE.MeshStandardMaterial({ color: '#0B0C0C', roughness: 0.44 })
    mt.userData.u = { uTempo: { value: 0 }, uPulso: { value: 0 }, uCor: { value: new THREE.Color('#3DFF6A') } }
    mt.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, mt.userData.u)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vAo;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAo = uv.x;')
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAo; uniform float uTempo, uPulso; uniform vec3 uCor;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float f = fract(vAo * 5.0 - uTempo * 0.9); float pulso = smoothstep(0.0, 0.04, f) * (1.0 - smoothstep(0.04, 0.16, f));
          totalEmissiveRadiance += uCor * (pulso * 1.6 + 0.08) * uPulso;`)
    }
    mt.customProgramCacheKey = () => 'cabo'
    return mt
  }
  function novoCabo(inicio, pist, r = 0.022, pai = cena, borda = null) {
    // do jeito da maquete v11: sai da bomba, desce a faixa, corre no chão e sobe até a empunhadura. borda (vagas
    // paralelas): { y, s } a beira do meio-fio do lado da vaga e o sentido dela (−1: a vaga fica em −Y, como na fileira;
    // +1: atrás da ilha, e o cabo desce pelo outro lado)
    const { fim, u } = pist; const xs = inicio.x, yE = borda ? borda.y : FX_Y0, sg = borda ? borda.s : -1
    const chave = [inicio, new THREE.Vector3(xs, inicio.y + sg * 0.08, Z + FX_H + 0.25), new THREE.Vector3(xs, (yE + inicio.y) / 2 + sg * 0.05, Z + FX_H),
      new THREE.Vector3(xs, yE - sg * 0.06, Z + FX_H), new THREE.Vector3(xs, yE + sg * 0.12, Z),
      new THREE.Vector3((fim.x + u.x * 0.16 + xs) / 2, (fim.y + yE) / 2, Z), new THREE.Vector3(fim.x + u.x * 0.16, fim.y - sg * 0.15, Z),
      new THREE.Vector3(fim.x + u.x * 0.12, fim.y - sg * 0.02, Z + 0.15), fim.clone().addScaledVector(u, 0.05).add(new THREE.Vector3(0, 0, -0.25)), fim]
    const pts = catmull(chave, 14)
    for (const p of pts) p.z = Math.max(p.z, chao(p.x, p.y) + r + 0.002)
    const segs = pts.length * 2
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, r, 10, false)
    const mesh = new THREE.Mesh(geo, matCabo()); mesh.castShadow = true; mesh.visible = false; pai.add(mesh)
    return { mesh, segs, radial: 10 }
  }
  const crescer = (cabo, f) => { cabo.mesh.visible = f > 0.001; cabo.mesh.geometry.setDrawRange(0, Math.round(cabo.segs * clamp01(f)) * cabo.radial * 6) }

  // ---------------------------------------------------------- vagas: carro, pistola, cabo, anel, selo
  const porta0 = V(infoCarro.porta), n0 = V(infoCarro.porta_n)
  // cores dos carros (Sergio, 19/10): branco, prata, grafite e verde; cada carro que chega pega a próxima
  const CORES_CARROS = opcoes.coresCarros || ['#E9EBED', '#B9C0C6', '#4A5157', '#1F8A4C']
  let proximaCor = 0
  const POT = { fast: { dc: 38, ac: 7 }, ultra: { dc: 76, ac: 7 }, mobi: { dc: 7, ac: 7 } }
  const conectores = []
  if (an.conectores) {
    // v14: a lista vem pronta (com 1 vaga, o outro conector da bomba também alcança a vaga); saída "de frente", como as vagas
    for (const c of an.conectores) {
      const b = an.bombas[c.bomba], bx = c.fileira === 'fundos' ? 2 * an.CX - b.x : b.x
      conectores.push({ id: conectores.length, chave: c.bomba + ':' + c.ponto + ':' + conectores.length, bomba: c.bomba, dc: c.ponto === 'dc', saida: V(c.saida), pecas: pecasDe(c.pecas || []),
        lado: c.saida[0] < bx - 0.05 ? 'esquerda' : c.saida[0] > bx + 0.05 ? 'direita' : 'centro', vagasNaturais: [...c.vagas], uso: null })
    }
  } else an.vagas.forEach((v, i) => {
    const chave = v.bomba + ':' + v.saida.map((n) => n.toFixed(3)).join(',')
    const ja = conectores.find((c) => c.chave === chave); if (ja) { ja.vagasNaturais.push(i); return }
    const b = an.bombas[v.bomba]
    conectores.push({ id: conectores.length, chave, bomba: v.bomba, dc: v.ponto === 'dc', saida: V(v.saida), pecas: pecasDe(v.pecas || []),
      lado: v.saida[0] < b.x - 0.05 ? 'esquerda' : v.saida[0] > b.x + 0.05 ? 'direita' : 'centro', vagasNaturais: [i], uso: null })
  })
  const vagas = an.vagas.map((vg, i) => {
    const fileira = vg.fileira || 'frente', pai = fileira === 'fundos' ? quadroTras : cena
    const dc = vg.ponto === 'dc'
    const lado = vg.lado                                         // tomada do lado do carro virado para a bomba
    const lat = vg.lateral || null                               // (9/11) vagas paralelas: o carro virado para +X
    // (o carro do modelo olha para +Y; virado para +X, o local (x, y) vai para (y, −x))
    const gira = (v) => (lat ? new THREE.Vector3(v.y, -v.x, v.z) : v)
    const pLocal = gira(new THREE.Vector3(lado > 0 ? porta0.x : -porta0.x, porta0.y, porta0.z))
    const nLocal = gira(new THREE.Vector3(lado > 0 ? n0.x : -n0.x, n0.y, 0))
    const pos = new THREE.Vector3(vg.x, vg.ycarro, Z)
    const porta = pos.clone().add(pLocal)
    const carro = novoCarro(CORES_CARROS[i % CORES_CARROS.length], pai)
    // um par pistola + cabo para cada conector da bomba desta vaga (o motorista usa o conector que quiser). Nas vagas
    // de trás da ilha o cabo sai por trás da bomba (a saída espelhada no eixo dela)
    const pares = {}
    for (const c of conectores.filter((c) => c.bomba === vg.bomba)) {
      const pist = novaPistola(porta, nLocal, c.dc ? 1 : 0.85, pai)
      const ini = lat && lat.s > 0 ? new THREE.Vector3(c.saida.x, 2 * lat.eixo - c.saida.y, c.saida.z) : c.saida
      pares[c.id] = { pist, cabo: novoCabo(ini, pist, c.dc ? 0.022 : 0.016, pai, lat ? { y: lat.yBorda, s: lat.s } : null) }
    }
    const natural = conectores.find((c) => c.vagasNaturais.includes(i)).id
    const { pist, cabo } = pares[natural]
    const anel = new THREE.Mesh(lat ? new THREE.PlaneGeometry(lat.baia.h - 0.12, lat.baia.w - 0.12) : new THREE.PlaneGeometry(an.BAY_W - 0.12, an.BAY_D - 0.12),
      new THREE.MeshBasicMaterial({ map: texAnel, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 }))
    if (lat) { anel.position.set(lat.baia.cx, lat.baia.cy, Z + 0.012); anel.rotation.z = Math.PI / 2 }
    else anel.position.set(vg.x, (an.Y_BOCA + an.Y_CAB) / 2, Z + 0.012)
    anel.renderOrder = 0; pai.add(anel)
    const modelo = an.bombas[vg.bomba].modelo
    return { i, dc, nome: vg.nome, bomba: vg.bomba, fileira, pares, natural, con: null, ficar: false, pos, carro, pist, cabo, anel, estado: 'vazia', t: 0,
      pct: 18 + 30 * (i % 2), kw: POT[modelo][dc ? 'dc' : 'ac'], sel: null, lat, dEntra: 0, dSai: null }
  })

  // ---------------------------------------------------------- alarme da bomba: brilho vermelho no chão, em volta da base
  const NOME_BOMBA = { fast: 'Mobi Fast', ultra: 'Mobi Ultra Fast', mobi: 'Mobi' }
  // uma luz vermelha só, que vai para a bomba com o alarme mais forte (uma por bomba mudava o shader de posto a posto)
  const luzAlarme = new THREE.PointLight('#FF3B2E', 0, 4, 2); cena.add(luzAlarme)
  const bombas = an.bombas.map((b, bi) => {
    const alarme = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.7), new THREE.MeshBasicMaterial({ map: texGlow, color: '#FF3B2E', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }))
    const s = b.fileira === 'fundos' ? -1 : 1                    // a bomba de trás olha para os fundos
    alarme.position.set(b.base[0], b.base[1] - 0.25 * s, b.base[2] + 0.006); cena.add(alarme)
    const luzPos = new THREE.Vector3(b.base[0], b.base[1] - 0.7 * s, b.base[2] + 1.2)
    return { bi, modelo: b.modelo, nome: NOME_BOMBA[b.modelo] + (an.bombas.length > 1 ? ' ' + (bi + 1) : ''), topo: V(b.topo), x: b.x, y: b.y, s, alarme, luzPos, falha: false, sel: null }
  })
  // (4/11, pedido do Sergio) o desenho na tela da bomba: falha, um alerta vermelho; desligada, o liga/desliga cinza. Um
  // plano do tamanho da tela, no lugar dela (estado-bomba.js, telaVista), um pouco à frente da moldura
  const texTela = {}
  const telaTex = (tipo, w, h) => {
    const k = `${tipo}:${w.toFixed(2)}:${h.toFixed(2)}`
    if (!texTela[k]) { const t = new THREE.CanvasTexture(desenhoTela(tipo, w, h)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texTela[k] = t }
    return texTela[k]
  }
  for (const b of bombas) {
    const tv = telaVista(an, b.bi); if (!tv) continue
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(tv.w, tv.h), new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false, opacity: 0 }))
    mesh.rotation.x = Math.PI / 2; mesh.position.set(tv.x, tv.y, tv.z); mesh.visible = false; cena.add(mesh)
    b.tela = { mesh, tv, tipo: null }
  }

  // ---------------------------------------------------------- totem com o preço ao vivo
  const logo = await new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = 'dados/logo-word.png' }); passo()
  let logoBranco = null
  if (logo) { const c = document.createElement('canvas'); c.width = logo.width; c.height = logo.height; const g = c.getContext('2d'); g.drawImage(logo, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); logoBranco = c }
  const telaTotem = document.createElement('canvas'); telaTotem.width = 800; telaTotem.height = 2400
  let preco = opcoes.preco || '2,20'
  const linhasTotem = opcoes.linhasTotem || an.totem.linhas || LINHAS_TOTEM.fast
  // a fonte do totem só é baixada quando alguém pede (o canvas não pede sozinho)
  if (document.fonts) await Promise.all(['800 168px', '700 38px', '600 42px', '700 22px'].map((f) => document.fonts.load(`${f} "Barlow Condensed"`).catch(() => null)))
  desenhaTotem(telaTotem, preco, logoBranco, linhasTotem)
  const texTotem = new THREE.CanvasTexture(telaTotem); texTotem.colorSpace = THREE.SRGBColorSpace; texTotem.anisotropy = 8
  const cs = an.totem.cantos.map(V)
  {
    const zs = [...cs].sort((a, b) => b.z - a.z), topo = zs.slice(0, 2).sort((a, b) => a.x - b.x), baixo = zs.slice(2).sort((a, b) => a.x - b.x)
    const geo = new THREE.BufferGeometry()
    const q = [baixo[0], baixo[1], topo[1], topo[0]].map((p) => p.clone().add(new THREE.Vector3(0, -0.002, 0)))
    geo.setAttribute('position', new THREE.Float32BufferAttribute(q.flatMap((p) => [p.x, p.y, p.z]), 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
    geo.setIndex([0, 1, 2, 0, 2, 3])
    var faceTotem = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texTotem, toneMapped: false, side: THREE.DoubleSide }))
    cena.add(faceTotem)
  }

  // ---------------------------------------------------------- selos em HTML presos a pontos 3D
  const camadaSelos = document.createElement('div'); camadaSelos.className = 'mv-selos'; el.appendChild(camadaSelos)
  function selo(cls) { const d = document.createElement('div'); d.className = 'mv-selo ' + (cls || ''); camadaSelos.appendChild(d); return d }
  for (const b of bombas) {
    b.sel = selo('mv-selo-bomba')
    b.sel.addEventListener('click', () => el.dispatchEvent(new CustomEvent('mv-bomba', { detail: { bomba: b.bi } })))
  }
  const ICONE_BOMBA = '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2.5" y="1.5" width="6.5" height="11" rx="1.2" fill="currentColor"/><path d="M9 4.5h1.6a1 1 0 0 1 1 1v4.2a.9.9 0 0 0 1.8 0V4.3L12 3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>'
  for (const vg of vagas) {
    vg.sel = selo('mv-selo-carro')
    // com motorista informado, o selo é um card: clicar avisa o painel (evento "mv-selo" no elemento da maquete)
    vg.sel.addEventListener('click', () => { if (vg.pessoa) el.dispatchEvent(new CustomEvent('mv-selo', { detail: { vaga: vg.i } })) })
  }
  for (const vg of vagas) {
    vg.info = selo('mv-selo-info'); vg.infoAte = -1
    vg.info.addEventListener('click', () => { vg.infoAte = -1 })
  }
  const ouvintes = []
  const avisa = (vg) => { for (const f of ouvintes) f({ vaga: vg.i, nome: vg.nome, estado: vg.estado }) }

  // ---------------------------------------------------------- hora do dia: camadas e luz
  let hora = opcoes.hora ?? 14
  function aplicaHora() {
    const { a, b, t } = periodoDaHora(hora)
    for (const [q, arr] of [[quadFundo, fundos], [quadTeto, tetos]]) { q.material.uniforms.tA.value = de(arr, a); q.material.uniforms.tB.value = de(arr, b); q.material.uniforms.t.value = t }
    if (copaU.horarios) copaU.horarios(a, b)                      // a árvore da ilha, na frente do carro dos fundos
    sombraSuja = true                                             // o sol mudou: a sombra do carro é refeita (no leve)
    const A = luzesP[a], B = luzesP[b]
    const exp = lerp(A.exposicao, B.exposicao, t)
    renderer.toneMappingExposure = Math.pow(2, exp)
    cena.environment = envs[t < 0.5 ? a : b] || null
    cena.environmentIntensity = Math.pow(2, -exp)               // a panorâmica já veio com a exposição do período
    const solA = A.luzes.find((L) => L.nome === 'sol'), solB = B.luzes.find((L) => L.nome === 'sol')
    const dir = V(solA.dir).lerp(V(solB.dir), t).normalize()
    sol.position.set(ljC[0], ljC[1], 0).addScaledVector(dir, -25 - ljM); sol.target.position.set(ljC[0], ljC[1], 0)
    sol.color.setRGB(...solA.cor).lerp(new THREE.Color().setRGB(...solB.cor), t)
    sol.userData.forca = lerp(solA.energia, solB.energia, t)
    solo.material.opacity = lerp(A.look === 'noite' ? 0.0 : 0.32, B.look === 'noite' ? 0.0 : 0.32, t) + (a === 'por' || b === 'por' ? 0.06 : 0)
    for (const [nome, F] of Object.entries(fontesLuz)) {
      const la = A.luzes.find((L) => L.nome === nome), lb = B.luzes.find((L) => L.nome === nome)
      F.i = lerp(la ? forcaLuz(la) : 0, lb ? forcaLuz(lb) : 0, t)
      if (!la && !lb) continue                                  // luz que não existe nos dois períodos fica apagada
      const ca = la ? la.cor : lb.cor, cb = lb ? lb.cor : la.cor
      F.cor = [lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t)]
    }
    escolheLuzes()
    const noiteP = lerp(A.look === 'noite' ? 1 : 0, B.look === 'noite' ? 1 : 0, t), noite = Math.max(noiteP, 0.55 * chuva.k)   // na chuva os faróis acendem
    SPR.noite = noiteP                                            // os carros em imagem (leve) cruzam dia e noite junto
    quadFundo.material.uniforms.uNoite.value = noiteP              // (4/11) o brilho da bomba em falha: mais forte à noite
    for (const vg of vagas) {
      vg.carro.luzes.farol.forEach((m2) => (m2.emissiveIntensity = lerp(6, 16, noite)))
      vg.carro.luzes.base = { lanterna: lerp(3, 14, noite), halo: 0.55 * noite, noite }
    }
    // nublado: o sol vira luz difusa, a sombra quase some e a panorâmica perde força (nuvem sozinha fecha menos que chuva)
    const cinza = Math.max(chuva.k, 0.6 * nuvem.k)
    sol.userData.forca *= 1 - 0.85 * cinza
    solo.material.opacity *= 1 - 0.7 * cinza
    cena.environmentIntensity *= 1 - 0.35 * cinza
    for (const q of [quadFundo, quadTeto]) q.material.uniforms.chuva.value = cinza
    const uc = quadChuva.material.uniforms
    uc.tA.value = de(fundos, a); uc.tB.value = de(fundos, b); uc.tMix.value = t; uc.noite.value = noiteP
    faceTotem.material.color.setScalar(lerp(0.92, 1.0, noite))
  }
  // as luzes da maquete que ocupam o conjunto fixo: cada carro estacionado (e cada bomba, com peso menor, pelas pistolas)
  // pega, por rodadas, a luz acesa que mais o ilumina e ainda não foi escolhida; os lugares que sobram ficam com as mais
  // fortes. A luz que continua escolhida fica no mesmo lugar, sem piscar. Roda quando a hora muda e quando um carro
  // aparece ou some
  const dirLuz = new THREE.Vector3(), PARA_BAIXO = new THREE.Vector3(0, 0, -1)
  let ocupLuz = ''
  function escolheLuzes() {
    const alvos = []
    for (const vg of vagas) if (vg.carro.raiz.visible) { const p = paraMundo(vg.fileira, vg.pos.clone()); p.z = Z + 0.8; alvos.push({ p, w: 1 }) }
    for (const b of bombas) alvos.push({ p: b.topo, w: 0.3 })
    const contrib = (F, a) => {
      dirLuz.subVectors(a.p, F.p); const d2 = dirLuz.lengthSq(); dirLuz.normalize()
      let k = (F.i * a.w) / (1 + d2)
      if (F.d && dirLuz.dot(F.d) < Math.cos(F.tipo === 'SPOT' ? Math.min(1.5, F.spot / 2) : 1.35)) k *= 0.1      // fora do cone
      return k
    }
    for (const [lugares, ehSpot] of [[lugaresSpot, true], [lugaresPonto, false]]) {
      const cands = Object.entries(fontesLuz).filter(([, F]) => (F.tipo !== 'POINT') === ehSpot && F.i > 0)
      const listas = alvos.map((a) => cands.map(([n, F]) => [n, contrib(F, a)]).filter(([, c]) => c > 1e-4).sort((x, y) => y[1] - x[1]))
      const escolhidas = new Set()
      for (let pegou = true; pegou && escolhidas.size < lugares.length;) {
        pegou = false
        for (const li of listas) {
          if (escolhidas.size >= lugares.length) break
          const c = li.find(([n]) => !escolhidas.has(n)); if (c) { escolhidas.add(c[0]); pegou = true }
        }
      }
      for (const [n] of [...cands].sort((x, y) => y[1].i - x[1].i)) { if (escolhidas.size >= lugares.length) break; escolhidas.add(n) }
      const ja = new Set(lugares.map((u) => u.nome)), novas = [...escolhidas].filter((n) => !ja.has(n))
      for (const u of lugares) if (!escolhidas.has(u.nome)) { u.nome = novas.shift() || null; if (u.nome) posicionaLuz(u) }
      for (const u of lugares) { const F = u.nome && fontesLuz[u.nome]; u.l.intensity = F ? F.i : 0; if (F) u.l.color.setRGB(...F.cor) }
    }
  }
  function posicionaLuz(u) {
    const F = fontesLuz[u.nome], l = u.l
    l.position.copy(F.p)
    if (l.isSpotLight) {
      l.angle = F.tipo === 'SPOT' ? Math.min(1.5, F.spot / 2) : 1.35; l.penumbra = F.tipo === 'SPOT' ? 0.6 : 1.0   // área -> spot largo
      l.target.position.copy(F.p).add(F.d || PARA_BAIXO)
    }
  }

  // ---------------------------------------------------------- estados das vagas
  const D_CHEGADA = 2.9, D_SAIDA = 3.6, T_CHEGA = 3.2, T_CONECTA = 1.5, T_DESCONECTA = 1.0, T_SAI = 4.2
  function muda(vg, estado) { vg.estado = estado; vg.t = 0; sombraSuja = true; avisa(vg) }
  let sombraSuja = true                                           // leve: a sombra do sol só é refeita quando algo muda
  // (9/11) vagas paralelas: a faixa (as vagas do mesmo lado da mesma ilha) está livre atrás desta vaga (antes = true)
  // ou à frente dela, até a ponta da ilha
  const faixaLivre = (vg, antes) => vagas.every((o) => o === vg || !o.lat || o.lat.faixa !== vg.lat.faixa || (antes ? o.lat.ordem > vg.lat.ordem : o.lat.ordem < vg.lat.ordem) || o.estado === 'vazia')
  function livreNaBomba(vg) { return conectores.find((c) => c.bomba === vg.bomba && c.uso == null && c.vagasNaturais.includes(vg.i)) || conectores.find((c) => c.bomba === vg.bomba && c.uso == null) }
  function evento(vagaIdx, acao, opc = {}) {
    const vg = vagas[vagaIdx]; if (!vg) return false
    if (acao === 'chegar' && vg.estado === 'vazia') {
      const c = opc.conector != null ? conectores[opc.conector] : livreNaBomba(vg)
      if (!c || c.uso != null || c.bomba !== vg.bomba) return false
      c.uso = vg.i; vg.con = c.id; vg.dc = c.dc; vg.pist = vg.pares[c.id].pist; vg.cabo = vg.pares[c.id].cabo; vg.ficar = !!opc.ficar
      vg.kw = POT[an.bombas[vg.bomba].modelo][c.dc ? 'dc' : 'ac']
      for (const p of Object.values(vg.pares)) { p.cabo.mesh.visible = false; p.pist.g.visible = false }
      const cor = opc.cor || CORES_CARROS[proximaCor % CORES_CARROS.length]; proximaCor++   // o painel pode mandar a cor do carro do motorista
      for (const m of vg.carro.pintura) m.color.set(cor)
      // leve: a imagem da cor nova; o carro só começa a surgir com ela carregada
      vg.carro.cor = cor
      if (SPR.ligado) { vg.carro.esperando = true; vesteCarro(vg.carro).then(() => { vg.carro.esperando = false }) }
      vg.pct = 12 + ((vg.i * 37 + proximaCor * 23) % 40)
      if (vg.lat) vg.dEntra = faixaLivre(vg, true) ? 6.5 : 0.9
      muda(vg, 'chegando'); vg.carro.raiz.visible = true
    }
    if (acao === 'sair' && ['carregando', 'falha'].includes(vg.estado)) { if (opc.ficar != null) vg.ficar = !!opc.ficar; muda(vg, 'desconectando') }
    else if (acao === 'sair' && vg.estado === 'concluido') muda(vg, 'saindo')
    return true
  }
  // o estado de cada bomba na imagem (máscara da V3): 1 falha, 2 desligada
  const estadosImg = () => {
    const e = quadFundo.material.uniforms.estados.value; for (const b of bombas) if (b.bi < 16) e[b.bi] = b.falha ? 1 : b.inativa ? 2 : 0
    // (4/11) o brilho em volta e o desenho na tela
    atualizaHalo(new Set(bombas.filter((b) => b.falha).map((b) => b.bi + 1)), new Set(bombas.filter((b) => b.inativa && !b.falha).map((b) => b.bi + 1)))
    for (const b of bombas) if (b.tela) {
      const tipo = b.falha ? 'falha' : b.inativa ? 'desligada' : null
      if (tipo && tipo !== b.tela.tipo) { b.tela.mesh.material.map = telaTex(tipo, b.tela.tv.w, b.tela.tv.h); b.tela.mesh.material.needsUpdate = true }
      b.tela.tipo = tipo; if (tipo) b.tela.mesh.visible = true
    }
  }
  function setFalha(on, bi) {
    for (const b of bombas) if (bi === undefined || b.bi === bi) b.falha = on
    for (const vg of vagas) {
      const f = bombas[vg.bomba].falha
      if (f && vg.estado === 'carregando') muda(vg, 'falha'); else if (!f && vg.estado === 'falha') muda(vg, 'carregando')
    }
    estadosImg()
  }
  // (3/11, noite) a bomba desligada: a tela e as luzes dela apagam na imagem
  function setInativa(on, bi) { for (const b of bombas) if (bi === undefined || b.bi === bi) b.inativa = on; estadosImg() }
  function pecasRepouso(vg, visivel) { const c = conectores[vg.con]; if (c) for (const o of c.pecas) o.visible = visivel }
  function liberaConector(vg) { const c = conectores[vg.con]; if (c && c.uso === vg.i) c.uso = null }

  function atualizaVaga(vg, dt, tempo) {
    vg.t += dt
    const c = vg.carro, sobTeto = (y) => 1 - 0.35 * suave(clamp01((y - (an.Y_BOCA - 0.8)) / 2.6))
    let y = vg.pos.y, x = vg.pos.x, a = 1, giro = 0
    // (9/11) vagas paralelas: o carro entra andando para a frente (+X) e sai para a frente. Com a faixa livre atrás (ou
    // à frente, na saída), o trajeto inteiro; senão só um deslize curto no lugar, surgindo ou sumindo, para nunca passar
    // por cima de outro carro
    if (vg.lat && !vis.leve && (vg.estado === 'chegando' || vg.estado === 'saindo')) {
      if (vg.estado === 'chegando') {
        if (c.esperando) vg.t = 0
        const D = vg.dEntra || 0.9, longe = D > 2, T = longe ? 3.6 : 1.6, k = clamp01(vg.t / T), e = easeOut(k)
        x = vg.pos.x - D * (1 - e); a = suave(clamp01(k / (longe ? 0.2 : 0.7))); giro = D * (e - easeOut(clamp01((vg.t - dt) / T)))
        if (k >= 1) { muda(vg, 'conectando'); pecasRepouso(vg, false) }
      } else {
        if (vg.dSai == null) vg.dSai = faixaLivre(vg, false) ? 7 : 0.9
        const D = vg.dSai, longe = D > 2, T = longe ? 4.2 : 1.6, k = clamp01(vg.t / T), e = easeInOut(k)
        x = vg.pos.x + D * e; a = 1 - suave(clamp01((k - (longe ? 0.8 : 0.3)) / (longe ? 0.2 : 0.7))); giro = D * (e - easeInOut(clamp01((vg.t - dt) / T)))
        if (k >= 1) { muda(vg, 'vazia'); c.raiz.visible = false; liberaConector(vg); vg.con = null; vg.dSai = null }
      }
    } else if (vg.estado === 'chegando' && vis.leve) {
      if (c.esperando) vg.t = 0                                    // a imagem da cor ainda está chegando
      const k = clamp01(vg.t / 1.0); a = suave(k)
      if (k >= 1) { muda(vg, 'conectando'); pecasRepouso(vg, false) }
    } else if (vg.estado === 'chegando') {
      const k = clamp01(vg.t / T_CHEGA), e = easeOut(k)
      y = vg.pos.y - D_CHEGADA * (1 - e); a = suave(clamp01(k / 0.2)); giro = D_CHEGADA * (e - easeOut(clamp01((vg.t - dt) / T_CHEGA)))
      if (k >= 1) { muda(vg, 'conectando'); pecasRepouso(vg, false) }
    } else if (vg.estado === 'saindo' && vis.leve) {
      const k = clamp01(vg.t / 0.9); a = 1 - suave(k)
      if (k >= 1) { muda(vg, 'vazia'); c.raiz.visible = false; liberaConector(vg); vg.con = null }
    } else if (vg.estado === 'saindo') {
      const k = clamp01(vg.t / T_SAI), e = easeInOut(k)
      y = vg.pos.y - D_SAIDA * e; a = 1 - suave(clamp01((k - 0.8) / 0.2)); giro = -D_SAIDA * (e - easeInOut(clamp01((vg.t - dt) / T_SAI)))
      if (k >= 1) { muda(vg, 'vazia'); c.raiz.visible = false; liberaConector(vg); vg.con = null }
    }
    if (vg.estado === 'vazia') { c.raiz.visible = false }
    // carro: posição, inclinação na rampa, rodas girando, transparência ao surgir/sumir
    if (vg.lat) {
      // vagas paralelas: pátio plano, o carro virado para +X
      c.raiz.position.set(x, y, Z); c.raiz.rotation.set(0, 0, -Math.PI / 2); c.sombra.position.z = 0.004
      if (vg.estado === 'vazia') vg.dSai = null
    } else {
      const yf = y + infoCarro.rodas.yf, yr = y + infoCarro.rodas.yr
      const zf = chaoPatio(yf), zr = chaoPatio(yr)
      c.raiz.position.set(vg.pos.x, y, (zf + zr) / 2)
      c.raiz.rotation.set(Math.atan2(zf - zr, yf - yr), 0, 0)
      c.sombra.position.z = Z - (zf + zr) / 2 + 0.004
    }
    c.giro += giro / infoCarro.rodas.raio
    for (const r of c.rodas) {
      const q = new THREE.Quaternion().setFromAxisAngle(r.eixo === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1), -c.giro * r.sinal)
      r.o.quaternion.copy(r.q0).multiply(q)
    }
    if (c.raiz.visible) opacidadeCarro(c, a)
    // ré: a luz traseira acende forte do fim da desconexão até o carro sumir. De dia o brilho aditivo some sobre o
    // carro branco, então o halo vira uma névoa vermelha normal; à noite ele soma luz
    // (nas vagas paralelas o carro sai para a frente: sem a luz de ré)
    const reAlvo = !vis.leve && !vg.lat && (vg.estado === 'saindo' || (vg.estado === 'desconectando' && vg.t > T_DESCONECTA * 0.6)) ? 1 : 0
    c.re = lerp(c.re, reAlvo, Math.min(1, dt * 7))
    const lb = c.luzes.base || { lanterna: 3, halo: 0, noite: 0 }
    c.luzes.lanterna.forEach((m2) => (m2.emissiveIntensity = lb.lanterna * (1 + 1.2 * c.re) + 3 * c.re))   // forte demais o vermelho vira rosa
    const hm = c.luzes.halo.material, dia = lb.noite < 0.5, bl = dia ? THREE.NormalBlending : THREE.AdditiveBlending
    if (hm.blending !== bl) { hm.blending = bl; hm.needsUpdate = true }
    hm.opacity = (dia ? 0.8 * c.re : Math.max(lb.halo, 0.95 * c.re)) * a
    c.raiz.userData.sol = vg.lat ? (vg.lat.coberta ? 0.65 : 1) : sobTeto(y)
    // cabo e pistola
    let f = 0
    // leve: a pistola sai e volta para a bomba sem a animação do cabo
    if (vg.estado === 'conectando') { f = vis.leve ? 1 : easeInOut(clamp01(vg.t / T_CONECTA)); if (vis.leve || vg.t >= T_CONECTA) muda(vg, bombas[vg.bomba].falha ? 'falha' : 'carregando') }
    else if (['carregando', 'falha'].includes(vg.estado)) f = 1
    else if (vg.estado === 'desconectando') { f = vis.leve ? 0 : 1 - easeInOut(clamp01(vg.t / T_DESCONECTA)); if (vis.leve || vg.t >= T_DESCONECTA) { pecasRepouso(vg, true); liberaConector(vg); muda(vg, vg.ficar ? 'concluido' : 'saindo') } }
    crescer(vg.cabo, f); vg.pist.g.visible = f > 0.92
    const mu = vg.cabo.mesh.material.userData.u
    mu.uTempo.value = tempo; mu.uPulso.value = vg.estado === 'carregando' && !vis.leve ? 1 : 0; mu.uCor.value.set('#3DFF6A')   // leve: o cabo não pulsa
    // anel da vaga
    // realce: o painel acende o anel do ponto (passar o mouse no card ou no feed)
    const corAnel = vg.estado === 'carregando' ? CORES.carregando : vg.estado === 'falha' ? CORES.falha : vg.estado === 'concluido' && !vg.realce ? '#F5B54A' : (vg.realce ? CORES.carregando : CORES.conectando)
    const pulsa = vis.leve ? 0 : 1                               // leve: o anel fica aceso, sem pulsar
    const alvoA = { carregando: 0.85 + pulsa * (0.25 * Math.sin(tempo * 2.4) - 0.1), falha: 0.95 + pulsa * (0.1 * Math.sin(tempo * 6) - 0.05), conectando: 0.55, chegando: 0.35 * suave(clamp01(vg.t / T_CHEGA)), desconectando: 0.35, concluido: 0.45, saindo: 0.0, vazia: 0 }[vg.estado] + (vg.realce ? 0.5 + pulsa * (0.15 * Math.sin(tempo * 4) - 0.05) : 0)
    // verde soma luz (brilho); vermelho sobre a vaga verde precisa cobrir, senão vira amarelo
    const blend = vg.estado === 'falha' ? THREE.NormalBlending : THREE.AdditiveBlending
    if (vg.anel.material.blending !== blend) { vg.anel.material.blending = blend; vg.anel.material.map = vg.estado === 'falha' ? texAnelFalha : texAnel; vg.anel.material.needsUpdate = true }
    vg.anel.material.color.set(corAnel); vg.anel.material.opacity = lerp(vg.anel.material.opacity, alvoA, Math.min(1, dt * 6))
    if (vg.estado === 'carregando') vg.pct = Math.min(100, vg.pct + dt * 0.9)
  }

  // ---------------------------------------------------------- selos: projeta pontos 3D na tela
  // (4/11) o arranjo (medir, subir o de trás, agrupar os amontoados) está em selos.js, o mesmo da 2D
  const proj = new THREE.Vector3(), pSelo = new THREE.Vector3(), dSelo = new THREE.Vector3(0, 0.2, 2.15)
  function telaSelo(div, p, on, agrupa = false) {
    proj.copy(p).project(cam)
    return { div, on, agrupa, x: (proj.x * 0.5 + 0.5) * cnv.w, y: (-proj.y * 0.5 + 0.5) * cnv.h }
  }
  // tocar num grupo: a vista aproxima em volta dele até os selos caberem separados
  // Depois do toque, os selos não se juntam de novo até a vista afastar abaixo desse zoom (semGrupo)
  function abreGrupo(g) {
    const k = limita(zoom.alvo * fatorParaGrupo(g, cnv.w))
    panAlvo = { u: lerp(jan.U0, jan.U1, g.x / cnv.w) - 0.5, v: lerp(jan.V0, jan.V1, 1 - g.y / cnv.h) - 0.5 }
    focoAlvo = 0; zoom.alvo = k; semGrupo = k * 0.97; atualizaCursor()
  }
  let panAlvo = null, semGrupo = null
  const ICONE_RAIO = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M8 1 3 8h3.5L6 13l5-7H7.5Z" fill="currentColor"/></svg>'
  const ICONE_ALERTA = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 15 14H1Z" fill="currentColor"/><path d="M8 6v4" stroke="#200" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="12" r=".9" fill="#200"/></svg>'
  // o anel do selo: o caminho até o fim da recarga que o painel manda (prog: o valor definido, a bateria ou "até
  // encher" sem fim conhecido, que gira); sem prog, a bateria no DC
  function anelSelo(vg) {
    if (vg.estado !== 'carregando') return ''
    const pr = vg.prog || (vg.dc ? { modo: 'bateria', p: vg.pct } : null)
    if (!pr) return ''
    return pr.modo === 'livre' ? '<i class="mv-pct livre">∞</i>' : `<i class="mv-pct${pr.modo === 'meta' ? ' definido' : ''}" style="--p:${Math.round(pr.p)}">${Math.round(pr.p)}%</i>`
  }
  function seloPessoa(vg, ps) {
    const tipo = vg.con != null ? (conectores[vg.con].dc ? 'CCS2' : 'Tipo 2') : ''
    const fim = vg.prog && vg.prog.modo === 'meta' ? ` · ${vg.prog.fim}` : ''
    const linha = vg.estado === 'falha' ? `${tipo} · Interrompida` : vg.estado === 'conectando' ? `${tipo} · Conectando` : vg.estado === 'concluido' ? 'Terminou · ainda na vaga' : `${tipo} · ${vg.kw} kW${fim}${vg.aviso ? ` <em class="mv-aviso">${vg.aviso}</em>` : ''}`
    return `<b class="mv-av">${ps.iniciais}</b><span class="mv-tx"><b>${ps.nome}</b><small>${linha}</small></span>${anelSelo(vg)}`
  }
  function atualizaSelos() {
    const itens = []
    for (const vg of vagas) {
      const on = ['carregando', 'falha', 'conectando'].includes(vg.estado) || (vg.estado === 'concluido' && !!vg.pessoa)
      if (on) {
        const ps = vg.pessoa
        const html = ps ? seloPessoa(vg, ps)
          : vg.estado === 'falha' ? `<b class="mv-ic mv-ic-falha">${ICONE_ALERTA}</b><span>${vg.nome} · Interrompida</span>`
          : vg.estado === 'conectando' ? `<b class="mv-ic">${ICONE_RAIO}</b><span>${vg.nome} · Conectando</span>`
          : `<b class="mv-ic">${ICONE_RAIO}</b><span>${vg.nome} · ${vg.kw} kW</span>${anelSelo(vg)}`
        if (vg.sel.dataset.h !== html) { vg.sel.innerHTML = html; vg.sel.dataset.h = html }
        vg.sel.classList.toggle('falha', vg.estado === 'falha'); vg.sel.classList.toggle('pessoa', !!ps)
      }
      itens.push(telaSelo(vg.sel, paraMundo(vg.fileira, pSelo.copy(vg.carro.raiz.position).add(dSelo)), on, true))
      const infoOn = tempo < vg.infoAte
      itens.push(infoOn || vg.info._on ? telaSelo(vg.info, paraMundo(vg.fileira, pSelo.set(vg.pos.x, vg.pos.y, chao(vg.pos.x, vg.pos.y) + 0.35)), infoOn) : { div: vg.info, on: false, x: 0, y: 0 })
    }
    for (const b of bombas) {
      const emFoco = foco > 0.6 && zoom.k > 1.05            // "Ver as bombas": o selo em todas, não só na do foco (29/10), até voltar a 100%
      const htmlB = b.falha ? `<b class="mv-ic mv-ic-falha">${ICONE_ALERTA}</b><span>${b.nome} · Falha de comunicação</span><em class="mv-link">Ver detalhes</em>`
        : b.inativa ? `<b class="mv-ic">${ICONE_BOMBA}</b><span>${b.nome} · Desligada</span><em class="mv-link">Ver detalhes</em>`
        : `<b class="mv-ic">${ICONE_BOMBA}</b><span>${b.nome} · Online</span><em class="mv-link">Ver detalhes</em>`
      if (b.sel.dataset.h !== htmlB) { b.sel.innerHTML = htmlB; b.sel.dataset.h = htmlB }
      b.sel.classList.toggle('falha', b.falha); b.sel.classList.toggle('clicavel', b.falha || emFoco)
      itens.push(telaSelo(b.sel, b.topo, b.falha || emFoco))
    }
    // agrupa os amontoados, menos com a vista no máximo do zoom (aí não há como separar mais)
    if (semGrupo && zoom.alvo < semGrupo * 0.8) semGrupo = null
    arranja(itens, { camada: camadaSelos, agrupar: zoom.k < (semGrupo || ZOOM_MAX) * 0.97, aoAbrir: abreGrupo })
  }

  // ---------------------------------------------------------- laço
  let ultimo = performance.now(), tempo = 0, comparar = false
  const zoomAlvo = { u: 0.5, v: 0.5 }
  let foco = 0, focoAlvo = 0, bombaFoco = 0
  const ZOOM_MIN = 0.75, ZOOM_MAX = 2.4
  const pan = { u: 0, v: 0 }                                   // deslocamento da vista pelo arrasto, em frações do quadro
  const limita = (k) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, k))
  const aproximado = () => zoom.alvo > 1.02
  let arrasto = null
  function atualizaCursor() {
    el.style.cursor = arrasto ? 'grabbing' : aproximado() ? 'grab' : ''
    el.style.touchAction = aproximado() ? 'none' : 'pan-y'     // no celular, aproximado, um dedo arrasta a vista em vez de rolar a página
  }
  function calculaAlvoZoom() { const b = bombas[bombaFoco]; const p = new THREE.Vector3(b.x + 0.35, b.y - 0.9 * b.s, Z + 0.9).project(cam); zoomAlvo.u = lerp(jan.U0, jan.U1, p.x * 0.5 + 0.5); zoomAlvo.v = lerp(jan.V0, jan.V1, p.y * 0.5 + 0.5) }
  // roda do mouse e pinça: muda só o tamanho (a câmera não sai do lugar). Aproximado, arrastar move a vista;
  // a maquete não gira nem se mexe. Duplo clique volta ao enquadramento inicial
  el.addEventListener('wheel', (e) => { e.preventDefault(); zoom.alvo = limita(zoom.alvo * Math.exp(-e.deltaY * 0.0015)); if (zoom.alvo < 1.05) focoAlvo = 0; atualizaCursor() }, { passive: false })
  const toques = new Map(); let dist0 = 0, zoom0 = 1
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest && e.target.closest('.mv-selo')) return
    toques.set(e.pointerId, e)
    if (toques.size === 2) { const [a, b] = [...toques.values()]; dist0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); zoom0 = zoom.alvo; arrasto = null }
    else if (toques.size === 1 && aproximado() && e.button === 0) { arrasto = { x: e.clientX, y: e.clientY }; try { el.setPointerCapture(e.pointerId) } catch {} }
    atualizaCursor()
  })
  el.addEventListener('pointermove', (e) => {
    if (!toques.has(e.pointerId)) return; toques.set(e.pointerId, e)
    if (toques.size === 2 && dist0) { const [a, b] = [...toques.values()]; zoom.alvo = limita(zoom0 * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / dist0); atualizaCursor() }
    else if (arrasto) {
      panAlvo = null; const w = 1 / zoom.k                       // 1 px de arrasto = w / largura do quadro, em frações
      pan.u -= (e.clientX - arrasto.x) * w / img.w; pan.v += (e.clientY - arrasto.y) * w / img.h
      arrasto.x = e.clientX; arrasto.y = e.clientY
    }
  })
  // clique (sem arrastar) numa vaga: avisa o painel com "mv-vaga" (a vaga e o estado dela)
  let clique0 = null
  el.addEventListener('pointerdown', (e) => { clique0 = toques.size === 0 && e.button === 0 && !(e.target.closest && e.target.closest('.mv-selo')) ? { x: e.clientX, y: e.clientY, t: performance.now() } : null }, true)
  const raio = new THREE.Raycaster(), plano = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), alvoChao = new THREE.Vector3()
  function vagaNoPonto(cx, cy) {
    const r = el.getBoundingClientRect()
    raio.setFromCamera(new THREE.Vector2(((cx - r.left) / cnv.w) * 2 - 1, -(((cy - r.top) / cnv.h) * 2 - 1)), cam)
    for (const vg of vagas) {
      plano.constant = -chao(vg.pos.x, vg.pos.y)
      if (!raio.ray.intersectPlane(plano, alvoChao)) continue
      const lc = paraMundo(vg.fileira, alvoChao)                 // o giro de 180° é a própria volta: mundo → "de frente"
      if (Math.abs(lc.x - vg.pos.x) < an.BAY_W / 2 && Math.abs(lc.y - vg.pos.y) < an.BAY_D / 2) return vg
    }
    return null
  }
  // clique numa bomba (29/10): o painel abre o card dela, como o do carro. A bomba é a faixa da tela entre a base e o
  // topo dela, com a largura de ~1/3 da altura; com a bomba e uma vaga sob o dedo, vale a bomba
  const pTela = new THREE.Vector3()
  const naTela = (v) => { pTela.copy(v).project(cam); return { x: (pTela.x * 0.5 + 0.5) * cnv.w, y: (-pTela.y * 0.5 + 0.5) * cnv.h } }
  function bombaNoPonto(cx, cy) {
    const r = el.getBoundingClientRect(), x = cx - r.left, y = cy - r.top
    let melhor = null, dm = Infinity
    for (const b of bombas) {
      const base = naTela(new THREE.Vector3(b.x, b.y, Z)), topo = naTela(b.topo)
      if (y < Math.min(base.y, topo.y) - 6 || y > Math.max(base.y, topo.y) + 6) continue
      const d = Math.abs(x - (base.x + topo.x) / 2), larg = Math.max(12, Math.abs(base.y - topo.y) * 0.32)
      if (d < larg && d < dm) { dm = d; melhor = b }
    }
    return melhor
  }
  el.addEventListener('pointermove', (e) => { if (!toques.size && !arrasto) el.style.cursor = bombaNoPonto(e.clientX, e.clientY) ? 'pointer' : arrasto ? 'grabbing' : aproximado() ? 'grab' : '' })
  const solta = (e) => {
    if (clique0 && e.type === 'pointerup' && Math.hypot(e.clientX - clique0.x, e.clientY - clique0.y) < 6 && performance.now() - clique0.t < 600) {
      const bb = bombaNoPonto(e.clientX, e.clientY), vg = bb ? null : vagaNoPonto(e.clientX, e.clientY)
      if (bb) el.dispatchEvent(new CustomEvent('mv-bomba', { detail: { bomba: bb.bi } }))
      else if (vg) el.dispatchEvent(new CustomEvent('mv-vaga', { detail: { vaga: vg.i, estado: vg.estado } }))
    }
    clique0 = null
    toques.delete(e.pointerId); if (toques.size < 2) dist0 = 0; if (!toques.size) arrasto = null; atualizaCursor()
  }
  el.addEventListener('pointerup', solta); el.addEventListener('pointercancel', solta)
  el.addEventListener('dblclick', () => { zoom.alvo = 1; focoAlvo = 0; pan.u = pan.v = 0; panAlvo = null; atualizaCursor() })
  el.style.userSelect = 'none'
  atualizaCursor()
  // desenhar = false só avança o tempo (o avancar do painel pula 170 quadros na abertura e desenha só o último)
  function quadro(dt, desenhar = true) {
    tempo += dt
    zoom.k = lerp(zoom.k, zoom.alvo, Math.min(1, dt * 3.2))
    foco = lerp(foco, focoAlvo, Math.min(1, dt * 3.2))
    const kz = clamp01((zoom.k - 1) / 1.2), w = 1 / zoom.k
    const bu = lerp(0.5, zoomAlvo.u, kz * foco), bv = lerp(0.5, zoomAlvo.v, kz * foco)
    // tocar num grupo de selos: a vista anda até ele enquanto aproxima (1,2 s; arrastar cancela)
    if (panAlvo) { const q = Math.min(1, dt * 4); pan.u = lerp(pan.u, panAlvo.u, q); pan.v = lerp(pan.v, panAlvo.v, q); if ((panAlvo.t = (panAlvo.t || 0) + dt) > 1.2) panAlvo = null }
    // o arrasto para na borda do render (sem acumular além dela) e some ao afastar
    if (w >= 1 && !panAlvo) { pan.u = 0; pan.v = 0 } else { pan.u = clamp(bu + pan.u, w / 2, 1 - w / 2) - bu; pan.v = clamp(bv + pan.v, w / 2, 1 - w / 2) - bv }
    zoom.u = bu + pan.u; zoom.v = bv + pan.v
    aplicaZoom()
    quadTeto.material.uniforms.opac.value = 1 - 0.88 * suave(clamp01((zoom.k - 1.15) / 0.8))   // ao aproximar, o teto quase some
    for (const vg of vagas) atualizaVaga(vg, dt, tempo)
    quadFundo.material.uniforms.uT.value = tempo; quadFundo.material.uniforms.piscar.value = vis.leve ? 0 : 1
    let bAlarme = null
    for (const b of bombas) {
      // falha: o brilho vermelho em volta da base pulsa (no Leve fica fixo, sem piscar) e a luz vermelha tinge o carro.
      // (29/10: um comentário no meio desta linha tinha desligado o brilho; o Sergio sentiu falta)
      const alvo = b.falha ? (vis.leve ? 0.85 : 0.55 + 0.45 * Math.sin(tempo * 5.5)) : 0
      b.alarme.material.opacity = lerp(b.alarme.material.opacity, alvo * 0.9, Math.min(1, dt * 8))
      if (!bAlarme || b.alarme.material.opacity > bAlarme.alarme.material.opacity) bAlarme = b
      // (4/11) o desenho da tela: entra suave; na falha pulsa junto com as luzes (sem sumir); ao voltar ao normal, sai
      if (b.tela) {
        // (pulsa pouco: abaixo de ~90% o anúncio da tela aparecia por trás do alerta, de dia)
        const mt = b.tela.mesh.material, alvoT = b.tela.tipo === 'falha' ? (vis.leve ? 1 : 0.93 + 0.07 * Math.sin(tempo * 5.5)) : b.tela.tipo ? 0.97 : 0
        mt.opacity = lerp(mt.opacity, alvoT, Math.min(1, dt * 8))
        if (!b.tela.tipo && mt.opacity < 0.01) b.tela.mesh.visible = false
      }
    }
    if (bAlarme) { luzAlarme.position.copy(bAlarme.luzPos); luzAlarme.intensity = bAlarme.alarme.material.opacity * 6 }
    const ocup = vagas.reduce((s, vg) => s + (vg.carro.raiz.visible ? '1' : '0'), '')
    if (ocup !== ocupLuz) { ocupLuz = ocup; escolheLuzes() }
    const somb = vagas.reduce((m2, vg) => Math.min(m2, vg.carro.raiz.visible ? vg.carro.raiz.userData.sol ?? 1 : 1), 1)
    sol.intensity = (sol.userData.forca || 0) * somb
    if (desenhar) {
      copaU.tela.value.set(renderer.domElement.width, renderer.domElement.height)     // a copa da ilha lê o fundo pela tela
      atualizaSprites()
      // o mapa de sombra do sol só é refeito quando algo muda: um carro muda de estado, se mexe ou aparece e some (fade),
      // a pistola e o cabo saem ou voltam, a hora muda (o sol anda) ou a resolução da sombra muda. Era só no leve; desde
      // 5/11 vale sempre (com o posto parado, o desenho da sombra era refeito a cada quadro, ~350 pedidos com 7 carros)
      renderer.shadowMap.autoUpdate = false
      if (sombraSuja || vagas.some((vg) => vg.estado === 'chegando' || vg.estado === 'conectando' || vg.estado === 'desconectando' || vg.estado === 'saindo')) { renderer.shadowMap.needsUpdate = true; sombraSuja = false }
      // (5/11) o que está com opacidade zero (anel da vaga vazia, brilho de ré apagado, alarme desligado) não é desenhado
      for (const vg of vagas) { vg.anel.visible = vg.anel.material.opacity > 0.002; const h = vg.carro.luzes.halo; h.visible = h.material.opacity > 0.002 }
      for (const b of bombas) b.alarme.visible = b.alarme.material.opacity > 0.002
      atualizaFotos()
      if (renderer.shadowMap.needsUpdate) sombraSoParaFotos()
      renderer.clear()
      renderer.render(cenaFundo, telaCam)
      renderer.clearDepth()
      renderer.render(cena, cam)
      renderer.render(cenaTeto, telaCam)
    }
    // chuva: transição suave ao ligar e desligar; a luz acompanha
    let mudouClima = false
    for (const c of [chuva, nuvem]) if (Math.abs(c.k - c.alvo) > 0.001) { c.k = lerp(c.k, c.alvo, Math.min(1, dt * 1.6)); if (Math.abs(c.k - c.alvo) < 0.002) c.k = c.alvo; mudouClima = true }
    if (mudouClima) aplicaHora()
    if (!desenhar) return
    if (chuva.k > 0.002 && vis.efeitos) {
      const uc = quadChuva.material.uniforms
      uc.uT.value = tempo; uc.uK.value = chuva.k; uc.uDpr.value = renderer.getPixelRatio(); uc.aspecto.value = ASPECTO
      renderer.render(cenaChuva, telaCam)
    }
    atualizaSelos()
  }
  // ---------------------------------------------------------- desempenho: o quadro se adapta ao aparelho
  // Ritmo: com algo se mexendo (carro chegando, conectando ou saindo, zoom, arrasto, chuva) até 60 quadros por segundo
  // (num monitor de 144 Hz ele desenhava 144); com a cena parada, só o anel e o cabo pulsando, 30; fora da tela, nenhum.
  // Resolução: começa em 1,5× a da tela (2× nas de alta densidade) e desce em degraus quando os quadros atrasam (um
  // quadro desenhado leva mais de ~28 ms até o seguinte), voltando a subir quando cabem num ciclo da tela por 8 s. Um
  // degrau que já atrasou só é tentado de novo depois de 30 s, 60 s, 120 s... Abaixo de 1×, a sombra do sol das
  // maquetes grandes cai de 4096 para 2048 px. ?qualidade=leve no painel começa no degrau de 1× (e alta não desce).
  // Medido (RTX 4070 Ti, monitor de 240 Hz, 2 carros carregando): antes 240 quadros/s e 8,8% da placa; agora 30 e <1%
  const PR0 = Math.min(2, Math.max(1.5, window.devicePixelRatio || 1))
  const DEGRAUS = [...new Set([PR0, 1.5, 1.25, 1, 0.8].filter((v) => v <= PR0))].sort((a, b) => b - a)
  const TOPO = opcoes.qualidade === 'leve' ? DEGRAUS.length - 1 : 0                 // leve: o degrau mais baixo (0,8×)
  const des = { nivel: TOPO, fixo: opcoes.qualidade === 'alta', naTela: true, ultimoQ: 0, anterior: 0, desenhou: false, media: 16, ciclo: 16.7, desde: 0,
    falhou: DEGRAUS.map(() => ({ ate: 0, espera: 30000 })), sombra: sol.shadow.mapSize.x }
  // configuração visual do painel (setVisual): leve = 1×, sombra menor, até 30 quadros por segundo e animações reduzidas
  // (sem a chuva desenhada, entre outras); sem efeitos = só sem a chuva desenhada e até 30 quadros por segundo
  const vis = { leve: opcoes.qualidade === 'leve', efeitos: opcoes.qualidade !== 'leve' }
  function aplicaNivel() {
    const pr = DEGRAUS[des.nivel]
    renderer.setPixelRatio(pr); tamanho()
    const s = vis.leve ? Math.min(1024, des.sombra) : pr < 1 ? Math.min(2048, des.sombra) : des.sombra     // leve: sombra de 1024
    if (sol.shadow.mapSize.x !== s) { sol.shadow.mapSize.set(s, s); if (sol.shadow.map) { sol.shadow.map.dispose(); sol.shadow.map = null } sombraSuja = true }
  }
  if (des.nivel > 0) aplicaNivel()
  new IntersectionObserver(([e]) => { des.naTela = e.isIntersecting }).observe(el)
  const movendo = () => Math.abs(zoom.k - zoom.alvo) > 0.002 || Math.abs(foco - focoAlvo) > 0.002 || arrasto || panAlvo || toques.size > 0 || chuva.k > 0.002 ||
    Math.abs(chuva.k - chuva.alvo) > 0.001 || Math.abs(nuvem.k - nuvem.alvo) > 0.001 || vagas.some((vg) => ['chegando', 'conectando', 'desconectando', 'saindo'].includes(vg.estado))
  function laco(agora) {
    if (!opcoes.captura) requestAnimationFrame(laco)
    const passou = agora - des.anterior; des.anterior = agora
    // o ciclo da tela (16,7 ms a 60 Hz, 6,9 a 144) se mede nos quadros que não desenham; o intervalo depois de um quadro
    // desenhado mostra se o aparelho dá conta (a placa atrasa o seguinte)
    if (!des.desenhou && passou > 4 && passou < 50) des.ciclo = des.ciclo * 0.9 + passou * 0.1
    if (des.desenhou) {
      des.desenhou = false
      des.media = des.media * 0.85 + Math.min(200, agora - des.ultimoQ) * 0.15
      if (!des.fixo && agora - des.desde > 1500) {
        if (des.media > 28 && des.nivel < DEGRAUS.length - 1) {
          const f = des.falhou[des.nivel]; f.ate = agora + f.espera; f.espera *= 2
          des.nivel++; des.desde = agora; des.media = 16; aplicaNivel()
        } else if (des.media < Math.max(14, des.ciclo * 1.2) && des.nivel > TOPO && agora - des.desde > 8000 && agora > des.falhou[des.nivel - 1].ate) {
          des.nivel--; des.desde = agora; des.media = 16; aplicaNivel()
        }
      }
    }
    if (!des.naTela) return
    // ritmo: 60 quadros/s com algo se mexendo e 30 parada; no leve, 30 se mexendo e 12 parada (nada pulsa no leve)
    const mexe = movendo()
    if (agora - ultimo < (vis.leve ? (mexe ? 1000 / 30 : 1000 / 12) : mexe && vis.efeitos ? 1000 / 60 : 1000 / 30) - 2) return
    const dt = Math.min(0.1, (agora - ultimo) / 1000); ultimo = agora          // aparelho lento (10 qps) ainda anda no tempo real
    quadro(dt); des.ultimoQ = agora; des.desenhou = true
  }
  function tamanho() {
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight)
    const mg = (getComputedStyle(el).getPropertyValue('--mv-margem').trim() || '0').split(/\s+/).map(parseFloat)
    const [t, r, b, l] = [mg[0], mg[1] ?? mg[0], mg[2] ?? mg[0], mg[3] ?? mg[1] ?? mg[0]].map((v) => v || 0)
    const aw = Math.max(1, w - l - r), ah = Math.max(1, h - t - b)
    let iw = aw, ih = aw / ASPECTO; if (ih > ah) { ih = ah; iw = ah * ASPECTO }
    img = { x: l + (aw - iw) / 2, y: t + (ah - ih) / 2, w: iw, h: ih }; cnv = { w, h }
    renderer.setSize(w, h)
    Object.assign(renderer.domElement.style, { position: 'absolute', left: '0px', top: '0px' })
    esquece(camadaSelos)                                       // a fonte dos selos muda com a largura: mede de novo
    aplicaZoom()
  }
  new ResizeObserver(tamanho).observe(el); tamanho()
  aplicaHora(); aplicaZoom(); cam.updateMatrixWorld(); calculaAlvoZoom()

  // leve desde a abertura: os carros já vestem as imagens (os materiais pesados do carro nem chegam a compilar)
  if (vis.leve) await usaSprites(true)
  // ---------------------------------------------------------- aquecimento, ainda com a tela de carregamento na frente
  // Cada shader compila na primeira vez que é desenhado, e com ~30 luzes à noite cada material do carro leva ~0,5 s na
  // primeira visita (o navegador guarda os compilados para as próximas). Sem o aquecimento, o primeiro carro que aparecia
  // compilava tudo de uma vez e o navegador travava segundos. Aqui a tela de carregamento cobre a maquete e cada peça
  // nova é desenhada num quadro só dela, para a animação do carregamento seguir entre uma e outra. O compileAsync não
  // serve: no Chrome do Windows ele também trava enquanto compila. As camadas sobem para a placa uma por quadro
  const proximoQuadro = () => new Promise((ok) => requestAnimationFrame(() => ok()))
  const desenhaAquece = () => { renderer.clear(); renderer.render(cenaFundo, telaCam); renderer.clearDepth(); renderer.render(cena, cam); renderer.render(cenaTeto, telaCam); renderer.render(cenaChuva, telaCam) }
  {
    const vg0 = vagas[0], c0 = vg0.carro
    const objs = vagas.flatMap((vg) => [vg.carro.raiz, ...Object.values(vg.pares).flatMap((p) => [p.pist.g, p.cabo.mesh])])
    const antes = objs.map((o) => o.visible)
    objs.forEach((o) => (o.visible = false))
    desenhaAquece(); passo(); await proximoQuadro()             // a cena fixa (peças da bomba, totem, chão, camadas)
    // o primeiro carro na vaga dele, peça por peça (os outros carros usam os mesmos shaders); depois pistolas e cabos dele
    c0.raiz.position.set(vg0.pos.x, vg0.pos.y, Z); opacidadeCarro(c0, 1); c0.raiz.visible = true
    const pecasC0 = []; c0.raiz.traverse((o) => { if (o.isMesh) pecasC0.push(o) })
    const vis0 = pecasC0.map((m) => m.visible); pecasC0.forEach((m) => (m.visible = false))
    const passos = [...pecasC0.map((m) => () => { m.visible = true }), ...Object.values(vg0.pares).map((p) => () => { p.pist.g.visible = true; p.cabo.mesh.visible = true })]
    for (const f of passos) {
      f(); const t0 = performance.now(); desenhaAquece()
      // compilou algo: dois quadros para a animação do carregamento respirar (um pouco mais lento, sem engasgo seguido)
      if (performance.now() - t0 > 12) { await proximoQuadro(); await proximoQuadro() }
    }
    pecasC0.forEach((m, i) => (m.visible = vis0[i])); objs.forEach((o, i) => (o.visible = antes[i])); passo()
  }
  {
    const { a, b } = periodoDaHora(hora)                       // as camadas do horário de agora primeiro
    for (const p of new Set([a, b, ...INI])) if (fundos[p]) for (const t of [fundos[p], tetos[p]]) {
      if (t.image && t.image.decode) await t.image.decode().catch(() => null)   // decodifica fora da linha principal
      renderer.initTexture(t); passo(); await proximoQuadro()
    }
  }
  ultimo = performance.now()
  if (!opcoes.captura) requestAnimationFrame(laco)
  // (3/11, noite) os outros horários, um de cada vez, em segundo plano (o mais perto do de agora primeiro); cada um que
  // chega sobe para a placa e, se a hora de agora usa ele, entra no lugar do vizinho
  const resto = PERIODOS.filter((p) => !fundos[p])
  segundoPlano = true
  ;(async () => {
    for (const p of resto) {
      // no celular (ECONOMIA): só baixa os arquivos para o cache; a placa recebe quando a hora chegar neles
      if (ECONOMIA) { for (const n of ['fundo', 'teto']) await fetch(base + `${n}-${p}.${ext}`).then((r) => r.blob()).catch(() => null); continue }
      await camadasDe(p).catch(() => null)
      if (copaU.carregaResto) await copaU.carregaResto(p)
      for (const t of [fundos[p], tetos[p]]) if (t) { if (t.image && t.image.decode) await t.image.decode().catch(() => null); renderer.initTexture(t); await proximoQuadro() }
      aplicaHora()
    }
  })()

  return {
    posto: an.posto,
    quadroImagem: () => ({ ...img }),
    _carro: (i) => vagas[i].carro,
    _bombas: bombas,                                                                                  // só para inspeção (testes)
    _telaDaVaga: (i) => { const p0 = vagas[i].pos.clone(); p0.z = chao(p0.x, p0.y); const p = paraMundo(vagas[i].fileira, p0); p.project(cam); const r = el.getBoundingClientRect(); return { x: r.left + (p.x * 0.5 + 0.5) * cnv.w, y: r.top + (-p.y * 0.5 + 0.5) * cnv.h } },   // testes                              // só para inspeção (testes)                          // onde o render cai dentro do elemento (px), sem zoom
    vagas: vagas.map((v) => ({ nome: v.nome, dc: v.dc, bomba: v.bomba, kw: v.kw, natural: v.natural })),
    // conectores: um por saída de cabo; vagasNaturais = as vagas que ficam de frente para ele
    conectores: conectores.map((c) => ({ id: c.id, bomba: c.bomba, dc: c.dc, lado: c.lado, vagasNaturais: [...c.vagasNaturais] })),
    conectorDa: (i) => vagas[i].con,
    conectorLivre: (i) => { const c = livreNaBomba(vagas[i]); return c ? c.id : null },
    bombas: bombas.map((b) => ({ nome: b.nome, modelo: b.modelo })),
    estado: (i) => vagas[i].estado,
    falha: (bi) => bombas[bi].falha,
    evento, setFalha, setInativa, temEstadosNaImagem: !!mascaraB,
    // dados que o painel manda para o selo (potência e carga do carro)
    setDados(i, d) { const vg = vagas[i]; if (d.kw != null) vg.kw = d.kw; if (d.pct != null) vg.pct = d.pct; if (d.prog !== undefined) vg.prog = d.prog; if (d.pessoa !== undefined) vg.pessoa = d.pessoa; if (d.aviso !== undefined) vg.aviso = d.aviso },   // pessoa: { nome, iniciais } ou null; prog: { modo, p, fim }
    getDados: (i) => ({ kw: vagas[i].kw, pct: vagas[i].pct }),
    setRealce(i) { for (const vg of vagas) vg.realce = vg.i === i },
    // selo de informação sobre a vaga (html), por alguns segundos
    mostrarVaga(i, html, seg = 5) { const vg = vagas[i]; if (vg.info.dataset.h !== html) { vg.info.innerHTML = html; vg.info.dataset.h = html } vg.infoAte = tempo + seg },
    ouvir(f) { ouvintes.push(f) },
    // um horário que ainda não está na placa (celular): a troca espera ele ficar pronto, em vez de mostrar o vizinho
    setHora(h) {
      hora = h; const { a, b } = periodoDaHora(h), falta = [a, b].filter((p) => !fundos[p])
      if (!falta.length) { aplicaHora(); libera() } else Promise.all(falta.map(garante)).then(() => { if (hora === h) { aplicaHora(); libera() } })
    },
    // tempo chuvoso: on = true/false (transição de ~2 s); imediato = sem transição
    setChuva(on, imediato) { chuva.alvo = on ? 1 : 0; nuvem.alvo = on ? 1 : nuvem.alvo; if (imediato) { chuva.k = chuva.alvo; nuvem.k = nuvem.alvo; aplicaHora() } },
    getChuva: () => chuva.alvo > 0.5,
    // clima de verdade: nuvens e chuva de 0 a 1 (garoa ~0,35, chuva forte 1)
    setClima({ nuvens = 0, chuva: ch = 0 } = {}, imediato) { nuvem.alvo = clamp01(nuvens); chuva.alvo = clamp01(ch); if (imediato) { nuvem.k = nuvem.alvo; chuva.k = chuva.alvo; aplicaHora() } },
    getHora: () => hora,
    setPreco(v) { preco = v; desenhaTotem(telaTotem, preco, logoBranco, linhasTotem); texTotem.needsUpdate = true },
    setZoom(on, bi = 0) { bombaFoco = bi; calculaAlvoZoom(); focoAlvo = on ? 1 : 0; zoom.alvo = on ? 2.0 : 1; pan.u = pan.v = 0; panAlvo = null; atualizaCursor() },
    setZoomNivel(k) { zoom.alvo = limita(Math.abs(k - 1) < 0.08 ? 1 : k); if (zoom.alvo < 1.05) focoAlvo = 0; atualizaCursor() },   // perto de 100% encaixa em 100%
    zoomLimites: { min: ZOOM_MIN, max: ZOOM_MAX },
    getZoom: () => zoom.alvo,
    // modo de captura (vídeo): avança o tempo em passos fixos e desenha (só o último passo; os outros não aparecem)
    avancar(dt, passos = 1) { for (let i = 0; i < passos; i++) quadro(dt, i === passos - 1) },
    // o modo desempenho agora (para medir e conferir)
    // configuração visual (29/10, pedido do Sergio, como num jogo): qualidade 'auto' (desce sozinha quando atrasa),
    // 'alta' (resolução cheia, não desce) ou 'leve': 1×, sombra menor, 30 quadros/s e as animações reduzidas (carro
    // surge e some com transparência, sem manobra; falha com a base vermelha fixa; anel e cabo sem pulsar; sem a chuva
    // desenhada). efeitos false tira só a chuva desenhada
    setVisual({ qualidade, efeitos } = {}) {
      if (qualidade) {
        des.fixo = qualidade !== 'auto'; vis.leve = qualidade === 'leve'; vis.efeitos = !vis.leve
        des.nivel = vis.leve ? DEGRAUS.length - 1 : 0; des.media = 16; des.desde = performance.now(); aplicaNivel()   // leve: o degrau mais baixo (0,8×)
        if (vis.leve !== SPR.ligado) usaSprites(vis.leve)          // leve: os carros em imagem
      }
      if (efeitos != null) vis.efeitos = !!efeitos
    },
    desempenho: () => ({ pixelRatio: DEGRAUS[des.nivel], degraus: DEGRAUS, noLimite: des.nivel === DEGRAUS.length - 1, sombra: sol.shadow.mapSize.x,
      mediaMs: Math.round(des.media), cicloMs: Math.round(des.ciclo * 10) / 10, naTela: des.naTela, movendo: movendo() }),
    canvas: renderer.domElement,
  }
}
