// "Deixe seu posto pronto" (9/11, pedido do Sergio: o job to be done depois de criar o posto). O posto sai do construtor
// com a parte física pronta (bombas, conectores, vagas), mas só funciona de verdade com algumas decisões do dono, como o
// workspace de um CRM que só serve depois do mínimo configurado. Aqui ficam:
//   - os 4 itens obrigatórios (preço do kWh, onde receber, horário e acesso, como aparece no app) e 3 opcionais;
//   - o fluxo guiado (um diálogo com os passos; cada um dá para pular), que abre sozinho logo depois de criar o posto;
//   - o card flutuante das pendências no palco (recolhe numa pílula), para quem escolheu "Configurar depois";
//   - o selo de cada posto nas listas ("Configurado" ou "Falta configurar · N").
// Protótipo: os dados ficam neste navegador (localStorage), por cima do que o cadastro diz (`config` do posto em
// postos.json; um posto sem `config` é um posto já em operação, configurado). Em produção, isso é do backend.

export const ITENS = [
  { k: 'preco', t: 'Preço do kWh', d: 'Quanto o motorista paga por kWh carregado.' },
  { k: 'receber', t: 'Onde receber', d: 'A chave Pix da sua parte das recargas.' },
  { k: 'horario', t: 'Horário e acesso', d: 'Quando o posto abre e como chegar às bombas.' },
  { k: 'app', t: 'Como aparece no app', d: 'O nome, a foto e o endereço que o motorista vê.' },
]
export const EXTRAS = [
  { k: 'avisos', t: 'Como avisar você', d: 'App, WhatsApp ou e-mail, e o que merece aviso.' },
  { k: 'qr', t: 'Adesivo com o QR do posto', d: 'Para colar na bomba: quem chega se cadastra pelo seu QR.' },
  { k: 'equipe', t: 'Alguém da equipe', d: 'Um gerente ou funcionário que também acompanha o painel.' },
]
const IC = {
  preco: '<path d="M10 2.6v14.8M13.4 5.6c-.7-1-2-1.6-3.4-1.6-2 0-3.4 1-3.4 2.6 0 3.6 7 2 7 5.6 0 1.6-1.6 2.8-3.6 2.8-1.6 0-3-.7-3.7-1.8" />',
  receber: '<rect x="2.6" y="5" width="14.8" height="10" rx="2"/><path d="M2.6 8.4h14.8M5.6 12h3"/>',
  horario: '<circle cx="10" cy="10" r="7.2"/><path d="M10 6v4l2.6 1.8"/>',
  app: '<rect x="6" y="2.6" width="8" height="14.8" rx="1.8"/><path d="M9 14.8h2"/>',
  avisos: '<path d="M5.4 13.4V9.2a4.6 4.6 0 0 1 9.2 0v4.2l1.4 1.6H4ZM8.4 17.2a1.8 1.8 0 0 0 3.2 0"/>',
  qr: '<rect x="3" y="3" width="5.4" height="5.4" rx=".8"/><rect x="11.6" y="3" width="5.4" height="5.4" rx=".8"/><rect x="3" y="11.6" width="5.4" height="5.4" rx=".8"/><path d="M11.6 11.6h2v2M17 11.6v2M11.6 17h5.4v-1.4"/>',
  equipe: '<circle cx="7.6" cy="7" r="2.8"/><path d="M2.6 16.4c.6-2.8 2.6-4.2 5-4.2s4.4 1.4 5 4.2M13.4 4.6a2.6 2.6 0 0 1 0 4.8M14.8 12.4c1.4.5 2.4 1.8 2.6 4"/>',
  ok: '<path d="m5 10.4 3.2 3.2L15 6.6"/>',
  mapa: '<path d="M10 17.4s5.4-4.8 5.4-9a5.4 5.4 0 0 0-10.8 0c0 4.2 5.4 9 5.4 9Z"/><circle cx="10" cy="8.4" r="2"/>',
  bomba: '<rect x="4.6" y="2.6" width="7.4" height="14.8" rx="1.4"/><path d="M6.8 5.6h3M12 7.4h1.6a1.4 1.4 0 0 1 1.4 1.4v4.4a1.2 1.2 0 0 0 2.4 0V7.6l-2-2"/>',
}
const ico = (k, cls = '') => `<svg class="pp-ic ${cls}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>`
const ICON_X = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const hh = (h) => `${String(h % 24).padStart(2, '0')}h`

// ---------------------------------------------------------------- estado de cada posto
const CHAVE = (id) => `posto-pronto-v1-${id}`
// posto sem `config` no cadastro: já opera, com tudo configurado (dados de exemplo)
const EM_OPERACAO = { preco: { exemplo: true }, receber: { exemplo: true }, horario: { exemplo: true, h24: true }, app: { exemplo: true } }
function local(id) { try { return JSON.parse(localStorage.getItem(CHAVE(id)) || '{}') } catch { return {} } }
function grava(id, c) { try { localStorage.setItem(CHAVE(id), JSON.stringify(c)) } catch {} }
export function config(posto) { return { ...(posto.config === undefined ? EM_OPERACAO : posto.config), ...local(posto.id) } }
export function estado(posto) {
  const c = config(posto), faltam = ITENS.filter((i) => !c[i.k])
  return { c, faltam, feitos: ITENS.length - faltam.length, total: ITENS.length, pronto: !faltam.length }
}
function marca(posto, k, v) { const c = local(posto.id); c[k] = v; grava(posto.id, c); ouvintes.forEach((f) => f(posto.id)) }
const ouvintes = new Set()
export const aoMudar = (f) => ouvintes.add(f)
// o selo das listas: "Configurado" ou "Falta configurar · N"
export function selo(posto) {
  const e = estado(posto)
  return e.pronto ? `<span class="pp-selo ok">${ico('ok')}Configurado</span>`
    : `<span class="pp-selo falta" title="Falta: ${e.faltam.map((i) => i.t.toLowerCase()).join(', ')}"><i></i>Falta configurar · ${e.faltam.length}</span>`
}

