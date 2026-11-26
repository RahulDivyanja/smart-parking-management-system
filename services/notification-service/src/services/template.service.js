const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');

/**
 * Handlebars Template Rendering Service
 * Compiles and renders ParkEase branded HTML emails
 */
class TemplateService {
  constructor() {
    this.templatesDir = path.join(__dirname, '../templates');
    this.layoutPath = path.join(this.templatesDir, 'layouts/main.hbs');
    this.compiledTemplates = new Map();
    this.compiledLayout = null;

    this._initializeLayout();
  }

  /**
   * Pre-compile master layout
   * @private
   */
  _initializeLayout() {
    if (fs.existsSync(this.layoutPath)) {
      const layoutSource = fs.readFileSync(this.layoutPath, 'utf8');
      this.compiledLayout = handlebars.compile(layoutSource);
    }
  }

  /**
   * Get or compile a template by name
   * @param {string} templateName 
   * @returns {handlebars.TemplateDelegate}
   */
  getTemplate(templateName) {
    if (this.compiledTemplates.has(templateName)) {
      return this.compiledTemplates.get(templateName);
    }

    const templatePath = path.join(this.templatesDir, `${templateName}.hbs`);
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Email template '${templateName}' not found at: ${templatePath}`);
    }

    const templateSource = fs.readFileSync(templatePath, 'utf8');
    const compiled = handlebars.compile(templateSource);
    this.compiledTemplates.set(templateName, compiled);
    return compiled;
  }

  /**
   * Render an email template inside the master layout
   * @param {string} templateName - e.g. 'booking-created'
   * @param {object} data - Dynamic variables for the template
   * @returns {string} - Full rendered HTML email
   */
  render(templateName, data = {}) {
    const template = this.getTemplate(templateName);

    // Provide safe non-invented defaults
    const context = {
      ...data,
      customerName: data.customerName || 'Valued Customer',
      bookingReference: data.bookingReference || 'N/A',
      facilityName: data.facilityName || 'ParkEase Facility',
      bookingDate: data.bookingDate || 'Scheduled Date',
      startTime: data.startTime || 'Start Time',
      endTime: data.endTime || 'End Time',
      message: data.message || ''
    };

    const bodyHtml = template(context);

    if (this.compiledLayout) {
      return this.compiledLayout({
        ...context,
        subject: data.subject || 'ParkEase Notification',
        body: bodyHtml
      });
    }

    return bodyHtml;
  }
}

module.exports = new TemplateService();
