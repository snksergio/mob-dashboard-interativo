# Arquitetura técnica do painel V3

Para quem vai continuar o projeto, pessoa ou agente de IA. O `README.md` diz **como rodar e o que existe**; este
documento diz **por que é assim e o que não pode quebrar**. Quase toda decisão aqui parece excesso de engenharia
olhando um arquivo isolado e é o que segura qualidade de render offline num celular médio. Antes de "simplificar"
qualquer coisa, leia a seção 13 (invariantes).

---

## 0. Em uma tela

- **Problema invertido.** Na maioria das cenas 3D o cenário é fixo e os objetos se movem. Aqui cada posto tem um
  formato (até 10 bombas, 3 modelos, 1 ou 2 vagas por bomba, coberta ou não, fileira ou ilha), e os objetos (bombas,
  carros) são sempre os mesmos. Renderizar cada formato no Blender (Cycles, path tracing) levava ~50 min por formato e
  vista: inviável para milhares de combinações.
- **Solução: renderização híbrida 2.5D.** A iluminação global é pré-computada offline (Cycles) e vira **peças de imagem
  reutilizáveis** ("Lego"). O **navegador compõe** a maquete de qualquer formato em 3–10 s (Web Workers +
  OffscreenCanvas, composição em luz linear). Só o que se mexe é rasterizado em tempo real (three.js r186, WebGL2),
  encaixado nas camadas por **oclusores só de profundidade**.
- **A câmera ortográfica fixa é a pedra angular.** Na projeção ortográfica, transladar no mundo equivale a transladar
  na tela (equivariância à translação). É isso que permite deslocar uma peça "uma vaga" com um deslocamento inteiro de
  pixels e casar sem costura. Em perspectiva, nada disso funcionaria.
- **Desempenho no celular:**
  - carro com malha simplificada (meshoptimizer, 68k → 25k triângulos) e lotes por material;
  - mapa de sombra em cache;
  - carro parado vira **impostor dinâmico** (fotografado pela própria GPU, com profundidade por pixel);
  - resolução dinâmica em degraus e ritmo de quadros sob demanda;
  - horários carregados sob demanda;
  - selos agrupados como pinos de mapa;
  - números desenhados a 1 Hz e só na aba visível.
- **Resultado** (celular médio simulado, 4× CPU, 7 carros): **21 → ~3 ms de CPU por quadro**, 820 → 63 chamadas de
  desenho, 99,6% de similaridade (SSIM) com o 3D completo.

---

## 1. Pipeline de ponta a ponta

```
 OFFLINE (time de design, uma vez)                         ONLINE (navegador do dono, por posto)
 ────────────────────────────────                          ─────────────────────────────────────
 Blender / Cycles                                          construtor.html
   postos-exemplo, câmera fixa,                              montagem = { fileiras, bombas, vagas, cobertura }
   4 horários × (3D, planta)                                   │
   imagens em sRGB da luz/2 (exposição −1)                     ▼
        │                                                  montarMaquete()  web/montar-soltas.js
        ▼                                                    ├─ baixa lego.json de cada vista e SÓ as peças usadas
 ferramentas/preparar-lego.mjs                               ├─ planejar()  web/lego.js  → lista de camadas
   recorta chão em faixas por vaga,                          ├─ Workers (montar-soltas-worker.js), em paralelo:
   cobertura em "multiplica"/"soma",                         │    composição em luz linear → tone map → sRGB
   peças de pé (bomba, pilar, árvore, totem)                 │    → redução por área → webp (+ estados.png)
   com sombra e luz próprias                                 └─ dados-sem-blender.js: âncoras, luzes, cabos, projeção 2D
        │                                                      │
        ▼                                                      ▼  POST /api/maquete/{reservar, arquivo, concluir}
 lego/<vista>-<horário>/                                   app/dados/m-xxxxxxxx/   (endereçado pela assinatura)
   lego.json (índice: retângulos, coluna-âncora,               │
   modo de mistura, profundidade) + webp                       ▼
   8 pastas, ~272 peças cada, 174 MB                       painel.html
                                                             ├─ maquete.js      (3D: three.js, camadas + carros)
                                                             ├─ planta-imagem.js (2D: SVG + imagens)
                                                             ├─ selos.js        (rótulos DOM projetados, agrupamento)
                                                             └─ estado-bomba.js (falha/desligada a partir da máscara)
```

