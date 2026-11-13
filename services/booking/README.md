# Booking service

Provides date availability, reservations, simulated checkout, history, cancellation, rescheduling, and staff review. Holds last 2 minutes and expire to CANCELLED on booking/availability access. Payment and refund changes are atomic with their logs; retries do not duplicate a successful payment or refund. No card data or real money is handled.

Check-in opens at 12:30 Bangkok time on the first day. Confirmed stays without an arrival expire after that day. PawInn releases the room, keeps the original payment, and expires open change requests. Pickup is due at noon on the checkout date. Each started hour after noon adds a simulated THB 100 charge. The room remains occupied until actual pickup is recorded.

Run with the root Compose stack. The [API agreement](../../docs/api.md#member-4-booking) lists the routes. Run the root verification script to test concurrency, ownership and lifecycle rules.
