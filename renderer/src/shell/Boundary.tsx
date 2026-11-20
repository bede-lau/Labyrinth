// Error boundaries for the shell itself. The views have ViewErrorBoundary (ArtifactGate.tsx); these
// keep a failure in the header, or anywhere above the views, from leaving an empty page.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StatusPill } from '../design';

interface HeaderBoundaryProps {
  /** What failed, for the message: "mode indicator", "live-session alert". */
  what: string;
  /** When this value changes the boundary tries to render its children again (e.g. the next status). */
  resetKey?: unknown;
  children: ReactNode;
}

/**
 * Around the live-status parts of the header. If they throw, the rest of the page (question, nav,
 * view, legend) stays up and the header says, as an alert, that the session state is unknown.
 */
export class HeaderBoundary extends Component<HeaderBoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[labyrinth] the ${this.props.what} failed to render`, error, info.componentStack);
  }

  componentDidUpdate(prev: HeaderBoundaryProps) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="shell-mode shell-mode--broken" role="alert">
        <span className="shell-mode__pills">
          <StatusPill status="failed" size="md">
            Mode unknown
          </StatusPill>
        </span>
        <span className="shell-mode__detail shell-mode__detail--always">
          The {this.props.what} failed to render ({this.state.error.message}). Treat the live session state as unknown
          and check the Modal dashboard.
        </span>
      </div>
    );
  }
}

/** Last resort around the whole app (main.tsx): a rendering error never leaves a blank page. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[labyrinth] the app failed to render', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="shell-crash" role="alert">
        <p className="shell-crash__product">Labyrinth</p>
        <h1 className="shell-crash__title">The app could not be displayed</h1>
        <p className="shell-crash__body">
          A rendering error stopped the page: <span className="lab-mono">{this.state.error.message}</span>
        </p>
        <p className="shell-crash__body">
          Nothing is shown as live from here. If a live GX session was running, treat its state as unknown and check
          the Modal dashboard.
        </p>
        <p className="shell-crash__body">
          <button type="button" className="shell-crash__reload" onClick={() => location.reload()}>
            Reload the page
          </button>
        </p>
      </div>
    );
  }
}
