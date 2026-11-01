// Ícones SVG: carregados como imagem e desenhados no canvas na cor pedida.
// Cada ícone ganha image, width e height (do próprio SVG) depois de loadIcons.

// Carrega todos; um ícone que não carregar fica sem imagem (o nó aparece sem ele).
export async function loadIcons(icons = {}) {
  if (typeof Image === 'undefined') return;
  await Promise.all(Object.values(icons).map(async (icon) => {
    const image = new Image();
    image.src = icon.file;
    try {
      await image.decode();
      icon.image = image;
      icon.width = image.naturalWidth || icon.width;
      icon.height = image.naturalHeight || icon.height;
    } catch {
      console.warn(`Ícone não carregou: ${icon.file}`);
    }
  }));
}

// Largura do ícone numa altura dada (proporcional ao SVG; sem medidas, quadrado).
export function iconWidth(icon, height) {
  return icon.width && icon.height ? (icon.width * height) / icon.height : height;
}

// Cópia do ícone pintada na cor, com `pixels` de altura (guardada para os próximos quadros).
export function tintedIcon(icon, color, pixels) {
  icon.tinted ??= new Map();
  const key = `${color}|${pixels}`;
  if (!icon.tinted.has(key)) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(iconWidth(icon, pixels)));
    canvas.height = pixels;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(icon.image, 0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    icon.tinted.set(key, canvas);
  }
  return icon.tinted.get(key);
}