---

## 2. A montagem "Lego" (composição de imagens no navegador)

**Onde:** `web/lego.js` (planejar + montarLego), `web/montar-soltas.js` (orquestração), `web/montar-soltas-worker.js`
(um horário de uma vista por Worker), `web/base/compor.js` (cor e brilho), `ferramentas/preparar-lego.mjs` (corte
offline das peças).

### 2.1 A grade

- Uma vaga é um deslocamento fixo na tela: `DU = 384 × 150 px` no 3D (o vetor isométrico de uma vaga). A peça `r`
  recortada na coluna `k` do posto-exemplo e posta na coluna `kp` anda `round((kp − k) · DU)` pixels. A coluna pode ser
  fracionária (pilar da ponta: ±0,2/2,7 de vaga).
- **Máscara por coluna, decidida por raio:** cada pixel sabe a que coluna pertence pelo ponto do **chão** (ou do
  **teto**, `z: 'zteto'`) que ele enxerga, ou seja, a interseção do raio da câmera com o plano. A costura entre duas
  peças cai sempre "entre vagas iguais", não numa linha de tela. Mesma conta da V2.
- Medido no corte: o chão sem cobertura se repete a cada vaga com **menos de 1% de diferença**, de dia e de noite.
  É o que valida a premissa de que dá para usar peças repetidas.

### 2.2 As camadas, nesta ordem (pintor com modos de mistura)

| # | Camada | Modo | Observação |
|---|---|---|---|
| 1 | Chão: lateral esq., um bloco por vaga em faixas (rua, piso, vaga, calçada, canteiro), lateral dir. | cobre | cada peça vem com ~8 px de sobra e é cortada exata na coluna |
| 2 | Efeito da cobertura no chão | **multiplica** (sombra) e **soma** (luz das lâmpadas) | pontas de 2 vagas, meio, viga entre bombas; a vaga descoberta vizinha recebe o vazamento |
| 3 | Sombras e luzes das peças de pé | multiplica / soma | em luz linear |
| 4 | Peças de pé (bomba, pilar, árvore, totem) | cobre, de trás para a frente | ordenadas por `prof` (algoritmo do pintor por profundidade) |
| 5 | Teto | camada à parte (`teto-<h>.webp`) | o painel desenha por cima dos carros |

Casos especiais:
- **Cobertura pequena** (posto todo coberto de 1–2 vagas): usa a cobertura inteira de um exemplo do mesmo tamanho.
- **Trechos cobertos** (cobertura bomba a bomba): cada trecho é uma cobertura com pontas, meio e viga. A ponta que cai
  no meio do posto é outra peça (margem de 40 cm, não 60).
- **Ilha:** chão e teto em faixas contadas do eixo do meio (`Y_MEIO = 6,4 m`); a camada `sobre` (bombas dos fundos,
  pilares, árvore) e a **copa** recortada da árvore, que o painel põe na frente do carro dos fundos.
- **Costura de luz na ilha:** `COSTURA = 0,25`, a luz de um trecho se mistura com a do vizinho ¼ de vaga para cada lado
  da divisa.

### 2.3 Cor: tudo em luz linear, como o Blender

- As imagens guardam **sRGB da luz / 2** (exposição −1 no Blender): uma margem de 2× acima do branco (headroom HDR
  barato em 8 bits).
- Leitura por LUT de 256 entradas, sRGB → linear × 2.
- **Byte de sombra 188 = razão 1** (o "não muda" do multiplica): o ponto neutro foi escolhido para caber o
  escurecimento e um pouco de clareamento no mesmo byte.
- **Sombra transparente = razão 1 exata** (vagas paralelas, `lego-lateral/`): a sombra de perto é gravada com perda
  leve (webp 95) e os blocos de 8 × 8 que ficam no neutro (188 ± 1) saem transparentes. Os dois montadores
  (`web/lateral.js` e `ferramentas/lateral-lego.mjs montar`) leem o transparente como 1. Sem isso, a perda (YUV)
  deixava o neutro um pouco mais escuro no verde e, como as sombras se multiplicam onde as peças se cruzam, a tarde
  ficava visivelmente mais escura e esverdeada. Medido contra o render inteiro: melhor que o corte sem perda.
  A junção (`web/lateral.js`) pula, em cada linha de cada peça, as colunas exatamente neutras: mexer nela exige
  conferir a saída bit a bit contra a versão anterior (foi assim que ela ficou 2,5× mais rápida sem mudar nada).
