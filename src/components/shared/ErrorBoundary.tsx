import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level error boundary — catches render/lifecycle crashes and shows a
 * recovery UI instead of a blank screen. Wraps the entire app in main.tsx.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Caught:", error, info.componentStack);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="h-screen w-screen bg-zinc-900 text-zinc-100 flex items-center justify-center">
        <div className="max-w-md text-center space-y-4 px-6">
          <h1 className="text-xl font-semibold text-red-400">
            Something went wrong
          </h1>
          <p className="text-sm text-zinc-400">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <div className="flex gap-3 justify-center pt-2">
            <button
              onClick={this.handleReset}
              className="px-4 py-2 text-sm rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={this.handleReload}
              className="px-4 py-2 text-sm rounded-lg bg-orange-600 hover:bg-orange-500 transition-colors"
            >
              Reload App
            </button>
          </div>
        </div>
      </div>
    );
  }
}

// ── Panel-scoped error boundary ──────────────────────────────────────────────

interface PanelProps {
  children: ReactNode;
  /** Panel name shown in error UI (e.g., "Goals", "Memory") */
  name: string;
  /** Called when user clicks "Close" — should close the panel */
  onClose: () => void;
}

/**
 * Compact error boundary for right-side panels (w-80). Catches crashes within
 * a panel without taking down the whole app. Shows a recovery UI with retry.
 */
export class PanelErrorBoundary extends Component<PanelProps, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[PanelErrorBoundary:${this.props.name}] Caught:`, error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="h-full flex flex-col items-center justify-center px-4 text-center gap-3">
        <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
          <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-zinc-300">{this.props.name} panel crashed</p>
        <p className="text-xs text-zinc-500 max-w-[200px] break-words">
          {this.state.error?.message || "An unexpected error occurred."}
        </p>
        <div className="flex gap-2 pt-1">
          <button
            onClick={this.handleRetry}
            className="px-3 py-1.5 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors"
          >
            Retry
          </button>
          <button
            onClick={this.props.onClose}
            className="px-3 py-1.5 text-xs rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }
}
