// Tema padrão: cores e medidas do canvas. O núcleo só lê estes valores.
export const theme = {
  background: '#1d1f24',
  grid: {
    step: 20, // distância entre pontos, em unidades do mundo (também é o passo do encaixe)
    majorEvery: 5, // a cada quantos pontos vem um ponto destacado
    minPx: 8, // abaixo disso na tela, o passo visível cresce
    dotSize: 2,
    dot: '#33363f',
    majorDot: '#4a4e5a',
  },
  node: {
    minWidth: 140,
    headerHeight: 28,
    rowHeight: 24,
    bottomPadding: 8,
    padding: 10,
    radius: 6,
    pinSize: 10,
    pinInset: 12, // distância do pino até a borda do nó
    labelGap: 6, // distância do pino até o nome
    columnGap: 16, // espaço mínimo entre o nome de entrada e o de saída
    fill: '#2b2e37',
    border: '#444955',
    borderWidth: 1,
    selectedBorder: '#5b8cff',
    selectedWidth: 2,
    header: '#3b4050', // quando a categoria não tem cor
    title: '#eceef2',
    titleFont: '600 13px system-ui, sans-serif',
    label: '#b9bdc7',
    labelFont: '12px system-ui, sans-serif',
  },
  pin: {
    // Forma de cada tipo de fio: 'triangle' | 'circle' | 'diamond' | 'square'.
    shapes: { flow: 'triangle', data: 'circle', condition: 'diamond', config: 'square' },
    color: '#e8e9ec', // pinos sem tipo de dado (fluxo, condicional, configuração)
    hoverScale: 1.4,
    hitRadius: 9, // distância do mouse para contar como "em cima do pino"
  },
  tooltip: {
    fill: '#111216',
    border: '#444955',
    color: '#d8dbe2',
    font: '12px system-ui, sans-serif',
    padding: 6,
    offset: 14,
  },
  selectionBox: {
    fill: 'rgba(91, 140, 255, 0.12)',
    border: '#5b8cff',
    dash: [6, 4],
  },
  zoomLabel: {
    color: '#8a8f9c',
    font: '12px system-ui, sans-serif',
  },
};
