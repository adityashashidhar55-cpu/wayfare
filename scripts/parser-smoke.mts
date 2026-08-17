/** Parser smoke test (no DB): npx tsx scripts/parser-smoke.mts */
import { parseBookingEmail } from "../api/bookings-router";

const UA = `Subject: Your United Airlines flight confirmation
From: United Airlines <unitedairlines@united.com>

United Airlines
eTicket Itinerary and Receipt
Confirmation code: X7KQP2

Flight UA 875
Departs: San Francisco (SFO) 11:40 AM, Friday, August 7, 2026
Arrives: Osaka Kansai (KIX) 3:05 PM +1 day
Cabin: Economy · Seat 14A

Total charged: USD 1,284.00
`;

const JR = `Subject: JR-EAST Train Reservation - Booking Confirmed
From: JR East <noreply@jreast.co.jp>

Thank you for using JR-EAST Train Reservation.
Reservation number: EJ8K2P4

Train: Hikari 507 (Shinkansen)
From: Tokyo Station
To: Kyoto Station
Departure date: August 9, 2026
Departure time: 09:33
Car 7 · Seat 12A (Reserved)

Total: JPY 14,170
`;

const AIRBNB = `Subject: Reservation confirmed - You're going to Kyoto!
From: Airbnb <automated@airbnb.com>

You're staying at Machiya Guesthouse Rojiura
Address: 541-2 Gojocho, Shimogyo Ward, Kyoto, Japan
Check-in: August 7, 2026 3:00 PM
Check-out: August 12, 2026 11:00 AM
Guests: 2 · 5 nights
Confirmation code: HMKX9TQ4WD
Total (USD): $842.50
`;

const HERTZ = `Subject: Your Hertz Rental Confirmation
From: Hertz Reservations <reservations@hertz.com>

Rental confirmation number: G4928817
Pick-up location: Kyoto Station Hachijo Exit
Pick-up date: August 12, 2026 10:00 AM
Return date: August 14, 2026 6:00 PM
Class: Compact
Total: USD 210.00
`;

const GYG = `Subject: Your GetYourGuide booking is confirmed
From: GetYourGuide <noreply@getyourguide.com>

Booking reference: GYG8A2K4Z
Tour: Fushimi Inari Hidden Hiking Tour
Venue: Inari Station, Fushimi Ward, Kyoto
Date: August 10, 2026
Start time: 08:30
Total: EUR 49.00
`;

const GARBAGE = `Hey! Are we still on for lunch next week? Let me know.. Mom`;

for (const [name, text] of Object.entries({
  UA,
  JR,
  AIRBNB,
  HERTZ,
  GYG,
  GARBAGE,
})) {
  const p = parseBookingEmail(text);
  if (!p) {
    console.log(`${name}: null`);
    continue;
  }
  const { details, ...rest } = p;
  console.log(
    `${name}:`,
    JSON.stringify({ ...rest, details: details?.slice(0, 80) }, null, 1)
  );
}
