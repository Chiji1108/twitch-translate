"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

type CaptionStackLineProps = {
  children: ReactNode;
  className: string;
  layoutDependency: string;
};

export function CaptionStackLine({
  children,
  className,
  layoutDependency,
}: CaptionStackLineProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      layout={reduceMotion ? false : "position"}
      layoutDependency={layoutDependency}
      transition={{
        layout: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
