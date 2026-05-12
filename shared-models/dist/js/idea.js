// GENERATED — do not edit. Source: shared-models/schemas.json
'use strict';
function isIdea(o) {
  if (!o || typeof o !== 'object') return false;
    if (!(typeof o.id === 'string')) return false;
    if (!(typeof o.text === 'string')) return false;
    if (!(typeof o.createdAt === 'number')) return false;
    if (!((o.convertedTaskId == null || typeof o.convertedTaskId === 'string'))) return false;
  return true;
}
function makeIdea({ id, text, createdAt, convertedTaskId }) {
  return {
    id,
    text,
    createdAt,
    convertedTaskId,
  };
}
module.exports = { isIdea, makeIdea };
