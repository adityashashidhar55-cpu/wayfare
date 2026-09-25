/**
 * r35: privacy policy and terms. Google requires a public privacy-policy URL
 * before a sign-in app can leave "testing" mode, and a real product needs
 * both anyway. Plain, honest language about what the app actually stores.
 */
const UPDATED = "25 September 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="type-h3 text-ink">{title}</h2>
      <div className="type-body mt-2 space-y-3 leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

export function Privacy() {
  return (
    <main className="mx-auto max-w-[760px] px-5 py-14">
      <h1 className="type-h1 text-ink">Privacy policy</h1>
      <p className="type-caption mt-2 text-ink-3">Last updated {UPDATED}</p>
      <Section title="What we collect">
        <p>When you sign in with Google or Microsoft we receive your name, email address and, from Google, your profile picture. If you create an account with email, we store your email and a one-way hash of your password, never the password itself.</p>
        <p>We store what you put into Wayfare: trips, itineraries, places, expenses, checklists, notes, journal posts and messages you send to your trip group. If you allow location access, it is used on your device to show nearby places and is not stored unless you save something.</p>
      </Section>
      <Section title="How we use it">
        <p>Only to run the service: to show you your trips, to share a trip with the people you invite, to send you invites and password-reset emails, and to process payments if you upgrade. We do not sell your data and we do not show you third-party advertising.</p>
      </Section>
      <Section title="Who can see your trips">
        <p>Trip members you invite. A trip is visible to anyone else only if you create a share link or publish it. Private checklist items are visible only to you.</p>
      </Section>
      <Section title="Services we rely on">
        <p>Hosting (Render), database (TiDB Cloud), email delivery (Resend) and payments (Razorpay). Map and place data come from OpenStreetMap contributors. Booking links may take you to partner sites, whose own policies apply.</p>
      </Section>
      <Section title="Your choices">
        <p>You can edit or delete your trips at any time. To delete your account and everything in it, email us from the address you signed in with and we will do it within 30 days.</p>
      </Section>
      <Section title="Contact">
        <p>aditya.shashidhar55@gmail.com</p>
      </Section>
    </main>
  );
}

export function Terms() {
  return (
    <main className="mx-auto max-w-[760px] px-5 py-14">
      <h1 className="type-h1 text-ink">Terms of use</h1>
      <p className="type-caption mt-2 text-ink-3">Last updated {UPDATED}</p>
      <Section title="The service">
        <p>Wayfare helps you plan trips, split costs and share plans with friends. Suggestions, opening hours, prices and travel times are estimates; check anything important with the venue or operator before you rely on it.</p>
      </Section>
      <Section title="Your content">
        <p>You own what you add. You give us permission to store and display it to the people you choose to share it with. Do not post anything unlawful or anything you do not have the right to share.</p>
      </Section>
      <Section title="Paid plans">
        <p>Voyager is billed in advance for the period you choose. Cancelling stops renewal; you keep access until the end of the paid period.</p>
      </Section>
      <Section title="Liability">
        <p>The service is provided as is. We are not responsible for bookings you make on partner sites or for decisions made on the basis of estimates shown in the app.</p>
      </Section>
    </main>
  );
}
