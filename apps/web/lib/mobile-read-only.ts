import { useEffect, useRef, useState } from "react";

export const mobileReadOnlyQuery = "(max-width: 640px)";
export const mobileReadOnlyMessage = "スマートフォンでは閲覧のみです。パソコンで操作してください。";

/** Mutation handlers use this too, so a delayed render cannot permit a mobile action. */
export const canPerformDesktopAction = (mobile: boolean, busy = false) => !mobile && !busy;

/**
 * Starts conservatively read-only. The ref is intentionally synchronous so a click cannot
 * slip between viewport changes and React's next render.
 */
export const useMobileReadOnly = () => {
  const [mobile, setMobile] = useState(true);
  const mobileRef = useRef(true);
  useEffect(() => {
    const media = window.matchMedia(mobileReadOnlyQuery);
    const sync = () => { mobileRef.current = media.matches; setMobile(media.matches); };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return { mobile, mobileRef };
};
