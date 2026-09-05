/// A student code as a human should SEE it — the same rule the web app applies.
///
/// A card's number is stored as an integer in a reserved range but prints short
/// and unmistakable: an old card (100005) prints "A5", a new one (900005) prints
/// "05", a fixed-width card (800005) prints "005". Organic codes print as they
/// are. Mirrors formatStudentCode in the frontend and the CARD_SERIAL_BASE
/// constants in the API — a card in a pocket must read the same everywhere.
const int cardSerialBase = 100000;
const int cardSerialBaseV2 = 900000;
const int cardSerialBaseV3 = 800000;

String formatStudentCode(int? code) {
  if (code == null) return '';
  if (code >= cardSerialBaseV2) return '0${code - cardSerialBaseV2}';
  // Fixed three digits — checked before the "A" range, which starts lower.
  if (code >= cardSerialBaseV3) {
    return (code - cardSerialBaseV3).toString().padLeft(3, '0');
  }
  return code > cardSerialBase ? 'A${code - cardSerialBase}' : code.toString();
}
