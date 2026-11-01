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
- **Tipo**: que dado aceita. Representado por um ícone: a **forma** diz o tipo de fio (fluxo = triângulo, dados = círculo, condicional = losango, configuração = quadrado) e a **cor** diz o tipo de dado.
- **Direção**: entrada (lado esquerdo) ou saída (lado direito).
- **Conexões**: número máximo de fios. Padrão pelo tipo de fio (como na Unreal): entrada de dados 1, saída de dados sem limite; entrada de fluxo sem limite, saída de fluxo 1; condicional como dados (entrada 1, saída sem limite); configuração como fluxo. Cada pino pode mudar o seu.
- Ao passar o mouse, o pino destaca e mostra uma dica com tipo de fio, tipo de dado, lado e limite.

### Fio
- **Tipos**: dados, fluxo, condicional (valor lógico: resultado de comparação, "e", "ou"…, que alimenta a condição de um `if`; as saídas verdadeiro/falso do `if` são fluxo) e configuração (ex.: `@export` ligado a uma variável).
- O tipo é identificado pelo **ícone**, no pino e no fio.
- **Reroute**: pontos no meio do fio para organizar o desenho. Criado com duplo clique no fio; vira de lado sozinho quando o destino fica à esquerda da origem (como na Unreal); arrasta, seleciona e apaga como um nó; a área de clique é maior que o ponto visível (bordas puxam fio, meio arrasta). Apagar um reroute refaz o fio ligando direto as duas pontas.
- **Formato**: curva, saindo e chegando na horizontal. Cor do tipo de dado (sem tipo de dado: condicional em vermelho, fluxo e configuração em branco); ícone do tipo de fio no meio; pino com fio fica preenchido.
- **Ligar**: arrastar de um pino (saída ou entrada) até outro. Só liga saída → entrada, nunca no mesmo nó. Tipos de fio que ligam: fluxo → fluxo, condicional → condicional, dados → dados, configuração → configuração (o núcleo define; novos tipos dizem em quais ligam). Tipos de dado: a linguagem decide (na linguagem de teste: mesmo tipo, ou "qualquer").
- Enquanto puxa: pinos compatíveis destacados, incompatíveis apagados; sobre um incompatível, a dica mostra o motivo (ex.: "texto não aceita número").
- **Limite**: soltar num pino que já está no limite substitui o fio mais antigo.
- **Soltar no vazio**: abre a busca só com os nós que têm pino compatível; o nó escolhido nasce ligado, com o pino no ponto.
- **Ctrl + arrastar** num pino leva todos os fios dele para outro pino (como na Unreal); soltar no vazio apaga esses fios; num pino incompatível, nada muda.
- **Alt + clique** num pino solta todos os fios dele. Clique no fio seleciona; Delete apaga. Apagar um nó apaga os fios dele.
- Modular: dá para criar novos tipos de fio.

### Nó
- **Nó comum**: título, pinos e campos no inspetor.
- **Nó de área** (pasta, arquivo, classe, função…):
  - **fechado**: tem o visual de um nó comum;
  - **aberto**: vira uma área de programação. O nó cabeçalho fica fixo no canto superior esquerdo da área, com um pino de execução à direita.
- **Criar nó**: clique direito no vazio (sem arrastar) abre uma busca no ponto; a busca ignora acentos.
- O tamanho do nó acompanha o conteúdo (título e nomes dos pinos).
- Clicar num elemento traz ele para a frente. Nas áreas (etapa 2), clicar no cabeçalho, no corpo ou num nó dentro traz a área inteira para a frente.
- Nós, pinos e fios são **dinâmicos**: estrutura e conteúdo mudam conforme as ligações e a configuração no inspetor.

### Visual dos nós (1c2)
- Fonte **JetBrains Mono** (arquivos em `fonts/`): cabeçalho semibold 14px, o resto regular 14px.
- Corpo `#2E2E2E`, borda `#212121`, cantos de 18px; fundo do canvas `#1d1f24`.
- **Fios**: espessura 2; fio de fluxo 4.
- **Seleção**: a borda do nó selecionado fica na cor do tipo dele (tag); sem tipo, azul. Reroute selecionado: anel na cor do fio.
- **Pinos**: 12px no corpo, 13px no cabeçalho (e no nó compacto); contorno grosso com cantos arredondados (círculo, quadrado arredondado, triângulo arredondado, losango arredondado).
- Medidas: **cabeçalho de 40px** (10px acima e abaixo da etiqueta); nó compacto também com 40px; 14px de padding nas laterais e na base do corpo; 14px entre o pino de execução e o resto do cabeçalho; 10px abaixo da linha divisória; 10px entre os elementos do corpo.
- **Linhas do corpo**: cada pino na sua linha; uma entrada e uma saída com o mesmo id (o dado entra à esquerda e sai à direita) dividem a linha. Ordem: entradas (com o par), depois saídas sem par. Vale também para nós só com entradas ou só com saídas.
- **Cabeçalho**: [pino de execução de entrada] [tag do tipo] nome [pino de execução de saída]. Vão para o cabeçalho os pinos de fluxo **sem nome**; os de fluxo com nome (verdadeiro/falso) ficam no corpo.
- **Tag de tipo**: pílula na cor do tipo de dado, texto `#2E2E2E`, com a etiqueta curta da linguagem (na de teste: `num`, `txt`, `bol`, `any`). Só em nós que têm um tipo principal (`tag` na definição).
- **Nó compacto** (`compact` na definição): uma linha só, [entrada] tag nome [saída].
- Todos esses valores ficam no tema (`js/theme/default.js`).
- **Ícones** (função, evento, loop, condicional): arquivos SVG em `icons/`, desenhados a 14px de altura na cor `#2E2E2E`, dentro da etiqueta na cor do ícone. Nós com ícone têm a **borda** nessa cor. Cada linguagem define arquivos e cores (`icons` da linguagem); na de teste: função `#0A6CC2`, evento `#C20A0A`, loop `#C2850A`, condicional `#666666` (Greater, And).
- Para depois: campo de valor dentro do nó.

