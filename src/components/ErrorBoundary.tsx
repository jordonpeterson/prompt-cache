import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error?: Error; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex flex-col items-center justify-center bg-gray-900 text-white p-6">
          <h1 className="text-xl font-bold mb-2">Something went wrong</h1>
          <p className="text-gray-400 text-sm mb-4">{this.state.error?.message}</p>
          <button
            onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
            className="px-4 py-2 bg-green-600 rounded-lg text-white font-medium"
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
