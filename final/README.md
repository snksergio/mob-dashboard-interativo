# Painel do eletroposto iGreen: V3 (pacote para o time de desenvolvimento)

Protótipo funcional do painel do dono do eletroposto: o posto em maquete 3D e em planta 2D com os carros carregando, o
construtor do posto (o dono escolhe as bombas e como elas ficam) e a tela "meu posto".

Na V3 a maquete de cada posto é montada no navegador a partir de peças pré-renderizadas que se repetem (como Lego):
cerca de 272 peças por vista e horário servem para qualquer formato de posto. Não há Blender nem imagem nova por posto.

É uma referência funcional, não código de produção: o servidor é mínimo e os dados de carregamento são simulados.
Esta pasta é gerada a partir de `proposta-02/v3` (`ferramentas/empacotar.mjs`); não depende da V1 nem da V2.

**Ver funcionando:** https://snksergio.github.io/mob-dashboard-interativo/final/online/ (painel 3D e 2D, construtor,
primeiro acesso). É este mesmo pacote, aberto sem servidor pela pasta `online/`.

**Antes de mudar código, leia [`ARQUITETURA.md`](ARQUITETURA.md)** (pessoa ou agente de IA). Ele explica por que o
projeto é assim: a renderização híbrida (iluminação pré-calculada em peças + 3D só no que se mexe), a composição em
luz linear, o impostor dinâmico do carro, a resolução adaptativa e os 11 pontos que, se mudados, quebram a maquete sem
dar erro.

## Rodar

Node 18 ou mais novo. Sem dependências e sem build.

```bash
node app.mjs
```

Porta padrão 5299 (`node app.mjs 8080` usa outra). Páginas:

| Endereço | O que é |
|---|---|
| `/painel.html?posto=shopping-norte` | o painel (3D); `&visao=2d` abre a planta |
| `/construtor.html?posto=shopping-norte` | o construtor do posto; ao salvar, monta a maquete e volta ao painel |
| `/construtor-lateral.html?posto=shopping-norte` | o construtor das vagas paralelas (o carro para ao lado da ilha, em linha); os dois construtores trocam pelo seletor "Formato do posto" |
| `/meu-posto.html` | a lista de postos do dono |
| `/montador/web/remontar.html` | remonta todas as maquetes do cadastro (depois de trocar peças ou o montador) |

O primeiro acesso (o dono que ainda não montou o posto) roda com outro cadastro: `node app.mjs 5301 --dados
primeiro-acesso/dados` e http://localhost:5301/painel.html numa janela anônima. O fluxo, passo a passo e com as telas
(computador e celular), está em `primeiro-acesso/README.md`.

**Sem Node:** qualquer hospedagem de arquivos estáticos serve a pasta inteira; abra `online/` (HTTPS ou localhost).
O `online/sw.js` faz no navegador o papel do `app.mjs`, inclusive a API do construtor, gravando no próprio navegador
(`online/README.md`).

Postos de exemplo (`app/dados/postos.json`): `fast`, `mobi`, `fast-sem`, `ultra`, `ultra-sem` (1 bomba), `fast-mobi`,
`fast-mobi-sem`, `fast-fast`, `fast-ultra` (2 bombas) e `shopping-norte` (ilha com 4 bombas).

## Pastas

