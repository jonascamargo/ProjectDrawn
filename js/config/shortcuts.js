// Atalhos do app. Para mudar ou adicionar, edite aqui; o resto do app só lê este arquivo.
// O texto de ajuda de cada atalho vem do idioma ('shortcut.<nome>' em js/i18n/).
// Teclas: combinações como 'Ctrl+A', 'Shift+F', 'Delete' (Ctrl também vale Cmd no Mac).
// Mouse: botões 'left' | 'middle' | 'right'; modificadores 'Ctrl' | 'Shift' | 'Alt'.
export const shortcuts = {
  keys: {
    selectAll: { combos: ['Ctrl+A'] },
    clearSelection: { combos: ['Escape'] },
    deleteSelection: { combos: ['Delete', 'Backspace'] },
    frameAll: { combos: ['F'] },
    zoomReset: { combos: ['Home'] },
    toggleInspector: { combos: ['I'] },
  },
  mouse: {
    panHoldKey: { key: 'Space' },
    panButton: { button: 'right' },
    nodeMenu: { button: 'right' },
    connectWire: { button: 'left' },
    addReroute: { button: 'left', double: true },
    toggleArea: { button: 'left', double: true },
    resizeArea: { button: 'left' },
    moveWires: { modifier: 'Ctrl' },
    breakWires: { modifier: 'Alt' },
    multiSelect: { modifier: 'Shift' },
    noSnap: { modifier: 'Alt' },
    leaveArea: { modifier: 'Ctrl' },
  },
};
