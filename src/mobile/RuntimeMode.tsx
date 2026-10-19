import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";

function readMode() {
  if (typeof window === "undefined")
    return { native: false, height: 852, width: 393, top: 0, left: 0 };
  const mode = new URLSearchParams(window.location.search).get("mode");
  return {
    native:
      mode === "phone" ||
      (mode !== "preview" &&
        window.matchMedia("(pointer: coarse) and (max-width: 1024px)").matches),
    height: Math.round(window.visualViewport?.height ?? window.innerHeight),
    width: Math.round(window.visualViewport?.width ?? window.innerWidth),
    top: Math.max(0, window.visualViewport?.offsetTop ?? 0),
    left: Math.max(0, window.visualViewport?.offsetLeft ?? 0),
  };
}

const RuntimeModeContext = createContext(readMode());

export function RuntimeModeProvider({ children }: PropsWithChildren) {
  const [mode, setMode] = useState(readMode);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = readMode();
        // Keyboard/rotation resizes must never reparent the app and discard form state.
        setMode((previous) =>
          previous.height === next.height &&
          previous.width === next.width &&
          previous.top === next.top &&
          previous.left === next.left
            ? previous
            : { ...next, native: previous.native },
        );
      });
    };
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);
  return (
    <RuntimeModeContext.Provider value={mode}>
      {children}
    </RuntimeModeContext.Provider>
  );
}

export function useRuntimeMode() {
  return useContext(RuntimeModeContext);
}