| Pasta | Conteúdo |
|---|---|
| `README.md`, `ARQUITETURA.md` | este guia e a arquitetura técnica (por que é assim, números, o que não pode quebrar) |
| `app.mjs` | o servidor (arquivos, cache, API do construtor) |
| `app/site/` | as páginas e os motores: `painel.html`, `construtor.html`, `meu-posto.html`, `maquete.js` (3D, three.js), `planta-imagem.js` (2D), `planta2d.js`, `selos.js` (os selos sobre a maquete, dos dois motores), `estado-bomba.js` (falha e desligada), `vendor/` (three.js) |
| `app/dados/` | o cadastro (`postos.json`), as montagens (`montagens/<posto>.json`), as maquetes (`m-xxxxxxxx/`) e as imagens fixas (bombas, carros, tela de carregamento, construtor) |
| `app/fila-maquetes.mjs` | o cadastro das maquetes no servidor (reservar, guardar arquivo, concluir) |
| `web/` | o montador, que roda no navegador: `montar-soltas.js` (entrada), `montar-soltas-worker.js`, `lego.js` (regras e composição), `base/` (cor, projeção, âncoras e moldes) |
| `lego/<vista>-<horário>/` | as peças: `lego.json` (o índice) e os webp. Vistas 3D e 2D, cada uma em tarde, noite, manhã e pôr do sol |
| `lego-lateral/<vista>-<horário>/` | as peças das vagas paralelas (montadas por `web/lateral.js`, com a geometria de `web/lateral-plano.js`) |
| `primeiro-acesso/` | o segundo cadastro (o dono que ainda não montou o posto), o passo a passo e as telas do fluxo |
| `online/`, `index.html` | a versão sem servidor: `online/sw.js` faz o papel do `app.mjs` no navegador; o `index.html` da raiz leva a ela |

O servidor expõe `web/` e `lego/` em `/montador/web/` e `/montador/lego/`, e `app/dados/` em `/dados/`.

## Como a maquete de um posto nasce

1. O dono monta o posto no construtor. A montagem (`montagens/<posto>.json`) diz as fileiras (`frente` e, na ilha,
   `fundos`), cada bomba com modelo (`fast`, `mobi`, `ultra`), vagas (1 ou 2) e se está coberta.
2. O construtor chama `montarMaquete(montagem)` de `/montador/web/montar-soltas.js`. O montador:
   - baixa o índice de cada vista e só as peças que o posto usa;
   - planeja cada vista (`lego.js`, `planejar`: fileira ou ilha, coluna a coluna);
   - junta as camadas em Web Workers (chão, sombras que multiplicam, luzes que somam, cobertura), aplica a cor e o
     brilho da noite e grava webp;
   - gera os dados da cena (`base/dados-sem-blender.js`): âncoras das vagas e das bombas, luzes, cabos, projeção da 2D.
   Leva de 3 a 10 s num computador comum (medido: fileira de 2 bombas 3,6 s; ilha de 3 bombas 7,3 s; ilha 4 + 4 9,9 s).
3. O construtor manda tudo ao servidor:
   - `POST /api/maquete/reservar` com `{ postoId, montagem }` → `{ estado: 'montar' | 'pronto', maquete: 'm-xxxxxxxx' }`;
   - `POST /api/maquete/arquivo?pasta=m-xxxxxxxx&arq=<nome>` com o arquivo no corpo, um por arquivo;
   - `POST /api/maquete/concluir` com `{ postoId, maquete }`: a maquete entra no cadastro e o posto passa a usá-la.
   O nome da pasta vem da assinatura do formato (ex.: `1|fast2s,fast2|fast2,mobi2c`), então postos com o mesmo
   formato dividem a mesma maquete: o segundo já recebe `pronto` e nada é montado.
4. O painel lê `dados/postos.json`, acha a maquete do posto e abre `dados/<maquete>/`.

Assinatura: `<tem cobertura 0|1>|<frente>|<fundos>`, cada bomba `modelo + vagas + marca`, com a marca `c` (coberta) ou
`s` (sem) só quando foge da regra antiga (posto coberto cobre todas menos o Mobi). A mesma conta está no construtor,
em `app/fila-maquetes.mjs` e em `web/remontar.html`.

Vagas paralelas (`"modelo": "lateral"`): a montagem diz as ilhas (até 8, com até 4 bombas cada), cada bomba com modelo,
`disp` (`unica`: 1 vaga; `dois`: uma de cada lado; `fila`: 2 em fila do mesmo lado), `lado` (`frente` ou `tras`, menos
na `dois`) e se está coberta. Assinatura: `L|` e, por ilha (separadas por `/`), cada bomba `modelo + u|d|f + F|T + c`
(ex.: `L|fastd,mobiuFc/ultrafTc`).

O construtor das vagas paralelas funciona como o das bombas de frente: arrastar da lista para a ilha (o lado onde
solta é o lado da vaga), arrastar a bomba ou a vaga no mapa, "+ vaga", botão direito (no celular, tocar e segurar),
pinça para o zoom, formatos prontos e o "Como funciona".

