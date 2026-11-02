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
- `js/core` — nó (campos e inferência), pino, tipos de fio, regras de ligação (`wires.js`), cena (`scene.js`: nós e fios), atalhos, idioma (`i18n.js`) e salvamento (`storage.js`)
- `js/core/canvas` — câmera, grade, seleção, entrada (mouse/teclado), menu de criar nó, curva dos fios e desenho do canvas
- `js/core/concepts` — conceitos (um por arquivo): o que cada tipo de nó é, sem linguagem
- `js/core/languages.js` — registro de linguagens (a extensão do arquivo escolhe a linguagem)
- `js/lang/godot` — GDScript (.gd): tipos e funções globais em `api/core.js`, gerado da API da Godot
- `tools/godot_api.py` — gera `js/lang/godot/api/core.js` do `extension_api.json` (rodar ao trocar a versão da Godot)
- `js/lang/teste` — linguagem de teste (só para os testes em Node); `js/lang/teste2` — .gdshader de teste até a etapa 6
- `js/ui` — telas em HTML (inspetor)
- `js/i18n` — textos de ajuda por idioma (hoje `pt-BR.js`); nomes ficam em inglês
- `js/theme` — cores, fontes, medidas e variáveis da interface (o núcleo só lê esses valores)
- `icons/` — ícones SVG das etiquetas (função, evento, loop, condicional, pasta, arquivo, classe), do botão abrir/fechar das áreas e do desconectar no inspetor; a linguagem escolhe arquivo e cor
- `fonts/` — JetBrains Mono (licença OFL)
- `tests/` — testes em Node: `node --test`
