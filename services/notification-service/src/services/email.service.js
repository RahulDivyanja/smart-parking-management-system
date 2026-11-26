const nodemailer = require('nodemailer');
const config = require('../config/env');

/**
 * Reusable Email Service
 * Handles Nodemailer transporter setup, SMTP verification, and HTML email dispatch
 */
class EmailService {
  /**
   * @param {object} [options]
   * @param {nodemailer.Transporter} [options.transporter] - Injected transporter (e.g. for testing)
   */
  constructor(options = {}) {
    if (options.transporter) {
      this.transporter = options.transporter;
      this.customTransporter = true;
    } else {
      this.customTransporter = false;
      this.transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: {
          user: config.smtp.user,
          pass: config.smtp.password
        },
        tls: {
          rejectUnauthorized: config.nodeEnv === 'production'
        }
      });
    }
  }

  /**
   * Verifies SMTP connection with configured credentials
   * @returns {Promise<{ ok: boolean, error?: string, code?: string }>}
   */
  async verifyConnection() {
    try {
      await this.transporter.verify();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        code: error.code
      };
    }
  }

  /**
   * Sends an HTML email
   * @param {object} options
   * @param {string} options.to - Recipient email address
   * @param {string} options.subject - Email subject line
   * @param {string} options.html - Full rendered HTML content
   * @param {string} [options.text] - Plain text alternative
   * @returns {Promise<{ success: boolean, messageId?: string, response?: string, error?: string, code?: string }>}
   */
  async sendEmail({ to, subject, html, text }) {
    if (!to) {
      return {
        success: false,
        error: 'Recipient email address (to) is required'
      };
    }

    if (!subject) {
      return {
        success: false,
        error: 'Email subject is required'
      };
    }

    if (!html) {
      return {
        success: false,
        error: 'Email HTML content is required'
      };
    }

    // Safe delivery-disabled mode for dev/test when no custom transporter is injected
    if (!this.customTransporter && !config.smtp.deliveryEnabled) {
      console.log(`[EmailService] Safe Mode: Email delivery disabled. Simulated dispatch to: ${to}`);
      return {
        success: true,
        simulated: true,
        messageId: '<simulated-disabled-mode@parkease.local>',
        response: '250 Simulated OK (delivery disabled)'
      };
    }

    const mailOptions = {
      from: config.smtp.from,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim()
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      return {
        success: true,
        messageId: info.messageId,
        response: info.response
      };
    } catch (error) {
      // Safe error return without leaking passwords or auth headers
      return {
        success: false,
        error: error.message,
        code: error.code
      };
    }
  }
}

// Export singleton instance as default, class for custom instantiation/mocking
const defaultEmailService = new EmailService();
defaultEmailService.EmailService = EmailService;

module.exports = defaultEmailService;
