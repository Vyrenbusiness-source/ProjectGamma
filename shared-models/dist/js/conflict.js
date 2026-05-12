// GENERATED — do not edit. Source: shared-models/schemas.json
'use strict';
function isConflict(o) {
  if (!o || typeof o !== 'object') return false;
    if (!(typeof o.id === 'string')) return false;
    if (!(typeof o.field === 'string')) return false;
    if (!((o.localValue == null || typeof o.localValue === 'string'))) return false;
    if (!((o.remoteValue == null || typeof o.remoteValue === 'string'))) return false;
    if (!(typeof o.status === 'string')) return false;
    if (!(typeof o.createdAt === 'number')) return false;
    if (!((o.resolvedWith == null || typeof o.resolvedWith === 'string'))) return false;
  return true;
}
function makeConflict({ id, field, localValue, remoteValue, status, createdAt, resolvedWith }) {
  return {
    id,
    field,
    localValue,
    remoteValue,
    status,
    createdAt,
    resolvedWith,
  };
}
module.exports = { isConflict, makeConflict };
