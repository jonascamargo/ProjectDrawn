// Atalhos do app. Para mudar ou adicionar, edite aqui; o resto do app só lê este arquivo.
// Teclas: combinações como 'Ctrl+A', 'Shift+F', 'Delete' (Ctrl também vale Cmd no Mac).
// Mouse: botões 'left' | 'middle' | 'right'; modificadores 'Ctrl' | 'Shift' | 'Alt'.
export const shortcuts = {
  keys: {
    selectAll: { combos: ['Ctrl+A'], label: 'selecionar tudo' },
    clearSelection: { combos: ['Escape'], label: 'limpar seleção' },
    deleteSelection: { combos: ['Delete', 'Backspace'], label: 'apagar' },
    frameAll: { combos: ['F'], label: 'enquadrar tudo' },
    zoomReset: { combos: ['Home'], label: 'zoom 100%' },
  },
  mouse: {
    panHoldKey: { key: 'Space', label: 'segurar + arrastar: mover a vista' },
    panButton: { button: 'right', label: 'arrastar: mover a vista' },
    nodeMenu: { button: 'right', label: 'clique no vazio: criar nó' },
    multiSelect: { modifier: 'Shift', label: '+ clique ou retângulo: somar/tirar da seleção' },
    noSnap: { modifier: 'Alt', label: 'ao soltar: sem encaixe na grade' },
  },
};
