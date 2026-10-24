import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; label: string }
interface State { error: Error | null }

export class WorkspaceErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Workspace view failed: ${this.props.label}`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <section className="workspace-error-boundary" role="alert">
        <span className="eyebrow">VIEW COULD NOT OPEN</span>
        <h2>{this.props.label} is unavailable</h2>
        <p>{this.state.error.message || 'The view failed while rendering. The rest of Climate Chain remains available.'}</p>
        <button type="button" className="memory-button memory-button-primary" onClick={() => this.setState({ error: null })}>Retry this view</button>
      </section>;
    }
    return this.props.children;
  }
}
