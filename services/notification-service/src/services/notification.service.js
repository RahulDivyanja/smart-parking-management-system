const templateService = require('./template.service');
const defaultEmailService = require('./email.service');
const defaultRecipientResolver = require('./recipient-resolver.service');
const AppDataSource = require('../config/data-source');
const { DELIVERY_STATUS } = require('../constants/delivery-status');

/**
 * Notification Processing Service
 * Coordinates recipient resolution, database audit record persistence,
 * Handlebars rendering, SMTP dispatch, and delivery attempt logging
 */
class NotificationService {
  /**
   * @param {object} [options]
   * @param {import('typeorm').DataSource} [options.dataSource]
   * @param {object} [options.emailService]
   * @param {object} [options.templateService]
   * @param {object} [options.recipientResolver]
   */
  constructor(options = {}) {
    this.dataSource = options.dataSource || AppDataSource;
    this.emailService = options.emailService || defaultEmailService;
    this.templateService = options.templateService || templateService;
    this.recipientResolver = options.recipientResolver || defaultRecipientResolver;
  }

  /**
   * Orchestrates full notification lifecycle:
   * 1. Idempotency check against existing records
   * 2. Recipient resolution (direct payload email or User Service lookup)
   * 3. Persists notification record in SQL Server
   * 4. Renders Handlebars template
   * 5. Dispatches email via SMTP (only if recipient resolution succeeded)
   * 6. Logs delivery attempt in notification_delivery_logs
   * 7. Updates notification status to SENT, FAILED, or RETRYING
   * 
   * @param {object} params
   * @param {string} [params.eventId] - Originating event UUID
   * @param {string} [params.idempotencyKey] - Unique deduplication key
   * @param {string} [params.userId] - User identifier
   * @param {string} [params.recipientEmail] - Target email address (if present in payload)
   * @param {string} params.notificationType - Enum from NOTIFICATION_TYPE
   * @param {string} params.subject - Subject line
   * @param {string} params.templateName - Template basename (e.g. 'booking-created')
   * @param {object} [params.templateData] - Context variables for template
   * @returns {Promise<{
   *   notification: object,
   *   deliveryLog?: object,
   *   delivered: boolean,
   *   isDuplicate?: boolean,
   *   retryable?: boolean,
   *   error?: string
   * }>}
   */
  async processNotification({
    eventId,
    idempotencyKey,
    userId,
    recipientEmail,
    notificationType,
    subject,
    templateName,
    templateData = {}
  }) {
    const notificationRepo = this.dataSource.getRepository('Notification');
    const deliveryLogRepo = this.dataSource.getRepository('NotificationDeliveryLog');

    let existingNotification = null;
    if (idempotencyKey) {
      existingNotification = await notificationRepo.findOneBy({ idempotencyKey });
    }

    // 1. Idempotency Check
    if (existingNotification) {
      // 1a. SENT: Treat as completed. Do not send again.
      if (existingNotification.deliveryStatus === DELIVERY_STATUS.SENT) {
        return {
          notification: existingNotification,
          isDuplicate: true,
          delivered: true
        };
      }

      // 1b. FAILED: Distinguish permanent failure from retryable failure
      if (existingNotification.deliveryStatus === DELIVERY_STATUS.FAILED) {
        const errorMsg = (existingNotification.errorMessage || '').toLowerCase();
        const isPermanent =
          errorMsg.includes('404') ||
          errorMsg.includes('not found') ||
          errorMsg.includes('template rendering failed') ||
          errorMsg.includes('invalid email');

        if (isPermanent) {
          return {
            notification: existingNotification,
            isDuplicate: true,
            delivered: false,
            retryable: false,
            error: existingNotification.errorMessage || 'Permanent non-retryable failure'
          };
        }
      }

      // 1c. RETRYING / PENDING / retryable FAILED: Allow another processing attempt reusing record
    }

    // Calculate attempt number based on existing delivery logs
    let attemptNumber = 1;
    if (existingNotification) {
      try {
        if (typeof deliveryLogRepo.countBy === 'function') {
          attemptNumber = (await deliveryLogRepo.countBy({ notificationId: existingNotification.id })) + 1;
        } else if (typeof deliveryLogRepo.count === 'function') {
          attemptNumber = (await deliveryLogRepo.count({ where: { notificationId: existingNotification.id } })) + 1;
        } else if (typeof deliveryLogRepo.findBy === 'function') {
          const logs = await deliveryLogRepo.findBy({ notificationId: existingNotification.id });
          attemptNumber = (logs?.length || 0) + 1;
        } else {
          attemptNumber = 2;
        }
      } catch {
        attemptNumber = 2;
      }
    }

    // 2. Recipient Resolution: Direct payload email or User Service lookup
    const resolution = await this.recipientResolver.resolveRecipient({
      recipientEmail: recipientEmail || (existingNotification && existingNotification.recipientEmail !== 'UNRESOLVED' ? existingNotification.recipientEmail : undefined),
      customerName: templateData.customerName,
      userId: userId || existingNotification?.userId
    });

    // 2a. Recipient Resolution Failure: DO NOT SEND EMAIL
    if (!resolution.resolved) {
      const isRetryable = resolution.retryable === true;
      const initialStatus = isRetryable ? DELIVERY_STATUS.RETRYING : DELIVERY_STATUS.FAILED;

      let savedNotification;
      if (existingNotification) {
        existingNotification.deliveryStatus = initialStatus;
        existingNotification.errorMessage = resolution.error || 'Recipient resolution failed';
        savedNotification = await notificationRepo.save(existingNotification);
      } else {
        const newRecord = notificationRepo.create({
          eventId: eventId || null,
          idempotencyKey: idempotencyKey || null,
          userId: userId || null,
          recipientEmail: 'UNRESOLVED', // Non-null marker; never fabricate fake email domains
          notificationType,
          subject,
          templateName,
          payload: JSON.stringify(templateData),
          deliveryStatus: initialStatus,
          errorMessage: resolution.error || 'Recipient resolution failed'
        });
        try {
          savedNotification = await notificationRepo.save(newRecord);
        } catch (saveErr) {
          // Concurrent insert collision: reload existing record
          savedNotification = await notificationRepo.findOneBy({ idempotencyKey }) || newRecord;
        }
      }

      const deliveryLog = await deliveryLogRepo.save({
        notificationId: savedNotification.id,
        attemptNumber,
        provider: 'USER_SERVICE',
        deliveryStatus: initialStatus,
        errorMessage: resolution.error || 'Recipient resolution failed'
      });

      return {
        notification: savedNotification,
        deliveryLog,
        delivered: false,
        retryable: isRetryable,
        error: resolution.error
      };
    }

    // 2b. Recipient Resolution Succeeded
    const effectiveRecipientEmail = resolution.email;
    const effectiveTemplateData = { ...templateData };
    if (resolution.customerName && !effectiveTemplateData.customerName) {
      effectiveTemplateData.customerName = resolution.customerName;
    }

    let savedNotification;
    if (existingNotification) {
      existingNotification.recipientEmail = effectiveRecipientEmail;
      existingNotification.deliveryStatus = DELIVERY_STATUS.PENDING;
      existingNotification.payload = JSON.stringify(effectiveTemplateData);
      savedNotification = await notificationRepo.save(existingNotification);
    } else {
      const newRecord = notificationRepo.create({
        eventId: eventId || null,
        idempotencyKey: idempotencyKey || null,
        userId: userId || null,
        recipientEmail: effectiveRecipientEmail,
        notificationType,
        subject,
        templateName,
        payload: JSON.stringify(effectiveTemplateData),
        deliveryStatus: DELIVERY_STATUS.PENDING
      });
      try {
        savedNotification = await notificationRepo.save(newRecord);
      } catch (saveErr) {
        savedNotification = await notificationRepo.findOneBy({ idempotencyKey }) || newRecord;
      }
    }

    // 4. Render HTML email template
    let htmlContent;
    try {
      htmlContent = this.templateService.render(templateName, {
        ...effectiveTemplateData,
        subject
      });
    } catch (renderError) {
      savedNotification.deliveryStatus = DELIVERY_STATUS.FAILED;
      savedNotification.errorMessage = `Template rendering failed: ${renderError.message}`;
      await notificationRepo.save(savedNotification);

      const deliveryLog = await deliveryLogRepo.save({
        notificationId: savedNotification.id,
        attemptNumber,
        provider: 'TEMPLATE',
        deliveryStatus: DELIVERY_STATUS.FAILED,
        errorMessage: `Template rendering failed: ${renderError.message}`
      });

      return {
        notification: savedNotification,
        deliveryLog,
        delivered: false,
        retryable: false,
        error: renderError.message
      };
    }

    // 5. Mark status as SENDING
    savedNotification.deliveryStatus = DELIVERY_STATUS.SENDING;
    await notificationRepo.save(savedNotification);

    // 6. Send email via SMTP (outside DB transaction boundary)
    const emailResult = await this.emailService.sendEmail({
      to: effectiveRecipientEmail,
      subject,
      html: htmlContent
    });

    // 7. Record delivery attempt and finalize notification status
    if (emailResult.success) {
      savedNotification.deliveryStatus = DELIVERY_STATUS.SENT;
      savedNotification.sentAt = new Date();
      savedNotification.errorMessage = null;
      await notificationRepo.save(savedNotification);

      const providerName = (emailResult.simulated || (emailResult.messageId && emailResult.messageId.includes('simulated'))) ? 'SIMULATED' : 'SMTP';
      const deliveryLog = await deliveryLogRepo.save({
        notificationId: savedNotification.id,
        attemptNumber,
        provider: providerName,
        deliveryStatus: DELIVERY_STATUS.SENT,
        providerMessageId: emailResult.messageId || null
      });

      return {
        notification: savedNotification,
        deliveryLog,
        delivered: true
      };
    } else {
      // SMTP Delivery Failed - Distinguish permanent from retryable
      const errorMsg = (emailResult.error || '').toLowerCase();
      const isPermanentError =
        errorMsg.includes('550') ||
        errorMsg.includes('recipient rejected') ||
        errorMsg.includes('user unknown') ||
        errorMsg.includes('mailbox not found');
      const targetStatus = isPermanentError ? DELIVERY_STATUS.FAILED : DELIVERY_STATUS.RETRYING;
      const isRetryable = !isPermanentError;

      savedNotification.deliveryStatus = targetStatus;
      savedNotification.errorMessage = emailResult.error || 'SMTP delivery failed';
      await notificationRepo.save(savedNotification);

      const deliveryLog = await deliveryLogRepo.save({
        notificationId: savedNotification.id,
        attemptNumber,
        provider: 'SMTP',
        deliveryStatus: targetStatus,
        errorMessage: emailResult.error || 'SMTP delivery failed'
      });

      return {
        notification: savedNotification,
        deliveryLog,
        delivered: false,
        retryable: isRetryable,
        error: emailResult.error
      };
    }
  }
}

const defaultNotificationService = new NotificationService();
defaultNotificationService.NotificationService = NotificationService;

module.exports = defaultNotificationService;