- Ao final, **Khronos PBR Neutral** (o tone map do Blender) e a curva sRGB. Compor em sRGB em vez de linear dá halo nas
  costuras e degraus nas sombras somadas.
- **PNG lido byte a byte** (decodificador próprio em `compor.js`): o canvas pré-multiplica o alfa e perde precisão nas
  bordas transparentes. `createImageBitmap` sempre com `premultiplyAlpha: 'none', colorSpaceConversion: 'none'`.
- **Redução por média de área** com alfa pré-multiplicado, para a borda não escurecer.
- **Brilho** (glow) de noite e pôr do sol aplicado na composição.

### 2.4 `estados.png`: falha e desligada sem render extra

Na noite de cada vista, o Worker grava em meia resolução:
- canal **R**: o número da bomba dona do pixel;
- canal **G**: o quanto ali é luz acesa da bomba.

O painel (`estado-bomba.js`) usa isso como máscara para tingir de vermelho e piscar (falha) ou dessaturar e apagar
(desligada), em qualquer horário. A tela da bomba é posicionada pelos oclusores `bombaN_tela_moldura`/`_costas` do
`ancoras.json`. Custo medido: 30–130 ms no celular médio.

### 2.5 Paralelismo e memória

- `paralelos(pixels) = max(1, min(3, ⌊núcleos/2⌋, ⌊25% de deviceMemory / (pixels × 40 B)⌋))`: o número de Workers é
  limitado por CPU **e** por memória (cada Worker segura vários buffers Float32 do quadro inteiro).
- Workers de módulo (`{ type: 'module' }`), `OffscreenCanvas.convertToBlob` em webp: qualidade 0,9 no 3D, 0,86 na 2D.
- Tempo medido num computador comum: fileira de 2 bombas 3,6 s; ilha de 3 bombas 7,3 s; ilha 4 + 4 9,9 s.

### 2.6 Endereçamento por conteúdo (deduplicação)

- **Assinatura:** `<tem cobertura 0|1>|<frente>|<fundos>`, cada bomba `modelo + vagas + marca`, com a marca `c`/`s` só
  quando foge da regra antiga.
- **Pasta:** `m-xxxxxxxx` (hash FNV de 32 bits da assinatura).
- Postos com o mesmo formato **dividem a maquete**: `reservar` responde `pronto` e nada é montado. A API é idempotente
  (`reservar` → `arquivo`* → `concluir`).
- **A mesma conta existe em três lugares** (construtor, `app/fila-maquetes.mjs`, `web/remontar.html`) e precisa
  continuar idêntica.

---

## 3. A cena 3D em tempo real (`app/site/maquete.js`)

### 3.1 Câmera e camadas

- **`THREE.OrthographicCamera` com a mesma pose e escala da câmera do Blender.**
  - O zoom e o arrasto **mudam a janela do frustum** (`jan`), não movem a câmera.
  - As camadas de imagem são quads de tela com o recorte de UV equivalente, então imagem e 3D andam juntos ao pixel.
- **Ordem do quadro:**
  1. `cenaFundo` (quad, sem depth test);
  2. `clearDepth`;
  3. `cena` (oclusores, carros, pistolas, cabos, anéis);
  4. `cenaTeto` (quad);
  5. `cenaChuva`.
- **Oclusores só de profundidade** (`MeshBasicMaterial({ colorWrite: false })`).
  - São a geometria-proxy de bombas, pilares, árvore e cobertura: escrevem no Z-buffer e não na cor. Assim o carro 3D
    some atrás do pixel da bomba pintada na imagem (composição 2.5D por proxies de profundidade).
  - Todos viram **uma malha só** (`mergeGeometries`, `renderOrder −1`).
- **Horários:**
  - `periodoDaHora(h) → { a, b, t }` faz crossfade entre as camadas de dois horários;
  - as luzes da cena vêm de `luzes-<h>.json` (exportadas do Blender), com conversão de energia: área `E/π`, ponto
    `E/4π`;
  - reflexo por `env-<h>.jpg` → `PMREMGenerator.fromEquirectangular`.
- **`renderer.toneMapping = NeutralToneMapping`:** o mesmo Khronos PBR Neutral do Blender e do compositor. É o que faz
  o carro 3D e o cenário assado parecerem a mesma foto.

