# PawInn requirements implementation plan

This is a historical plan and test record. The account administration feature described below was subsequently retired. See the [current setup guide](../../../README.md#set-up-staff-access) for staff provisioning.

**Goal:** Close the gaps in the PawInn User Story document in the existing Docker stack.

**Architecture:** Account owns user status, Admin actions and their audit history. Booking owns actual stay times, dated care history, and simulated price adjustments. The Alpine pages continue using the same authenticated API through Nginx.

**Spec:** [PawInn User Story](https://docs.google.com/document/d/1LrqKjZ4x7x-RAAgLFZo1M0krEJ3vhYEUWud28ZBYif8/edit?usp=sharing), FR-01–21 and NFR-01–06.

- [x] Add actual arrival/pickup, daily reports, separate care records, correction history, and customer/staff history.
- [x] Add Admin role, account operations and audit, with migration and cross-service access checks.
- [x] Add pet-first search and editable held booking, complete staff filters and review, and require decline reasons.
- [x] Quote customer date changes on the original rate and apply original-room moves and simulated adjustments in one transaction.
- [x] Run the disposable Docker suite and verify the customer booking flow at 360 CSS pixels and by keyboard.

## Local verification evidence

| Check | Observed result |
| --- | --- |
| Docker integration and database restart | All groups passed: overlap and last-room race, hold editing, payment retry, cancellation and inventory restoration, reschedule charges/refunds, dated care and photo privacy, Admin permissions/auditing, and restart persistence. |
| Frontend build and tests | Build succeeded; all three frontend checks passed. |
| Upgrade from `fa2ce26` | Same disposable PostgreSQL container; all six existing bookings and all three active accounts were preserved. New care and audit tables were present. |
| 360 px room search, review, checkout, booking details | No horizontal overflow. Reservation and booking detail dialogs each had equal client and scroll widths. Buddy was preselected after choosing his saved profile. |
| Keyboard and errors | Visible solid focus outline on a date input; booking dialog, checkout and retry operable with Enter/Space; Arrow Right moved visible focus to Care during stay. Declined checkout explained that the room was still held and how to retry. |
| Staff/customer agreement | Both saw CONFIRMED with a pending reschedule. Staff approved the quoted THB 650 adjustment. After staff recorded arrival, an individual care event, and pickup, the customer saw COMPLETED, the original/requested dates, and the care event alongside the missing daily report indicator. |

These are local checks with fixture data. Capture the assigned course-container and Jenkins runs separately using [the verification walkthrough](../../local-demo.md).