## Arquivos de uma maquete (`app/dados/m-xxxxxxxx/`)

| Arquivo | Uso |
|---|---|
| `fundo-<horário>.webp`, `teto-<horário>.webp` | 3D: o chão com bombas e a cobertura, para tarde, noite, manhã e pôr do sol |
| `arvore-<horário>.webp` e `.json` | só na ilha: a árvore do meio recortada, que fica na frente do carro dos fundos |
| `planta/planta-<h>.webp`, `planta/teto-<h>.webp`, `planta/sobre-<h>.webp` | 2D nos quatro horários; `sobre` só na ilha; o teto da 2D vai em meia resolução (o painel o mostra a ~30% de opacidade) |
| `estados.png`, `planta/estados.png` | onde fica cada bomba e o que nela acende (para falha e desligada) |
| `ancoras.json`, `planta/planta.json` | onde ficam vagas, bombas e conectores no 3D e na 2D |
| `luzes-<horário>.json`, `env-<horário>.jpg` | as luzes e o reflexo dos carros |
| `bomba_pecas.glb` | as peças da bomba que se mexem (pistola, cabo) |
| `pronto.json` | marca de pronta, com os horários que existem |

Tamanho por maquete: de 1,6 a 8 MB em disco (todos os horários). O painel baixa primeiro só o horário de agora
(ilha 4 + 4 à noite: 1,1 MB em vez de 4,4 MB) e os outros depois que o posto aparece.

## O painel por código

`painel.html` cria a cena com `criarMaquete(el, opcoes)` (`maquete.js`, 3D) ou `criarPlantaImagem(el, opcoes)`
(`planta-imagem.js`, 2D) e deixa o objeto em `window.maquete`. As duas têm as mesmas funções; o que o painel usa:

- `setFalha(on, bomba)`: bomba em falha: as luzes dela ficam vermelhas e piscam, com um brilho leve de LED em volta, e a
  tela mostra um alerta (triângulo vermelho);
- `setInativa(on, bomba)`: bomba desligada: ela perde a cor (fica cinza, "fora de serviço"), as luzes viram plástico
  apagado e a tela mostra o símbolo de liga/desliga;
- `setHora(h)`, `setChuva(on)`, `setClima({ nuvens, chuva })`: horário e tempo;
- `setDados(vaga, { kw, pct, prog, pessoa })`, `mostrarVaga(vaga, html)`: o selo de cada carro;
- `setZoom(on, bomba)`, `setZoomNivel(k)`, `setPreco(v)`, `ouvir(f)` (eventos).

Falha e desligada não usam imagem de render extra: saem do `estados.png` da maquete (onde está cada bomba e o que nela
acende), em qualquer horário. O desenho da tela e o brilho são feitos na hora por `app/site/estado-bomba.js` (a tela é
posta no lugar certo pelos oclusores `bombaN_tela_moldura` e `_costas` do `ancoras.json`).

## Cache e compressão em produção

O `app.mjs` manda cada arquivo com `ETag`, `Last-Modified` e `Cache-Control: no-cache`: o navegador guarda e só
pergunta se mudou (resposta 304 vazia). Na segunda visita ao painel, 190 KB baixados em vez de 3,3 MB. Faça igual
para `dados/` (a maquete remontada mantém os nomes dos arquivos) e para `lego/`. Cache longo (`immutable`) só se o
nome mudar a cada versão (ex.: `lego/<versão>/`).

Texto e modelos 3D vão comprimidos (brotli, ou gzip): js, json, html, css, svg e glb. Imagens e vídeos já vêm
comprimidos. A produção (servidor ou CDN) deve fazer o mesmo: sem isso, o three.js sozinho são 2 MB.

## Celular

O painel abre na vista de cima (2D) em tela de celular, em aparelho simples ou com internet lenta (dá para trocar para o
3D). Medido num celular médio simulado (processador 4× mais lento, 4G), primeira visita, ilha de 8 vagas:

| | Até abrir | Baixado até abrir |
|---|---|---|
| 2D | ~4,5 s | ~1,1 MB (a maquete: ~460 KB) |
| 3D | ~14 s | ~2,9 MB |

