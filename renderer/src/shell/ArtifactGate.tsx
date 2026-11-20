// Loading / error / data gate for artifact-backed views. A view never renders blank: it shows a
// loading line, a named error panel, or its content. Feature views wrap useArtifact() state in it.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Callout, Panel } from '../design';
import type { ArtifactState } from '../lib/artifacts';

export interface ArtifactErrorPanelProps {
  /** View name, used as the panel eyebrow ("Locate the tubes"). */
  view: string;
  /** Files the view needed, named in the message ("artifacts/geometry.json"). */
  files: string[];
  message: string;
}

/** Names the file that failed and how to regenerate it, instead of a blank or spinning view. */
export function ArtifactErrorPanel({ view, files, message }: ArtifactErrorPanelProps) {
  const names = files.join(', ');
  const isArtifact = files.some((f) => f.startsWith('artifacts/'));
  return (
    <Panel eyebrow={view} title={`Could not load ${names}`} subtitle="This view has no evidence to show until the file loads.">
      <Callout
        tone="warn"
        title={`${names} is missing or invalid`}
        action={
          isArtifact ? (
            <span>
              Regenerate the artifacts with <code className="lab-mono">python3 -m labyrinth_main.build_artifacts</code>{' '}
              (from <code className="lab-mono">main/</code>), then reload.
            </span>
          ) : undefined
        }
      >
        <p className="lab-mono shell-error__message">{message}</p>
      </Callout>
    </Panel>
  );
}

export interface ArtifactGateProps<T> {
  state: ArtifactState<T>;
  view: string;
  /** Repo-relative file name ("artifacts/geometry.json"). */
  file: string;
  /** Optional structural check beyond schemaVersion; return a message to reject the data. */
  validate?: (data: T) => string | null;
  children: (data: T) => ReactNode;
}

export function ArtifactGate<T>({ state, view, file, validate, children }: ArtifactGateProps<T>) {
  if (state.status === 'loading') {
    return (
      <div className="shell-loading" role="status">
        Loading {file}…
      </div>
    );
  }
  if (state.status === 'error') return <ArtifactErrorPanel view={view} files={[state.file]} message={state.message} />;
  const problem = validate?.(state.data) ?? null;
  if (problem) return <ArtifactErrorPanel view={view} files={[file]} message={`${file}: ${problem}`} />;
  return <>{children(state.data)}</>;
}

interface BoundaryProps {
  view: string;
  files: string[];
  children: ReactNode;
}

/** Catches a view that throws while rendering (e.g. an artifact with an unexpected shape). */
export class ViewErrorBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[labyrinth] ${this.props.view} failed to render`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <ArtifactErrorPanel view={this.props.view} files={this.props.files} message={this.state.error.message} />;
    }
    return this.props.children;
  }
}
