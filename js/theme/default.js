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
  block: {
    fill: '#2b2e37',
    border: '#444955',
    borderWidth: 1,
    selectedBorder: '#5b8cff',
    selectedWidth: 2,
    radius: 6,
    padding: 10,
    title: '#d8dbe2',
    font: '13px system-ui, sans-serif',
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
