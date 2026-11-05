# online/: o pacote aberto sem servidor

Esta pasta faz o pacote inteiro funcionar numa hospedagem só de arquivos (GitHub Pages, um bucket, uma CDN), sem Node.
É o que está publicado em https://snksergio.github.io/mob-dashboard-interativo/final/online/.

Para desenvolver, use o `app.mjs` (README do pacote, "Rodar"). Esta pasta não substitui o backend de produção: é uma
vitrine que funciona de verdade, inclusive o construtor.

## Como funciona

O `sw.js` é o `app.mjs` refeito como service worker. Ele responde, dentro de `online/`, nos mesmos endereços que o
`app.mjs` usa:

| Endereço (dentro de `online/`) | Vem de |
|---|---|
| `painel.html`, `construtor.html`, `meu-posto.html`, `maquete.js`, `vendor/...` | `app/site/` |
| `dados/...` | o que este navegador gravou ou, se nada, `app/dados/` |
| `montador/web/...`, `montador/lego/...` | `web/` e `lego/` |
| `api/maquete/reservar`, `arquivo`, `concluir` (e `api/montagens`, `api/fila`) | a mesma lógica de `app/fila-maquetes.mjs` |
| `primeiro-acesso/...` | o segundo cadastro (`primeiro-acesso/inicial/postos.json`), como o `--dados` do `app.mjs` |

- **O que o construtor grava fica no Cache Storage deste navegador** (`igreen-v3-online`). Cada visitante tem o seu.
  A página de abertura tem os botões para recomeçar.
- **As respostas saem no endereço pedido.** Assim cada módulo tem um endereço só (o three.js não é carregado duas vezes)
  e os caminhos relativos das páginas continuam dentro de `online/`. Só vídeo vai por redirecionamento, para o navegador
  pedir por partes direto no arquivo.

## As portas de entrada

`painel.html`, `construtor.html`, `meu-posto.html` e as de `primeiro-acesso/` são só portas de entrada:

1. Na primeira visita o navegador ainda não tem o `sw.js`.
2. A porta (`entrar.js`) instala o `sw.js` e recarrega.
3. Daí em diante o `sw.js` responde no lugar da porta com a página de verdade, e a porta nem aparece.

A página de abertura (`index.html`) só instala, para os links já abrirem direto.

## Cuidados

- **A assinatura da maquete está em quatro lugares:** o construtor, `app/fila-maquetes.mjs`, `web/remontar.html` e
  `sw.js`. Mudou num, mude nos outros.
- **Precisa de service worker:** HTTPS ou localhost. Não funciona na janela privada do Firefox.
- **Os caminhos das páginas são relativos** (o construtor pede `api/...` e `./montador/web/...`). É isso que deixa o
  pacote rodar numa subpasta, aqui ou no CRM.
