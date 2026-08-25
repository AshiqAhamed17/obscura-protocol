import { Hero } from "@/components/Hero";
import { Reveal } from "@/components/Reveal";
import { Ruler } from "@/components/landing/Ruler";
import { Features } from "@/components/landing/Features";
import { WorkSection } from "@/components/landing/WorkSection";
import { ProofSection } from "@/components/landing/ProofSection";
import { LandingFooter } from "@/components/landing/LandingFooter";

export default function Home() {
  return (
    <main id="top">
      <Hero />

      {/* headline */}
      <div className="wrap headline">
        <div>
          <Reveal>
            <h1>
              A prediction market that&apos;s <em>private</em> to place and <em>proven</em> to pay.
            </h1>
          </Reveal>
          <Reveal delay={90}>
            <p className="sub">
              Your position is shielded the moment you take it. The whole book is settled by a
              zero-knowledge proof — so nobody sees your side, and nobody has to trust the house.
            </p>
          </Reveal>
        </div>
        <a className="scrolldown" href="#features" aria-label="Scroll to features">
          <svg width="18" height="24" viewBox="0 0 18 24" fill="none">
            <path d="M9 1v20M2 15l7 7 7-7" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </a>
      </div>

      <Ruler />
      <Features />
      <Ruler />
      <WorkSection />
      <Ruler />
      <ProofSection />

      {/* closer */}
      <section className="band wrap">
        <div className="kicker">Obscura Protocol</div>
        <div className="landing-h2" style={{ fontSize: "clamp(2.2rem, 6vw, 4.4rem)", maxWidth: "16ch" }}>
          Private to place. <em>Proven</em> to pay.
        </div>
        <a
          className="doclink"
          href="https://github.com/AshiqAhamed17/obscura-protocol"
          target="_blank"
          rel="noreferrer"
          style={{ marginTop: "1.4rem" }}
        >
          Explore the repository ↗
        </a>
      </section>

      <LandingFooter />
    </main>
  );
}
