import { useEffect, useState } from "react";

/**
 * Returns `value` after it has stopped changing for `delay` ms.
 *
 * Transformation is fast but not free, and re-running it on every keystroke of
 * a large document makes typing feel heavy. Debouncing the *input* rather than
 * the output keeps the generated code in sync with what was typed.
 */
export function useDebounced<T>(value: T, delay = 150): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debounced;
}
