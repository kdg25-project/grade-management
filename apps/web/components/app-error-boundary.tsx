import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean };

/** Keeps an unexpected render exception from leaving users on a blank screen. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // The visible fallback intentionally avoids exposing implementation details.
  }

  render() {
    if (this.state.hasError) {
      return <main className="loginPage"><section className="loginPanel" role="alert"><p className="sectionEyebrow">表示エラー</p><h1>画面を表示できませんでした</h1><p className="pageLead">お手数ですが、画面を再読み込みしてもう一度お試しください。</p><button className="primaryAction" type="button" onClick={() => window.location.reload()}>再読み込み</button></section></main>;
    }
    return this.props.children;
  }
}
