#!/usr/bin/env node

/**
 * Opt-in CLI utility to send a real test email using configured Gmail SMTP
 * Usage: npm run email:test -- <recipient-email>
 * Example: npm run email:test -- mytest@gmail.com
 */
require('dotenv').config();
const config = require('../src/config/env');
const emailService = require('../src/services/email.service');
const templateService = require('../src/services/template.service');

async function main() {
  const recipient = process.argv[2];

  console.log('========================================================');
  console.log('ParkEase Notification Service - Live SMTP Test Utility');
  console.log('========================================================\n');

  // Guard: Check if credentials are placeholders
  const user = config.smtp.user;
  const pass = config.smtp.password;

  if (!user || user.includes('your-email') || !pass || pass.includes('your-google-app-password')) {
    console.error('❌ Gmail SMTP credentials are not configured in notification-service/.env.');
    console.log('\nTo configure Gmail SMTP:');
    console.log('1. Open your Google Account: https://myaccount.google.com/security');
    console.log('2. Ensure 2-Step Verification is enabled.');
    console.log('3. Search for "App Passwords" and generate a 16-character password for "Mail".');
    console.log('4. In notification-service/.env, set:');
    console.log('   SMTP_HOST=smtp.gmail.com');
    console.log('   SMTP_PORT=587');
    console.log('   SMTP_SECURE=false');
    console.log('   SMTP_USER=your_real_gmail@gmail.com');
    console.log('   SMTP_PASSWORD=your_16_character_app_password');
    console.log('   EMAIL_FROM=your_real_gmail@gmail.com\n');
    console.log('Then re-run: npm run email:test -- <recipient-email>\n');
    process.exit(1);
  }

  if (!recipient || !recipient.includes('@')) {
    console.error('❌ Please provide a valid recipient email address.');
    console.log('Usage: npm run email:test -- <recipient-email>');
    console.log('Example: npm run email:test -- user@example.com\n');
    process.exit(1);
  }

  console.log(`Checking SMTP connection to ${config.smtp.host}:${config.smtp.port}...`);
  const verifyResult = await emailService.verifyConnection();

  if (!verifyResult.ok) {
    console.error(`❌ SMTP Connection Failed: ${verifyResult.error}`);
    process.exit(1);
  }
  console.log('✅ SMTP Connection verified successfully!\n');

  console.log(`Rendering test template 'booking-confirmed' for ${recipient}...`);
  const html = templateService.render('booking-confirmed', {
    subject: 'ParkEase Test - Reservation Confirmed',
    customerName: 'ParkEase Explorer',
    bookingReference: 'BK-TEST-2026',
    facilityName: 'Downtown Central Garage (Level 2, Bay B-14)',
    bookingDate: 'Monday, Nov 23, 2026',
    startTime: '10:00 AM UTC',
    endTime: '12:00 PM UTC',
    message: 'This is a test notification verifying your ParkEase Gmail SMTP integration.'
  });

  console.log(`Sending email to: ${recipient}...`);
  const sendResult = await emailService.sendEmail({
    to: recipient,
    subject: 'ParkEase Test - Reservation Confirmed',
    html
  });

  if (sendResult.success) {
    console.log('🎉 Email sent successfully!');
    console.log(`Message ID: ${sendResult.messageId}`);
    console.log(`Server Response: ${sendResult.response}`);
  } else {
    console.error(`❌ Failed to send email: ${sendResult.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
