import { generateScript } from './gdscript/generate.js';
import { buildGraph } from './gdscript/importer.js';
import { generateJson, parseJson } from './json/data.js';
import { generateTres, parseTres } from './tres/data.js';
import { generateTscn, parseTscn } from './tscn/data.js';
import { generateShader } from './shader/generate.js';
import { parseShader } from './shader/importer.js';
import { fileTypeOfItem, profileOf, withItemProfile } from './profileLoader.js';

// Adaptadores de linguagem: a parte em JavaScript de cada perfil (montar o código a partir
// dos nós e transformar código em nós). O perfil escolhe o adaptador pelo campo "adapter";
// sem o campo vale "gdscript" (perfis antigos); "" ou null = só nós, sem exportar/importar.
// graphs: tipos de área (fileType.graph) que o adaptador sabe montar (ex.: a cena do perfil
// GDScript não vira código).
//   generate(item)                      → { code, warnings: [{ nodeId, message, params }] }
//   parse(source, { resolvePath })      → { graph, warnings }
const ADAPTERS = {
  gdscript: { label: 'GDScript', graphs: ['script'], generate: generateScript, parse: buildGraph },
  json: { label: 'JSON', graphs: ['data'], generate: generateJson, parse: parseJson },
  tres: { label: 'Recurso Godot (.tres)', graphs: ['data'], generate: generateTres, parse: parseTres },
  tscn: { label: 'Cena Godot (.tscn)', graphs: ['scene'], generate: generateTscn, parse: parseTscn },
  shader: { label: 'Shader Godot (.gdshader)', graphs: ['script'], generate: generateShader, parse: parseShader },
};

export function adapterIds() {
  return Object.entries(ADAPTERS).map(([id, a]) => ({ id, label: a.label }));
}

export function adapterFor(item) {
  if (item?.kind !== 'file') return null;
  const profile = profileOf(item);
  if (!profile) return null;
  const id = profile.adapter === undefined ? 'gdscript' : profile.adapter;
  const adapter = ADAPTERS[id] ?? null;
  return adapter?.graphs.includes(fileTypeOfItem(item).graph) ? adapter : null;
}

export function generateCode(item) {
  const adapter = adapterFor(item);
  return adapter ? withItemProfile(item, () => adapter.generate(item)) : null;
}

export function parseCode(item, source, options) {
  const adapter = adapterFor(item);
  return adapter?.parse ? withItemProfile(item, () => adapter.parse(source, options)) : null;
}