// ---------------------------------------------------------------- estilo (o mesmo nas páginas que usam)
const CSS = `
.pp-selo{display:inline-flex;align-items:center;gap:5px;width:fit-content;margin-top:4px;padding:1px 9px 1px 7px;border-radius:999px;font-size:12px;font-weight:500;line-height:1.6;white-space:nowrap}
.pp-selo.ok{color:var(--green-ink);background:var(--green-soft);border:1px solid var(--green-line)}
.pp-selo.ok .pp-ic{width:12px;height:12px;stroke-width:2}
.pp-selo.falta{color:var(--amber);background:rgba(245,181,74,.1);border:1px solid rgba(245,181,74,.4)}
.pp-selo.falta i{width:6px;height:6px;border-radius:50%;background:var(--amber)}
.pp-ic{width:18px;height:18px;flex:none}
dialog.pp-modal{width:min(900px,calc(100vw - 32px))}
.pp-corpo{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:0;flex:1 1 auto;overflow:hidden}
/* (9/11, 2ª rodada) a coluna dos passos é um progresso: a barra no alto e a linha do tempo (o mesmo desenho do card) */
.pp-lado{padding:20px 16px;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:16px;overflow:auto}
.pp-prog{display:flex;flex-direction:column;gap:8px;padding:0 4px}
.pp-prog span{font-size:12.5px;color:var(--muted)}
.pp-passos{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.pp-passos li{position:relative}
.pp-passos li:not(:last-child)::after{content:"";position:absolute;left:21px;top:33px;bottom:-11px;width:2px;border-radius:2px;background:var(--line-2)}
.pp-passos li.feito:not(:last-child)::after{background:var(--green-line)}
.pp-passos button{display:flex;align-items:center;gap:11px;width:100%;padding:9px 10px;border-radius:10px;text-align:left;font-size:13.5px;color:var(--muted)}
.pp-passos button:hover{background:var(--surface-2);color:var(--text)}
.pp-passos button[aria-current="step"]{background:var(--surface-2);color:var(--text);font-weight:500}
.pp-passos .mk{position:relative;z-index:1;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;border:2px solid var(--line-2);background:var(--modal);font-size:11.5px;font-weight:500;flex:none;color:var(--muted)}
.pp-passos .mk .pp-ic{width:13px;height:13px}
.pp-passos .feito .mk{border-color:transparent;background:var(--green-soft);color:var(--green-ink)}
.pp-passos .feito .mk .pp-ic{stroke-width:2.6}
.pp-passos .proximo .mk{border-color:var(--amber);color:var(--amber)}
.pp-passos .geral .mk,.pp-passos .fim .mk{border-style:dashed}
.pp-passos .fim.feito .mk{border-style:solid}
/* o atalho de cada passo: onde fica a configuração completa no painel, para a pessoa se situar */
.pp-onde{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;border:1px dashed var(--line-2)}
.pp-onde > .pp-ic{color:var(--muted)}
.pp-onde .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.pp-onde .tx b{font-size:13px;font-weight:500;color:var(--muted)}
.pp-onde .trilha{display:flex;flex-wrap:wrap;align-items:center;gap:4px;font-size:13px}
.pp-onde .trilha span{padding:1px 8px;border-radius:7px;background:var(--surface-2);border:1px solid var(--line);color:var(--text);white-space:nowrap}
.pp-onde .trilha i{font-style:normal;color:var(--dim)}
.pp-onde small{font-size:12.5px;color:var(--dim);line-height:1.4}
.pp-onde .btn{flex:none}
.pp-tela{padding:24px 28px 28px;overflow:auto;display:flex;flex-direction:column;gap:18px;min-width:0}
.pp-tela h3.pp-t{font-size:20px;font-weight:500;letter-spacing:-.01em;color:var(--text);margin:0}
.pp-tela h3.pp-t:focus{outline:none}
.pp-tela .pp-sub{font-size:14px;color:var(--muted);line-height:1.5;margin-top:-10px}
.pp-lista{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.pp-lista li{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:var(--surface)}
.pp-lista li .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.pp-lista li .tx b{font-size:14.5px;font-weight:500}
.pp-lista li .tx small{font-size:13px;color:var(--muted);line-height:1.4}
.pp-lista li > .pp-ic{color:var(--muted)}
.pp-lista li.feito > .pp-ic{color:var(--green-ink)}
.pp-lista .pp-st{font-size:12.5px;color:var(--dim);white-space:nowrap}
.pp-lista li.feito .pp-st{color:var(--green-ink)}
.pp-lista li.auto{background:none;border-style:dashed}
.pp-lista button.pp-ir{font-size:13px;color:var(--green-ink);white-space:nowrap}
.pp-campo{display:flex;flex-direction:column;gap:6px}
.pp-campo > span{font-size:13px;color:var(--muted)}
.pp-campo input[type=text],.pp-campo input[type=email],.pp-campo select,.pp-campo textarea{height:44px;padding:0 13px;border:1px solid var(--line-2);border-radius:12px;background:var(--surface-2);color:var(--text);font:inherit;font-size:16px;outline:none;width:100%}
.pp-campo textarea{height:auto;min-height:76px;padding:10px 13px;resize:vertical;line-height:1.45}
.pp-campo select{appearance:auto}
.pp-campo input:focus,.pp-campo select:focus,.pp-campo textarea:focus{border-color:var(--green-line);box-shadow:0 0 0 3px var(--green-soft)}
.pp-campo small{font-size:12.5px;color:var(--dim)}
.pp-campo small.erro{color:var(--red)}
.pp-duas{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.pp-seg{display:flex;flex-wrap:wrap;gap:6px}
.pp-seg button{padding:7px 12px;border-radius:999px;border:1px solid var(--line-2);font-size:13.5px;color:var(--muted)}
.pp-seg button[aria-pressed="true"]{border-color:var(--green-line);background:var(--green-soft);color:var(--green-ink)}
.pp-nota{font-size:13px;color:var(--muted);line-height:1.5;padding:12px 14px;border-radius:12px;background:var(--surface-2)}
.pp-nota b{color:var(--text);font-weight:500}
.pp-preco{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.pp-preco .campo-valor input{width:4.2ch}
.pp-hora{display:grid;grid-template-columns:130px 1fr 1fr;gap:10px;align-items:center}
.pp-hora > b{font-size:14px;font-weight:500}
.pp-linha{display:flex;align-items:center;gap:12px}
.pp-linha .tx{flex:1;display:flex;flex-direction:column}
.pp-linha .tx b{font-size:14px;font-weight:500}
.pp-linha .tx small{font-size:12.5px;color:var(--muted)}
.pp-app{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:22px;align-items:start}
.pp-fotos{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.pp-fotos button{display:flex;flex-direction:column;gap:6px;padding:6px;border-radius:14px;border:1px solid var(--line);text-align:left;font-size:13px;color:var(--muted)}
.pp-fotos button[aria-pressed="true"]{border-color:var(--green-line);background:var(--green-soft);color:var(--green-ink)}
.pp-fotos .ft{aspect-ratio:16/10;border-radius:10px;background:#0E1511 center/cover no-repeat;display:grid;place-items:center;color:var(--dim)}
.pp-fotos span.rot{padding:0 4px 2px}
.pp-cel{border-radius:22px;border:1px solid var(--line-2);background:#0B0F0D;padding:10px;box-shadow:0 18px 40px rgba(0,0,0,.4)}
.pp-cel small.cab-cel{display:block;font-size:11.5px;color:var(--dim);padding:2px 4px 8px}
.pp-cel .ft{aspect-ratio:16/10;border-radius:12px;background:#121A15 center/cover no-repeat}
.pp-cel .info{padding:10px 4px 4px;display:flex;flex-direction:column;gap:4px;color:#E8EDE9}
.pp-cel .info b{font-size:15px;font-weight:600}
.pp-cel .info small{font-size:12px;color:#9AA49D;line-height:1.35}
.pp-cel .aberto{color:#7DFF8C}.pp-cel .fechado{color:#FFB15E}
.pp-cel .preco-cel{display:flex;justify-content:space-between;align-items:center;margin-top:6px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08);font-size:12.5px}
.pp-cel .preco-cel b{font-size:14px;color:#7DFF8C}
.pp-feito{display:flex;align-items:center;gap:14px;padding:16px;border-radius:16px;border:1px solid var(--green-line);background:linear-gradient(180deg,rgba(3,255,31,.07),rgba(3,255,31,0) 80%),var(--surface)}
.pp-feito .pp-ic{width:34px;height:34px;padding:7px;border-radius:50%;background:var(--green-soft);color:var(--green-ink);stroke-width:2}
.pp-feito b{display:block;font-size:16px;font-weight:500}
.pp-feito span{font-size:13.5px;color:var(--muted)}
.pp-convite{display:flex;gap:8px;margin-top:8px}
.pp-convite input{flex:1;min-width:0;height:38px;padding:0 12px;border:1px solid var(--line-2);border-radius:10px;background:var(--surface-2);color:var(--text);font:inherit;font-size:16px;outline:none}
.pp-convite input:focus{border-color:var(--green-line)}
.pp-pe-passo{font-size:13px;color:var(--muted)}
/* (9/11, 2ª rodada do Sergio) o card das pendências flutua fixo no canto inferior esquerdo da tela, fora do palco: vale
   em qualquer tela. Sem borda colorida (a barra de progresso já diz o estado); a lista é uma linha do tempo com os 4
   itens, os feitos e os que faltam, alinhada à barra */
.pp-card{position:fixed;left:24px;bottom:24px;z-index:60;width:320px;padding:16px 16px 10px;border-radius:18px;border:1px solid var(--line-2);background:var(--vidro-solido);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 24px 60px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:12px;animation:pp-sobe .35s ease-out both}
@keyframes pp-sobe{from{opacity:0;transform:translateY(10px)}}
.pp-card .pp-c-cab{display:flex;align-items:flex-start;gap:10px}
.pp-card .pp-c-cab .tx{flex:1;min-width:0}
.pp-card .pp-c-cab b{display:block;font-size:15px;font-weight:500;letter-spacing:-.005em}
.pp-card .pp-c-cab small{display:block;margin-top:2px;font-size:12.5px;color:var(--muted)}
.pp-card .pp-recolhe{display:grid;place-items:center;width:28px;height:28px;margin:-4px -6px 0 0;border-radius:8px;color:var(--muted);flex:none}
.pp-card .pp-recolhe:hover{background:var(--surface-2);color:var(--text)}
.pp-barra{height:4px;border-radius:999px;background:var(--surface-3);overflow:hidden}
.pp-barra i{display:block;height:100%;border-radius:inherit;background:var(--amber);transition:width .3s}
/* a linha do tempo: o marcador de cada item (feito: verde com o visto; o próximo: âmbar; os outros: só o anel) e o
   traço entre eles. O conteúdo fica na mesma margem da barra; só o fundo do hover sai um pouco para os lados */
.pp-tl{list-style:none;margin:0;padding:0}
.pp-tl li{position:relative}
.pp-tl li:not(:last-child)::after{content:"";position:absolute;left:9px;top:27px;bottom:-7px;width:2px;border-radius:2px;background:var(--line-2)}
.pp-tl li.feito:not(:last-child)::after{background:var(--green-line)}
.pp-tl button{display:flex;align-items:center;gap:11px;width:calc(100% + 16px);margin:0 -8px;padding:7px 8px;border-radius:10px;text-align:left;font-size:13.5px;color:var(--text)}
.pp-tl button:hover{background:var(--surface-2)}
.pp-tl .mk{position:relative;z-index:1;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;flex:none;border:2px solid var(--line-2);background:var(--modal)}
.pp-tl .feito .mk{border-color:transparent;background:var(--green-soft);color:var(--green-ink)}
.pp-tl .feito .mk .pp-ic{width:12px;height:12px;stroke-width:2.6}
.pp-tl .proximo .mk{border-color:var(--amber)}
.pp-tl .proximo .mk::after{content:"";width:6px;height:6px;border-radius:50%;background:var(--amber)}
.pp-tl .nome{flex:1;min-width:0}
.pp-tl .feito .nome{color:var(--muted)}
.pp-tl em{font-style:normal;font-size:12.5px;color:var(--dim);white-space:nowrap}
.pp-tl .pendente em{color:var(--green-ink)}
.pp-pilula{position:fixed;left:24px;bottom:24px;z-index:60;display:inline-flex;align-items:center;gap:10px;padding:9px 16px 9px 12px;border-radius:999px;border:1px solid var(--line-2);background:var(--vidro-solido);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);font-size:13.5px;box-shadow:0 18px 44px rgba(0,0,0,.5);animation:pp-sobe .3s ease-out both}
.pp-pilula .anel{width:22px;height:22px;flex:none}
.pp-pilula:hover{border-color:var(--amber)}
html.cheio .pp-card,html.cheio .pp-pilula{display:none}
@media (max-width: 760px){
  .pp-corpo{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}
  .pp-lado{padding:12px 18px;border-right:0;border-bottom:1px solid var(--line);overflow:visible}
  .pp-passos{display:none}
  .pp-onde{flex-wrap:wrap}
  .pp-app{grid-template-columns:1fr}
  .pp-cel{max-width:300px}
}
@media (max-width: 560px){
  dialog.pp-modal{width:100vw;max-width:100vw}
  .pp-tela{padding:18px 18px 24px}
  .pp-duas{grid-template-columns:1fr}
  .pp-hora{grid-template-columns:1fr 1fr}
  .pp-hora > b{grid-column:1 / -1}
  .pp-card{left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));width:auto}
  .pp-pilula{left:12px;bottom:calc(12px + env(safe-area-inset-bottom))}
}
@media (prefers-reduced-motion: reduce){ .pp-barra i{transition:none} .pp-card,.pp-pilula{animation:none} }
`
function estilo() { if (document.getElementById('pp-css')) return; const s = document.createElement('style'); s.id = 'pp-css'; s.textContent = CSS; document.head.appendChild(s) }
export function prepararEstilo() { estilo() }

