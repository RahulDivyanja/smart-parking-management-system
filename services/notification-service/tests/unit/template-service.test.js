const { describe, it } = require('node:test');
const assert = require('node:assert');

const templateService = require('../../src/services/template.service');

describe('Handlebars Template Service Unit Tests', () => {
  const sampleData = {
    customerName: 'Sarah Jenkins',
    bookingReference: 'BK-20261123-A8F2',
    facilityName: 'Metro North Parkade (Bay 42)',
    bookingDate: 'Monday, Nov 23, 2026',
    startTime: '09:00 AM UTC',
    endTime: '12:00 PM UTC',
    message: 'Access code is #5542'
  };

  it('should render booking-created template with correct data and layout', () => {
    const html = templateService.render('booking-created', {
      ...sampleData,
      subject: 'ParkEase - Reservation Created'
    });

    assert.ok(html.includes('ParkEase'));
    assert.ok(html.includes('Pending Confirmation'));
    assert.ok(html.includes('Sarah Jenkins'));
    assert.ok(html.includes('BK-20261123-A8F2'));
    assert.ok(html.includes('Metro North Parkade (Bay 42)'));
    assert.ok(html.includes('10 minutes'));
    assert.ok(html.includes('09:00 AM UTC'));
    assert.ok(html.includes('12:00 PM UTC'));
    assert.ok(html.includes('#5542'));
  });

  it('should render booking-confirmed template with confirmation badge and tips', () => {
    const html = templateService.render('booking-confirmed', {
      ...sampleData,
      subject: 'ParkEase - Booking Confirmed!'
    });

    assert.ok(html.includes('Confirmed'));
    assert.ok(html.includes('Reservation Confirmed!'));
    assert.ok(html.includes('Sarah Jenkins'));
    assert.ok(html.includes('BK-20261123-A8F2'));
    assert.ok(html.includes('Arrival Tips'));
  });

  it('should render booking-cancelled template with cancellation context', () => {
    const html = templateService.render('booking-cancelled', {
      ...sampleData,
      message: 'Cancelled by user due to travel schedule change'
    });

    assert.ok(html.includes('Cancelled'));
    assert.ok(html.includes('Reservation Cancelled'));
    assert.ok(html.includes('BK-20261123-A8F2'));
    assert.ok(html.includes('Cancelled by user due to travel schedule change'));
  });

  it('should render booking-expired template with hold expiration notice', () => {
    const html = templateService.render('booking-expired', {
      ...sampleData,
      message: 'Hold expired at 09:10 UTC'
    });

    assert.ok(html.includes('Expired'));
    assert.ok(html.includes('Reservation Hold Expired'));
    assert.ok(html.includes('create a new reservation'));
    assert.ok(html.includes('BK-20261123-A8F2'));
  });

  it('should safely escape dynamic HTML characters to prevent XSS injection', () => {
    const maliciousData = {
      customerName: '<script>alert("hack")</script>',
      bookingReference: 'BK-"><img src=x onerror=alert(1)>',
      facilityName: 'Downtown & Sons <Warehouse>'
    };

    const html = templateService.render('booking-created', maliciousData);

    assert.ok(!html.includes('<script>alert("hack")</script>'));
    assert.ok(html.includes('&lt;script&gt;alert(&quot;hack&quot;)&lt;/script&gt;'));
    assert.ok(html.includes('Downtown &amp; Sons &lt;Warehouse&gt;'));
  });

  it('should use safe default fallbacks when optional fields are omitted', () => {
    const html = templateService.render('booking-created', {});

    assert.ok(html.includes('Valued Customer'));
    assert.ok(html.includes('ParkEase Facility'));
  });

  it('should throw clear error when requested template does not exist', () => {
    assert.throws(() => {
      templateService.render('non-existent-template', {});
    }, /Email template 'non-existent-template' not found/);
  });
});
