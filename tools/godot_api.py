# Gera js/lang/godot/api/*.js a partir do extension_api.json da Godot (só o que o app usa).
# Uso (na pasta do projeto):  python tools/godot_api.py downloads/godot-4.7.1/extension_api-4-7.json
# Rodar de novo quando trocar a versão da Godot ou quando o app passar a usar mais dados da API.
import json
import os
import sys

SCALARS = {'int', 'float'}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'js', 'lang', 'godot', 'api')


def js(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def header(api, what):
    v = api['header']
    version = f"{v['version_major']}.{v['version_minor']}.{v['version_patch']}"
    return (f"// Gerado por tools/godot_api.py a partir do extension_api.json ({v['version_full_name']}). Não editar.\n"
            f"// {what}\n"), version


def builtins(api):
    # Tipos básicos (sem Nil). components: só quando todos os membros são do mesmo número (vetores);
    # Color: r, g, b, a.
    out = []
    for b in api['builtin_classes']:
        if b['name'] == 'Nil':
            continue
        entry = {'name': b['name']}
        members = b.get('members', [])
        types = {m['type'] for m in members}
        if b['name'] == 'Color':
            entry.update(components=['r', 'g', 'b', 'a'], componentType='float')
        elif members and len(members) <= 4 and len(types) == 1 and types <= SCALARS:
            entry.update(components=[m['name'] for m in members], componentType=types.pop())
        out.append(entry)
    return out


def classes(api):
    # [nome, classe pai] na ordem da API.
    return [[c['name'], c.get('inherits')] for c in api['classes']]


def functions(api):
    # [nome, categoria, retorno (null = nenhum), [[argumento, tipo]...], vararg (1/0)]
    return [[f['name'], f['category'], f.get('return_type'), [[a['name'], a['type']] for a in f.get('arguments', [])], int(f.get('is_vararg', False))]
            for f in api['utility_functions']]


def simple_type(t):
    # Tipos da API para os tipos do app: enum::X e bitfield::X viram int; typedarray::X vira Array;
    # "Texture2D,-AtlasTexture…" (lista de aceitos) fica na primeira classe.
    if not t:
        return t
    if t.startswith(('enum::', 'bitfield::')):
        return 'int'
    if t.startswith('typedarray::'):
        return 'Array'
    return t.split(',')[0]


def members(api):
    # { classe: { m: [[método, [[argumento, tipo]...], retorno, flags]...], p: [[propriedade, tipo, gravável]...] } }
    # flags: 1 = static, 2 = const (só lê), 4 = vararg. Sem os virtuais (esses vão em virtuals.js).
    out = {}
    for c in api['classes']:
        methods = []
        for m in c.get('methods', []):
            if m.get('is_virtual'):
                continue
            flags = (1 if m.get('is_static') else 0) | (2 if m.get('is_const') else 0) | (4 if m.get('is_vararg') else 0)
            args = [[a['name'], simple_type(a['type'])] for a in m.get('arguments', [])]
            methods.append([m['name'], args, simple_type(m.get('return_value', {}).get('type')), flags])
        props = [[p['name'], simple_type(p['type']), 1 if p.get('setter') else 0] for p in c.get('properties', [])]
        if methods or props:
            out[c['name']] = {'m': methods, 'p': props}
    return out


def builtin_methods(api):
    # { tipo básico: [[método, [[argumento, tipo]...], retorno, flags]...] } (o objeto é o próprio valor).
    out = {}
    for b in api['builtin_classes']:
        methods = []
        for m in b.get('methods', []):
            flags = (1 if m.get('is_static') else 0) | (2 if m.get('is_const') else 0) | (4 if m.get('is_vararg') else 0)
            args = [[a['name'], simple_type(a['type'])] for a in m.get('arguments', [])]
            methods.append([m['name'], args, simple_type(m.get('return_type')), flags])
        if methods:
            out[b['name']] = methods
    return out


def constants(api):
    # { dono: [[nome, tipo]...] }: constantes e valores de enum, das globais ('@GlobalScope'), das
    # classes e dos tipos básicos (ex.: Vector2.ZERO).
    out = {'@GlobalScope': [[c['name'], 'int'] for c in api['global_constants']]
           + [[v['name'], 'int'] for e in api['global_enums'] for v in e['values']]}
    for c in api['classes'] + api['builtin_classes']:
        items = [[k['name'], simple_type(k.get('type', 'int'))] for k in c.get('constants', [])]
        items += [[v['name'], 'int'] for e in c.get('enums', []) for v in e['values']]
        if items:
            out[c['name']] = items
    return out


def virtuals(api):
    # { classe: [[método, [[argumento, tipo]...], retorno (null = nenhum)]...] } (só classes que têm).
    out = {}
    for c in api['classes']:
        methods = [[m['name'], [[a['name'], a['type']] for a in m.get('arguments', [])], m.get('return_value', {}).get('type')]
                   for m in c.get('methods', []) if m.get('is_virtual')]
        if methods:
            out[c['name']] = methods
    return out


def main(path):
    api = json.load(open(path, encoding='utf8'))
    os.makedirs(OUT, exist_ok=True)
    head, version = header(api, 'Tipos básicos, classes (com a pai) e funções globais.')
    text = (head
            + f"export const version = {js(version)};\n\n"
            + "// Tipos básicos: { name, components, componentType } (componentes: o pino pode ser aberto).\n"
            + f"export const builtins = {js(builtins(api))};\n\n"
            + "// Classes: [nome, classe pai].\n"
            + f"export const classes = {js(classes(api))};\n\n"
            + "// Funções globais: [nome, categoria, retorno, [[argumento, tipo]...], vararg].\n"
            + f"export const functions = {js(functions(api))};\n")
    target = os.path.join(OUT, 'core.js')
    open(target, 'w', encoding='utf8', newline='\n').write(text)
    print(f'{target}: {len(text) // 1024} KB (Godot {version})')
    head, _ = header(api, 'Métodos virtuais de cada classe (o que uma função do script sobrescreve).')
    text = (head
            + "// { classe: [[método, [[argumento, tipo]...], retorno]...] }\n"
            + f"export const virtuals = {js(virtuals(api))};\n")
    target = os.path.join(OUT, 'virtuals.js')
    open(target, 'w', encoding='utf8', newline='\n').write(text)
    print(f'{target}: {len(text) // 1024} KB')
    head, _ = header(api, 'Métodos (sem os virtuais) e propriedades de cada classe.')
    text = (head
            + "// { classe: { m: [[método, [[argumento, tipo]...], retorno, flags (1 static, 2 const, 4 vararg)]...],\n"
            + "//             p: [[propriedade, tipo, gravável]...] } }\n"
            + f"export const members = {js(members(api))};\n")
    target = os.path.join(OUT, 'members.js')
    open(target, 'w', encoding='utf8', newline='\n').write(text)
    print(f'{target}: {len(text) // 1024} KB')
    head, _ = header(api, 'Métodos dos tipos básicos, constantes e enums, e os singletons.')
    text = (head
            + "// { tipo básico: [[método, [[argumento, tipo]...], retorno, flags (1 static, 2 const, 4 vararg)]...] }\n"
            + f"export const builtinMethods = {js(builtin_methods(api))};\n\n"
            + "// { dono ('@GlobalScope', classe ou tipo básico): [[nome, tipo]...] } (constantes e valores de enum).\n"
            + f"export const constants = {js(constants(api))};\n\n"
            + "// Singletons: objetos globais (ex.: Input); os métodos deles não precisam de target.\n"
            + f"export const singletons = {js([s['name'] for s in api['singletons']])};\n")
    target = os.path.join(OUT, 'extras.js')
    open(target, 'w', encoding='utf8', newline='\n').write(text)
    print(f'{target}: {len(text) // 1024} KB')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('uso: python tools/godot_api.py <extension_api.json>')
    main(sys.argv[1])
