import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';

import 'package:netrofit_app/core/qr.dart';
import 'package:netrofit_app/main.dart';

void main() {
  setUpAll(() {
    // No network in the test harness — fall back to the bundled font.
    GoogleFonts.config.allowRuntimeFetching = false;
  });

  test('extractQrToken reads the card URL, a bare token, and rejects junk', () {
    const token = 'a3f9c2d14b8e47f0a1b2c3d4e5f60718';
    expect(extractQrToken('https://app.netrofit.com/p/s/$token'), token);
    expect(extractQrToken(token), token);
    expect(extractQrToken('hello'), isNull);
    expect(extractQrToken(''), isNull);
    expect(extractQrToken('https://app.netrofit.com/somewhere/else'), isNull);
  });

  testWidgets('landing offers both modes', (tester) async {
    await tester.pumpWidget(const NetrofitApp());
    await tester.pump();

    expect(find.text('أنا ولي أمر'), findsOneWidget);
    expect(find.text('أنا طالب'), findsOneWidget);
  });
}
