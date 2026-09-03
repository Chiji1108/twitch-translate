"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

type CaptionStackEntryProps = {
  children: ReactNode;
  className: string;
};

export function CaptionStackEntry({
  children,
  className,
}: CaptionStackEntryProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      layout={reduceMotion ? false : "position"}
      transition={{
        layout: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
