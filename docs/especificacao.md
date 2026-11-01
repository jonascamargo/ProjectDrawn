# ProjectDrawn — Especificação v1

## 1. O que é

Web app para **desenhar sistemas** num **canvas único**: scripts de várias linguagens, pastas e arquivos.
O app **não compila nem executa** nada, mas respeita as regras e relações de cada linguagem.

Tecnologia: JavaScript puro, sem build, publicado no GitHub Pages.

## 2. Camadas (cada uma em scripts separados)

| Camada | Conteúdo | Sabe de linguagem? |
|---|---|---|
| **Núcleo** | canvas, nós, pinos, fios, áreas, seleção, inspetor | Não |
| **Conceitos** | tipo primitivo, tipo composto, classe, objeto, propriedade, método, construtor, encapsulamento, herança, polimorfismo, abstração, interface, composição, getter, setter, estruturas de controle… | Não (só define o que cada conceito é) |
| **Linguagens** (`lang/godot/…`) | bibliotecas, regras, padrões, cores — em arquivos separados. Diz como cada conceito aparece na linguagem e o que é permitido | Sim |
| **Tema** | visual de tudo: nós, fios, pinos, canvas, telas, campos, fontes | Não |
| **Telas do app** | inspetor, busca, etc. | Não |

Princípio: **o núcleo executa as regras, a linguagem define as regras.** O núcleo define os conceitos; cada linguagem só os "veste".

## 3. Elementos

### Pino
- **Tipo**: que dado aceita. Representado por um ícone.
- **Direção**: entrada (lado esquerdo) ou saída (lado direito).
- **Conexões**: número máximo de fios.

### Fio
- **Tipos**: dados, fluxo, condicional (saídas verdadeiro/falso de um `if` etc.) e configuração (ex.: `@export` ligado a uma variável).
- O tipo é identificado pelo **ícone**, no pino e no fio.
- **Reroute**: pontos no meio do fio para organizar o desenho.
- Modular: dá para criar novos tipos de fio.

### Nó
- **Nó comum**: título, pinos e campos no inspetor.
- **Nó de área** (pasta, arquivo, classe, função…):
  - **fechado**: tem o visual de um nó comum;
  - **aberto**: vira uma área de programação. O nó cabeçalho fica fixo no canto superior esquerdo da área, com um pino de execução à direita.
- Nós, pinos e fios são **dinâmicos**: estrutura e conteúdo mudam conforme as ligações e a configuração no inspetor.

### Canvas e seleção
- Desenho em **Canvas 2D**. Campos de texto são editados no inspetor (ou num campo que aparece sobre o nó durante a edição).
- **Mover a vista**: Espaço + arrastar, ou botão direito + arrastar (clique direito sem arrastar fica livre para um menu).
- **Zoom**: roda do mouse, no ponteiro, de 10% a 400%. **F** enquadra tudo, **Home** volta a 100%.
- **Grade** de pontos; ao soltar, os elementos encaixam nela (**Alt** desliga o encaixe).
- **Seleção**: clique; **Shift**+clique soma ou tira (o Ctrl fica para as áreas); **Ctrl+A**; **Esc** limpa; **Delete** apaga.
- **Retângulo de seleção** (como no CAD): da esquerda para a direita, contorno contínuo, pega só o que fica **inteiro dentro**; da direita para a esquerda, tracejado, pega o que **toca**.
- A seleção fica **presa à área onde começou**: começando numa função não pega nada da raiz; começando num script não pega pastas do diretório pai.

## 4. Áreas

- Pastas, arquivos, classes e funções são áreas, umas dentro das outras.
- O tamanho da área é **dinâmico** e acompanha o conteúdo. Ao expandir ou encolher uma área filha (ex.: pasta dentro de pasta), a área pai cresce ou encolhe junto.
- Arrastar um elemento dentro de uma área faz a área pai crescer.
- Arrastar segurando **Ctrl** tira o elemento da área: ele vai para a área pai (ou para o canvas, se não houver pai) e a área de origem encolhe. Quem decide é o Ctrl **no momento de soltar o mouse**: se o Ctrl for solto antes, o elemento continua na área e a faz crescer.
- O contrário também vale: arrastar um elemento para dentro de uma área o coloca nela, se for permitido.
- Elementos de script só saem da área de script para outra área de script do **mesmo tipo** (`.gd` → `.gd`, `.json` → `.json`…).
- Elementos externos (pastas, arquivos…) arrastados para uma área de script viram um **caminho** para o elemento: o original volta ao lugar e surge um nó de caminho no script (ex.: `res://pasta/arquivo.gd`).
- Arrastar para uma área não permitida faz o elemento **voltar à posição inicial**.

## 5. Salvar

- Inicialmente, tudo fica salvo no navegador.
- Opção de criar um arquivo JSON por projeto e sincronizar com ele.

## 6. Escopo inicial

Godot 4.7.1: GDScript, Godot Shader, `.tscn`, `.tres` e `.json`.
Gerar código a partir do desenho e importar código existente: sim, os dois, na etapa final.

## 7. Etapas

| Etapa | Entrega |
|---|---|
| 1a | Canvas: arrastar a vista, zoom, grade, seleção (clique e retângulo) |
| 1b | Nós e pinos genéricos: criar, mover, apagar; pino com tipo, lado e limite |
| 1c | Fios: os 4 tipos com ícone, validação (tipo, lado, limite), reroute |
| 1d | Inspetor básico e salvar no navegador |
| 2 | Nós de área: abrir/fechar, cabeçalho fixo, tamanho dinâmico, regras de arrastar |
| 3 | Conceitos no núcleo e sistema de linguagem (regras vêm da linguagem) |
| 4 | `lang/godot`: GDScript básico (variáveis, funções, controle, classes) |
| 5 | Sincronizar com o arquivo JSON do projeto |
| 6 | `.tscn`, `.tres`, shader, `.json` |
| 7 | Tema modular |
| 8 | Gerar e importar código |

Primeira entrega ("o app nasceu"): fim da etapa 1, canvas com nós e fios genéricos. Tema não é prioridade agora.
