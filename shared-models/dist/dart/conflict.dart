// GENERATED — do not edit. Source: shared-models/schemas.json
class Conflict {
  final String id;
  final String field;
  final String? localValue;
  final String? remoteValue;
  final String status;
  final int createdAt;
  final String? resolvedWith;
  const Conflict({
    required this.id,
    required this.field,
    this.localValue,
    this.remoteValue,
    required this.status,
    required this.createdAt,
    this.resolvedWith,
  });
  factory Conflict.fromJson(Map<String, dynamic> m) {
    return Conflict(
      id: m['id'] as String,
      field: m['field'] as String,
      localValue: m['localValue'] == null ? null : (m['localValue'] as String),
      remoteValue: m['remoteValue'] == null ? null : (m['remoteValue'] as String),
      status: m['status'] as String,
      createdAt: (m['createdAt'] as num).toInt(),
      resolvedWith: m['resolvedWith'] == null ? null : (m['resolvedWith'] as String),
    );
  }
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'field': field,
      'localValue': localValue,
      'remoteValue': remoteValue,
      'status': status,
      'createdAt': createdAt,
      'resolvedWith': resolvedWith,
    };
  }
}
