import { getDef } from '../nodeRegistry.js';

// Texto de um nó de anotação (@export_range(0, 100), @export_enum("A", "B")…).
export function annotationCode(node) {
  const f = node.fields ?? {};
  const filled = (v) => v !== undefined && v !== null && String(v).trim() !== '';
  const quoted = (text) => String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => (/^".*"$/.test(s) ? s : `"${s}"`)).join(', ');
  switch (node.type) {
    case 'anno.export_range': return `@export_range(${[f.min, f.max, f.step, f.extra].filter(filled).map((v) => String(v).trim()).join(', ')})`;
    case 'anno.export_enum': return `@export_enum(${quoted(f.options)})`;
    case 'anno.export_file': return filled(f.filter) ? `@export_file(${quoted(f.filter)})` : '@export_file';
    case 'anno.warning_ignore': return `@warning_ignore(${quoted(f.warnings)})`;
    case 'anno.icon': return `@icon("${f.path ?? ''}")`;
    case 'anno.custom': return `@${String(f.text ?? '').trim().replace(/^@/, '')}`;
  }
  return getDef(node.type)?.code ?? '';
}
