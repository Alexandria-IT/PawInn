import { transaction } from "./runtime.js";

export const checkInOpensAt = "12:30";
export const pickupDeadline = "12:00";
export const latePickupHourlyRate = 100;
export const hotelDateSql = "(statement_timestamp() AT TIME ZONE 'Asia/Bangkok')::date";

// Release missed check-ins and record why, without changing their payment.
export async function releaseNoShows(db) {
  await db.query(`WITH missed AS (
    UPDATE bookings
    SET status='CANCELLED', no_show_at=clock_timestamp()
    WHERE status='CONFIRMED' AND arrived_at IS NULL AND check_in_date < ${hotelDateSql}
    RETURNING booking_id
  )
  INSERT INTO booking_logs (booking_id, action, details)
  SELECT booking_id, 'NO_SHOW', 'No arrival recorded on check-in day (Bangkok time). Room released without a refund.'
  FROM missed`);
}

// Apply the policy before reading or changing inventory or attendance.
export const sweepNoShows = (pool) => transaction(pool, releaseNoShows);
