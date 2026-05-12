// GENERATED — do not edit. Source: shared-models/schemas.json
'use strict';
function isRuleDiff(o) {
  if (!o || typeof o !== 'object') return false;
    if (!(typeof o.id === 'string')) return false;
    if (!(typeof o.kind === 'string')) return false;
    if (!(typeof o.text === 'string')) return false;
    if (!(typeof o.status === 'string')) return false;
    if (!(typeof o.createdAt === 'number')) return false;
    if (!((o.approvedAt == null || typeof o.approvedAt === 'number'))) return false;
  return true;
}
function makeRuleDiff({ id, kind, text, status, createdAt, approvedAt }) {
  return {
    id,
    kind,
    text,
    status,
    createdAt,
    approvedAt,
  };
}
module.exports = { isRuleDiff, makeRuleDiff };
