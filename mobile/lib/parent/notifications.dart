import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmanager/workmanager.dart';

import '../core/api.dart';

/// One parent event, exactly as the API's feed returns it — the same rows the
/// backend records for every check-in, absence, payment and mark.
class ParentNotification {
  ParentNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.createdAt,
    required this.childName,
    required this.childToken,
  });

  final String id;
  final String title;
  final String body;
  final DateTime createdAt;

  /// Which saved child this event belongs to — the merged feed names them.
  final String childName;
  final String childToken;
}

const _kLastSeenKey = 'netrofit.parent.lastSeen';
const _kLastNotifiedPrefix = 'netrofit.parent.lastNotified.';
const _kChildrenKey = 'netrofit.parent.children';

final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();

Future<void> _initLocalNotifications() async {
  const settings = InitializationSettings(
    android: AndroidInitializationSettings('@mipmap/ic_launcher'),
    iOS: DarwinInitializationSettings(),
  );
  await _plugin.initialize(settings: settings);
}

/// Ask the OS for permission (Android 13+ and iOS both prompt).
Future<void> requestNotificationPermission() async {
  try {
    await _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.requestNotificationsPermission();
    await _plugin
        .resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>()
        ?.requestPermissions(alert: true, badge: true, sound: true);
  } catch (_) {}
}

/// Fetch one child's feed straight over http — no app services, because this
/// also runs inside the background isolate where nothing is wired up.
Future<List<ParentNotification>> fetchFeed(
    String token, String childName) async {
  final res = await http
      .get(Uri.parse('$kApiBase/public/students/$token/notifications'))
      .timeout(const Duration(seconds: 20));
  if (res.statusCode != 200) return const [];
  final list = jsonDecode(utf8.decode(res.bodyBytes));
  if (list is! List) return const [];
  return list
      .whereType<Map<String, dynamic>>()
      .map((j) => ParentNotification(
            id: (j['id'] as String?) ?? '',
            title: (j['title'] as String?) ?? '',
            body: (j['body'] as String?) ?? '',
            createdAt:
                DateTime.tryParse((j['createdAt'] as String?) ?? '')?.toLocal() ??
                    DateTime.fromMillisecondsSinceEpoch(0),
            childName: childName,
            childToken: token,
          ))
      .where((n) => n.id.isNotEmpty)
      .toList();
}

/// The saved children, read raw from prefs (shape owned by ChildrenStore).
Future<List<({String token, String name})>> _savedChildren(
    SharedPreferences prefs) async {
  final raw = prefs.getString(_kChildrenKey);
  if (raw == null) return const [];
  try {
    return (jsonDecode(raw) as List)
        .whereType<Map<String, dynamic>>()
        .map((j) => (
              token: (j['token'] as String?) ?? '',
              name: (j['name'] as String?) ?? '',
            ))
        .where((c) => c.token.isNotEmpty)
        .toList();
  } catch (_) {
    return const [];
  }
}

/// Pull every child's feed and raise a device notification for each event newer
/// than the per-child high-water mark. Runs from BOTH the foreground poller and
/// the Android background worker, so it owns its own init and storage.
///
/// The first check for a child only sets the mark: the backlog predates the
/// install, and twenty catch-up notifications on day one teach people to mute
/// the app.
Future<void> checkAndNotifyAllChildren() async {
  final prefs = await SharedPreferences.getInstance();
  final children = await _savedChildren(prefs);
  if (children.isEmpty) return;

  await _initLocalNotifications();

  for (final child in children) {
    try {
      final feed = await fetchFeed(child.token, child.name);
      if (feed.isEmpty) continue;

      final markKey = '$_kLastNotifiedPrefix${child.token}';
      final mark = DateTime.tryParse(prefs.getString(markKey) ?? '');
      final newest = feed
          .map((n) => n.createdAt)
          .reduce((a, b) => a.isAfter(b) ? a : b);

      if (mark != null) {
        final fresh = feed.where((n) => n.createdAt.isAfter(mark)).toList()
          ..sort((a, b) => a.createdAt.compareTo(b.createdAt));
        // A cap, not a firehose: if somehow many landed, the last few carry it.
        for (final n in fresh.take(5)) {
          await _plugin.show(
            id: n.id.hashCode,
            title: n.title,
            body: n.body,
            notificationDetails: const NotificationDetails(
              android: AndroidNotificationDetails(
                'parent_events',
                'إشعارات الطالب',
                channelDescription: 'الحضور والغياب والمدفوعات والنتائج',
                importance: Importance.high,
                priority: Priority.high,
              ),
              iOS: DarwinNotificationDetails(),
            ),
          );
        }
      }
      await prefs.setString(markKey, newest.toIso8601String());
    } catch (_) {
      // One child's feed failing must not silence the others.
    }
  }
}

/// The background isolate's entry. Android only — WorkManager wakes the app
/// roughly every 15 minutes and this re-runs the same check the foreground
/// poller does.
@pragma('vm:entry-point')
void notificationsCallbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    try {
      await checkAndNotifyAllChildren();
    } catch (_) {}
    return true;
  });
}

/// Wire everything on app start: plugin init, the OS permission ask, and the
/// Android periodic worker. iOS gets foreground checks only until FCM lands —
/// Apple gives polling apps no reliable background slot.
Future<void> initParentNotifications() async {
  try {
    await _initLocalNotifications();
    await requestNotificationPermission();
    if (!kIsWeb && Platform.isAndroid) {
      await Workmanager().initialize(notificationsCallbackDispatcher);
      await Workmanager().registerPeriodicTask(
        'netrofit-parent-feed',
        'parentFeedPoll',
        frequency: const Duration(minutes: 15),
        existingWorkPolicy: ExistingPeriodicWorkPolicy.keep,
        constraints: Constraints(networkType: NetworkType.connected),
      );
    }
  } catch (_) {
    // Notifications are a courtesy; the app must open even if the OS says no.
  }
}

/// The in-app notification centre's state: the merged feed across all saved
/// children, plus the unread count against the last time the screen was opened.
class NotificationsController extends ChangeNotifier {
  List<ParentNotification> items = [];
  bool loading = false;
  DateTime? lastSeen;

  int get unread => lastSeen == null
      ? items.length
      : items.where((n) => n.createdAt.isAfter(lastSeen!)).length;

  Future<void> refresh() async {
    loading = true;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      lastSeen = DateTime.tryParse(prefs.getString(_kLastSeenKey) ?? '');
      final children = await _savedChildren(prefs);
      final all = <ParentNotification>[];
      for (final child in children) {
        try {
          all.addAll(await fetchFeed(child.token, child.name));
        } catch (_) {}
      }
      all.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      items = all;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  /// Opening the centre marks everything seen — the badge starts over.
  Future<void> markSeen() async {
    final prefs = await SharedPreferences.getInstance();
    lastSeen = DateTime.now();
    await prefs.setString(_kLastSeenKey, lastSeen!.toIso8601String());
    notifyListeners();
  }
}