Antes dos ajustes de 4/11 eram 5,7 s e 2,8 MB na 2D, e 18 s e 7,1 MB no 3D. O horário de agora vem primeiro; os outros chegam depois que o posto aparece. Ligar uma
falha ou uma bomba desligada custa 30 a 130 ms nesse aparelho.

Com o posto aberto (mesmo aparelho, ilha de 8 vagas com 6 carros carregando):

| | Quadros por segundo | Trabalho dos números (por segundo) | Mudanças na página (por segundo) |
|---|---|---|---|
| 2D, antes | 19 | 239 ms | ~3.000 |
| 2D, agora | 55 | 13 ms | ~550 |
| 3D, antes | 22 | 105 ms | ~850 |
| 3D, agora | 41 | 4 ms | ~66 |

O que mudou:

- **Os números**: a simulação faz a conta a cada 0,25 s, mas a tela (a coluna e os selos da maquete) muda uma vez por
  segundo, como o mostrador de uma bomba, e só o que está à vista: a aba aberta da coluna, e só se ela estiver na
  tela (no celular a coluna fica embaixo da maquete). Mudança de estado (carro chega, sai, falha) aparece na hora. Os
  formatadores de reais e kWh são criados uma vez (`toLocaleString` criava um a cada número). Em produção, os dados
  chegam pelo sistema da bomba; a mesma regra vale: atualize a tela no máximo a cada segundo e só o que está à vista.
- **Os selos sobre a maquete** (`selos.js`): medem o tamanho só quando o texto muda e escrevem a posição só quando ela
  muda. Selos de carros amontoados (posto afastado, posto grande, celular) viram um selo só com o número de carros,
  como os pinos de um mapa; tocar nele aproxima a vista até os selos caberem (sem passar da largura da tela). Selos de
  bomba e avisos nunca se juntam; um grupo com carro em falha fica vermelho.
- **A 2D** desenha no ritmo do 3D: até 60 quadros por segundo com algo se mexendo, 30 parada, nenhum fora da tela; e só
  reescreve no desenho o que mudou.
- **O detalhe da bomba** mostra uma foto fixa, de frente (`dados/bombas/<modelo>/g00.webp`, ~75 KB). O giro de 360°
  (36 quadros, ~2,5 MB) saiu.

**O carro 3D (5/11).** O painel usa `dados/carro-leve.glb`: a mesma malha do `carro.glb`, com 25 mil triângulos em
vez de 68 mil, gerada por `ferramentas/carro-leve.mjs` na pasta da V3 (meshoptimizer). No carregamento, as peças do
carro com o mesmo material viram uma malha só (rodas e calotas ficam soltas, para girar), e a sombra do sol só é
redesenhada quando algo muda. Com 7 carros, no mesmo aparelho simulado: 820 → 288 pedidos de desenho por quadro, ~1
milhão → 219 mil triângulos, 21 → 13 ms de processador por quadro, sem diferença visível.

**Carro parado como foto, cena enxuta e horários sob demanda (5/11, tarde).**
- **Carro parado como foto:** o carro parado é fotografado pelo navegador (com a luz do momento e a profundidade de
  cada ponto), e o quadro desenha só um retângulo com a foto. O que se mexe continua 3D. Está em `maquete.js`, na
  seção "carro parado como foto".
- **Cena enxuta:** os oclusores fixos viram uma malha só, e o que está com opacidade zero não é desenhado.
- **Horários sob demanda:** no celular, só os dois horários em uso ficam abertos, no 3D e na 2D. Os outros ficam no
  cache e entram quando a hora chega.
- **Sem desfoque de vidro:** no celular, o vidro sobre a maquete não desfoca.

Mesmo aparelho simulado, Shopping Norte com 7 carros: ~16,5 → ~3 ms de processador por quadro no 3D (21 ms com o
carro original), 63 pedidos de desenho. Na 2D, o zoom passou de 20 para ~30 quadros por segundo. O visual não muda
(99,6% igual na comparação de imagem).

