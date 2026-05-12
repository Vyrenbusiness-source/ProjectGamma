// GENERATED — do not edit. Source: shared-models/schemas.json
class Idea {
  final String id;
  final String text;
  final int createdAt;
  final String? convertedTaskId;
  const Idea({
    required this.id,
    required this.text,
    required this.createdAt,
    this.convertedTaskId,
  });
  factory Idea.fromJson(Map<String, dynamic> m) {
    return Idea(
      id: m['id'] as String,
      text: m['text'] as String,
      createdAt: (m['createdAt'] as num).toInt(),
      convertedTaskId: m['convertedTaskId'] == null ? null : (m['convertedTaskId'] as String),
    );
  }
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'text': text,
      'createdAt': createdAt,
      'convertedTaskId': convertedTaskId,
    };
  }
}
