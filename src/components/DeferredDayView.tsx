import { Component, lazy, Suspense, type ComponentProps, type PropsWithChildren } from 'react';
import { SplashScreen } from './SplashScreen';

type DayViewProps = ComponentProps<typeof import('./DayView')['DayView']>;
const DayView = lazy(() => import('./DayView').then(module => ({ default: module.DayView })));

class DayLoadBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <section>
      <p role="alert">この日の予定を読み込めませんでした。</p>
    </section> : this.props.children;
  }
}

// Keep app navigation and data owners mounted if optional delivery fails.
export function DeferredDayView(props: DayViewProps) {
  return <DayLoadBoundary key={props.userId}>
    <Suspense fallback={<SplashScreen />}>
      <DayView {...props} />
    </Suspense>
  </DayLoadBoundary>;
}
