/**
 * Initial TypeORM Migration: Create bookings table and indexes in Microsoft SQL Server
 */
class CreateBookingsTable1700000000000 {
  name = 'CreateBookingsTable1700000000000';

  /**
   * Run migration
   * @param {import('typeorm').QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'bookings')
      BEGIN
        CREATE TABLE [bookings] (
          [id] UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          [booking_reference] NVARCHAR(25) NOT NULL,
          [user_id] NVARCHAR(50) NOT NULL,
          [facility_id] NVARCHAR(50) NOT NULL,
          [vehicle_registration_number] NVARCHAR(20) NOT NULL,
          [start_time] DATETIME2(0) NOT NULL,
          [end_time] DATETIME2(0) NOT NULL,
          [hourly_rate] DECIMAL(10, 2) NOT NULL,
          [total_amount] DECIMAL(10, 2) NOT NULL,
          [status] NVARCHAR(20) NOT NULL DEFAULT 'PENDING',
          [created_at] DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
          [updated_at] DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
          CONSTRAINT [PK_bookings_id] PRIMARY KEY CLUSTERED ([id]),
          CONSTRAINT [UQ_bookings_reference] UNIQUE NONCLUSTERED ([booking_reference]),
          CONSTRAINT [CK_bookings_hourly_rate] CHECK ([hourly_rate] >= 0),
          CONSTRAINT [CK_bookings_total_amount] CHECK ([total_amount] >= 0)
        );
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_bookings_facility_status_times' AND object_id = OBJECT_ID('bookings'))
      BEGIN
        CREATE NONCLUSTERED INDEX [IX_bookings_facility_status_times] 
        ON [bookings] ([facility_id], [status], [start_time], [end_time]);
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_bookings_user_id' AND object_id = OBJECT_ID('bookings'))
      BEGIN
        CREATE NONCLUSTERED INDEX [IX_bookings_user_id] 
        ON [bookings] ([user_id]);
      END
    `);
  }

  /**
   * Revert migration
   * @param {import('typeorm').QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`
      IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_bookings_user_id' AND object_id = OBJECT_ID('bookings'))
      BEGIN
        DROP INDEX [IX_bookings_user_id] ON [bookings];
      END
    `);

    await queryRunner.query(`
      IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_bookings_facility_status_times' AND object_id = OBJECT_ID('bookings'))
      BEGIN
        DROP INDEX [IX_bookings_facility_status_times] ON [bookings];
      END
    `);

    await queryRunner.query(`
      IF EXISTS (SELECT * FROM sys.tables WHERE name = 'bookings')
      BEGIN
        DROP TABLE [bookings];
      END
    `);
  }
}

module.exports = CreateBookingsTable1700000000000;