### 3.2 Compilação de shaders: o gargalo invisível

- **Conjunto fixo de luzes: 8 SpotLights + 3 PointLights** (`POOL_SPOT`, `POOL_PONTO`) em toda maquete.
  - O three.js gera uma variante de programa por contagem de luzes (`NUM_SPOT_LIGHTS` etc.). Com 16–50 luzes por
    maquete, cada maquete nova recompilava os materiais do carro (0,5–1 s cada, ~5 s de página travada).
  - Com o conjunto fixo, o programa é o mesmo e o cache de programas do navegador é reaproveitado.
  - `escolhaLuzes` dá cada lugar do conjunto à luz que mais ilumina os carros e, com sobra, as bombas.
- **Aquecimento progressivo atrás da tela de carregamento:** o primeiro carro é desenhado peça por peça, um quadro para
  cada compilação lenta, para a animação de carregamento não engasgar.
  - **`compileAsync` não é usado:** com `KHR_parallel_shader_compile` no Chrome/Windows (ANGLE sobre D3D11) ele também
    trava enquanto compila.
- **Materiais do carro já nascem `transparent: true`.** O fade de chegada e saída não troca de programa
  (opaco ↔ transparente seria outra variante e outra compilação no meio da animação).

### 3.3 Sombra

- **Sol:**
  - `DirectionalLight` com mapa de 2048 px, ou 4096 nas maquetes grandes (`LJ`);
  - PCF com `radius 4`, `bias −0,0004`, `normalBias 0,02`.
- **Sombra em cache:**
  - `shadowMap.autoUpdate = false`;
  - `needsUpdate` só quando `sombraSuja` (troca de horário, degrau, carro entrando ou saindo) ou com carro em
    movimento.
  - Numa cena parada, o passe de sombra (que redesenha todos os carros do ponto de vista do sol) simplesmente não
    acontece.
- **Sombra de contato** do carro: um quad com textura, opacidade `0,5·a²`, que some antes do carro no fade.

---

## 4. O carro

### 4.1 Malha (`dados/carro-leve.glb`, `ferramentas/carro-leve.mjs`)

- Gerado com **gltf-transform + meshoptimizer** `simplify` (razão 0,25, erro alvo 0,001), de **68 mil para 25 mil
  triângulos**.
- Comparado no zoom máximo (2,4×): sem diferença visível.
- Se o arquivo não existir, cai para o `carro.glb` original. O original **não foi alterado** (a V1 e a V2 usam ele).

### 4.2 Lotes por material (`juntaPecas`)

- No carregamento, as peças com o mesmo material viram uma malha só (redução de chamadas de desenho).
- **Ficam separadas:**
  - rodas e calotas, que giram;
  - as peças das zonas de pintura que têm transformação própria, que mudam de cor por carro.
- Resultado com 7 carros: **820 → 288** chamadas por quadro, ~1 milhão → 219 mil triângulos.

### 4.3 Impostor dinâmico: "carro parado como foto"

Seção "carro parado como foto" em `maquete.js`. O carro parado na vaga é **fotografado pela própria GPU**, com a luz
do momento e a profundidade de cada pixel. O quadro passa a desenhar um único quad por carro. O que se mexe continua
3D.

Os detalhes que fazem ficar indistinguível:

1. **Captura em alta faixa e antisserrilhada:**
   - render target de rascunho compartilhado `HalfFloat`, MSAA `samples: 4`, com `DepthTexture`;
   - superamostragem de 1,5× a resolução do zoom máximo (até 1024 px).
2. **Tone map antes dos mipmaps.**
   - Um passe com a fórmula Neutral grava num alvo **sRGB RGBA8 com mipmaps**.
   - Gerar mipmaps em HDR linear faz o realce (lanternas, reflexo) "vazar" nos níveis menores e engrossar, o que foi
     visto e corrigido.
3. **Profundidade junto:** textura `R16F` com a profundidade de cada pixel.
4. **O quad escreve `gl_FragDepth`.**
   - Usa a profundidade mais próxima numa vizinhança 3×3, para a borda não brigar com o chão.
   - Assim a foto continua sendo encoberta pelos oclusores e cruzando corretamente com outros carros.
   - `renderOrder 2`, depois da sombra de contato.
