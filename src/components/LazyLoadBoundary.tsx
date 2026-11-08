import { Component, type PropsWithChildren } from 'react';

type LazyLoadBoundaryProps = PropsWithChildren<{ message: string; onClose?: () => void }>;

// A lazy chunk can fail to load (offline, or a stale tab after a deploy). Without a boundary the error unmounts the whole app.
// React keeps a rejected lazy component rejected, so the message asks for a reload and the user can close this surface.
export class LazyLoadBoundary extends Component<LazyLoadBoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div role="alert">
      <p>{this.props.message}</p>
      {this.props.onClose ? <button type="button" onClick={this.props.onClose}>閉じる</button> : null}
    </div> : this.props.children;
  }
}
