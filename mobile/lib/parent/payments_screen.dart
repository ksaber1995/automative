import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../models/parent_profile.dart';
import 'widgets/rows.dart';

enum _Filter { all, due, paid }

/// Money, on its own page: what is still owed at the top, then every bill —
/// monthly, per-session, package and one-time — filterable to "what do I still
/// have to pay?" or "what have I paid?".
class PaymentsScreen extends StatefulWidget {
  const PaymentsScreen({super.key, required this.profile});

  final ParentProfile profile;

  @override
  State<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends State<PaymentsScreen> {
  _Filter _filter = _Filter.all;

  @override
  Widget build(BuildContext context) {
    final payments = widget.profile.payments;
    final all = payments?.rows ?? const <PaymentRow>[];
    final due = all.where((r) => r.remaining > 0).toList();
    final paid = all.where((r) => r.remaining <= 0).toList();
    final outstanding = payments?.totalOutstanding ?? 0;
    final totalPaid = all.fold<double>(0, (sum, r) => sum + r.amountPaid);

    final rows = switch (_filter) {
      _Filter.all => all,
      _Filter.due => due,
      _Filter.paid => paid,
    };

    return Scaffold(
      appBar: AppBar(
        title: Column(
          children: [
            const Text('المدفوعات'),
            Text(widget.profile.studentName,
                style: const TextStyle(fontSize: 12, color: Color(0xFFB3B3B3))),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          _OutstandingCard(amount: outstanding, dueCount: due.length),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: StatChip(
                    label: 'إجمالي المدفوع',
                    value: fmtAmount(totalPaid),
                    color: AppTheme.green),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: StatChip(
                    label: 'فاتورة',
                    value: '${all.length}',
                    color: AppTheme.info),
              ),
            ],
          ),
          const SectionTitle('الفواتير', icon: Icons.receipt_long_outlined),
          FilterPills<_Filter>(
            value: _filter,
            onChanged: (v) => setState(() => _filter = v),
            options: [
              (_Filter.all, 'الكل (${all.length})'),
              (_Filter.due, 'مستحقة (${due.length})'),
              (_Filter.paid, 'مدفوعة (${paid.length})'),
            ],
          ),
          const SizedBox(height: 12),
          if (rows.isEmpty)
            EmptyNote(
              icon: Icons.payments_outlined,
              text: switch (_filter) {
                _Filter.due => 'لا توجد مبالغ مستحقة 🎉',
                _Filter.paid => 'لا توجد مدفوعات مسجّلة بعد',
                _Filter.all => 'لا توجد فواتير بعد',
              },
            )
          else
            Card(
              child: Column(
                children: [
                  for (var i = 0; i < rows.length; i++) ...[
                    if (i > 0) const Divider(height: 1, indent: 56),
                    PaymentTile(row: rows[i]),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// The headline number. Amber while money is owed, green once it is not —
/// the same two colours the web uses for pending and paid.
class _OutstandingCard extends StatelessWidget {
  const _OutstandingCard({required this.amount, required this.dueCount});

  final double amount;
  final int dueCount;

  @override
  Widget build(BuildContext context) {
    final owed = amount > 0;
    final color = owed ? AppTheme.amber : AppTheme.green;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Row(
        children: [
          Icon(owed ? Icons.hourglass_bottom : Icons.check_circle,
              color: owed ? AppTheme.amberDeep : AppTheme.green, size: 34),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(owed ? 'المبلغ المستحق' : 'لا توجد مبالغ مستحقة',
                    style: TextStyle(
                        color: owed ? AppTheme.amberDeep : AppTheme.green,
                        fontWeight: FontWeight.w700)),
                if (owed)
                  Text(fmtAmount(amount),
                      style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                          color: AppTheme.amberDeep,
                          fontWeight: FontWeight.w800)),
                if (owed)
                  Text('على $dueCount ${dueCount == 1 ? 'فاتورة' : 'فواتير'}',
                      style: const TextStyle(
                          color: AppTheme.amberDeep, fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