5. **Quando refazer:**
   - assinatura da luz (horário, intensidades, cores) e do estado do carro, com uma **janela de estabilidade de
     0,35 s** para não refotografar a cada quadro de um crossfade;
   - carro a menos de **4,6 m** de um alarme aceso fica 3D (a luz pisca, a foto ficaria velha).
6. **Pixels por unidade calculados com `cnv.w · PR0`** (a resolução nominal), não com o `pixelRatio` atual.
   - Usar o atual criava um ciclo de realimentação: a resolução dinâmica desce, a foto é refeita, o quadro engasga, a
     resolução desce de novo. Eram quadros de 53 ms nas chegadas.
7. **A foto continua projetando sombra:** os carros-foto ficam na camada `CAMADA_FOTO = 5`.
   - Quando a sombra precisa ser atualizada, `sombraSoParaFotos` roda um `render` com uma câmera que não enxerga nada.
   - O three.js faz o passe de sombra antes do passe principal, então o mapa é atualizado sem custo de cor.
8. **Proteções:** sem `EXT_color_buffer_float`, ou em modo de captura (vídeo), o carro fica 3D.

Validação: imagem do quadro com foto × com 3D, **SSIM 99,6%**.

### 4.4 Modo leve: o carro "veste" uma imagem do Blender

Em `?qualidade=leve`, o carro usa imagens pré-renderizadas (`blender/carro_sprites.py`):
- 4 cores, 2 direções, dia/noite, com e sem cobertura, com a luz do posto assada;
- a malha 3D continua como **forma** (contorno e profundidade, para bombas e pilares passarem na frente);
- o shader é trivial: cada pixel lê a imagem pela posição de tela, a partir da origem do carro projetada.

Compila uma vez, e os materiais pesados nem chegam a compilar.

---

## 5. Tempo de quadro e adaptação ao aparelho

- **Ritmo sob demanda:**

  | Situação | Quadros por segundo |
  |---|---|
  | Algo se mexendo (carro chegando, conectando ou saindo, zoom, arrasto, chuva) | 60 |
  | Cena parada (só o anel e o cabo pulsando) | 30 |
  | No leve | 30 / 12 |
  | Fora da tela (`IntersectionObserver`) | 0 |

  - `dt` limitado a 0,1 s: aparelho lento anda no tempo real.
  - Medido numa RTX 4070 Ti com monitor de 240 Hz: de 240 quadros/s e 8,8% da placa para 30 e menos de 1%.
- **Resolução dinâmica em degraus:**
  - `PR0 = clamp(devicePixelRatio, 1,5, 2)`, `DEGRAUS = [PR0, 1,5, 1,25, 1, 0,8]`.
  - Desce quando a média móvel exponencial do intervalo entre quadros desenhados passa de 28 ms.
  - Sobe quando cabe em `max(14, ciclo·1,2)` por 8 s; o ciclo da tela é medido nos quadros não desenhados, o que
    detecta 60/120/144 Hz.
  - **Backoff exponencial:** um degrau que já falhou só é tentado de novo depois de 30 s, 60 s, 120 s…
  - Abaixo de 1×, a sombra cai de 4096 para 2048.
  - `?qualidade=alta` trava no topo; `leve` começa no último degrau.
- **ECONOMIA** (`pointer: coarse` ou `deviceMemory ≤ 4`), no 3D e na 2D:
  - só os **dois horários em uso** ficam na GPU;
  - os outros são baixados só para o cache HTTP e sobem quando a hora chega;
  - os sem uso são liberados após 10 s;
  - `setHora` espera o horário estar pronto (`garante`).
- **Sem `backdrop-filter` em toque** (`--vidro-solido`): desfoque de vidro sobre um canvas WebGL força o compositor a
  refazer o desfoque a cada quadro do canvas.
- **Primeiro carregamento:** baixa primeiro só o horário de agora (ilha 4 + 4 à noite: 1,1 MB em vez de 4,4 MB). As
  camadas sobem para a GPU uma por quadro.

---

## 6. A planta 2D (`app/site/planta-imagem.js`)

- **A mesma interface do 3D** (`setFalha`, `setInativa`, `setHora`, `setDados`, `mostrarVaga`, `setZoom`…). O painel
  não sabe qual motor está usando.