// ---------------------------------------------------------------- o fluxo (diálogo) e o card flutuante, no painel
// opcoes: { posto, novo (acabou de criar), aposCarga(f), bombas: () => ({ ok, total }), preco: { atual(), define(v) },
//           abreAvisos(), abrePreco(), abreAba(aba), fotoMaquete }
export function iniciar(op) {
  estilo()
  const { posto } = op
  if (op.novo && posto.config !== undefined) grava(posto.id, {})          // posto recém-criado: começa do zero
  // o preço guardado aqui vale no painel (o painel mostra o preço do posto)
  const c0 = config(posto); if (c0.preco && c0.preco.base && Math.abs(c0.preco.base - op.preco.atual()) > 0.001) op.preco.define(c0.preco.base, false)
  let tela = 'inicio', dlg = null, rasc = {}
  const PASSOS = ['inicio', ...ITENS.map((i) => i.k), 'fim']

  // ------------------------------------------------ o card flutuante
  // (9/11, 2ª rodada) fixo no canto inferior esquerdo da tela (fora do palco); a lista é a linha do tempo dos 4 itens
  function desenhaCard() {
    for (const el of document.querySelectorAll('.pp-card,.pp-pilula')) el.remove()
    const e = estado(posto)
    if (e.pronto || (dlg && dlg.open)) return
    const rec = !!local(posto.id).recolhido
    const el = document.createElement(rec ? 'button' : 'section')
    if (rec) {
      const C = 2 * Math.PI * 9, f = e.feitos / e.total
      el.type = 'button'; el.className = 'pp-pilula'; el.setAttribute('aria-label', `Deixe o posto pronto: ${e.feitos} de ${e.total} feitos. Abrir a lista`)
      el.innerHTML = `<svg class="anel" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="9" fill="none" stroke="var(--surface-3)" stroke-width="3"/>
          <circle cx="11" cy="11" r="9" fill="none" stroke="var(--amber)" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(C * f).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 11 11)"/></svg>
        Falta configurar · ${e.faltam.length}`
      el.addEventListener('click', () => { const c = local(posto.id); delete c.recolhido; grava(posto.id, c); desenhaCard(); document.querySelector('.pp-card [data-ppc="recolher"]')?.focus() })
    } else {
      const prox = e.faltam[0]?.k
      el.className = 'pp-card'; el.setAttribute('aria-label', 'O que falta para o posto ficar pronto')
      el.innerHTML = `<div class="pp-c-cab"><div class="tx"><b>Deixe o posto pronto</b><small>${e.feitos} de ${e.total} feitos · falta${e.faltam.length > 1 ? 'm' : ''} ${e.faltam.length}</small></div>
          <button type="button" class="pp-recolhe" data-ppc="recolher" aria-label="Recolher" title="Recolher"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
        <div class="pp-barra" role="progressbar" aria-valuemin="0" aria-valuemax="${e.total}" aria-valuenow="${e.feitos}" aria-label="Itens feitos"><i style="width:${(100 * e.feitos) / e.total}%"></i></div>
        <ol class="pp-tl">${ITENS.map((i) => { const ok = !!e.c[i.k]; return `<li class="${ok ? 'feito' : i.k === prox ? 'proximo pendente' : 'pendente'}"><button type="button" data-ppc="${i.k}">
            <span class="mk" aria-hidden="true">${ok ? ico('ok') : ''}</span><span class="nome">${i.t}</span><em>${ok ? 'Feito' : 'Configurar'}</em></button></li>` }).join('')}</ol>`
      el.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-ppc]'); if (!b) return
        if (b.dataset.ppc === 'recolher') { const c = local(posto.id); c.recolhido = true; grava(posto.id, c); desenhaCard(); document.querySelector('.pp-pilula')?.focus(); return }
        abrir(b.dataset.ppc)
      })
    }
    document.body.appendChild(el)
  }

  // ------------------------------------------------ o diálogo
  function garanteDialogo() {
    if (dlg) return dlg
    dlg = document.createElement('dialog'); dlg.className = 'modal pp-modal'; dlg.setAttribute('aria-labelledby', 'ppTit'); dlg.tabIndex = -1
    document.body.appendChild(dlg)
    dlg.addEventListener('close', () => { if (!document.querySelector('.pp-card,.pp-pilula')) desenhaCard() })   // (Esc fecha sem passar pelo fecha())
    dlg.addEventListener('click', aoClicar)
    dlg.addEventListener('input', aoDigitar)
    dlg.addEventListener('change', aoDigitar)
    return dlg
  }
  function abrir(qual = null) {
    garanteDialogo()
    const e = estado(posto)
    tela = qual || (e.feitos === 0 ? 'inicio' : e.faltam[0]?.k || 'fim')
    rasc = {}
    desenha(); if (!dlg.open) dlg.showModal(); dlg.focus(); desenhaCard()
  }
  const vaiPara = (t) => { tela = t; rasc = {}; desenha(); dlg.querySelector('.pp-tela').scrollTop = 0; dlg.querySelector('.pp-tela h3')?.focus() }
  const proximo = () => { const e = estado(posto), depois = ITENS.slice(ITENS.findIndex((i) => i.k === tela) + 1).find((i) => !e.c[i.k]); vaiPara(depois ? depois.k : 'fim') }

  function desenha() {
    const e = estado(posto), i = ITENS.findIndex((x) => x.k === tela)
    // (9/11, 2ª rodada) a coluna é um progresso: a barra e a linha do tempo (feito: verde; o próximo: âmbar)
    const prox = e.faltam[0]?.k, atual = (t) => (tela === t ? 'aria-current="step"' : '')
    const passos = `<nav class="pp-lado" aria-label="Passos">
      <div class="pp-prog"><span>${e.pronto ? 'Tudo pronto' : `${e.feitos} de ${e.total} feitos`}</span><div class="pp-barra" role="progressbar" aria-valuemin="0" aria-valuemax="${e.total}" aria-valuenow="${e.feitos}" aria-label="Itens feitos"><i style="width:${(100 * e.feitos) / e.total}%"></i></div></div>
      <ol class="pp-passos">
        <li class="geral ${e.feitos ? 'feito' : ''}"><button type="button" data-ir="inicio" ${atual('inicio')}><span class="mk">${ico('bomba')}</span>O que falta</button></li>
        ${ITENS.map((x, n) => `<li class="${e.c[x.k] ? 'feito' : x.k === prox ? 'proximo' : ''}"><button type="button" data-ir="${x.k}" ${atual(x.k)}><span class="mk">${e.c[x.k] ? ico('ok') : n + 1}</span>${x.t}</button></li>`).join('')}
        <li class="fim ${e.pronto ? 'feito' : ''}"><button type="button" data-ir="fim" ${atual('fim')}><span class="mk">${ico('ok')}</span>${e.pronto ? 'Pronto e opcionais' : 'Resumo e opcionais'}</button></li></ol></nav>`
    const pe = tela === 'inicio' ? `<span></span><button type="button" class="btn" data-pp="depois">Configurar depois</button><button type="button" class="btn prim" data-pp="comecar">${e.feitos ? 'Continuar' : 'Começar'}</button>`
      : tela === 'fim' ? `<span></span>${e.pronto ? '' : '<button type="button" class="btn" data-pp="depois">Configurar depois</button>'}<button type="button" class="btn prim" data-pp="${e.pronto ? 'fechar' : 'continuar'}">${e.pronto ? 'Ir para o painel' : 'Continuar'}</button>`
      : `<span class="pp-pe-passo">Passo ${i + 1} de ${ITENS.length}</span><button type="button" class="btn" data-pp="pular">${e.c[tela] ? 'Manter como está' : 'Pular por agora'}</button><button type="button" class="btn prim" data-pp="salvar" ${valido() ? '' : 'disabled'}>Salvar e continuar</button>`
    dlg.innerHTML = `<div class="cab"><div><h2 id="ppTit">Deixe o ${esc(posto.nome)} pronto</h2><p>${e.pronto ? 'Tudo configurado. Ele já pode receber carros.' : `${e.feitos} de ${e.total} feitos · falta${e.faltam.length > 1 ? 'm' : ''} ${e.faltam.length} para receber o primeiro carro`}</p></div>
        <button class="fechar" type="button" data-pp="depois" aria-label="Fechar">${ICON_X}</button></div>
      <div class="pp-corpo">${passos}<div class="pp-tela">${corpo(e)}</div></div>
      <div class="pe">${pe}</div>`
  }

  // os valores do passo aberto: o que foi digitado agora ou o que já estava guardado
  const val = (k, def) => (k in rasc ? rasc[k] : def)
  // (9/11, 2ª rodada) cada passo é a versão rápida: o atalho diz onde fica a configuração completa no painel
  const trilha = (...p) => `<span class="trilha">${p.map((x) => `<span>${x}</span>`).join('<i aria-hidden="true">›</i>')}</span>`
  const ONDE = {
    preco: { t: 'Todas as opções de preço ficam no painel', p: ['Posto', 'Preço do kWh', 'Alterar'], d: 'Preço por horário e por quantidade, desconto no AC e taxa por carro parado.', b: 'Abrir as opções' },
    receber: { t: 'O que entrou e os repasses ficam no Financeiro', p: ['Financeiro'], d: 'Para trocar a chave depois: nome do posto, no alto do palco › Configurar o posto.', b: 'Abrir o Financeiro' },
    horario: { t: 'Para mudar depois', p: ['Nome do posto, no alto do palco', 'Configurar o posto'], d: 'Abre este mesmo passo a passo, em qualquer item.' },
    app: { t: 'Para mudar depois', p: ['Nome do posto, no alto do palco', 'Configurar o posto'], d: 'A foto e o nome mudam no app na hora.' },
  }
  const onde = (k) => { const o = ONDE[k]; return `<div class="pp-onde">${ico('mapa')}<div class="tx"><b>${o.t}</b>${trilha(...o.p)}<small>${o.d}</small></div>${o.b ? `<button type="button" class="btn" data-atalho="${k}">${o.b}</button>` : ''}</div>` }
  function corpo(e) {
    const c = e.c
    if (tela === 'inicio') {
      const b = op.bombas()
      // a primeira vez (nada feito), a volta com pendências, ou o posto já pronto (pelo "Configurar o posto")
      const [tit, sub] = e.pronto ? ['Configurações do posto', `O ${esc(posto.nome)} está pronto. Aqui você revê o que configurou quando quiser.`]
        : e.feitos ? ['Falta pouco', `Para o ${esc(posto.nome)} aparecer no app e receber carros, falta${e.faltam.length > 1 ? 'm' : ''} ${e.faltam.length} decis${e.faltam.length > 1 ? 'ões' : 'ão'} sua${e.faltam.length > 1 ? 's' : ''}.`]
        : ['Seu posto está montado', `As bombas já estão no lugar. Para o ${esc(posto.nome)} aparecer no app e receber o primeiro carro, faltam algumas decisões suas. Leva uns 3 minutos, e dá para deixar alguma para depois.`]
      return `<h3 class="pp-t" tabindex="-1">${tit}</h3>
        <p class="pp-sub">${sub}</p>
        <ul class="pp-lista">${ITENS.map((x) => `<li class="${c[x.k] ? 'feito' : ''}">${ico(c[x.k] ? 'ok' : x.k)}<span class="tx"><b>${x.t}</b><small>${x.d}</small></span>
            <button type="button" class="pp-ir" data-ir="${x.k}">${c[x.k] ? 'Alterar' : 'Configurar'}</button></li>`).join('')}
          <li class="auto ${b.ok === b.total ? 'feito' : ''}">${ico(b.ok === b.total ? 'ok' : 'bomba')}<span class="tx"><b>Bombas respondendo</b><small>${b.ok} de ${b.total} conectadas ao sistema. Isso é automático: a instalação cuida.</small></span><span class="pp-st">${b.ok === b.total ? 'Tudo certo' : 'Verificando'}</span></li></ul>`
    }
    if (tela === 'preco') {
      const p = num(val('base', c.preco?.base ?? op.preco.atual()))
      return `<h3 class="pp-t" tabindex="-1">Quanto custa o kWh no seu posto?</h3>
        <p class="pp-sub">É o preço padrão: vale a qualquer hora, até você criar regras (por horário ou por quantidade).</p>
        <div class="pp-preco"><span class="campo-valor"><span class="pre">R$</span><input type="text" inputmode="decimal" data-v="base" value="${p.toFixed(2).replace('.', ',')}" aria-label="Preço do kWh em reais"><span class="suf">por kWh</span>
          <span class="passos"><button type="button" data-passo="-0.05" aria-label="Diminuir 5 centavos">−</button><button type="button" data-passo="0.05" aria-label="Aumentar 5 centavos">+</button></span></span>
          <span class="pp-pe-passo" id="ppExemplo">Uma recarga de 30 kWh: <b>${brl(30 * p)}</b> para o motorista</span></div>
        <p class="pp-nota">Postos rápidos da região cobram de <b>R$ 1,90 a R$ 2,60</b> por kWh (exemplo).</p>
        ${onde('preco')}`
    }
    if (tela === 'receber') {
      const tipo = val('tipo', c.receber?.tipo || 'cpf'), PH = { cpf: '000.000.000-00 ou 00.000.000/0001-00', cel: '(31) 90000-0000', email: 'voce@email.com', aleat: 'a chave aleatória do seu banco' }
      return `<h3 class="pp-t" tabindex="-1">Onde você recebe a sua parte?</h3>
        <p class="pp-sub">A sua parte de cada recarga cai nesta chave Pix. A iGreen e os licenciados recebem a deles à parte.</p>
        <div class="pp-campo"><span>Tipo de chave</span><div class="pp-seg" role="group" aria-label="Tipo de chave Pix">${[['cpf', 'CPF ou CNPJ'], ['cel', 'Celular'], ['email', 'E-mail'], ['aleat', 'Aleatória']].map(([k, t]) => `<button type="button" data-tipo="${k}" aria-pressed="${tipo === k}">${t}</button>`).join('')}</div></div>
        <label class="pp-campo"><span>Chave Pix</span><input type="text" data-v="chave" value="${esc(val('chave', c.receber?.chave || ''))}" placeholder="${PH[tipo]}" autocomplete="off"></label>
        <label class="pp-campo"><span>Nome do titular da conta</span><input type="text" data-v="titular" value="${esc(val('titular', c.receber?.titular || ''))}" placeholder="Como está no banco" autocomplete="off"></label>
        <p class="pp-nota">Protótipo: nada é enviado a banco nenhum. Exemplo de repasse: todo dia 5, o que entrou no mês anterior.</p>
        ${onde('receber')}`
    }
    if (tela === 'horario') {
      const h24 = val('h24', c.horario?.h24 ?? false), u = val('uteis', c.horario?.uteis || [7, 22]), f = val('fds', c.horario?.fds || [8, 20])
      const op_ = (sel, de) => Array.from({ length: de ? 24 : 24 }, (_, h) => (de ? h : h + 1)).map((h) => `<option value="${h}" ${h === sel ? 'selected' : ''}>${hh(h)}${h === 24 ? ' (meia-noite)' : ''}</option>`).join('')
      const linha = (k, t, v) => `<div class="pp-hora"><b>${t}</b><label class="pp-campo"><span>Abre</span><select data-h="${k}" data-i="0">${op_(v[0], true)}</select></label><label class="pp-campo"><span>Fecha</span><select data-h="${k}" data-i="1">${op_(v[1], false)}</select></label></div>`
      return `<h3 class="pp-t" tabindex="-1">Quando o posto abre?</h3>
        <p class="pp-sub">O app mostra "aberto agora" ou "fecha às…" e só leva o motorista quando dá para carregar.</p>
        <div class="pp-linha"><label class="chave"><input type="checkbox" data-v="h24" ${h24 ? 'checked' : ''} aria-label="Aberto 24 horas"><span></span></label><span class="tx"><b>Aberto 24 horas</b><small>Rua, estrada ou estacionamento sem horário</small></span></div>
        ${h24 ? '' : linha('uteis', 'Segunda a sexta', u) + linha('fds', 'Sábado e domingo', f)}
        <label class="pp-campo"><span>Como chegar às bombas (opcional)</span><textarea data-v="acesso" placeholder="Ex.: entrada pela Rua das Flores, estacionamento G2, ao lado dos elevadores">${esc(val('acesso', c.horario?.acesso || ''))}</textarea><small>Aparece no app quando o motorista traça a rota.</small></label>
        ${onde('horario')}`
    }
    if (tela === 'app') {
      const nome = val('nome', c.app?.nome || posto.nome), foto = val('foto', c.app?.foto || 'maquete'), endOk = val('endOk', !!c.app?.endOk)
      const fotoMq = op.fotoMaquete ? `background-image:url('${op.fotoMaquete}')` : ''
      const fotoEnv = val('fotoUrl', null)
      return `<h3 class="pp-t" tabindex="-1">Como o motorista vê o seu posto</h3>
        <p class="pp-sub">É o que aparece no mapa e na lista de postos do app iGreen.</p>
        <div class="pp-app"><div style="display:grid;gap:16px">
          <label class="pp-campo"><span>Nome no app</span><input type="text" data-v="nome" value="${esc(nome)}" maxlength="40" autocomplete="off"><small>${nome.trim() ? 'Curto e fácil de achar: o nome do lugar ajuda.' : '<span class="erro">Escreva um nome.</span>'}</small></label>
          <div class="pp-campo"><span>Foto</span><div class="pp-fotos" role="group" aria-label="Foto do posto">
            <button type="button" data-foto="maquete" aria-pressed="${foto === 'maquete'}"><span class="ft" style="${fotoMq}"></span><span class="rot">A maquete do posto</span></button>
            <button type="button" data-foto="enviar" aria-pressed="${foto === 'enviar'}"><span class="ft" style="${fotoEnv ? `background-image:url('${fotoEnv}')` : ''}">${fotoEnv ? '' : '+'}</span><span class="rot">${fotoEnv ? 'A sua foto' : 'Enviar uma foto'}</span></button></div>
            <input type="file" accept="image/*" data-arq hidden></div>
          <div class="pp-linha"><label class="chave"><input type="checkbox" data-v="endOk" ${endOk ? 'checked' : ''} aria-label="O endereço está certo"><span></span></label><span class="tx"><b>O endereço está certo</b><small>${esc(posto.end || '')}</small></span></div>
        </div>${previaApp(nome, foto === 'enviar' && fotoEnv ? fotoEnv : op.fotoMaquete, c)}</div>
        ${onde('app')}`
    }
    // fim: pronto, ou o resumo do que falta; os opcionais
    const ex = c.extras || {}
    return `${e.pronto ? `<div class="pp-feito">${ico('ok')}<div><b>O ${esc(posto.nome)} está pronto</b><span>Ele já aparece no app e pode receber o primeiro carro.</span></div></div>`
      : `<h3 class="pp-t" tabindex="-1">Falta${e.faltam.length > 1 ? 'm' : ''} ${e.faltam.length} para o posto ficar pronto</h3>
        <p class="pp-sub">Pode deixar para depois: o painel lembra num card no canto do palco.</p>
        <ul class="pp-lista">${e.faltam.map((x) => `<li>${ico(x.k)}<span class="tx"><b>${x.t}</b><small>${x.d}</small></span><button type="button" class="pp-ir" data-ir="${x.k}">Configurar</button></li>`).join('')}</ul>`}
      <div><h3>Para deixar melhor (opcional)</h3><ul class="pp-lista">
        <li class="${ex.avisos ? 'feito' : ''}">${ico(ex.avisos ? 'ok' : 'avisos')}<span class="tx"><b>${EXTRAS[0].t}</b><small>${EXTRAS[0].d}</small></span><button type="button" class="pp-ir" data-x="avisos">${ex.avisos ? 'Rever' : 'Escolher'}</button></li>
        <li class="${ex.qr ? 'feito' : ''}">${ico(ex.qr ? 'ok' : 'qr')}<span class="tx"><b>${EXTRAS[1].t}</b><small>${ex.qr ? 'Pedido feito: o adesivo chega pelo seu licenciado.' : EXTRAS[1].d}</small></span>${ex.qr ? '<span class="pp-st">Pedido</span>' : '<button type="button" class="pp-ir" data-x="qr">Pedir</button>'}</li>
        <li class="${ex.equipe?.length ? 'feito' : ''}">${ico(ex.equipe?.length ? 'ok' : 'equipe')}<span class="tx"><b>${EXTRAS[2].t}</b><small>${ex.equipe?.length ? `Convite enviado para ${ex.equipe.map(esc).join(', ')}.` : EXTRAS[2].d}</small>
          <span class="pp-convite"><input type="email" data-v="convite" placeholder="e-mail da pessoa" aria-label="E-mail de quem vai acompanhar o painel" autocomplete="off"><button type="button" class="btn" data-x="equipe">Convidar</button></span></span></li></ul></div>`
  }
  function previaApp(nome, foto, c) {
    const h = c.horario || { h24: true }, agora = new Date(), hora = agora.getHours(), dia = agora.getDay(), faixa = dia === 0 || dia === 6 ? h.fds : h.uteis
    const aberto = h.h24 ? '<span class="aberto">Aberto 24 horas</span>' : faixa && hora >= faixa[0] && hora < faixa[1] ? `<span class="aberto">Aberto agora</span> · fecha às ${hh(faixa[1])}` : faixa ? `<span class="fechado">Fechado agora</span> · abre às ${hh(faixa[0])}` : ''
    const nb = (posto.bombas || []).length, con = (posto.bombas || []).reduce((a, b) => a + (b.modelo === 'mobi' ? 1 : 2), 0)
    const preco = c.preco?.base ?? op.preco.atual()
    return `<div class="pp-cel" aria-label="Prévia no app"><small class="cab-cel">Assim aparece no app</small><div class="ft" style="${foto ? `background-image:url('${foto}')` : ''}"></div>
      <div class="info"><b>${esc(nome || 'Seu posto')}</b><small>${aberto}</small><small>${esc(posto.end || '')}</small><small>${nb} bomba${nb > 1 ? 's' : ''} · ${con} conectores</small>
        <div class="preco-cel"><span>Preço</span><b>${brl(preco)}/kWh</b></div></div></div>`
  }

  // ------------------------------------------------ validação e salvar
  const num = (t) => Number(String(t).replace(/[^\d,.-]/g, '').replace(',', '.'))
  function valido() {
    const c = config(posto)
    if (tela === 'preco') { const p = num(val('base', String(c.preco?.base ?? op.preco.atual()))); return p >= 0.5 && p <= 9.99 }
    if (tela === 'receber') return String(val('chave', c.receber?.chave || '')).trim().length >= 4 && String(val('titular', c.receber?.titular || '')).trim().length >= 3
    if (tela === 'horario') { const h24 = val('h24', c.horario?.h24 ?? false); if (h24) return true; const u = val('uteis', c.horario?.uteis || [7, 22]), f = val('fds', c.horario?.fds || [8, 20]); return u[1] > u[0] && f[1] > f[0] }
    if (tela === 'app') return String(val('nome', c.app?.nome || posto.nome)).trim().length > 0 && !!val('endOk', !!c.app?.endOk)
    return true
  }
  function salvar() {
    const c = config(posto)
    if (tela === 'preco') { const base = Math.round(num(val('base', String(c.preco?.base ?? op.preco.atual()))) * 100) / 100; marca(posto, 'preco', { base }); op.preco.define(base, true) }
    if (tela === 'receber') marca(posto, 'receber', { tipo: val('tipo', c.receber?.tipo || 'cpf'), chave: String(val('chave', c.receber?.chave || '')).trim(), titular: String(val('titular', c.receber?.titular || '')).trim() })
    if (tela === 'horario') { const h24 = val('h24', c.horario?.h24 ?? false); marca(posto, 'horario', { h24, uteis: h24 ? null : val('uteis', c.horario?.uteis || [7, 22]), fds: h24 ? null : val('fds', c.horario?.fds || [8, 20]), acesso: String(val('acesso', c.horario?.acesso || '')).trim() }) }
    if (tela === 'app') marca(posto, 'app', { nome: String(val('nome', c.app?.nome || posto.nome)).trim(), foto: val('foto', c.app?.foto || 'maquete'), endOk: true })
    proximo()
  }
  const atualizaBotao = () => { const b = dlg.querySelector('[data-pp="salvar"]'); if (b) b.disabled = !valido() }

  const fecha = () => { dlg.close(); desenhaCard() }                  // o card volta na hora (o evento close vem depois)
  function aoClicar(ev) {
    if (ev.target === dlg) { fecha(); return }
    const ir = ev.target.closest('[data-ir]'); if (ir) { vaiPara(ir.dataset.ir); return }
    // o atalho para a configuração completa: fecha este passo a passo (o que já foi salvo fica) e abre a de lá
    const at = ev.target.closest('[data-atalho]')
    if (at) { fecha(); if (at.dataset.atalho === 'preco') op.abrePreco(); else if (at.dataset.atalho === 'receber') op.abreAba('financeiro'); return }
    const t = ev.target.closest('[data-tipo]'); if (t) { rasc.tipo = t.dataset.tipo; desenha(); dlg.querySelector('[data-v="chave"]').focus(); return }
    const fo = ev.target.closest('[data-foto]'); if (fo) { if (fo.dataset.foto === 'enviar' && !rasc.fotoUrl) { dlg.querySelector('[data-arq]').click(); return } rasc.foto = fo.dataset.foto; desenha(); return }
    const ps = ev.target.closest('[data-passo]')
    if (ps) { const inp = dlg.querySelector('[data-v="base"]'), v = Math.max(0.5, Math.min(9.99, Math.round((num(inp.value) + Number(ps.dataset.passo)) * 100) / 100)); rasc.base = v.toFixed(2); inp.value = v.toFixed(2).replace('.', ','); aoDigitar({ target: inp }); return }
    const x = ev.target.closest('[data-x]')
    if (x) {
      const c = local(posto.id), ex = c.extras || {}
      if (x.dataset.x === 'avisos') { ex.avisos = true; marca(posto, 'extras', ex); fecha(); op.abreAvisos(); return }
      if (x.dataset.x === 'qr') { ex.qr = true; marca(posto, 'extras', ex); desenha(); return }
      if (x.dataset.x === 'equipe') {
        const inp = dlg.querySelector('[data-v="convite"]'), m = inp.value.trim()
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)) { inp.focus(); inp.setCustomValidity('Escreva um e-mail.'); inp.reportValidity(); return }
        ex.equipe = [...(ex.equipe || []), m]; marca(posto, 'extras', ex); desenha(); return
      }
    }
    const a = ev.target.closest('[data-pp]'); if (!a) return
    const k = a.dataset.pp
    if (k === 'depois' || k === 'fechar') fecha()
    if (k === 'comecar' || k === 'continuar') { const e = estado(posto); vaiPara(e.faltam[0]?.k || 'fim') }
    if (k === 'pular') proximo()
    if (k === 'salvar' && valido()) salvar()
  }
  function aoDigitar(ev) {
    const t = ev.target
    if (t.matches('[data-arq]')) { const f = t.files && t.files[0]; if (f) { rasc.fotoUrl = URL.createObjectURL(f); rasc.foto = 'enviar'; desenha() } return }
    if (t.matches('[data-v="convite"]')) { t.setCustomValidity(''); return }
    if (t.dataset.h) { const k = t.dataset.h, v = [...val(k, config(posto).horario?.[k] || (k === 'uteis' ? [7, 22] : [8, 20]))]; v[+t.dataset.i] = +t.value; rasc[k] = v; atualizaBotao(); return }
    const k = t.dataset.v; if (!k) return
    rasc[k] = t.type === 'checkbox' ? t.checked : t.value
    if (k === 'h24' || k === 'endOk') { desenha(); return }
    if (k === 'base') { const p = num(t.value), ex = dlg.querySelector('#ppExemplo'); if (ex) ex.innerHTML = p > 0 ? `Uma recarga de 30 kWh: <b>${brl(30 * p)}</b> para o motorista` : 'Escreva o preço' }
    if (k === 'nome') { const cel = dlg.querySelector('.pp-cel .info b'); if (cel) cel.textContent = t.value || 'Seu posto' }
    atualizaBotao()
  }

  aoMudar((id) => { if (id === posto.id && !(dlg && dlg.open)) desenhaCard() })
  if (op.novo && !estado(posto).pronto) op.aposCarga(() => abrir('inicio'))
  else desenhaCard()
  return { abrir, marca: (k, v) => marca(posto, k, v), estado: () => estado(posto), desenhaCard }
}
