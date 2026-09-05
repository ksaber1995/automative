import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// The app's visual voice, lifted from the web app so the two read as one
/// product:
///
///  * chrome — the header/sidebar surface of the web app (#333), a neutral
///    dark grey with the logo's own green as the single accent on it;
///  * primary — the emerald every PrimeNG button ships in (Aura's default);
///  * ground/card/line/ink — Tailwind gray-100 / white / gray-200 / gray-800,
///    exactly the page body, cards and text of every web screen;
///  * green / amber / red / info / exam — the -600 steps of the semantic
///    Tailwind colours the web uses for present/paid, pending, absent/overdue,
///    informational text and exam marks.
///
/// Cairo stays as the Arabic typeface — the web falls back to system fonts,
/// which read poorly on a phone.
abstract final class AppTheme {
  // ── Chrome (web header + sidebar) ────────────────────────────────────────
  static const Color chrome = Color(0xFF333333);
  static const Color chromeRaised = Color(0xFF414141);
  static const Color chromeLine = Color(0xFF525252);

  /// The brand green — legible on the dark chrome only; never on white.
  static const Color accent = Color(0xFF3DDC84);

  // ── Interactive ──────────────────────────────────────────────────────────
  /// Aura emerald-600: buttons, links, selection. Emerald-500 for fills that
  /// sit on dark.
  static const Color primary = Color(0xFF059669);
  static const Color primaryBright = Color(0xFF10B981);

  /// Tailwind `primary` (sky-600) — the web's login gradient and info text.
  static const Color info = Color(0xFF0284C7);

  // ── Surfaces & text ──────────────────────────────────────────────────────
  static const Color ground = Color(0xFFF3F4F6); // gray-100
  static const Color card = Colors.white;
  static const Color line = Color(0xFFE5E7EB); // gray-200
  static const Color lineStrong = Color(0xFFD1D5DB); // gray-300
  static const Color ink = Color(0xFF1F2937); // gray-800
  static const Color muted = Color(0xFF6B7280); // gray-500

  // ── Semantic ─────────────────────────────────────────────────────────────
  static const Color green = Color(0xFF16A34A); // green-600
  static const Color amber = Color(0xFFD97706); // amber-600
  static const Color amberDeep = Color(0xFFB45309); // amber-700 (text)
  static const Color red = Color(0xFFDC2626); // red-600

  /// indigo-600 — what the web colours exam and homework marks with.
  static const Color exam = Color(0xFF4F46E5);

  /// The header surface. The web chrome is flat #333; a whisper of depth keeps
  /// a tall phone header from reading as a slab.
  static const LinearGradient headerGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [Color(0xFF3B3B3B), chrome],
  );

  /// The web login page's sky gradient (primary-600 → primary-900).
  static const LinearGradient skyGradient = LinearGradient(
    begin: Alignment.topRight,
    end: Alignment.bottomLeft,
    colors: [Color(0xFF0284C7), Color(0xFF0369A1), Color(0xFF0C4A6E)],
  );

  static ThemeData light() {
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: primary,
        primary: primary,
        onPrimary: Colors.white,
        secondary: info,
        error: red,
        surface: ground,
        onSurface: ink,
      ),
      scaffoldBackgroundColor: ground,
    );
    final text = GoogleFonts.cairoTextTheme(base.textTheme).apply(
      bodyColor: ink,
      displayColor: ink,
    );
    return base.copyWith(
      textTheme: text,
      appBarTheme: AppBarTheme(
        backgroundColor: chrome,
        elevation: 0,
        foregroundColor: Colors.white,
        centerTitle: true,
        titleTextStyle: text.titleLarge?.copyWith(
            color: Colors.white, fontWeight: FontWeight.w800),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: card,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: const BorderSide(color: line),
        ),
        margin: EdgeInsets.zero,
      ),
      dividerTheme: const DividerThemeData(color: line, space: 1),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: primary,
          foregroundColor: Colors.white,
          minimumSize: const Size.fromHeight(50),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: text.titleMedium?.copyWith(fontWeight: FontWeight.w700),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: primary,
          side: const BorderSide(color: primary),
          minimumSize: const Size.fromHeight(50),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: text.titleMedium?.copyWith(fontWeight: FontWeight.w700),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: primary),
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: primary,
        foregroundColor: Colors.white,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: card,
        indicatorColor: primary.withValues(alpha: 0.12),
        surfaceTintColor: Colors.transparent,
        iconTheme: WidgetStateProperty.resolveWith((states) => IconThemeData(
            color: states.contains(WidgetState.selected) ? primary : muted)),
        labelTextStyle: WidgetStateProperty.resolveWith((states) =>
            text.labelMedium?.copyWith(
                fontWeight: FontWeight.w700,
                color:
                    states.contains(WidgetState.selected) ? primary : muted)),
      ),
      progressIndicatorTheme:
          const ProgressIndicatorThemeData(color: primary),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: card,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: lineStrong),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: lineStrong),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: primary, width: 1.6),
        ),
      ),
    );
  }
}

/// One small pill of fact — "٩٥٪ حضور", "٣ كورسات". Used across both flows so
/// the two halves of the app read as one product.
class StatChip extends StatelessWidget {
  const StatChip({
    super.key,
    required this.label,
    required this.value,
    this.color = AppTheme.primary,
  });

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.09),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(value,
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(color: color, fontWeight: FontWeight.w800)),
          Text(label,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: color.withValues(alpha: 0.9))),
        ],
      ),
    );
  }
}

/// Section header with the web sidebar's green active-bar as its tick.
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.title, {super.key, this.icon, this.trailing});

  final String title;
  final IconData? icon;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 22, bottom: 10),
      child: Row(
        children: [
          Container(
            width: 4,
            height: 20,
            decoration: BoxDecoration(
              color: AppTheme.primary,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(width: 8),
          if (icon != null) ...[
            Icon(icon, size: 18, color: AppTheme.primary),
            const SizedBox(width: 6),
          ],
          Expanded(
            child: Text(title,
                style: Theme.of(context)
                    .textTheme
                    .titleMedium
                    ?.copyWith(fontWeight: FontWeight.w800)),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}
