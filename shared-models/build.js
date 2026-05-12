'use strict';
// Build-CLI: liest schemas.json, schreibt dist/dart/*.dart + dist/js/*.js.
const fs = require('node:fs');
const path = require('node:path');
const { generateAll } = require('./generator');

function snake(name) {
  return name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

function build() {
  const schemaPath = path.join(__dirname, 'schemas.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const { dart, js } = generateAll(schema);
  const dartDir = path.join(__dirname, 'dist', 'dart');
  const jsDir = path.join(__dirname, 'dist', 'js');
  fs.mkdirSync(dartDir, { recursive: true });
  fs.mkdirSync(jsDir, { recursive: true });
  for (const [name, src] of Object.entries(dart)) {
    fs.writeFileSync(path.join(dartDir, snake(name) + '.dart'), src);
  }
  for (const [name, src] of Object.entries(js)) {
    fs.writeFileSync(path.join(jsDir, snake(name) + '.js'), src);
  }
  console.log('shared-models: ' + Object.keys(dart).length + ' modelle generiert');
}

if (require.main === module) build();
module.exports = { build, snake };
