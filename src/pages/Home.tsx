import Hero from '@/components/home/Hero';
import FeatureTour from '@/components/home/FeatureTour';

/**
 * Wayfare landing page (r23 design): a single full-viewport hero section
 * (video background, glass prompt card) with the auto-cycling feature tour
 * anchored one scroll below, reachable from the "Features" nav button.
 */
export default function Home() {
  return (
    <>
      <Hero />
      <section id="features" className="relative z-[2] scroll-mt-6 bg-white px-6 pb-20 pt-4">
        <div className="mx-auto w-full max-w-[701px]">
          <FeatureTour />
        </div>
      </section>
    </>
  );
}
