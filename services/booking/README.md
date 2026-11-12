# Booking service

Provides date availability, reservations, simulated checkout, history, cancellation, rescheduling, and staff review. Holds last 2 minutes and expire to CANCELLED on booking/availability access. Payment and refund changes are atomic with their logs; retries do not duplicate a successful payment or refund. No card data or real money is handled.

Run with the root Compose stack. The [API agreement](../../docs/api.md#member-4-booking) lists the routes. Run the root verification script to test concurrency, ownership and lifecycle rules.
