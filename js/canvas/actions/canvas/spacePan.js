// Com Espaço pressionado o canvas está em modo de pan: o cursor fica com o navegador.
export default {
  id: 'canvas.spacePan',
  area: '*',
  priority: 50,
  hover: {
    when: (c) => c.viewport.isSpaceDown,
    run: () => true,
  },
};
