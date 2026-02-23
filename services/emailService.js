const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    console.warn('Gmail credentials not configured. Email sending disabled.');
    return null;
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  return transporter;
}

async function sendPasswordResetEmail(toEmail, resetToken) {
  const transport = getTransporter();
  if (!transport) {
    throw new Error('Email not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD environment variables.');
  }

  const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
  const resetLink = `${appUrl}#/reset-password?token=${resetToken}`;

  await transport.sendMail({
    from: `"Menu Planner" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: 'Password Reset - Menu Planner',
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #2d6a4f;">Menu Planner</h2>
        <p>You requested a password reset. Click the link below to set a new password:</p>
        <p style="margin: 24px 0;">
          <a href="${resetLink}" style="background: #2d6a4f; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            Reset Password
          </a>
        </p>
        <p style="color: #757575; font-size: 14px;">This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
      </div>
    `,
  });
}

module.exports = { sendPasswordResetEmail };
