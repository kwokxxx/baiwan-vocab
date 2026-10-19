import { useEffect, type PropsWithChildren } from "react";
import { MobileDeviceProvider, useMobileDevice } from "./Device";
import { KeyboardDock, KeyboardProvider, useKeyboard } from "./Keyboard";
import { PhoneFrame } from "./PhoneFrame";
import { HomeIndicator, StatusBar } from "./components";
import { RuntimeModeProvider, useRuntimeMode } from "./RuntimeMode";

export function MobileRuntime({ children }: PropsWithChildren) {
  return (
    <RuntimeModeProvider>
      <MobileDeviceProvider>
        <PhoneFrame>
          <KeyboardProvider>
            <RuntimeContents>{children}</RuntimeContents>
          </KeyboardProvider>
        </PhoneFrame>
      </MobileDeviceProvider>
    </RuntimeModeProvider>
  );
}

function RuntimeContents({ children }: PropsWithChildren) {
  const { native } = useRuntimeMode();
  return (
    <>
      {!native && <KeyboardPreview />}
      {!native && <StatusBar />}
      <MobileAppViewport>{children}</MobileAppViewport>
      {!native && <HomeIndicator />}
      {!native && <KeyboardDock />}
    </>
  );
}

function MobileAppViewport({ children }: PropsWithChildren) {
  const { device } = useMobileDevice();
  const keyboard = useKeyboard();

  return (
    <div
      className="mobile-app-viewport"
      data-keyboard-visible={keyboard.visible ? "true" : "false"}
      data-platform={device.platform}
      data-testid="mobile-app-viewport"
    >
      {children}
    </div>
  );
}

function KeyboardPreview() {
  const keyboard = useKeyboard();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("keyboard") === "1") {
      keyboard.show();
    }
  }, [keyboard]);

  return null;
}