- **Motor em SVG** com camadas de imagem (planta, teto em meia resolução a ~30%, `sobre` na ilha) e carros em imagem.
- **Escrita de atributo com cache** (`at()`): só toca o DOM quando o valor muda (evita recálculo de estilo e layout).
- **Ritmo de quadros igual ao 3D**, `IntersectionObserver`, ECONOMIA de horários.
- **Abre por padrão no celular** e em conexão lenta: ~1,1 MB e ~4,5 s em 4G até aparecer.

---

## 7. Selos (`app/site/selos.js`)

Rótulos HTML posicionados sobre a projeção das âncoras 3D/2D, usados pelos dois motores.

- **Sem layout thrashing:**
  - mede o tamanho (`offsetWidth`/`offsetHeight`, que forçam layout) só quando o texto muda (`esquece` invalida, por exemplo quando a fonte
    muda com a largura);
  - escreve a posição só quando ela muda.
- **Agrupamento como pinos de mapa** (no espírito do supercluster):
  - 3 ou mais selos de carro que se cruzam viram um selo "N carros", com tolerância vertical de 2 alturas;
  - tocar no grupo aproxima o zoom até eles caberem (`fatorParaGrupo`, limitado pela largura do palco);
  - `semGrupo` dá a histerese: não reagrupa até o usuário afastar o zoom de novo;
  - selos de bomba e avisos nunca se agrupam;
  - um grupo com carro em falha fica vermelho.

---

## 8. O painel (`app/site/painel.html`)

- **Simulação a 4 Hz, tela a 1 Hz**, como o mostrador de uma bomba.
  - Só a aba visível (`IntersectionObserver` sobre as abas) e nada com `document.hidden`.
  - Mudança de estado (chega, sai, falha) aparece na hora.
- **`Intl.NumberFormat` em cache** (`FMT_BRL`, `FMT_NUM`): `toLocaleString` instancia um formatador a cada chamada.
  Era o maior custo dos números.
- **Tela cheia:**
  - Fullscreen API + `screen.orientation.lock('landscape')` no Android;
  - no iOS, que não deixa a página fazer isso, pseudo tela cheia em CSS e aviso para girar.
- **Detalhe da bomba:** foto fixa `g00.webp` (~75 KB) no lugar do giro de 36 quadros (~2,5 MB).
- **`?qualidade=` no endereço** vale sobre a preferência guardada (`localStorage`).

---

## 9. Servidor e entrega (`app.mjs`)

- **Revalidação:**
  - `ETag` + `Last-Modified` + `Cache-Control: no-cache`, com resposta 304 vazia;
  - na segunda visita: 190 KB em vez de 3,3 MB;
  - cache `immutable` só com caminho versionado (ex.: `lego/<versão>/`).
- **Compressão em memória:**
  - brotli qualidade 6 (gzip se o navegador não aceitar) para js, json, html, css, svg **e glb**;
  - o three.js cai de 2 MB para ~0,5 MB.
- Em produção: CDN com as mesmas regras, autenticação, maquetes num bucket, validação da montagem no servidor e limite
  de tamanho dos envios.

### 9.1 Hospedagem só de arquivos (`online/`)

O GitHub Pages (e qualquer bucket ou CDN) não roda o `app.mjs`. A pasta `online/` resolve isso sem mudar o app:

- **`sw.js` é o `app.mjs` como service worker.** Ele mapeia os mesmos endereços (`app/site`, `app/dados`, `web`, `lego`)
  e implementa a API do construtor com a lógica de `fila-maquetes.mjs`.
- **A gravação vai para o Cache Storage do navegador** (`igreen-v3-online`). O que um visitante monta fica só com ele;
  o resto vem do pacote.
- **Respostas sintetizadas no endereço pedido** (`new Response(body)`, não `fetch` devolvido nem redirecionamento).
  - O mapa de módulos do navegador é indexado pelo endereço pedido, e a base de um módulo é o endereço da resposta.
  - Um redirecionamento faria o three.js e os motores carregarem duas vezes (instâncias diferentes, `instanceof`
    quebrado).
  - Só vídeo vai por redirecionamento, para o navegador pedir por partes (`Range`) direto no arquivo.
- **Portas de entrada:** cada página de `online/` é um HTML mínimo que instala o service worker e recarrega. Depois disso,
  o service worker responde no lugar dela com a página de verdade.
- **Pré-requisito:** caminhos relativos nas páginas (o construtor pede `api/...` e `./montador/web/...`). É o mesmo
  requisito para rodar numa subpasta do CRM.

---

## 10. Dados ao vivo: OCPP

