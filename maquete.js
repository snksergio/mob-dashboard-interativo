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

export const PERIODOS = ['manha', 'tarde', 'por', 'noite']
// [hora, período]: entre duas chaves iguais segura; entre diferentes cruza
const CHAVES = [[0, 'noite'], [5, 'noite'], [7.5, 'manha'], [10, 'manha'], [12.5, 'tarde'], [16.5, 'tarde'], [17.8, 'por'], [18.6, 'por'], [19.6, 'noite'], [24, 'noite']]
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
  // progresso: cada arquivo baixado conta um passo (âncoras, luzes, camadas, panorâmicas, carro, peças e logo)
  let feitos = 0; const TOTAL = 2 + PERIODOS.length * 4 + 3
  const passo = () => { feitos++; if (opcoes.aoProgresso) opcoes.aoProgresso(Math.min(1, feitos / TOTAL)) }
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
  const tex = (u) => new Promise((ok) => tl.load(u, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.premultiplyAlpha = true; t.anisotropy = 4; passo(); ok(t) }))
  const ext = opcoes.ext || 'webp'
  const fundos = {}, tetos = {}, envs = {}
  await Promise.all(PERIODOS.map(async (p) => { fundos[p] = await tex(base + `fundo-${p}.${ext}`); tetos[p] = await tex(base + `teto-${p}.${ext}`) }))
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
  const placa = () => new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { tA: { value: null }, tB: { value: null }, t: { value: 0 }, janela: { value: new THREE.Vector4(0, 0, 1, 1) }, opac: { value: 1 }, chuva: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `uniform sampler2D tA, tB; uniform float t, opac, chuva; uniform vec4 janela; varying vec2 vUv;
      void main(){
        vec2 uv = janela.xy + vUv * (janela.zw - janela.xy);
        if (uv.x < 0. || uv.x > 1. || uv.y < 0. || uv.y > 1.) discard;     // fora do render
        vec4 c = mix(texture2D(tA, uv), texture2D(tB, uv), t);          // pré-multiplicado
        vec3 col = c.a > 1e-4 ? c.rgb / c.a : vec3(0.0);
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
  const chao = (x, y) => (y > FX_Y0 - 0.005 ? Z + FX_H : chaoPatio(y))
  const chaoPatio = (y) => { const y0 = an.AP_Y0, y1 = an.AP_Y0 + an.RAMPA_L; return y >= y1 ? Z : y <= y0 ? 0.015 : lerp(0.015, Z, (y - y0) / (y1 - y0)) }

  // oclusores invisíveis: só escrevem profundidade (o que está atrás deles some, como no render)
  const matOc = new THREE.MeshBasicMaterial({ colorWrite: false })
  for (const o of an.oclusores) {
    const mn = V(o.min), mx = V(o.max), c = mn.clone().add(mx).multiplyScalar(0.5), d = mx.clone().sub(mn)
    let mesh
    if (o.cilindro) { mesh = new THREE.Mesh(new THREE.CylinderGeometry(d.x / 2, d.x / 2, d.z, 20), matOc); mesh.rotation.x = Math.PI / 2 }
    else mesh = new THREE.Mesh(new THREE.BoxGeometry(d.x, d.y, d.z), matOc)
    mesh.position.copy(c); mesh.renderOrder = -1; cena.add(mesh)
  }
  // sombra do carro: plano que só recebe sombra + sombra de contato macia
  const solo = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.32 }))
  solo.position.set(0, 2, Z + 0.003); solo.receiveShadow = true; cena.add(solo)
  const texSombra = texturaSombra(), texAnel = texturaAnel(), texAnelFalha = texturaAnel(true), texHalo = texturaHalo(), texGlow = texturaGlow()

  // luzes: sol e as da cena (uma por nome, com a força de cada período)
  const sol = new THREE.DirectionalLight('#ffffff', 1); sol.castShadow = true
  sol.shadow.mapSize.set(2048, 2048); Object.assign(sol.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 60 })
  sol.shadow.bias = -0.0004; sol.shadow.normalBias = 0.02; sol.shadow.radius = 4
  cena.add(sol, sol.target)
  const luzesCena = {}
  for (const p of PERIODOS) for (const L of luzesP[p].luzes) {
    if (L.nome === 'sol' || luzesCena[L.nome]) continue
    let l
    if (L.tipo === 'POINT') l = new THREE.PointLight('#fff', 0, 0, 2)
    else if (L.tipo === 'SPOT') l = new THREE.SpotLight('#fff', 0, 0, Math.min(1.5, L.spot / 2), 0.6, 2)
    else l = new THREE.SpotLight('#fff', 0, 0, 1.35, 1.0, 2)            // área -> spot largo
    l.position.copy(V(L.pos)); if (l.target) { l.target.position.copy(V(L.pos).add(V(L.dir))); cena.add(l.target) }
    luzesCena[L.nome] = l; cena.add(l)
  }
  const forcaLuz = (L) => (L.tipo === 'AREA' ? L.energia / Math.PI : L.energia / (4 * Math.PI))

  // ---------------------------------------------------------- carro (GLB) e materiais
  const gltf = await new GLTFLoader().loadAsync('dados/carro.glb'); passo()
  const molde = gltf.scene
  function novoCarro(cor) {
    const g = molde.clone(true); const luzes = { farol: [], lanterna: [] }; const mats = []; const rodas = []; const pintura = []
    const sombraSol = new THREE.MeshDepthMaterial({ alphaHash: true })   // a sombra do sol some com o carro
    g.traverse((o) => {
      if (o.isMesh) {
        const nm = (o.material && o.material.name) || ''
        const mm = materialDoCarro(nm, cor, luzes)
        if (mm) o.material = mm; else o.material = o.material.clone()
        if (nm.startsWith('c2_pintura')) pintura.push(o.material)
        o.castShadow = true; o.receiveShadow = true; o.customDepthMaterial = sombraSol; mats.push(o.material)
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
    raiz.visible = false; cena.add(raiz)
    return { raiz, mats, luzes, rodas, sombra, sombraSol, pintura, giro: 0, re: 0 }
  }
  function opacidadeCarro(c, a) {
    for (const mt of c.mats) {
      const tr = a < 0.999
      if (mt.transparent !== tr) { mt.transparent = tr; mt.needsUpdate = true }
      mt.opacity = a
    }
    c.sombra.material.opacity = 0.5 * a * a                       // a de contato some antes do carro
    c.sombraSol.opacity = a
  }

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
  function novaPistola(porta, n, escala = 1) {
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
    g.visible = false; cena.add(g)
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
  function novoCabo(inicio, pist, r = 0.022) {
    // do jeito da maquete v11: sai da bomba, desce a faixa, corre no chão e sobe até a empunhadura
    const { fim, u } = pist; const xs = inicio.x
    const chave = [inicio, new THREE.Vector3(xs, inicio.y - 0.08, Z + FX_H + 0.25), new THREE.Vector3(xs, (FX_Y0 + inicio.y) / 2 - 0.05, Z + FX_H),
      new THREE.Vector3(xs, FX_Y0 + 0.06, Z + FX_H), new THREE.Vector3(xs, FX_Y0 - 0.12, Z),
      new THREE.Vector3((fim.x + u.x * 0.16 + xs) / 2, (fim.y + FX_Y0) / 2, Z), new THREE.Vector3(fim.x + u.x * 0.16, fim.y + 0.15, Z),
      new THREE.Vector3(fim.x + u.x * 0.12, fim.y + 0.02, Z + 0.15), fim.clone().addScaledVector(u, 0.05).add(new THREE.Vector3(0, 0, -0.25)), fim]
    const pts = catmull(chave, 14)
    for (const p of pts) p.z = Math.max(p.z, chao(p.x, p.y) + r + 0.002)
    const segs = pts.length * 2
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, r, 10, false)
    const mesh = new THREE.Mesh(geo, matCabo()); mesh.castShadow = true; mesh.visible = false; cena.add(mesh)
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
  an.vagas.forEach((v, i) => {
    const chave = v.bomba + ':' + v.saida.map((n) => n.toFixed(3)).join(',')
    const ja = conectores.find((c) => c.chave === chave); if (ja) { ja.vagasNaturais.push(i); return }
    const b = an.bombas[v.bomba]
    conectores.push({ id: conectores.length, chave, bomba: v.bomba, dc: v.ponto === 'dc', saida: V(v.saida), pecas: pecasDe(v.pecas || []),
      lado: v.saida[0] < b.x - 0.05 ? 'esquerda' : v.saida[0] > b.x + 0.05 ? 'direita' : 'centro', vagasNaturais: [i], uso: null })
  })
  const vagas = an.vagas.map((vg, i) => {
    const dc = vg.ponto === 'dc'
    const lado = vg.lado                                         // tomada do lado do carro virado para a bomba
    const pLocal = new THREE.Vector3(lado > 0 ? porta0.x : -porta0.x, porta0.y, porta0.z)
    const nLocal = new THREE.Vector3(lado > 0 ? n0.x : -n0.x, n0.y, 0)
    const pos = new THREE.Vector3(vg.x, vg.ycarro, Z)
    const porta = pos.clone().add(pLocal)
    const carro = novoCarro(CORES_CARROS[i % CORES_CARROS.length])
    // um par pistola + cabo para cada conector da bomba desta vaga (o motorista usa o conector que quiser)
    const pares = {}
    for (const c of conectores.filter((c) => c.bomba === vg.bomba)) {
      const pist = novaPistola(porta, nLocal, c.dc ? 1 : 0.85)
      pares[c.id] = { pist, cabo: novoCabo(c.saida, pist, c.dc ? 0.022 : 0.016) }
    }
    const natural = conectores.find((c) => c.vagasNaturais.includes(i)).id
    const { pist, cabo } = pares[natural]
    const anel = new THREE.Mesh(new THREE.PlaneGeometry(an.BAY_W - 0.12, an.BAY_D - 0.12), new THREE.MeshBasicMaterial({ map: texAnel, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 }))
    anel.position.set(vg.x, (an.Y_BOCA + an.Y_CAB) / 2, Z + 0.012); anel.renderOrder = 0; cena.add(anel)
    const modelo = an.bombas[vg.bomba].modelo
    return { i, dc, nome: vg.nome, bomba: vg.bomba, pares, natural, con: null, ficar: false, pos, carro, pist, cabo, anel, estado: 'vazia', t: 0,
      pct: 18 + 30 * (i % 2), kw: POT[modelo][dc ? 'dc' : 'ac'], sel: null }
  })

  // ---------------------------------------------------------- alarme da bomba: brilho vermelho no chão, em volta da base
  const NOME_BOMBA = { fast: 'Mobi Fast', ultra: 'Mobi Ultra Fast', mobi: 'Mobi' }
  const bombas = an.bombas.map((b, bi) => {
    const alarme = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.7), new THREE.MeshBasicMaterial({ map: texGlow, color: '#FF3B2E', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }))
    alarme.position.set(b.base[0], b.base[1] - 0.25, b.base[2] + 0.006); cena.add(alarme)
    const luz = new THREE.PointLight('#FF3B2E', 0, 4, 2); luz.position.set(b.base[0], b.base[1] - 0.7, b.base[2] + 1.2); cena.add(luz)
    return { bi, modelo: b.modelo, nome: NOME_BOMBA[b.modelo] + (an.bombas.length > 1 ? ' ' + (bi + 1) : ''), topo: V(b.topo), x: b.x, y: b.y, alarme, luz, falha: false, sel: null }
  })

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
    for (const [q, arr] of [[quadFundo, fundos], [quadTeto, tetos]]) { q.material.uniforms.tA.value = arr[a]; q.material.uniforms.tB.value = arr[b]; q.material.uniforms.t.value = t }
    const A = luzesP[a], B = luzesP[b]
    const exp = lerp(A.exposicao, B.exposicao, t)
    renderer.toneMappingExposure = Math.pow(2, exp)
    cena.environment = envs[t < 0.5 ? a : b] || null
    cena.environmentIntensity = Math.pow(2, -exp)               // a panorâmica já veio com a exposição do período
    const solA = A.luzes.find((L) => L.nome === 'sol'), solB = B.luzes.find((L) => L.nome === 'sol')
    const dir = V(solA.dir).lerp(V(solB.dir), t).normalize()
    sol.position.set(0, 2, 0).addScaledVector(dir, -25); sol.target.position.set(0, 2, 0)
    sol.color.setRGB(...solA.cor).lerp(new THREE.Color().setRGB(...solB.cor), t)
    sol.userData.forca = lerp(solA.energia, solB.energia, t)
    solo.material.opacity = lerp(A.look === 'noite' ? 0.0 : 0.32, B.look === 'noite' ? 0.0 : 0.32, t) + (a === 'por' || b === 'por' ? 0.06 : 0)
    for (const [nome, l] of Object.entries(luzesCena)) {
      const la = A.luzes.find((L) => L.nome === nome), lb = B.luzes.find((L) => L.nome === nome)
      l.intensity = lerp(la ? forcaLuz(la) : 0, lb ? forcaLuz(lb) : 0, t)
      if (!la && !lb) continue                                  // luz que não existe nos dois períodos fica apagada (sem recompilar)
      const ca = la ? la.cor : lb.cor, cb = lb ? lb.cor : la.cor
      l.color.setRGB(lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t))
    }
    const noiteP = lerp(A.look === 'noite' ? 1 : 0, B.look === 'noite' ? 1 : 0, t), noite = Math.max(noiteP, 0.55 * chuva.k)   // na chuva os faróis acendem
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
    uc.tA.value = fundos[a]; uc.tB.value = fundos[b]; uc.tMix.value = t; uc.noite.value = noiteP
    faceTotem.material.color.setScalar(lerp(0.92, 1.0, noite))
  }

  // ---------------------------------------------------------- estados das vagas
  const D_CHEGADA = 2.9, D_SAIDA = 3.6, T_CHEGA = 3.2, T_CONECTA = 1.5, T_DESCONECTA = 1.0, T_SAI = 4.2
  function muda(vg, estado) { vg.estado = estado; vg.t = 0; avisa(vg) }
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
      vg.pct = 12 + ((vg.i * 37 + proximaCor * 23) % 40)
      muda(vg, 'chegando'); vg.carro.raiz.visible = true
    }
    if (acao === 'sair' && ['carregando', 'falha'].includes(vg.estado)) { if (opc.ficar != null) vg.ficar = !!opc.ficar; muda(vg, 'desconectando') }
    else if (acao === 'sair' && vg.estado === 'concluido') muda(vg, 'saindo')
    return true
  }
  function setFalha(on, bi) {
    for (const b of bombas) if (bi === undefined || b.bi === bi) b.falha = on
    for (const vg of vagas) {
      const f = bombas[vg.bomba].falha
      if (f && vg.estado === 'carregando') muda(vg, 'falha'); else if (!f && vg.estado === 'falha') muda(vg, 'carregando')
    }
  }
  function pecasRepouso(vg, visivel) { const c = conectores[vg.con]; if (c) for (const o of c.pecas) o.visible = visivel }
  function liberaConector(vg) { const c = conectores[vg.con]; if (c && c.uso === vg.i) c.uso = null }

  function atualizaVaga(vg, dt, tempo) {
    vg.t += dt
    const c = vg.carro, sobTeto = (y) => 1 - 0.35 * suave(clamp01((y - (an.Y_BOCA - 0.8)) / 2.6))
    let y = vg.pos.y, a = 1, giro = 0
    if (vg.estado === 'chegando') {
      const k = clamp01(vg.t / T_CHEGA), e = easeOut(k)
      y = vg.pos.y - D_CHEGADA * (1 - e); a = suave(clamp01(k / 0.2)); giro = D_CHEGADA * (e - easeOut(clamp01((vg.t - dt) / T_CHEGA)))
      if (k >= 1) { muda(vg, 'conectando'); pecasRepouso(vg, false) }
    } else if (vg.estado === 'saindo') {
      const k = clamp01(vg.t / T_SAI), e = easeInOut(k)
      y = vg.pos.y - D_SAIDA * e; a = 1 - suave(clamp01((k - 0.8) / 0.2)); giro = -D_SAIDA * (e - easeInOut(clamp01((vg.t - dt) / T_SAI)))
      if (k >= 1) { muda(vg, 'vazia'); c.raiz.visible = false; liberaConector(vg); vg.con = null }
    }
    if (vg.estado === 'vazia') { c.raiz.visible = false }
    // carro: posição, inclinação na rampa, rodas girando, transparência ao surgir/sumir
    const yf = y + infoCarro.rodas.yf, yr = y + infoCarro.rodas.yr
    const zf = chaoPatio(yf), zr = chaoPatio(yr)
    c.raiz.position.set(vg.pos.x, y, (zf + zr) / 2)
    c.raiz.rotation.set(Math.atan2(zf - zr, yf - yr), 0, 0)
    c.sombra.position.z = Z - (zf + zr) / 2 + 0.004
    c.giro += giro / infoCarro.rodas.raio
    for (const r of c.rodas) {
      const q = new THREE.Quaternion().setFromAxisAngle(r.eixo === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1), -c.giro * r.sinal)
      r.o.quaternion.copy(r.q0).multiply(q)
    }
    if (c.raiz.visible) opacidadeCarro(c, a)
    // ré: a luz traseira acende forte do fim da desconexão até o carro sumir. De dia o brilho aditivo some sobre o
    // carro branco, então o halo vira uma névoa vermelha normal; à noite ele soma luz
    const reAlvo = vg.estado === 'saindo' || (vg.estado === 'desconectando' && vg.t > T_DESCONECTA * 0.6) ? 1 : 0
    c.re = lerp(c.re, reAlvo, Math.min(1, dt * 7))
    const lb = c.luzes.base || { lanterna: 3, halo: 0, noite: 0 }
    c.luzes.lanterna.forEach((m2) => (m2.emissiveIntensity = lb.lanterna * (1 + 1.2 * c.re) + 3 * c.re))   // forte demais o vermelho vira rosa
    const hm = c.luzes.halo.material, dia = lb.noite < 0.5, bl = dia ? THREE.NormalBlending : THREE.AdditiveBlending
    if (hm.blending !== bl) { hm.blending = bl; hm.needsUpdate = true }
    hm.opacity = (dia ? 0.8 * c.re : Math.max(lb.halo, 0.95 * c.re)) * a
    c.raiz.userData.sol = sobTeto(y)
    // cabo e pistola
    let f = 0
    if (vg.estado === 'conectando') { f = easeInOut(clamp01(vg.t / T_CONECTA)); if (vg.t >= T_CONECTA) muda(vg, bombas[vg.bomba].falha ? 'falha' : 'carregando') }
    else if (['carregando', 'falha'].includes(vg.estado)) f = 1
    else if (vg.estado === 'desconectando') { f = 1 - easeInOut(clamp01(vg.t / T_DESCONECTA)); if (vg.t >= T_DESCONECTA) { pecasRepouso(vg, true); liberaConector(vg); muda(vg, vg.ficar ? 'concluido' : 'saindo') } }
    crescer(vg.cabo, f); vg.pist.g.visible = f > 0.92
    const mu = vg.cabo.mesh.material.userData.u
    mu.uTempo.value = tempo; mu.uPulso.value = vg.estado === 'carregando' ? 1 : 0; mu.uCor.value.set('#3DFF6A')
    // anel da vaga
    // realce: o painel acende o anel do ponto (passar o mouse no card ou no feed)
    const corAnel = vg.estado === 'carregando' ? CORES.carregando : vg.estado === 'falha' ? CORES.falha : vg.estado === 'concluido' && !vg.realce ? '#F5B54A' : (vg.realce ? CORES.carregando : CORES.conectando)
    const alvoA = { carregando: 0.75 + 0.25 * Math.sin(tempo * 2.4), falha: 0.9 + 0.1 * Math.sin(tempo * 6), conectando: 0.55, chegando: 0.35 * suave(clamp01(vg.t / T_CHEGA)), desconectando: 0.35, concluido: 0.45, saindo: 0.0, vazia: 0 }[vg.estado] + (vg.realce ? 0.45 + 0.15 * Math.sin(tempo * 4) : 0)
    // verde soma luz (brilho); vermelho sobre a vaga verde precisa cobrir, senão vira amarelo
    const blend = vg.estado === 'falha' ? THREE.NormalBlending : THREE.AdditiveBlending
    if (vg.anel.material.blending !== blend) { vg.anel.material.blending = blend; vg.anel.material.map = vg.estado === 'falha' ? texAnelFalha : texAnel; vg.anel.material.needsUpdate = true }
    vg.anel.material.color.set(corAnel); vg.anel.material.opacity = lerp(vg.anel.material.opacity, alvoA, Math.min(1, dt * 6))
    if (vg.estado === 'carregando') vg.pct = Math.min(100, vg.pct + dt * 0.9)
  }

  // ---------------------------------------------------------- selos: projeta pontos 3D na tela
  const proj = new THREE.Vector3()
  function telaSelo(div, p, on) {
    proj.copy(p).project(cam)
    if (div.dataset.mw == null || div.dataset.mh !== div.dataset.h) { div.dataset.mw = div.offsetWidth; div.dataset.mh = div.dataset.h }   // mede só quando o texto muda
    return { div, on, x: (proj.x * 0.5 + 0.5) * cnv.w, y: (-proj.y * 0.5 + 0.5) * cnv.h, w: Number(div.dataset.mw), h: div.offsetHeight || 32, sobe: 0 }
  }
  // selos que se cruzam: o da frente (mais embaixo na tela) fica; o de trás sobe e a haste estica até o carro
  function arrumaSelos(itens) {
    const vis = itens.filter((i) => i.on).sort((a, b) => b.y - a.y)
    for (let i = 1; i < vis.length; i++) for (let j = 0; j < i; j++) {
      const a = vis[i], b = vis[j], folga = 6
      const baseA = a.y - a.sobe, topoB = b.y - b.sobe - b.h
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 + folga && baseA > topoB - folga && baseA - a.h < b.y - b.sobe) a.sobe += baseA - (topoB - folga)
    }
    for (const it of itens) {
      it.div.style.transform = `translate(${it.x}px, ${it.y - it.sobe}px) translate(-50%, -100%)`
      it.div.style.setProperty('--haste', `${7 + it.sobe}px`)
      it.div.classList.toggle('on', it.on)
    }
  }
  const ICONE_RAIO = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M8 1 3 8h3.5L6 13l5-7H7.5Z" fill="currentColor"/></svg>'
  const ICONE_ALERTA = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 15 14H1Z" fill="currentColor"/><path d="M8 6v4" stroke="#200" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="12" r=".9" fill="#200"/></svg>'
  function seloPessoa(vg, ps) {
    const tipo = vg.con != null ? (conectores[vg.con].dc ? 'CCS2' : 'Tipo 2') : ''
    const linha = vg.estado === 'falha' ? `${tipo} · Interrompida` : vg.estado === 'conectando' ? `${tipo} · Conectando` : vg.estado === 'concluido' ? 'Terminou · ainda na vaga' : `${tipo} · ${vg.kw} kW${vg.aviso ? ` <em class="mv-aviso">${vg.aviso}</em>` : ''}`
    const anel = vg.dc && vg.estado === 'carregando' ? `<i class="mv-pct" style="--p:${vg.pct.toFixed(0)}">${vg.pct.toFixed(0)}%</i>` : ''
    return `<b class="mv-av">${ps.iniciais}</b><span class="mv-tx"><b>${ps.nome}</b><small>${linha}</small></span>${anel}`
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
          : vg.dc ? `<b class="mv-ic">${ICONE_RAIO}</b><span>${vg.nome} · ${vg.kw} kW</span><i class="mv-pct" style="--p:${vg.pct.toFixed(0)}">${vg.pct.toFixed(0)}%</i>`
          : `<b class="mv-ic">${ICONE_RAIO}</b><span>${vg.nome} · ${vg.kw} kW</span>`                       // AC não informa a bateria
        if (vg.sel.dataset.h !== html) { vg.sel.innerHTML = html; vg.sel.dataset.h = html }
        vg.sel.classList.toggle('falha', vg.estado === 'falha'); vg.sel.classList.toggle('pessoa', !!ps)
      }
      itens.push(telaSelo(vg.sel, vg.carro.raiz.position.clone().add(new THREE.Vector3(0, 0.2, 2.15)), on))
      itens.push(telaSelo(vg.info, new THREE.Vector3(vg.pos.x, vg.pos.y, chao(vg.pos.x, vg.pos.y) + 0.35), tempo < vg.infoAte))
    }
    for (const b of bombas) {
      const emFoco = foco > 0.6 && bombaFoco === b.bi && zoom.k > 1.35
      const htmlB = b.falha ? `<b class="mv-ic mv-ic-falha">${ICONE_ALERTA}</b><span>${b.nome} · Falha de comunicação</span><em class="mv-link">Ver detalhes</em>`
        : `<b class="mv-ic">${ICONE_BOMBA}</b><span>${b.nome} · Online</span><em class="mv-link">Ver detalhes</em>`
      if (b.sel.dataset.h !== htmlB) { b.sel.innerHTML = htmlB; b.sel.dataset.h = htmlB }
      b.sel.classList.toggle('falha', b.falha); b.sel.classList.toggle('clicavel', b.falha || emFoco)
      itens.push(telaSelo(b.sel, b.topo, b.falha || emFoco))
    }
    arrumaSelos(itens)
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
  function calculaAlvoZoom() { const b = bombas[bombaFoco]; const p = new THREE.Vector3(b.x + 0.35, b.y - 0.9, Z + 0.9).project(cam); zoomAlvo.u = lerp(jan.U0, jan.U1, p.x * 0.5 + 0.5); zoomAlvo.v = lerp(jan.V0, jan.V1, p.y * 0.5 + 0.5) }
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
      const w = 1 / zoom.k                                       // 1 px de arrasto = w / largura do quadro, em frações
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
      if (Math.abs(alvoChao.x - vg.pos.x) < an.BAY_W / 2 && Math.abs(alvoChao.y - vg.pos.y) < an.BAY_D / 2) return vg
    }
    return null
  }
  const solta = (e) => {
    if (clique0 && e.type === 'pointerup' && Math.hypot(e.clientX - clique0.x, e.clientY - clique0.y) < 6 && performance.now() - clique0.t < 600) {
      const vg = vagaNoPonto(e.clientX, e.clientY)
      if (vg) el.dispatchEvent(new CustomEvent('mv-vaga', { detail: { vaga: vg.i, estado: vg.estado } }))
    }
    clique0 = null
    toques.delete(e.pointerId); if (toques.size < 2) dist0 = 0; if (!toques.size) arrasto = null; atualizaCursor()
  }
  el.addEventListener('pointerup', solta); el.addEventListener('pointercancel', solta)
  el.addEventListener('dblclick', () => { zoom.alvo = 1; focoAlvo = 0; pan.u = pan.v = 0; atualizaCursor() })
  el.style.userSelect = 'none'
  atualizaCursor()
  function quadro(dt) {
    tempo += dt
    zoom.k = lerp(zoom.k, zoom.alvo, Math.min(1, dt * 3.2))
    foco = lerp(foco, focoAlvo, Math.min(1, dt * 3.2))
    const kz = clamp01((zoom.k - 1) / 1.2), w = 1 / zoom.k
    const bu = lerp(0.5, zoomAlvo.u, kz * foco), bv = lerp(0.5, zoomAlvo.v, kz * foco)
    // o arrasto para na borda do render (sem acumular além dela) e some ao afastar
    if (w >= 1) { pan.u = 0; pan.v = 0 } else { pan.u = clamp(bu + pan.u, w / 2, 1 - w / 2) - bu; pan.v = clamp(bv + pan.v, w / 2, 1 - w / 2) - bv }
    zoom.u = bu + pan.u; zoom.v = bv + pan.v
    aplicaZoom()
    quadTeto.material.uniforms.opac.value = 1 - 0.88 * suave(clamp01((zoom.k - 1.15) / 0.8))   // ao aproximar, o teto quase some
    for (const vg of vagas) atualizaVaga(vg, dt, tempo)
    for (const b of bombas) { const alvo = b.falha ? 0.55 + 0.45 * Math.sin(tempo * 5.5) : 0; b.alarme.material.opacity = lerp(b.alarme.material.opacity, alvo * 0.9, Math.min(1, dt * 8)); b.luz.intensity = b.alarme.material.opacity * 6 }
    const somb = vagas.reduce((m2, vg) => Math.min(m2, vg.carro.raiz.visible ? vg.carro.raiz.userData.sol ?? 1 : 1), 1)
    sol.intensity = (sol.userData.forca || 0) * somb
    renderer.clear()
    renderer.render(cenaFundo, telaCam)
    renderer.clearDepth()
    renderer.render(cena, cam)
    renderer.render(cenaTeto, telaCam)
    // chuva: transição suave ao ligar e desligar; a luz acompanha
    let mudouClima = false
    for (const c of [chuva, nuvem]) if (Math.abs(c.k - c.alvo) > 0.001) { c.k = lerp(c.k, c.alvo, Math.min(1, dt * 1.6)); if (Math.abs(c.k - c.alvo) < 0.002) c.k = c.alvo; mudouClima = true }
    if (mudouClima) aplicaHora()
    if (chuva.k > 0.002) {
      const uc = quadChuva.material.uniforms
      uc.uT.value = tempo; uc.uK.value = chuva.k; uc.uDpr.value = renderer.getPixelRatio(); uc.aspecto.value = ASPECTO
      renderer.render(cenaChuva, telaCam)
    }
    atualizaSelos()
  }
  function laco(agora) {
    const dt = Math.min(0.1, (agora - ultimo) / 1000); ultimo = agora          // aparelho lento (10 qps) ainda anda no tempo real
    quadro(dt); if (!opcoes.captura) requestAnimationFrame(laco)
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
    aplicaZoom()
  }
  new ResizeObserver(tamanho).observe(el); tamanho()
  aplicaHora(); aplicaZoom(); cam.updateMatrixWorld(); calculaAlvoZoom()
  if (!opcoes.captura) requestAnimationFrame(laco)

  return {
    posto: an.posto,
    quadroImagem: () => ({ ...img }),
    _carro: (i) => vagas[i].carro,
    _telaDaVaga: (i) => { const p = vagas[i].pos.clone(); p.z = chao(p.x, p.y); p.project(cam); const r = el.getBoundingClientRect(); return { x: r.left + (p.x * 0.5 + 0.5) * cnv.w, y: r.top + (-p.y * 0.5 + 0.5) * cnv.h } },   // testes                              // só para inspeção (testes)                          // onde o render cai dentro do elemento (px), sem zoom
    vagas: vagas.map((v) => ({ nome: v.nome, dc: v.dc, bomba: v.bomba, kw: v.kw, natural: v.natural })),
    // conectores: um por saída de cabo; vagasNaturais = as vagas que ficam de frente para ele
    conectores: conectores.map((c) => ({ id: c.id, bomba: c.bomba, dc: c.dc, lado: c.lado, vagasNaturais: [...c.vagasNaturais] })),
    conectorDa: (i) => vagas[i].con,
    conectorLivre: (i) => { const c = livreNaBomba(vagas[i]); return c ? c.id : null },
    bombas: bombas.map((b) => ({ nome: b.nome, modelo: b.modelo })),
    estado: (i) => vagas[i].estado,
    falha: (bi) => bombas[bi].falha,
    evento, setFalha,
    // dados que o painel manda para o selo (potência e carga do carro)
    setDados(i, d) { const vg = vagas[i]; if (d.kw != null) vg.kw = d.kw; if (d.pct != null) vg.pct = d.pct; if (d.pessoa !== undefined) vg.pessoa = d.pessoa; if (d.aviso !== undefined) vg.aviso = d.aviso },   // pessoa: { nome, iniciais } ou null
    getDados: (i) => ({ kw: vagas[i].kw, pct: vagas[i].pct }),
    setRealce(i) { for (const vg of vagas) vg.realce = vg.i === i },
    // selo de informação sobre a vaga (html), por alguns segundos
    mostrarVaga(i, html, seg = 5) { const vg = vagas[i]; if (vg.info.dataset.h !== html) { vg.info.innerHTML = html; vg.info.dataset.h = html } vg.infoAte = tempo + seg },
    ouvir(f) { ouvintes.push(f) },
    setHora(h) { hora = h; aplicaHora() },
    // tempo chuvoso: on = true/false (transição de ~2 s); imediato = sem transição
    setChuva(on, imediato) { chuva.alvo = on ? 1 : 0; nuvem.alvo = on ? 1 : nuvem.alvo; if (imediato) { chuva.k = chuva.alvo; nuvem.k = nuvem.alvo; aplicaHora() } },
    getChuva: () => chuva.alvo > 0.5,
    // clima de verdade: nuvens e chuva de 0 a 1 (garoa ~0,35, chuva forte 1)
    setClima({ nuvens = 0, chuva: ch = 0 } = {}, imediato) { nuvem.alvo = clamp01(nuvens); chuva.alvo = clamp01(ch); if (imediato) { nuvem.k = nuvem.alvo; chuva.k = chuva.alvo; aplicaHora() } },
    getHora: () => hora,
    setPreco(v) { preco = v; desenhaTotem(telaTotem, preco, logoBranco, linhasTotem); texTotem.needsUpdate = true },
    setZoom(on, bi = 0) { bombaFoco = bi; calculaAlvoZoom(); focoAlvo = on ? 1 : 0; zoom.alvo = on ? 2.0 : 1; pan.u = pan.v = 0; atualizaCursor() },
    setZoomNivel(k) { zoom.alvo = limita(Math.abs(k - 1) < 0.08 ? 1 : k); if (zoom.alvo < 1.05) focoAlvo = 0; atualizaCursor() },   // perto de 100% encaixa em 100%
    zoomLimites: { min: ZOOM_MIN, max: ZOOM_MAX },
    getZoom: () => zoom.alvo,
    // modo de captura (vídeo): avança o tempo em passos fixos e desenha
    avancar(dt, passos = 1) { for (let i = 0; i < passos; i++) quadro(dt) },
    canvas: renderer.domElement,
  }
}
