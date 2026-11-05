// Volta o primeiro acesso ao começo: o cadastro (dados/postos.json) igual ao inicial (o Posto Lagoa comprado e ainda
// não montado). A maquete que já foi montada fica em dados/ (a pasta tem o nome do formato: montar o mesmo formato de
// novo reaproveita a pasta) e a montagem antiga vai para dados/montagens/_arquivo (a fila do app faz isso sozinha).
// O navegador guarda o rascunho do construtor e o "já montei" da tela Meu posto: para ver do zero, use uma janela anônima.
// Uso: node v3/primeiro-acesso/zerar.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = path.dirname(fileURLToPath(import.meta.url)), dados = path.join(aqui, 'dados')
fs.mkdirSync(path.join(dados, 'montagens'), { recursive: true })
fs.copyFileSync(path.join(aqui, 'inicial', 'postos.json'), path.join(dados, 'postos.json'))
const reg = JSON.parse(fs.readFileSync(path.join(dados, 'postos.json'), 'utf8'))
console.log('primeiro acesso zerado:', reg.postos.map((p) => `${p.nome} (${p.bombas.length} bombas, sem maquete)`).join(', '))
