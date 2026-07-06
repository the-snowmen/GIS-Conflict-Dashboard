import { useEffect, useState } from "react";

// Reactive viewport check — true below the phone breakpoint. Unlike a one-shot
// window.innerWidth read, this updates when the viewport crosses the breakpoint.
export function useIsMobile(query = "(max-width: 900px)"): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
