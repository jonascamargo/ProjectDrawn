// GDScript (Godot 4.7): tipos, funções globais e métodos virtuais vêm da API gerada (api/, por
// tools/godot_api.py); os nós são escritos aqui. Arquivos .gd são dela, e cada .gd é uma classe
// (class_name e extends no inspetor do arquivo).
import { version } from './api/core.js';
import { allDefs, chainDefs, resolve } from './members.js';
import { nodes } from './nodes.js';
import { canAssign, types } from './types.js';
import { virtuals } from './virtuals.js';

export const language = {
  id: 'gdscript',
  name: 'GDScript',
  version,
  extensions: { gd: '#478CBF' },
  fileContains: ['class', 'function', '@script'],
  // O arquivo .gd é uma classe: ganha estes campos; sem extends, a classe parte de RefCounted.
  classFiles: true,
  fileFields: [
    { id: 'class_name', label: 'Class name', input: 'text', default: '' },
    { id: 'extends', label: 'Extends', input: 'class', default: 'Node' },
  ],
  defaultBase: 'RefCounted',
  projectClassColor: '#3fa9a0',
  types,
  canAssign,
  icons: {
    function: { file: 'icons/function.svg', color: '#0A6CC2' },
    event: { file: 'icons/event.svg', color: '#C20A0A' },
    loop: { file: 'icons/loop.svg', color: '#C2850A' },
    condition: { file: 'icons/condition.svg', color: '#666666' },
    class: { file: 'icons/class.svg', color: '#196633' },
  },
  nodes,
  // Métodos nativos: os virtuais da classe da Godot de onde a classe do script parte (e das pais dela).
  virtuals,
  // Métodos e propriedades das classes e dos tipos básicos, constantes e enums, montados na hora (members.js).
  memberDefs: chainDefs,
  allMemberDefs: allDefs,
  resolveNode: resolve,
};
