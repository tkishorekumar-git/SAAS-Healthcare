import 'package:flutter_test/flutter_test.dart';
import 'package:kenisha_mobile/src/app.dart';

void main() {
  testWidgets('home screen lists the four product modules', (tester) async {
    await tester.pumpWidget(const KenishaApp());

    expect(find.text('Kenisha Healthcare'), findsOneWidget);
    expect(find.text('Hospital Management'), findsOneWidget);
    expect(find.text('Chronic Disease Management'), findsOneWidget);
    expect(find.text('Maternal & Pregnancy Care'), findsOneWidget);
    expect(find.text('Newborn & Pediatric Care'), findsOneWidget);
  });
}