No celular, a maquete 2D ocupa a largura da tela, e o botão de tela cheia (ao lado do nome do posto) abre a maquete na
tela toda, como um vídeo. No Android ele entra em tela cheia de verdade e deita o celular sozinho; no iPhone, que não
deixa a página fazer isso, a maquete cobre a tela e um aviso pede para girar o celular. Sai pelo mesmo botão, pelo
"voltar" ou pelo Esc.

## Levar para o CRM

O que já está pronto para reaproveitar e o que é do protótipo:

| Parte | No protótipo | No CRM |
|---|---|---|
| Motores da maquete (`maquete.js`, `planta-imagem.js`, `selos.js`, `estado-bomba.js`) | módulos ES sem framework: `criarMaquete(el, opcoes)` e `criarPlantaImagem(el, opcoes)` desenham dentro de um elemento | reaproveitar como estão, embrulhados num componente (React, Vue ou o que o CRM usar). Falta uma função de descarte (parar o laço de quadros, soltar a GPU, os Workers e os observadores) para telas que montam e desmontam o painel |
| Montador (`web/`) e peças (`lego/`) | rodam no navegador de quem salva o posto | iguais; servir `lego/` por CDN com cache longo e caminho versionado |
| Painel (`painel.html`) | uma página única com a tela, a simulação e a demonstração | referência de layout e de comportamento; a tela vira componentes do CRM com os tokens de `:root` (tema escuro e claro já definidos) |
| Construtor (`construtor.html`) | página única | idem; as regras do posto (até 10 bombas, 1 ou 2 vagas, fileira ou ilha, cobertura) e a assinatura do formato valem como estão |
| Dados ao vivo | simulados em `painel.html` | o sistema da bomba (OCPP) chama `setDados`, `setFalha` e `setInativa` (ARQUITETURA.md, seção 10) |
| API das maquetes (`app.mjs` + `app/fila-maquetes.mjs`) | grava em disco local | backend do CRM: as mesmas três rotas (`reservar`, `arquivo`, `concluir`), com login, validação e um bucket |
| Cadastro (`dados/postos.json`, `montagens/`) | arquivos JSON | banco de dados; o formato dos objetos pode ser mantido |

As páginas usam só caminhos relativos (`dados/`, `api/`, `./montador/web/`), então o painel roda numa subpasta do CRM
(ex.: `/crm/eletroposto/`) sem mudar código. Antes de mexer nos motores, leia os invariantes em `ARQUITETURA.md`
(seção 13).

## Limites conhecidos

- Até 10 bombas por posto (regra do construtor).
- A montagem roda no navegador de quem salva o posto: precisa de Web Workers de módulo, `OffscreenCanvas` e gravação
  de webp. Testado em navegador Chromium (Chrome) no Windows. Safari e Firefox não testados; o Safari pode gravar PNG
  no lugar de webp. Se for
  preciso, o mesmo montador pode rodar num serviço (Node com canvas) em vez do navegador.
- O 3D e a 2D têm os quatro horários (tarde, noite, manhã e pôr do sol); maquete antiga, sem a 2D da manhã e do pôr do
  sol, usa a da tarde com o tom do horário.
- O `app.mjs` não tem login, não separa usuários e grava em disco local. Em produção: autenticação, armazenamento
  das maquetes (ex.: bucket), validar a montagem no servidor e limitar o tamanho dos envios.
- Carros, cargas e valores do painel são simulados em `painel.html`.
- Serviços de fora: as fontes vêm do Google Fonts e o clima de verdade da Open-Meteo (`&clima=off` desliga o clima).
- `/api/fila` e `/api/montagens/<posto>` existem só para as páginas não quebrarem (eram da fila do Blender da V1).

## As peças (`lego/`)

Feitas pelo time de design a partir dos renders do Blender; não edite à mão. São 8 pastas de cerca de 272 peças,
174 MB no total, mas cada posto baixa só as que usa. Quando chegarem peças novas: troque a pasta `lego/` e abra
`/montador/web/remontar.html` para remontar as maquetes do cadastro (os nomes e o cadastro não mudam).

## Terceiros

three.js (licença MIT, `app/site/vendor/THREE-LICENSE`).
