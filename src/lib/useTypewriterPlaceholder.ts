"use client";

import { useEffect, useRef, useState } from "react";

/** Typewriter placeholder — landing hero + dashboard create bar. */
export function useTypewriterPlaceholder(active: boolean, examples: readonly string[]) {
  const [display, setDisplay] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({
    exIdx: 0,
    charIdx: 0,
    phase: "typing" as "typing" | "pausing" | "deleting",
  });

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!active) {
      setDisplay("");
      return;
    }
    const st = stateRef.current;
    st.exIdx = 0;
    st.charIdx = 0;
    st.phase = "typing";
    const tick = () => {
      const target = examples[st.exIdx];
      if (st.phase === "typing") {
        st.charIdx++;
        setDisplay(target.slice(0, st.charIdx));
        if (st.charIdx >= target.length) {
          st.phase = "pausing";
          timerRef.current = setTimeout(tick, 2000);
        } else {
          timerRef.current = setTimeout(tick, 72);
        }
      } else if (st.phase === "pausing") {
        st.phase = "deleting";
        tick();
      } else {
        st.charIdx = Math.max(0, st.charIdx - 1);
        setDisplay(target.slice(0, st.charIdx));
        if (st.charIdx <= 0) {
          st.exIdx = (st.exIdx + 1) % examples.length;
          st.phase = "typing";
          timerRef.current = setTimeout(tick, 380);
        } else {
          timerRef.current = setTimeout(tick, 42);
        }
      }
    };
    timerRef.current = setTimeout(tick, 500);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, examples]);

  return display;
}
