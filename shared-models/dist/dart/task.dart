// GENERATED — do not edit. Source: shared-models/schemas.json
class Task {
  final String id;
  final String title;
  final bool done;
  final String group;
  final int createdAt;
  final int updatedAt;
  final String? ownerUserId;
  final List<String> tags;
  const Task({
    required this.id,
    required this.title,
    required this.done,
    required this.group,
    required this.createdAt,
    required this.updatedAt,
    this.ownerUserId,
    required this.tags,
  });
  factory Task.fromJson(Map<String, dynamic> m) {
    return Task(
      id: m['id'] as String,
      title: m['title'] as String,
      done: m['done'] as bool,
      group: m['group'] as String,
      createdAt: (m['createdAt'] as num).toInt(),
      updatedAt: (m['updatedAt'] as num).toInt(),
      ownerUserId: m['ownerUserId'] == null ? null : (m['ownerUserId'] as String),
      tags: (m['tags'] as List).map((e) => e as String).toList(),
    );
  }
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'title': title,
      'done': done,
      'group': group,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
      'ownerUserId': ownerUserId,
      'tags': tags,
    };
  }
}