### Textos e idiomas (1d)
- **Nomes** sempre em inglês: código (classes, funções), título dos nós, pinos, categorias, campos do inspetor.
- **Ajuda** no idioma escolhido: dicas, motivos de não ligar, lista de atalhos, mensagens, tutoriais. Ficam em `js/i18n/<idioma>.js` (hoje `pt-BR.js`); outro idioma é um arquivo novo.

### Inspetor (1d)
- Painel à **esquerda**, aberto ao iniciar; **I** recolhe e abre (uma tela de configurações gerais virá depois).
- **Nó**: campos definidos pela linguagem (`fields`). Ex.: Variable tem Name (vira o título), Type (tipo dos pinos e da tag) e Infer type (o tipo vem do fio ligado na entrada `value`, como o `:=` do GDScript; o Type fica travado e a entrada aceita qualquer tipo).
- **Trocar o tipo** pelo inspetor desconecta todos os fios do nó. Na inferência, saem só os fios que deixaram de servir.
- **Fio**: origem, destino, tipo de fio e de dado (só leitura). **Vários selecionados**: a quantidade.
- A interface em HTML (inspetor, menu, dicas) usa as variáveis CSS `--ui-*` geradas de `theme.ui`.
- O menu do navegador no clique direito fica desligado no app (menos nos campos de texto).

### Canvas e seleção
- Desenho em **Canvas 2D**. Campos de texto são editados no inspetor (ou num campo que aparece sobre o nó durante a edição).
- **Mover a vista**: Espaço + arrastar, ou botão direito + arrastar (clique direito sem arrastar fica livre para um menu).
- **Zoom**: roda do mouse, no ponteiro, de 10% a 400%. **F** enquadra tudo, **Home** volta a 100%.
- **Grade** de pontos; ao soltar, os elementos encaixam nela (**Alt** desliga o encaixe).
- **Seleção**: clique; **Shift**+clique soma ou tira (o Ctrl fica para as áreas); **Ctrl+A**; **Esc** limpa; **Delete** apaga.
- **Retângulo de seleção** (como no CAD): da esquerda para a direita, contorno contínuo, pega só o que fica **inteiro dentro**; da direita para a esquerda, tracejado, pega o que **toca**.
- **Atalhos** ficam todos em `js/config/shortcuts.js`; mudar ou adicionar é só editar esse arquivo (uma tela para isso fica para depois).
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

### Áreas na prática (2a)
- **Fechada**: um nó compacto de 40px: [ícone] nome [▷ execução, na Function] [⇕].
- **Aberta**: moldura arredondada (fundo um pouco mais escuro que o canvas, borda na cor da área), cabeçalho no canto superior esquerdo e puxador no canto inferior direito.
- **Abrir/fechar**: botão ⇕ (ícones `node-head-open.svg` / `node-head-close.svg`) ou duplo clique no cabeçalho. O cabeçalho fica parado no lugar.
- **Mover**: arrastar o cabeçalho leva a área com tudo dentro. **Tamanho**: o conteúdo mais a margem (cresce e encolhe; se um nó passa da borda esquerda/de cima, a área anda até ele); o puxador só aumenta.
- Clique no **corpo vazio** começa a seleção por retângulo presa à área; clique direito ali cria o nó **dentro** dela, e o menu mostra só o que a área aceita.
- **Regras da linguagem** (`contains`): Folder aceita Folder e File; File aceita Class, Function e nós; Class aceita Function e nós; Function aceita nós; a raiz aceita tudo.
- **Cores**: Folder usa a cor padrão (personalizável no inspetor); File, a cor da extensão do nome; Class `#196633`; Function `#0A6CC2`.
- **Fios** só ligam nós da mesma área; os pinos do cabeçalho de uma área contam como de dentro dela. Para usar algo de fora: nó de referência (get/set, etapa 2c).
- Apagar uma área apaga tudo o que está dentro. Salvar guarda a hierarquia, aberta/fechada e o tamanho do puxador.

## 5. Salvar

- Inicialmente, tudo fica salvo no navegador (**IndexedDB**), sozinho, logo depois de cada mudança; ao abrir, volta como estava (nós, valores, fios, câmera). Um projeto só por enquanto; os nós de exemplo aparecem só na primeira vez. Banco `projectdrawn-canvas` (o `projectdrawn` é do app antigo e não é tocado).
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
| 2 | Nós de área — **2a** áreas (abrir/fechar, cabeçalho, tamanho, regras de conter, fios na mesma área); **2b** arrastar entre áreas (Ctrl, script só para script, volta se proibido, caminho); **2c** referências (Ctrl+clique = get, Alt+clique = set, ao lado da variável) |
| 3 | Conceitos no núcleo e sistema de linguagem (regras vêm da linguagem) |
| 4 | `lang/godot`: GDScript básico (variáveis, funções, controle, classes) |
| 5 | Sincronizar com o arquivo JSON do projeto |
| 6 | `.tscn`, `.tres`, shader, `.json` |
| 7 | Tema modular |
| 8 | Gerar e importar código |

Primeira entrega ("o app nasceu"): fim da etapa 1, canvas com nós e fios genéricos. Tema não é prioridade agora.
