// GENERATED — do not edit. Source: shared-models/schemas.json
'use strict';
function isTask(o) {
  if (!o || typeof o !== 'object') return false;
    if (!(typeof o.id === 'string')) return false;
    if (!(typeof o.title === 'string')) return false;
    if (!(typeof o.done === 'boolean')) return false;
    if (!(typeof o.group === 'string')) return false;
    if (!(typeof o.createdAt === 'number')) return false;
    if (!(typeof o.updatedAt === 'number')) return false;
    if (!((o.ownerUserId == null || typeof o.ownerUserId === 'string'))) return false;
    if (!(Array.isArray(o.tags) && o.tags.every((e) => typeof e === 'string'))) return false;
  return true;
}
function makeTask({ id, title, done, group, createdAt, updatedAt, ownerUserId, tags }) {
  return {
    id,
    title,
    done,
    group,
    createdAt,
    updatedAt,
    ownerUserId,
    tags,
  };
}
module.exports = { isTask, makeTask };
