import { createContext, useContext, useRef, useCallback } from 'react';

type CameraCallback = () => void;

const CameraContext = createContext<{
  registerHandler: (fn: CameraCallback) => void;
  triggerCamera: () => void;
}>({
  registerHandler: () => {},
  triggerCamera: () => {},
});

export function CameraProvider({ children }: { children: React.ReactNode }) {
  const handlerRef = useRef<CameraCallback | null>(null);

  const registerHandler = useCallback((fn: CameraCallback) => {
    handlerRef.current = fn;
  }, []);

  const triggerCamera = useCallback(() => {
    handlerRef.current?.();
  }, []);

  return (
    <CameraContext.Provider value={{ registerHandler, triggerCamera }}>
      {children}
    </CameraContext.Provider>
  );
}

export function useCamera() {
  return useContext(CameraContext);
}
