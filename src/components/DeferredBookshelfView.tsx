import { Component, lazy, Suspense, type ComponentProps, type PropsWithChildren } from 'react';
import { SplashScreen } from './SplashScreen';

type BookshelfViewProps = ComponentProps<typeof import('./BookshelfView')['BookshelfView']>;
const BookshelfView = lazy(() => import('./BookshelfView').then(module => ({ default: module.BookshelfView })));

class BookshelfLoadBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <section>
      <p role="alert">教材を読み込めませんでした。</p>
    </section> : this.props.children;
  }
}

// Keep the app's navigation and data owners mounted if optional delivery fails.
export function DeferredBookshelfView(props: BookshelfViewProps) {
  return <BookshelfLoadBoundary key={props.userId}>
    <Suspense fallback={<SplashScreen />}>
      <BookshelfView {...props} />
    </Suspense>
  </BookshelfLoadBoundary>;
}
