import { Camera } from './core/canvas/camera.js';
import { CanvasInput } from './core/canvas/input.js';
import { Renderer } from './core/canvas/renderer.js';
import { Selection } from './core/canvas/selection.js';
import { Scene } from './core/scene.js';
import { theme } from './theme/default.js';

const canvas = document.getElementById('board');
const camera = new Camera();
const scene = new Scene();
const selection = new Selection();
const renderer = new Renderer(canvas, { camera, scene, selection, theme });
new CanvasInput(canvas, { camera, scene, selection, renderer, theme }).attach();

// Blocos de teste (etapa 1a): só para experimentar seleção e arraste.
[[60, 60], [300, 60], [540, 60], [60, 240], [300, 240], [540, 240]].forEach(([x, y], i) => {
  scene.add({ x, y, title: `Bloco ${i + 1}` });
});

new ResizeObserver(() => renderer.resize(canvas.clientWidth, canvas.clientHeight)).observe(canvas);
