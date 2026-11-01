# ProjectDrawn

Web app para planejar e documentar projetos de forma visual: pastas, arquivos e a lógica dos scripts desenhados como nós, no estilo dos Blueprints da Unreal Engine. Começa com GDScript (Godot), mas o núcleo é independente de linguagem.

## Acessar online

**https://jonascamargo.github.io/ProjectDrawn/**

Publicado pelo GitHub Pages a partir da branch `main`. Use o Chrome ou o Edge: são eles que permitem vincular projetos a arquivos no disco e exportar os scripts para uma pasta. Os projetos ficam guardados no navegador, separados por endereço, então para levar um projeto do `localhost` para o site use exportar/importar JSON no launcher.

## Como rodar localmente

O app usa HTML, CSS e JavaScript puro (ES modules), sem etapa de build. Ele precisa ser servido por um servidor estático (não funciona abrindo o `index.html` direto do disco):

```bash
python -m http.server 5173
```

Depois abra `http://localhost:5173` no Chrome ou Edge (necessários para vincular projetos a arquivos no disco).

## Estrutura

- `docs/especificacao.md` — especificação e etapas
- `js/config/shortcuts.js` — todos os atalhos do app
- `js/core` — nó, pino, tipos de fio, regras de ligação (`wires.js`), leitura dos atalhos e elementos do canvas (`scene.js`: nós e fios)
- `js/core/canvas` — câmera, grade, seleção, entrada (mouse/teclado), menu de criar nó, curva dos fios e desenho do canvas
- `js/lang/teste` — linguagem de teste (nós e tipos de dado) usada até a etapa 3
- `js/theme` — cores, fontes e medidas (o núcleo só lê esses valores)
- `fonts/` — JetBrains Mono (licença OFL)
- `tests/` — testes em Node: `node --test`
