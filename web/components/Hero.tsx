"use client";

import { motion } from "framer-motion";

const ease = [0.2, 0.7, 0.2, 1] as const;

export function Hero() {
  return (
    <div className="stage">
      <section className="hero">
        <div className="hero-surface" aria-hidden />
        <div className="hero-body">
          <motion.p
            className="hero-eyebrow"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
          >
            Privacy-preserving prediction markets
          </motion.p>
          <motion.h1
            className="wordmark"
            initial={{ opacity: 0, y: 18, filter: "blur(14px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 1.2, ease, delay: 0.25 }}
          >
            OBSCURA
          </motion.h1>
        </div>
        <motion.div
          className="hero-foot"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 1 }}
        >
          <span>
            Built with <b>Noir</b> · <b>SP1</b> · <b>Chainlink</b>
          </span>
          <span className="live">
            <span className="beat" aria-hidden />
            Live on Sepolia
          </span>
        </motion.div>
      </section>
    </div>
  );
}
