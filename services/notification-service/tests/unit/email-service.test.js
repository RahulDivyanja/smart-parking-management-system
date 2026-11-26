const { describe, it } = require('node:test');
const assert = require('node:assert');

const { EmailService } = require('../../src/services/email.service');
const config = require('../../src/config/env');

describe('Email Service Unit Tests', () => {
  it('should verify default SMTP configuration targets Gmail port 587', () => {
    assert.strictEqual(config.smtp.host, 'smtp.gmail.com');
    assert.strictEqual(config.smtp.port, 587);
    assert.strictEqual(config.smtp.secure, false);
  });

  it('should verify connection successfully with a mocked transporter', async () => {
    const mockTransporter = {
      verify: async () => true
    };
    const service = new EmailService({ transporter: mockTransporter });
    const result = await service.verifyConnection();

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.error, undefined);
  });

  it('should safely capture connection errors without throwing or leaking credentials', async () => {
    const mockTransporter = {
      verify: async () => {
        const error = new Error('Invalid login: 535-5.7.8 Username and Password not accepted');
        error.code = 'EAUTH';
        throw error;
      }
    };
    const service = new EmailService({ transporter: mockTransporter });
    const result = await service.verifyConnection();

    assert.strictEqual(result.ok, false);
    assert.ok(result.error.includes('535-5.7.8'));
    assert.strictEqual(result.code, 'EAUTH');
  });

  it('should validate required parameters (to, subject, html)', async () => {
    const mockTransporter = {
      sendMail: async () => ({ messageId: '<test-msg-123@gmail.com>', response: '250 OK' })
    };
    const service = new EmailService({ transporter: mockTransporter });

    const noTo = await service.sendEmail({ subject: 'Test', html: '<p>Hi</p>' });
    assert.strictEqual(noTo.success, false);
    assert.ok(noTo.error.includes('to'));

    const noSubject = await service.sendEmail({ to: 'test@example.com', html: '<p>Hi</p>' });
    assert.strictEqual(noSubject.success, false);
    assert.ok(noSubject.error.includes('subject'));

    const noHtml = await service.sendEmail({ to: 'test@example.com', subject: 'Test' });
    assert.strictEqual(noHtml.success, false);
    assert.ok(noHtml.error.toLowerCase().includes('html'));
  });

  it('should successfully send email and return messageId and response', async () => {
    let capturedMailOptions = null;
    const mockTransporter = {
      sendMail: async (options) => {
        capturedMailOptions = options;
        return {
          messageId: '<1700000000.parkease@gmail.com>',
          response: '250 2.0.0 OK'
        };
      }
    };
    const service = new EmailService({ transporter: mockTransporter });

    const result = await service.sendEmail({
      to: 'driver@example.com',
      subject: 'Reservation Confirmed',
      html: '<h1>Booking Confirmed</h1><p>Enjoy your parking</p>'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.messageId, '<1700000000.parkease@gmail.com>');
    assert.strictEqual(result.response, '250 2.0.0 OK');

    assert.strictEqual(capturedMailOptions.to, 'driver@example.com');
    assert.strictEqual(capturedMailOptions.subject, 'Reservation Confirmed');
    assert.ok(capturedMailOptions.html.includes('Booking Confirmed'));
    assert.ok(capturedMailOptions.text.includes('Booking Confirmed Enjoy your parking'));
  });

  it('should handle SMTP failure safely without crashing and return error details', async () => {
    const mockTransporter = {
      sendMail: async () => {
        const error = new Error('550 5.1.1 The email account that you tried to reach does not exist');
        error.code = 'EENVELOPE';
        throw error;
      }
    };
    const service = new EmailService({ transporter: mockTransporter });

    const result = await service.sendEmail({
      to: 'nonexistent@example.com',
      subject: 'Booking Failed',
      html: '<p>Failed</p>'
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('550 5.1.1'));
    assert.strictEqual(result.code, 'EENVELOPE');
  });
});
