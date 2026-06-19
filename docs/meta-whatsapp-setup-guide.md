# Meta WhatsApp Business API Setup Guide

## Overview
This guide walks you through setting up a WhatsApp Business Account (WABA) on Meta to send messages through the Netrofit platform.

---

## Step 1: Create a Meta Business Account

1. Go to [business.facebook.com](https://business.facebook.com)
2. Click **Create Account**
3. Fill in your business details:
   - Business name: Your company/brand name (e.g., "Netrofit")
   - Your name and email
4. Verify your email address

## Step 2: Create a Meta Developer App

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Click **My Apps** > **Create App**
3. Select **Business** as the app type
4. Fill in:
   - App name (e.g., "Netrofit Messaging")
   - Contact email
   - Link it to your Meta Business Account
5. Click **Create App**

## Step 3: Add WhatsApp Product

1. In your app dashboard, scroll to **Add Products**
2. Find **WhatsApp** and click **Set Up**
3. This creates a WhatsApp Business Account linked to your app

## Step 4: Add Your Phone Number

1. In the WhatsApp section, go to **Getting Started**
2. Click **Add phone number**
3. Enter the phone number you want to send messages from
   - This must be a number NOT already registered on WhatsApp or WhatsApp Business app
   - If it is, you must delete the WhatsApp account first
4. Choose verification method: **SMS** or **Voice call**
5. Enter the verification code

### Important Notes on Phone Numbers:
- Once a number is registered with the API, it cannot be used in the regular WhatsApp app
- You can use a dedicated SIM/number for the business
- The number will show your business name (display name) instead of just the phone number
- You can register multiple numbers under one WABA

## Step 5: Set Display Name

1. Go to **WhatsApp** > **Getting Started** > **Phone Numbers**
2. Click on your number
3. Set the **Display Name** (this is what recipients see)
   - Must follow Meta's [display name guidelines](https://developers.facebook.com/docs/whatsapp/guides/display-name)
   - Must be related to your business
   - Review typically takes 1-3 business days

## Step 6: Create Message Templates

1. Go to **WhatsApp** > **Message Templates**
2. Click **Create Template**
3. For each message type, create a template:

### Template: Absence Notification
- **Category**: Utility
- **Name**: `absence_notification`
- **Language**: Arabic (or English)
- **Body**:
  ```
  رسالة من {{1}}:

  عزيزي {{2}}، لقد تغيب ابنك/ابنتك {{3}} اليوم عن حصة {{4}} ({{5}}) - الحصة رقم {{6}} بتاريخ {{7}}. يرجى الحرص على الحضور المنتظم.
  ```

### Template: Payment Delay
- **Category**: Utility
- **Name**: `payment_delay`
- **Language**: Arabic
- **Body**:
  ```
  رسالة من {{1}}:

  عزيزي {{2}}، دفعتك بقيمة {{3}} {{4}} لمادة {{5}} كانت مستحقة بتاريخ {{6}}. يرجى التسديد في أقرب وقت.
  ```

### Template: Absence Warning
- **Category**: Utility
- **Name**: `absence_warning`
- **Language**: Arabic
- **Body**:
  ```
  رسالة من {{1}}:

  عزيزي {{2}}، لقد تغيب ابنك/ابنتك {{3}} عن {{4}} حصص متتالية في {{5}} ({{6}}). آخر حضور: {{7}}. يرجى التواصل معنا.
  ```

### Template: Exam Results
- **Category**: Utility
- **Name**: `exam_results`
- **Language**: Arabic
- **Body**:
  ```
  رسالة من {{1}}:

  عزيزي {{2}}، حصل {{3}} على {{4}}/{{5}} ({{6}}%) في امتحان {{7}} لمادة {{8}}.
  ```

4. Submit templates for review (takes 1-24 hours typically)

## Step 7: Get API Credentials

1. In your app dashboard, go to **WhatsApp** > **API Setup**
2. Note down:
   - **Phone Number ID**: Found under your registered number
   - **WhatsApp Business Account ID**: Found in the WABA section
   - **Permanent Access Token**:
     1. Go to **Business Settings** > **System Users**
     2. Create a system user (Admin role)
     3. Generate a token with `whatsapp_business_messaging` permission
     4. This token does not expire

### Credentials to Save:
```
WHATSAPP_PHONE_NUMBER_ID=<your-phone-number-id>
WHATSAPP_ACCESS_TOKEN=<your-permanent-token>
WHATSAPP_BUSINESS_ACCOUNT_ID=<your-waba-id>
```

## Step 8: Verify Business (Required for Production)

1. Go to **Business Settings** > **Security Center**
2. Click **Start Verification**
3. Provide:
   - Business documents (commercial registration, tax certificate)
   - Business website
   - Business phone number
4. Meta will review (takes 2-7 business days)

**Without verification:**
- Limited to 250 messages per 24 hours
- Cannot increase messaging tier

**After verification:**
- Start at 1,000 messages/day (Tier 1)
- Can scale to 10K, 100K, unlimited based on quality

## Step 9: Go to Production

1. In **App Dashboard**, toggle from **Development** to **Live**
2. Ensure:
   - Business verification is complete
   - At least one approved template exists
   - Phone number display name is approved

## Messaging Tiers (Daily Limits)

| Tier | Business-Initiated Conversations/day |
|------|-------------------------------------|
| Unverified | 250 |
| Tier 1 | 1,000 |
| Tier 2 | 10,000 |
| Tier 3 | 100,000 |
| Tier 4 | Unlimited |

You automatically move up tiers by maintaining good message quality and volume.

## Quality Rating

Meta monitors your message quality:
- **Green**: High quality - eligible for tier upgrade
- **Yellow**: Medium quality - maintain or improve
- **Red**: Low quality - risk of tier downgrade or restriction

To maintain quality:
- Only message students who expect messages (QR activated = opted in)
- Don't send too frequently (the 24h cooldown helps)
- Use utility templates (not marketing)

---

## Quick Checklist

- [ ] Meta Business Account created
- [ ] Developer App created with WhatsApp product
- [ ] Phone number registered and verified
- [ ] Display name approved
- [ ] Message templates created and approved (4 types)
- [ ] Permanent access token generated
- [ ] Business verification completed
- [ ] App switched to Live mode
- [ ] Credentials configured in the platform
