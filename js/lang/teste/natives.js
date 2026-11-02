// Métodos nativos da linguagem de teste (como os da Godot): uma Function com o mesmo nome os
// sobrescreve; nome, parâmetros e retorno vêm daqui (travados; parâmetros extras, com valor padrão,
// podem vir depois). returns: null = nenhum (void).
export const natives = [
  { name: '_ready', params: [], returns: null },
  { name: '_process', params: [{ name: 'delta', type: 'float' }], returns: null },
  { name: '_physics_process', params: [{ name: 'delta', type: 'float' }], returns: null },
  { name: '_input', params: [{ name: 'event', type: 'any' }], returns: null },
];
