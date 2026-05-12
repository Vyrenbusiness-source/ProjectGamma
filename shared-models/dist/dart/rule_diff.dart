// GENERATED — do not edit. Source: shared-models/schemas.json
class RuleDiff {
  final String id;
  final String kind;
  final String text;
  final String status;
  final int createdAt;
  final int? approvedAt;
  const RuleDiff({
    required this.id,
    required this.kind,
    required this.text,
    required this.status,
    required this.createdAt,
    this.approvedAt,
  });
  factory RuleDiff.fromJson(Map<String, dynamic> m) {
    return RuleDiff(
      id: m['id'] as String,
      kind: m['kind'] as String,
      text: m['text'] as String,
      status: m['status'] as String,
      createdAt: (m['createdAt'] as num).toInt(),
      approvedAt: m['approvedAt'] == null ? null : ((m['approvedAt'] as num).toInt()),
    );
  }
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'kind': kind,
      'text': text,
      'status': status,
      'createdAt': createdAt,
      'approvedAt': approvedAt,
    };
  }
}
