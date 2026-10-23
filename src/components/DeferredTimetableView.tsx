import { Component, lazy, Suspense, type ComponentProps, type PropsWithChildren } from 'react';
import { SplashScreen } from './SplashScreen';

type TimetableViewProps = ComponentProps<typeof import('./TimetableView')['TimetableView']>;
const TimetableView = lazy(() => import('./TimetableView').then(module => ({ default: module.TimetableView })));

class TimetableLoadBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <section>
      <p role="alert">時間割を読み込めませんでした。</p>
    </section> : this.props.children;
  }
}

// Keep app navigation and data owners mounted if optional delivery fails.
export function DeferredTimetableView(props: TimetableViewProps) {
  return <TimetableLoadBoundary key={props.userId}>
    <Suspense fallback={<SplashScreen />}>
      <TimetableView {...props} />
    </Suspense>
  </TimetableLoadBoundary>;
}
