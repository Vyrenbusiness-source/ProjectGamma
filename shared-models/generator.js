'use strict';
// Generator fuer shared-models: liest schemas.json, erzeugt Dart + JS.
// Typen: string|int|double|bool|list<T>|map<string,T>. ?-Suffix = nullable.

const PRIMS = new Set(['string', 'int', 'double', 'bool']);

function parseType(raw) {
  let s = String(raw).trim();
  const nullable = s.endsWith('?');
  if (nullable) s = s.slice(0, -1).trim();
  const list = s.match(/^list<(.+)>$/);
  if (list) return { kind: 'list', nullable, inner: parseType(list[1]) };
  const map = s.match(/^map<\s*string\s*,\s*(.+)>$/);
  if (map) return { kind: 'map', nullable, value: parseType(map[1]) };
  if (!PRIMS.has(s)) throw new Error('Unbekannter Typ: ' + raw);
  return { kind: 'prim', nullable, name: s };
}

function dartType(t) {
  const q = t.nullable ? '?' : '';
  if (t.kind === 'prim') {
    const map = { string: 'String', int: 'int', double: 'double', bool: 'bool' };
    return map[t.name] + q;
  }
  if (t.kind === 'list') return 'List<' + dartType(t.inner) + '>' + q;
  if (t.kind === 'map') return 'Map<String, ' + dartType(t.value) + '>' + q;
  throw new Error('bad type');
}

function dartFromJson(t, expr) {
  if (t.kind === 'prim') {
    const cast = { string: 'as String', int: '(... as num).toInt()', double: '(... as num).toDouble()', bool: 'as bool' }[t.name];
    const inner = cast.includes('...') ? cast.replace(/\.\.\./g, expr) : expr + ' ' + cast;
    return t.nullable ? `${expr} == null ? null : (${inner})` : inner;
  }
  if (t.kind === 'list') {
    const item = dartFromJson(t.inner, 'e');
    const body = `(${expr} as List).map((e) => ${item}).toList()`;
    return t.nullable ? `${expr} == null ? null : ${body}` : body;
  }
  if (t.kind === 'map') {
    const v = dartFromJson(t.value, 'v');
    const body = `(${expr} as Map).map((k, v) => MapEntry(k as String, ${v}))`;
    return t.nullable ? `${expr} == null ? null : ${body}` : body;
  }
}

function renderDart(name, fields) {
  const entries = Object.entries(fields).map(([k, raw]) => [k, parseType(raw)]);
  const decls = entries.map(([k, t]) => `  final ${dartType(t)} ${k};`).join('\n');
  const ctorArgs = entries.map(([k, t]) => `    ${t.nullable ? '' : 'required '}this.${k},`).join('\n');
  const fromJsonAssigns = entries.map(([k, t]) =>
    `      ${k}: ${dartFromJson(t, `m['${k}']`)},`
  ).join('\n');
  const toJsonEntries = entries.map(([k]) => `      '${k}': ${k},`).join('\n');
  return [
    `// GENERATED — do not edit. Source: shared-models/schemas.json`,
    `class ${name} {`,
    decls,
    `  const ${name}({`,
    ctorArgs,
    `  });`,
    `  factory ${name}.fromJson(Map<String, dynamic> m) {`,
    `    return ${name}(`,
    fromJsonAssigns,
    `    );`,
    `  }`,
    `  Map<String, dynamic> toJson() {`,
    `    return {`,
    toJsonEntries,
    `    };`,
    `  }`,
    `}`,
    ''
  ].join('\n');
}

function jsCheck(t, expr) {
  if (t.nullable) return `(${expr} == null || ${jsCheck({ ...t, nullable: false }, expr)})`;
  if (t.kind === 'prim') {
    if (t.name === 'string') return `typeof ${expr} === 'string'`;
    if (t.name === 'bool') return `typeof ${expr} === 'boolean'`;
    return `typeof ${expr} === 'number'`;
  }
  if (t.kind === 'list') return `Array.isArray(${expr}) && ${expr}.every((e) => ${jsCheck(t.inner, 'e')})`;
  if (t.kind === 'map') return `${expr} && typeof ${expr} === 'object' && Object.values(${expr}).every((v) => ${jsCheck(t.value, 'v')})`;
}

function renderJs(name, fields) {
  const entries = Object.entries(fields).map(([k, raw]) => [k, parseType(raw)]);
  const checks = entries.map(([k, t]) => `    if (!(${jsCheck(t, `o.${k}`)})) return false;`).join('\n');
  const factoryArgs = entries.map(([k]) => `${k}`).join(', ');
  const factoryFields = entries.map(([k]) => `    ${k},`).join('\n');
  return [
    `// GENERATED — do not edit. Source: shared-models/schemas.json`,
    `'use strict';`,
    `function is${name}(o) {`,
    `  if (!o || typeof o !== 'object') return false;`,
    checks,
    `  return true;`,
    `}`,
    `function make${name}({ ${factoryArgs} }) {`,
    `  return {`,
    factoryFields,
    `  };`,
    `}`,
    `module.exports = { is${name}, make${name} };`,
    ''
  ].join('\n');
}

function generateAll(schema) {
  const dart = {};
  const js = {};
  for (const [name, def] of Object.entries(schema.models)) {
    dart[name] = renderDart(name, def.fields);
    js[name] = renderJs(name, def.fields);
  }
  return { dart, js };
}

module.exports = { parseType, renderDart, renderJs, generateAll };
