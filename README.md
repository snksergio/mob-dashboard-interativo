# Painel do eletroposto · iGreen Mob (protótipo)

Protótipo navegável do painel em tempo real para o dono de eletroposto. Os dados são simulados: um dia de demonstração gera chegadas, recargas e uma falha.

- **Painel:** https://snksergio.github.io/mob-dashboard-interativo/
- **Demonstração da maquete:** https://snksergio.github.io/mob-dashboard-interativo/demo.html
- **Outro posto:** acrescente `?posto=` com mobi, fast-mobi, fast-mobi-sem, fast-fast, fast-ultra, ultra, ultra-sem ou fast-sem.

A maquete mistura duas coisas. O fundo e o teto são renders do Blender (Cycles), um por período do dia. Os carros, cabos, selos e o preço são 3D ao vivo, em three.js.

Para gerar de novo, rode `node exportar-pages.mjs` na pasta `proposta-02` do projeto.
