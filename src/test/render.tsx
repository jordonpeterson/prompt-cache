import { render, type RenderOptions } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { CameraProvider } from '@/lib/camera-context';
import type { ReactElement } from 'react';

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <BrowserRouter>
      <CameraProvider>
        {children}
      </CameraProvider>
    </BrowserRouter>
  );
}

export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: Providers, ...options });
}

export { render };