- **O protótipo é simulado em `painel.html`, no formato que o carregador real entrega.** A integração da etapa 2 é
  ligar a fonte, não redesenhar a tela.
- **O carregador fala OCPP** (ex.: 1.6J):
  - `StatusNotification` traz o estado de cada conector: `Available`, `Preparing`, `Charging`, `SuspendedEV`/`EVSE`,
    `Finishing`, `Unavailable`, `Faulted`;
  - `MeterValues` traz as grandezas `Power.Active.Import`, `Energy.Active.Import.Register` e `SoC` (só DC);
  - a cadência das medidas é configurável (`MeterValueSampleInterval`).
- **Mapeamento sugerido** (a validar com o sistema da iGreen):

  | OCPP | Painel |
  |---|---|
  | `Preparing` | carro "conectando" |
  | `Charging` + `MeterValues` | `setDados(vaga, { kw, pct, prog, pessoa })` |
  | `Finishing` | "desconectando" |
  | `Faulted` | `setFalha(true, bomba)` |
  | `Unavailable` | `setInativa(true, bomba)` |

- **Regra de tela que vale com dado real:** desenhar no máximo 1×/s e só o que está à vista, por mais rápido que a
  medida chegue.
- Perguntas de negócio em aberto (simultaneidade da Mobi Fast, divisão da Ultra e outras): `PERGUNTAS-IGREEN.md` na
  pasta da V3.

---

## 11. Números medidos

Celular médio simulado (Chrome DevTools: CPU 4× mais lenta, emulação móvel), Shopping Norte (ilha de 8 vagas):

| Medida | Antes | Agora |
|---|---|---|
| 3D, CPU por quadro com 7 carros parados | 21 ms (carro original) | 2,6–3,6 ms |
| 3D, chamadas de desenho | 820 | 63 |
| 3D, quadro durante chegada de carro | 53 ms | 8–9 ms |
| 3D, quadros/s com 6 carregando | 22 | 41 |
| 2D, quadros/s com 6 carregando | 19 | 55 |
| 2D, zoom | 20 quadros/s, pior quadro 550 ms | 30–33 quadros/s, pior 50 ms |
| 2D, abrir em 4G (1ª visita) | 5,7 s / 2,8 MB | ~4,5 s / ~1,1 MB |
| 3D, abrir em 4G (1ª visita) | 18 s / 7,1 MB | ~14 s / ~2,9 MB |
| Trabalho dos números por segundo (2D / 3D) | 239 / 105 ms | 13 / 4 ms |
| Similaridade visual, foto × 3D | — | SSIM 99,6% |

**Como medir sem se enganar:**
- feche outras abas do navegador (a competição de CPU dobrou os números);
- deixe a página **na frente** (aba em segundo plano roda a 1 quadro/s);
- conte as chamadas de desenho por um gancho no contexto WebGL injetado antes do carregamento.

---

## 12. Mapa dos arquivos

| Arquivo | Linhas | Papel |
|---|---|---|
| `app/site/maquete.js` | ~1.500 | motor 3D: camadas, oclusores, luzes, carro, impostor, sombra, degraus, selos 3D |
| `app/site/planta-imagem.js` | ~650 | motor 2D (SVG), mesma interface |
| `app/site/selos.js` | ~100 | medição, posição e agrupamento dos selos |
| `app/site/estado-bomba.js` | ~100 | falha e desligada a partir de `estados.png` |
| `app/site/painel.html` | ~3.200 | o painel: simulação, abas, números, tela cheia, demonstração |
| `web/lego.js` | ~470 | planejamento (regras de fileira, ilha e cobertura) e composição das peças |
| `web/montar-soltas.js` / `-worker.js` | ~100 / ~140 | orquestração e Workers |
| `web/lateral.js`, `web/lateral-plano.js`, `web/base/dados-lateral.js` | — | vagas paralelas: composição das peças de `lego-lateral/` (chão por células, sombra em dois níveis, luz como irradiância), a geometria (ilhas, trechos do teto, pilares) e as âncoras, luzes e planta |
| `app/site/construtor-lateral.html` | ~600 | o construtor das vagas paralelas (o estilo é o do `construtor.html`) |
| `web/base/compor.js`, `chaves.js`, `dados-sem-blender.js` | — | cor e brilho, chaves das peças, âncoras, luzes e cabos sem Blender |
| `app.mjs`, `app/fila-maquetes.mjs` | ~100 / ~90 | servidor, cache, compressão, API das maquetes |
| `online/sw.js`, `online/entrar.js` | ~170 / ~40 | o `app.mjs` como service worker, para hospedagem só de arquivos (seção 9.1) |

