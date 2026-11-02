// Classe: área de script que agrupa funções e o resto dos nós de script (propriedades, etc.).
// Campo extends: id da classe pai (da mesma linguagem, em qualquer arquivo; null = nenhuma). As
// variáveis e funções da pai (e das pais dela) ficam ao alcance dentro da filha.
export const klass = {
  id: 'class',
  area: true,
  contains: ['function', '@script'],
};
