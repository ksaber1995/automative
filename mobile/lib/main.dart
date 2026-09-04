import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/api.dart';
import 'core/theme.dart';
import 'landing.dart';
import 'parent/children_store.dart';
import 'student/student_session.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const NetrofitApp());
}

class NetrofitApp extends StatefulWidget {
  const NetrofitApp({super.key});

  @override
  State<NetrofitApp> createState() => _NetrofitAppState();
}

class _NetrofitAppState extends State<NetrofitApp> {
  /// Two clients on purpose: the parent flow is tokenless and must never
  /// accidentally carry a student Bearer token (and vice versa).
  final _parentApi = ApiClient();
  final _studentApi = ApiClient();

  late final ChildrenStore _children = ChildrenStore(_parentApi);
  late final StudentSession _session = StudentSession(_studentApi);

  @override
  void initState() {
    super.initState();
    _children.restore();
    _session.restore();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: _children),
        ChangeNotifierProvider.value(value: _session),
      ],
      child: MaterialApp(
        title: 'نتروفت',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light(),
        // The product speaks Arabic; the whole app is laid out right-to-left.
        builder: (context, child) => Directionality(
          textDirection: TextDirection.rtl,
          child: child ?? const SizedBox.shrink(),
        ),
        home: const LandingScreen(),
      ),
    );
  }
}