Na pasta da V3 (fora deste pacote): `ferramentas/preparar-lego.mjs` (corta as peças) e `ferramentas/carro-leve.mjs`
(gera o carro leve).

---

## 13. Invariantes: o que não pode quebrar

Cada item abaixo, se mudado sem saber, quebra tudo **sem dar erro**: o resultado só fica "estranho".

1. **Câmera fixa e ortográfica, idêntica à do Blender.** Mudar ângulo, projeção ou escala invalida as ~2.200 peças e
   todas as maquetes já montadas.
2. **Deslocamento por vagas inteiras (`DU`)** e máscara de coluna pelo ponto do chão/teto. Não trocar por recorte em
   retângulo de tela.
3. **Composição em luz linear**, imagens em "luz/2", byte 188 como sombra neutra, Khronos PBR Neutral no fim. O mesmo
   tone map no 3D (`NeutralToneMapping`).
4. **Conjunto fixo de luzes (8 + 3).** Adicionar uma luz "só para testar" recompila os shaders do carro em toda
   maquete.
5. **Sem `compileAsync`, e com o aquecimento progressivo.** É o que evita a página travada no primeiro carro.
6. **Sombra em cache:** tudo que move algo que projeta sombra precisa marcar `sombraSuja`.
7. **Impostor:** pixels por unidade a partir de `PR0`, nunca do `pixelRatio` atual; tone map antes dos mipmaps;
   `gl_FragDepth` no quad.
8. **Assinatura da maquete** idêntica no construtor, em `fila-maquetes.mjs`, em `remontar.html` e em `online/sw.js`.
9. **`lego/` não se edita à mão.** Peças novas: troque a pasta e rode `/montador/web/remontar.html`.
10. **Selos só por `selos.js`** (medir no texto, escrever na diferença). Escrever estilo a cada quadro volta ao
    layout thrashing.
11. **Números: 1 Hz e só o visível**, com formatadores em cache.

---

## 14. Limites conhecidos e etapa 2

- **Safari/iPhone nunca testado.** Pontos de risco:
  - webp no `OffscreenCanvas.convertToBlob` (pode sair PNG);
  - Workers de módulo;
  - `EXT_color_buffer_float` (sem ele o carro fica 3D, mais pesado);
  - tela cheia.

  Roteiro em `ROTEIRO-TESTE-APARELHOS.md`, na pasta da V3.
- **A montagem roda no navegador de quem salva.** Se for preciso, o mesmo montador pode virar um serviço (Node com
  canvas): hipótese, não testada.
- **Dados simulados.** Ligar ao OCPP real (seção 10), login dentro do CRM, armazenamento das maquetes, validação no
  servidor.
- **Design em polimento**, já com tokens (cores, superfícies, temas claro e escuro) para levar aos CRMs.

---

## 15. Glossário (nome no código → conceito)

| No código | Conceito |
|---|---|
| maquete (`m-xxxxxxxx`) | o conjunto de camadas e dados de um formato de posto, endereçado pela assinatura |
| peça, Lego, `lego.json` | sprite pré-renderizado com retângulo, coluna-âncora, modo de mistura e profundidade |
| vista | 3D (isométrica) ou planta (vista de cima) |
| horário, período (`manha`, `tarde`, `por`, `noite`) | uma iluminação assada; o painel faz crossfade entre dois |
| fundo, teto, sobre, copa | camadas de imagem: atrás de tudo, por cima dos carros, fundos da ilha, árvore na frente do carro dos fundos |
| oclusor | proxy só de profundidade (`colorWrite: false`) |
| âncoras (`ancoras.json`) | posições de vagas, bombas, conectores e luzes no mundo 3D |
| foto do carro | impostor dinâmico com profundidade |
| degrau | nível da resolução dinâmica |
| ECONOMIA | modo de memória do celular (horários sob demanda) |
| leve | qualidade baixa escolhida: carros em imagem, 1×, 30/12 quadros por segundo |
| selo | rótulo HTML projetado sobre a cena |
| montagem | a descrição do posto que o construtor salva |
| assinatura | a chave canônica do formato (deduplicação) |
