// Função: área de script com os nós que ela executa. Campos: name, params (lista { id, name, type })
// e returns (tipo de retorno; null = nenhum). Com o nome de um método nativo da linguagem, params e
// returns vêm dele (travados). Ctrl+clique cria uma chamada (call) a ela.
export const func = {
  id: 'function',
  area: true,
  contains: ['@script'],
  references: { get: 'call' },
};
