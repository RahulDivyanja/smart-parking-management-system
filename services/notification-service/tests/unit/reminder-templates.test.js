const { describe, it } = require('node:test');
const assert = require('node:assert');
const templateService = require('../../src/services/template.service');

describe('Reminder Templates - Handlebars Unit Tests', () => {
  it('should render reminder-arrival template with facilityId, date, and times', () => {
    const html = templateService.render('reminder-arrival', {
      customerName: 'Samitha Perera',
      bookingReference: 'BK-ARR-001',
      facilityName: 'FAC-COLOMBO-CENTRAL',
      facilityId: 'FAC-COLOMBO-CENTRAL',
      bookingDate: '23 Nov 2026',
      startTime: '02:30 PM (Asia/Colombo)',
      endTime: '04:30 PM (Asia/Colombo)'
    });

    assert.ok(html.includes('Arrival Reminder: Your Parking Session Starts Soon'));
    assert.ok(html.includes('Samitha Perera'));
    assert.ok(html.includes('BK-ARR-001'));
    assert.ok(html.includes('FAC-COLOMBO-CENTRAL'));
    assert.ok(html.includes('23 Nov 2026'));
    assert.ok(html.includes('02:30 PM (Asia/Colombo)'));
    assert.ok(html.includes('04:30 PM (Asia/Colombo)'));
  });

  it('should render reminder-departure template with departure warnings and times', () => {
    const html = templateService.render('reminder-departure', {
      customerName: 'Dilshan Silva',
      bookingReference: 'BK-DEP-002',
      facilityName: 'FAC-KANDY-01',
      facilityId: 'FAC-KANDY-01',
      bookingDate: '23 Nov 2026',
      startTime: '05:00 PM (Asia/Colombo)',
      endTime: '07:00 PM (Asia/Colombo)'
    });

    assert.ok(html.includes('Departure Reminder: Your Parking Session Ends Soon'));
    assert.ok(html.includes('Dilshan Silva'));
    assert.ok(html.includes('BK-DEP-002'));
    assert.ok(html.includes('FAC-KANDY-01'));
    assert.ok(html.includes('07:00 PM (Asia/Colombo)'));
    assert.ok(html.includes('avoid any overtime parking fees'));
  });
});
