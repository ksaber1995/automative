import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/api.dart';
import '../models/parent_profile.dart';

/// One saved child: the QR token off their card is the whole credential, the
/// name/academy are a cached label so the list paints before any network.
class SavedChild {
  SavedChild({required this.token, required this.name, required this.academy});

  final String token;
  final String name;
  final String academy;

  Map<String, dynamic> toJson() => {'token': token, 'name': name, 'academy': academy};

  factory SavedChild.fromJson(Map<String, dynamic> j) => SavedChild(
        token: (j['token'] as String?) ?? '',
        name: (j['name'] as String?) ?? '',
        academy: (j['academy'] as String?) ?? '',
      );
}

const _kChildrenKey = 'netrofit.parent.children';

/// The parent's device-local family list. A card is scanned once and the child
/// stays on the home screen — unlike the web page, which forgets the token the
/// moment the tab closes. No account, no server state: losing the phone leaks
/// exactly what losing the physical card leaks.
class ChildrenStore extends ChangeNotifier {
  ChildrenStore(this._api);

  final ApiClient _api;

  List<SavedChild> _children = [];
  bool _loaded = false;

  List<SavedChild> get children => List.unmodifiable(_children);
  bool get loaded => _loaded;

  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_kChildrenKey);
    if (raw != null) {
      try {
        _children = (jsonDecode(raw) as List)
            .whereType<Map<String, dynamic>>()
            .map(SavedChild.fromJson)
            .where((c) => c.token.isNotEmpty)
            .toList();
      } catch (_) {
        _children = [];
      }
    }
    _loaded = true;
    notifyListeners();
  }

  /// Validate the token against the API (the profile fetch IS the validation),
  /// then persist the child. Returns the fetched profile so the caller can go
  /// straight to the dashboard without a second request.
  Future<ParentProfile> addByToken(String token) async {
    final json = await _api.get('/public/students/$token') as Map<String, dynamic>;
    final profile = ParentProfile.fromJson(json);

    _children.removeWhere((c) => c.token == token); // re-scan refreshes the label
    _children.add(SavedChild(
      token: token,
      name: profile.studentName,
      academy: profile.academyName,
    ));
    await _persist();
    notifyListeners();
    return profile;
  }

  Future<ParentProfile> fetchProfile(String token) async {
    final json = await _api.get('/public/students/$token') as Map<String, dynamic>;
    return ParentProfile.fromJson(json);
  }

  Future<void> remove(String token) async {
    _children.removeWhere((c) => c.token == token);
    await _persist();
    notifyListeners();
  }

  Future<void> _persist() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
        _kChildrenKey, jsonEncode(_children.map((c) => c.toJson()).toList()));
  }
}
