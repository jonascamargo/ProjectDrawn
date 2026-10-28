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

- `js/core` — modelo do projeto, comandos (desfazer/refazer), eventos, configurações
- `js/canvas` — câmera, renderização, layout e interação no canvas
- `js/editor` — editor de itens e sessão do projeto (autosave, arquivo vinculado)
- `js/storage` — IndexedDB, importação/exportação, arquivo no disco
- `js/ui` — launcher, modais, toasts, menus, breadcrumbs
- `themes/` — temas em JSON (cores, formas dos nós e pinos)
- `languages/` — perfis de linguagem em JSON
- `i18n/` — textos da interface
