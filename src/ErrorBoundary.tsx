/*  src/ErrorBoundary.tsx */
import React from 'react';

export default class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error?: Error}> {
  state = { error: undefined as Error | undefined };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: any) { console.error('App crash:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: 'crimson' }}>
          <h1>App error</h1>
          <pre>{String(this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
