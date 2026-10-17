import { Component, lazy, Suspense, type ComponentProps, type PropsWithChildren } from 'react';
import { SplashScreen } from './SplashScreen';

type ReportViewProps = ComponentProps<typeof import('./ReportView')['ReportView']>;
const ReportView = lazy(() => import('./ReportView').then(module => ({ default: module.ReportView })));

class ReportLoadBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <section>
      <p role="alert">学習レポートを読み込めませんでした。</p>
    </section> : this.props.children;
  }
}

// Keep app navigation and data owners mounted if optional delivery fails.
export function DeferredReportView(props: ReportViewProps) {
  return <ReportLoadBoundary>
    <Suspense fallback={<SplashScreen />}>
      <ReportView {...props} />
    </Suspense>
  </ReportLoadBoundary>;
}
