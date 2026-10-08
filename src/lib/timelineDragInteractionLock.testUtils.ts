// Node's EventTarget does not normalize the boolean capture option on removal.
// Browsers do, so keep the test harness faithful to the browser listener contract.
export class BrowserEventTarget extends EventTarget {
  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    super.removeEventListener(type, callback, typeof options === 'boolean' ? { capture: options } : options);
  }
}
