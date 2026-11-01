// Tema padrão: cores, fontes e medidas. O núcleo só lê estes valores.
const FONT = '"JetBrains Mono", ui-monospace, monospace';

export const theme = {
  fonts: [`400 14px ${FONT}`, `600 14px ${FONT}`], // carregadas antes de medir os nós
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
    minWidth: 160,
    padding: 14, // topo, base e laterais
    execGap: 14, // espaço entre o pino de execução (cabeçalho) e o resto
    headerGap: 10, // espaço acima e abaixo da linha divisória do cabeçalho
    rowGap: 10, // espaço entre os elementos do corpo
    lineHeight: 16, // altura de uma linha de texto do corpo
    labelGap: 8, // distância do pino até o nome
    columnGap: 24, // espaço mínimo entre o nome de entrada e o de saída
    compactGap: 10, // espaço entre pino, tag e nome no nó compacto
    radius: 16,
    pinSize: 12, // pinos do corpo
    headerPinSize: 13, // pinos do cabeçalho (execução) e do nó compacto
    pinStroke: 2,
    fill: '#2E2E2E',
    border: '#212121',
    borderWidth: 2,
    selectedBorder: '#5b8cff', // nó selecionado sem tipo (sem tag); com tag, a borda usa a cor do tipo
    selectedWidth: 2,
    divider: '#3d3d3d',
    title: '#ededed',
    titleFont: `600 14px ${FONT}`,
    label: '#d0d0d0',
    labelFont: `400 14px ${FONT}`,
  },
  tag: {
    height: 20,
    padX: 8,
    radius: 10,
    gap: 10, // espaço entre a tag e o nome
    font: `600 12px ${FONT}`,
    text: '#ffffff',
  },
  pin: {
    // Forma de cada tipo de fio: 'triangle' | 'circle' | 'diamond' | 'square'.
    shapes: { flow: 'triangle', data: 'circle', condition: 'diamond', config: 'square' },
    color: '#e8e8e8', // pinos sem tipo de dado e sem cor própria do tipo de fio
    kindColors: { condition: '#e5484d' }, // cor por tipo de fio, para pinos sem tipo de dado
    hoverScale: 1.3,
    hitRadius: 10, // distância do mouse (na tela) para contar como "em cima do pino"
    dimAlpha: 0.25, // pinos que não ligam com o fio sendo puxado
  },
  wire: {
    width: 2,
    kindWidths: { flow: 4 }, // espessura por tipo de fio (os outros usam width)
    selectedColor: 'rgba(91, 140, 255, 0.55)', // contorno do fio selecionado
    selectedExtra: 5, // o contorno do selecionado é a espessura do fio + isto
    hitWidth: 7, // distância do mouse (na tela) para contar como "em cima do fio"
    iconSize: 8, // ícone do tipo de fio no meio
    invalidDash: [6, 4], // fio puxado sobre um pino que não liga
  },
  reroute: {
    size: 10, // ponto visível
    hitSize: 22, // área de clique (maior que o ponto)
    pinHitRadius: 5, // nas bordas da área: puxar fio; no meio: arrastar
  },
  tooltip: {
    fill: '#1a1a1a',
    border: '#3d3d3d',
    color: '#e0e0e0',
    font: `400 12px ${FONT}`,
    padding: 6,
    offset: 14,
    invalidBorder: '#c0504d',
    invalidColor: '#ff9b98',
  },
  selectionBox: {
    fill: 'rgba(91, 140, 255, 0.12)',
    border: '#5b8cff',
    dash: [6, 4],
  },
  zoomLabel: {
    color: '#7a7a7a',
    font: `400 12px ${FONT}`,
  },
};
