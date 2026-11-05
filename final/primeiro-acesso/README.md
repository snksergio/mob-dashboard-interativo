# Primeiro acesso: o dono que ainda não montou o posto (4/11)

O fluxo completo da primeira vez: o dono entra no painel, o posto dele ainda não tem maquete, ele monta no construtor, a
maquete é feita na hora no navegador e o painel abre com o posto dele funcionando.

Fica separado do app da V3: tem o próprio cadastro (`dados/`), com uma conta que comprou 3 bombas (Posto Lagoa: 2 Mobi
Fast e 1 Mobi) e ainda não montou nada. As páginas são as mesmas do app (`app/site`).

## Como abrir

```bash
node v3/app.mjs 5301 --dados primeiro-acesso/dados
```

(atalho "v3-primeiro-acesso" no launch.json) e abra http://localhost:5301/painel.html numa **janela anônima**: o
navegador guarda o rascunho do construtor e o tour já visto, e na janela anônima tudo começa do zero.

Para recomeçar depois de montar: `node v3/primeiro-acesso/zerar.mjs` (o cadastro volta ao inicial).

## O fluxo

As telas de cada passo estão em `telas/`, no computador (1440 × 900) e no celular (390 × 844).

| Passo | O que o dono vê | Telas |
|---|---|---|
| 1. Painel, posto ainda não montado | No lugar da maquete, o posto em obra (o guindaste erguendo a cobertura, o G da iGreen pintado numa vaga e sendo pintado na outra, com lata e rolo; imagem editada pelo Codex, `montando-obra-logo.webp`) e "Seu posto ainda não está montado" com o botão **Montar meu posto**. Na coluna, as bombas que ele comprou ("Esperando a montagem do posto") e o que o painel mostra depois de montar. Sem os controles da maquete (não há maquete ainda). | `computador-1`, `celular-1` |
| 2. Construtor, primeiro acesso | "Monte o seu posto", mapa vazio e o tour de 7 passos (abre sozinho uma vez). "Voltar" leva de volta ao painel. | `computador-2`, `celular-2` |
| 3. As bombas no mapa | Ele põe as bombas (arrastando ou tocando nelas), escolhe vagas, fileira e cobertura. | `computador-3`, `celular-3` |
| 4. Confirmar | "Seu posto vai ficar assim": a figura, o resumo e **Criar meu posto**. | `computador-4`, `celular-4` |
| 5. Criando | O vídeo do posto se montando e a barra. A maquete é montada no navegador com as peças de Lego (5 a 10 s; no celular, um pouco mais). | `computador-5`, `celular-5` |
| 6. Painel com o posto | O posto dele em 3D (no computador) ou na vista de cima (no celular), com os carros carregando, e o aviso "Seu posto está montado", que some sozinho. | `computador-6`, `celular-6` |

## O que mudou no app para este fluxo (vale para o app todo)

- `app/site/painel.html`: posto sem maquete abre o estado de primeiro acesso (antes o painel caía no posto de exemplo);
  o aviso de boas-vindas (`?boasvindas=1`); a espera da tela de carga aceita mais de um que espera; no celular, os avisos
  ficam no vão acima da maquete (antes cobriam o card "A caminho").
- `app/site/construtor.html`: `?volta=painel` (o "Voltar" do primeiro acesso volta ao painel); depois de criar, no
  celular o painel escolhe a vista (a 2D, mais leve) em vez de forçar o 3D; no primeiro acesso o painel recebe o aviso de
  boas-vindas; no celular, o tour rola a parte de cada passo para a tela e o rodapé da confirmação cabe na tela.
- `app.mjs`: `--dados <pasta>` (outro cadastro; as imagens fixas continuam vindo de `app/dados`).

## Pastas

- `inicial/postos.json`: o cadastro do começo (o Posto Lagoa sem maquete);
- `dados/`: o cadastro em uso; o servidor grava aqui a montagem e a maquete do posto (a pasta da maquete tem o nome do
  formato, então montar o mesmo formato de novo reaproveita a mesma pasta);
- `telas/`: as telas do fluxo;
- `zerar.mjs`: volta o cadastro ao inicial.
