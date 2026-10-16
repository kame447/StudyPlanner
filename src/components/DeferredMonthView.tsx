import { Component, lazy, Suspense, useRef, type ComponentProps, type PropsWithChildren } from 'react';
import { SplashScreen } from './SplashScreen';

type MonthViewProps = ComponentProps<typeof import('./MonthView')['MonthView']>;
const MonthView = lazy(() => import('./MonthView').then(module => ({ default: module.MonthView })));

class MonthViewLoadBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <section>
      <p role="alert">月の予定を読み込めませんでした。</p>
    </section> : this.props.children;
  }
}

function MonthViewRequestScope(props: MonthViewProps) {
  // This shell commits before the chunk arrives. An add request made while it
  // loads must remain newer than the mounted view's last handled request.
  const initialCreateRequestId = useRef(props.createRequestId ?? 0);
  return <MonthViewLoadBoundary>
    <Suspense fallback={<SplashScreen />}>
      <MonthView {...props} initialCreateRequestId={initialCreateRequestId.current} />
    </Suspense>
  </MonthViewLoadBoundary>;
}

export function DeferredMonthView(props: MonthViewProps) {
  return <MonthViewRequestScope key={props.userId} {...props} />;
}
