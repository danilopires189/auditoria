import { useCallback, useState } from "react";

type SoftKeyboardMode = "text" | "numeric";

export function useOnDemandSoftKeyboard(mode: SoftKeyboardMode = "text") {
  const [softKeyboardEnabled, setSoftKeyboardEnabled] = useState(false);

  const enableSoftKeyboard = useCallback(() => {
    setSoftKeyboardEnabled(true);
  }, []);

  const disableSoftKeyboard = useCallback(() => {
    setSoftKeyboardEnabled(false);
  }, []);

  const inputMode: "none" | SoftKeyboardMode = softKeyboardEnabled ? mode : "none";

  return {
    inputMode,
    enableSoftKeyboard,
    disableSoftKeyboard
  };
}
