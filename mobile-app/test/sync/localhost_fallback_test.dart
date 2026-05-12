import 'package:flutter_test/flutter_test.dart';
import 'package:projectgamma_mobile/sync/localhost_fallback.dart';

void main() {
  group('deriveLocalhostFallback', () {
    test('null/leer → null', () {
      expect(deriveLocalhostFallback(null), isNull);
      expect(deriveLocalhostFallback(''), isNull);
    });
    test('LAN-IP → localhost-fallback mit gleichem port', () {
      expect(deriveLocalhostFallback('http://192.168.0.197:7892'),
          'http://localhost:7892');
      expect(deriveLocalhostFallback('http://10.0.0.5:17892'),
          'http://localhost:17892');
    });
    test('https bleibt https', () {
      expect(deriveLocalhostFallback('https://192.168.1.42:7892'),
          'https://localhost:7892');
    });
    test('localhost selbst → null (kein fallback)', () {
      expect(deriveLocalhostFallback('http://localhost:7892'), isNull);
      expect(deriveLocalhostFallback('http://127.0.0.1:7892'), isNull);
    });
    test('ohne port → default 7892', () {
      expect(deriveLocalhostFallback('http://192.168.0.5'),
          'http://localhost:7892');
    });
    test('müll → null statt crash', () {
      expect(deriveLocalhostFallback('keine url'), isNull);
    });
  });

  group('shouldTryLocalhostFallback', () {
    test('erst ab versuch 2', () {
      expect(shouldTryLocalhostFallback(0), isFalse);
      expect(shouldTryLocalhostFallback(1), isFalse);
      expect(shouldTryLocalhostFallback(2), isTrue);
      expect(shouldTryLocalhostFallback(5), isTrue);
    });
  });
}
