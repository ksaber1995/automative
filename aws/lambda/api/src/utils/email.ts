import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({ region: process.env.AWS_REGION || 'eu-west-1' });

const SENDER = process.env.SENDER_EMAIL || 'noreply@automate-magic.com';

export async function sendOtpEmail(
  toEmail: string,
  otp: string,
  firstName: string
): Promise<void> {
  const command = new SendEmailCommand({
    Source: SENDER,
    Destination: {
      ToAddresses: [toEmail],
    },
    Message: {
      Subject: {
        Data: 'Verify your Netrofit account',
        Charset: 'UTF-8',
      },
      Body: {
        Html: {
          Data: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.07);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1d4ed8,#3b82f6);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Netrofit</h1>
              <p style="margin:6px 0 0;color:#bfdbfe;font-size:13px;">Multi-branch academy management</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h2 style="margin:0 0 16px;color:#1e293b;font-size:20px;font-weight:600;">Verify your email address</h2>
              <p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6;">Hi ${firstName},</p>
              <p style="margin:0 0 28px;color:#475569;font-size:15px;line-height:1.6;">
                Thank you for registering with Netrofit. Enter the code below to verify your email and activate your account.
              </p>
              <!-- OTP Box -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:0 0 28px;">
                    <div style="display:inline-block;background:#eff6ff;border:2px solid #bfdbfe;border-radius:12px;padding:20px 40px;">
                      <p style="margin:0 0 4px;color:#3b82f6;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Verification Code</p>
                      <p style="margin:0;color:#1d4ed8;font-size:40px;font-weight:800;letter-spacing:12px;font-family:'Courier New',monospace;">${otp}</p>
                    </div>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;color:#64748b;font-size:14px;">
                ⏰ This code expires in <strong>15 minutes</strong>.
              </p>
              <p style="margin:0;color:#64748b;font-size:14px;">
                If you did not create an account, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">
                &copy; ${new Date().getFullYear()} Netrofit. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
          `.trim(),
          Charset: 'UTF-8',
        },
        Text: {
          Data: [
            `Hello ${firstName},`,
            '',
            'Thank you for registering with Netrofit.',
            'Your email verification code is:',
            '',
            `  ${otp}`,
            '',
            'This code expires in 15 minutes.',
            '',
            'If you did not create an account, please ignore this email.',
          ].join('\n'),
          Charset: 'UTF-8',
        },
      },
    },
  });

  await ses.send(command);
}

export async function sendPasswordResetEmail(
  toEmail: string,
  firstName: string,
  resetLink: string
): Promise<void> {
  const command = new SendEmailCommand({
    Source: SENDER,
    Destination: { ToAddresses: [toEmail] },
    Message: {
      Subject: { Data: 'Reset your Netrofit password', Charset: 'UTF-8' },
      Body: {
        Html: {
          Data: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.07);">
          <tr>
            <td style="background:linear-gradient(135deg,#1d4ed8,#3b82f6);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Netrofit</h1>
              <p style="margin:6px 0 0;color:#bfdbfe;font-size:13px;">Multi-branch academy management</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 32px;">
              <h2 style="margin:0 0 16px;color:#1e293b;font-size:20px;font-weight:600;">Reset your password</h2>
              <p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6;">Hi ${firstName},</p>
              <p style="margin:0 0 28px;color:#475569;font-size:15px;line-height:1.6;">
                We received a request to reset your Netrofit password. Click the button below to choose a new one.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:0 0 28px;">
                    <a href="${resetLink}" style="display:inline-block;background:#1d4ed8;color:#ffffff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Reset Password</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;color:#64748b;font-size:14px;">
                ⏰ This link expires in <strong>1 hour</strong>.
              </p>
              <p style="margin:0 0 8px;color:#64748b;font-size:13px;word-break:break-all;">
                If the button doesn't work, paste this link into your browser:<br>
                <a href="${resetLink}" style="color:#1d4ed8;">${resetLink}</a>
              </p>
              <p style="margin:16px 0 0;color:#64748b;font-size:14px;">
                If you didn't request this, you can safely ignore this email — your password won't change.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">
                &copy; ${new Date().getFullYear()} Netrofit. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
          `.trim(),
          Charset: 'UTF-8',
        },
        Text: {
          Data: [
            `Hello ${firstName},`,
            '',
            'We received a request to reset your Netrofit password.',
            'Open this link to set a new password (expires in 1 hour):',
            '',
            `  ${resetLink}`,
            '',
            "If you didn't request this, you can safely ignore this email.",
          ].join('\n'),
          Charset: 'UTF-8',
        },
      },
    },
  });

  await ses.send(command);
}
