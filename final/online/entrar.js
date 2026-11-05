// Painel V3 · online: liga o servidor no navegador (sw.js) antes de abrir a página.
// As páginas desta pasta (painel.html, construtor.html, meu-posto.html e as de primeiro-acesso/) são só portas de
// entrada: na primeira visita o navegador ainda não tem o sw.js, então a porta o instala e recarrega. Dali em diante o
// sw.js responde no lugar dela com a página de verdade (app/site/...), e a porta nem aparece. Na página de abertura
// (index.html, com data-so="instalar") só instala, para os links já abrirem direto.
;(() => {
  const eu = document.currentScript, sw = new URL('sw.js', eu.src), escopo = new URL('./', eu.src)
  const aviso = (t) => { const el = document.getElementById('aviso'); if (el) el.textContent = t }
  if (!('serviceWorker' in navigator)) {
    aviso('Este navegador não abre a versão online (falta o service worker). Use o Chrome, o Edge ou o Safari atualizados, fora da janela privada do Firefox.')
    return
  }
  const registro = navigator.serviceWorker.register(sw.href, { scope: escopo.pathname })
  if (eu.dataset.so === 'instalar') { registro.catch(() => {}); return }
  ;(async () => {
    // trava contra recarregar sem fim: até 3 tentativas em 15 s
    const K = 'igreen-v3-online-entrada'
    let t = { n: 0, desde: Date.now() }
    try { t = JSON.parse(sessionStorage.getItem(K)) || t } catch {}
    if (Date.now() - t.desde > 15000) t = { n: 0, desde: Date.now() }
    if (t.n >= 3) {
      try { sessionStorage.removeItem(K) } catch {}
      aviso('Não consegui abrir a página. Recarregue (F5) ou abra pela página de abertura da versão online.')
      return
    }
    try { sessionStorage.setItem(K, JSON.stringify({ n: t.n + 1, desde: t.desde })) } catch {}
    try {
      const reg = await registro
      if (navigator.serviceWorker.controller) await reg.update().catch(() => {})   // controlada e caiu aqui: sw velho
      await navigator.serviceWorker.ready
      if (!navigator.serviceWorker.controller) {
        await new Promise((ok) => { navigator.serviceWorker.addEventListener('controllerchange', ok, { once: true }); setTimeout(ok, 1500) })
      }
      location.reload()
    } catch (e) { aviso(`Não consegui ligar a versão online: ${e.message}`) }
  })()
})()
