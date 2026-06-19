# Messaging Cost & Pricing Analysis

## Pricing Model

### What Students Pay
- **25 EGP/year** per student (paid at QR activation)
- QR activation is the gate: no QR = no messaging for that student
- This is bundled with the QR code feature, not a separate charge

### Monthly Quota
- **3 messages per activated student per month** (pooled across the company)
- Example: 100 activated students = 300 messages/month quota
- Quota resets on the 1st of each month

---

## Meta WhatsApp API Costs (What Netrofit Pays)

### Conversation-Based Pricing (Current Model)
Meta charges per **conversation** (24-hour window), not per message.

| Category | Cost per Conversation (Egypt) |
|----------|-------------------------------|
| Utility  | ~$0.0045 (approx 0.22 EGP)   |
| Marketing| ~$0.0450 (approx 2.20 EGP)   |
| Authentication | ~$0.0400 (approx 1.95 EGP) |

**All our messages are Utility category** (absence, payments, exam results).

### Free Tier
- **1,000 free service conversations/month** (user-initiated)
- Utility/marketing conversations are NOT free
- First 250 conversations are free for testing

---

## Cost Calculation Examples

### Small Academy (50 activated students)
| Item | Value |
|------|-------|
| Monthly quota | 150 messages |
| Max cost per month | 150 x $0.0045 = **$0.675** (~33 EGP) |
| Annual student revenue | 50 x 25 = **1,250 EGP** |
| Annual max message cost | 33 x 12 = **396 EGP** |
| **Annual profit** | **854 EGP** |

### Medium Academy (200 activated students)
| Item | Value |
|------|-------|
| Monthly quota | 600 messages |
| Max cost per month | 600 x $0.0045 = **$2.70** (~132 EGP) |
| Annual student revenue | 200 x 25 = **5,000 EGP** |
| Annual max message cost | 132 x 12 = **1,584 EGP** |
| **Annual profit** | **3,416 EGP** |

### Large Academy (500 activated students)
| Item | Value |
|------|-------|
| Monthly quota | 1,500 messages |
| Max cost per month | 1,500 x $0.0045 = **$6.75** (~330 EGP) |
| Annual student revenue | 500 x 25 = **12,500 EGP** |
| Annual max message cost | 330 x 12 = **3,960 EGP** |
| **Annual profit** | **8,540 EGP** |

---

## Profit Margins

| Academy Size | Revenue/yr | Cost/yr | Margin |
|-------------|-----------|---------|--------|
| 50 students | 1,250 EGP | 396 EGP | **68%** |
| 100 students | 2,500 EGP | 792 EGP | **68%** |
| 200 students | 5,000 EGP | 1,584 EGP | **68%** |
| 500 students | 12,500 EGP | 3,960 EGP | **68%** |

The margin stays consistent at ~68% because both revenue and cost scale linearly with student count.

---

## Cost Controls Built Into the System

1. **QR Activation Gate**: Only students who paid 25 EGP and activated QR can receive messages. No activation = no cost.

2. **Pooled Monthly Quota (3x)**: Limits total messages to 3 per activated student per month. A 100-student academy can send max 300 messages/month.

3. **24-Hour Cooldown**: Same message type to same student can only be sent once per 24 hours. Prevents accidental re-sends.

4. **Admin Approval**: Messaging is OFF by default. Teachers must request activation, and you (admin) must approve. This gives you control over who uses the feature.

5. **Status Flow**: DISABLED -> PENDING -> ACTIVE. You can also REJECT or REVOKE at any time.

---

## Worst-Case Scenario Analysis

If every academy maxes out their quota every month:

| Scenario | Activated Students | Monthly Messages | Monthly Cost |
|----------|-------------------|-----------------|-------------|
| 10 academies x 100 students | 1,000 | 3,000 | ~$13.50 (660 EGP) |
| 50 academies x 200 students | 10,000 | 30,000 | ~$135 (6,600 EGP) |
| Revenue from same | - | - | 250,000 EGP/yr |

Even at worst case with 50 academies, annual cost is ~79,200 EGP vs revenue of 250,000 EGP = **68% margin**.

---

## Break-Even Analysis

**Per student break-even:**
- Annual revenue per student: 25 EGP
- Max annual cost per student: 3 msgs x 12 months x 0.22 EGP = 7.92 EGP
- Break-even: Always profitable at 25 EGP/student/year

**Minimum viable price would be ~8 EGP/student/year** to break even (at max usage).

---

## Exchange Rate Note

Costs above use approximate rate of 1 USD = 49 EGP. Meta bills in USD. Actual costs may vary with exchange rate fluctuations.

---

## Summary

- **You charge**: 25 EGP/student/year (at QR activation)
- **Meta charges you**: ~0.22 EGP per message (utility)
- **Max messages per student**: 36/year (3/month x 12)
- **Max cost per student**: ~7.92 EGP/year
- **Your profit per student**: ~17 EGP/year (68% margin)
- **Risk**: Very low - costs are capped by quota system
