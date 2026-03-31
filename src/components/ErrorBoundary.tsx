import React, { type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error("Error en ErrorBoundary:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "20px", textAlign: "center", fontFamily: "sans-serif" }}>
          <h1>⚠️ Error</h1>
          <p>{this.state.error?.message}</p>
          <details style={{ whiteSpace: "pre-wrap", textAlign: "left", marginTop: "20px" }}>
            {this.state.error?.stack}
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}
