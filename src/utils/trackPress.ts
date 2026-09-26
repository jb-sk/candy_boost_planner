/**
 * 押して動かす操作（長押し・ドラッグ）の入力をまとめる。
 *
 * 入口は Pointer Events。無い端末（iOS 13 未満・古い Mac の Safari）だけ touch / mouse を使う。
 * 始まりの3つのイベント（pointerdown / touchstart / mousedown）に同じハンドラを付けてその中で呼ぶと、
 * 使う入力の始まりでだけ追跡を始め、その指・ポインターの動きと離したことを document で受けて handlers へ渡す
 * （並べ替えで要素が DOM 上を動いても取りこぼさない）。使わない入力の始まりでは null を返す。
 */

export type PressPoint = { x: number; y: number };

export type PressHandlers = {
  /** 動いた。true を返すと、タッチではページのスクロールを止める（ドラッグ中）。 */
  move?(point: PressPoint): boolean | void;
  /** 離した（commit: true）・取り消された（false）。この後は通知しない。 */
  end(commit: boolean): void;
};

export type Press = PressPoint & {
  /** 指での操作か（離した後に iOS が click を遅れて出すので、抑止の長さを変えるのに使う）。 */
  touch: boolean;
  /** 追跡をやめる（end は呼ばない）。 */
  stop(): void;
};

/** タッチの後にブラウザが出す互換の mousedown を無視する時間。 */
const COMPAT_MOUSE_MS = 1000;
let lastTouchAt = 0;

type Source = {
  point: PressPoint;
  touch: boolean;
  events: { move: string; end: string; cancel?: string };
  /** その入力の動き・離したことか。そうなら位置を返す。 */
  pick(ev: Event): PressPoint | null;
};

function pointOf(ev: { clientX: number; clientY: number }): PressPoint {
  return { x: ev.clientX, y: ev.clientY };
}

function sourceOf(ev: Event): Source | null {
  if (typeof window.PointerEvent !== "undefined") {
    if (ev.type !== "pointerdown") return null;
    const down = ev as PointerEvent;
    if (!down.isPrimary || down.button !== 0) return null;
    return {
      point: pointOf(down),
      touch: down.pointerType === "touch",
      events: { move: "pointermove", end: "pointerup", cancel: "pointercancel" },
      pick: (e) => ((e as PointerEvent).pointerId === down.pointerId ? pointOf(e as PointerEvent) : null),
    };
  }
  if (ev.type === "touchstart") {
    const start = ev as TouchEvent;
    const touch = start.changedTouches[0];
    if (!touch || start.touches.length > 1) return null;
    lastTouchAt = Date.now();
    return {
      point: pointOf(touch),
      touch: true,
      events: { move: "touchmove", end: "touchend", cancel: "touchcancel" },
      pick: (e) => {
        const changed = (e as TouchEvent).changedTouches;
        for (let i = 0; i < changed.length; i++) {
          if (changed[i]!.identifier === touch.identifier) return pointOf(changed[i]!);
        }
        return null;
      },
    };
  }
  if (ev.type === "mousedown") {
    const down = ev as MouseEvent;
    if (down.button !== 0 || Date.now() - lastTouchAt < COMPAT_MOUSE_MS) return null;
    return {
      point: pointOf(down),
      touch: false,
      events: { move: "mousemove", end: "mouseup" },
      pick: (e) => pointOf(e as MouseEvent),
    };
  }
  return null;
}

export function trackPress(ev: Event, handlers: PressHandlers): Press | null {
  const source = sourceOf(ev);
  if (!source) return null;
  const { events, pick } = source;

  const onMove = (e: Event) => {
    const point = pick(e);
    // passive: false で受けているので、タッチでもドラッグ中はスクロールを止められる
    if (point && handlers.move?.(point) && source.touch && e.cancelable) e.preventDefault();
  };
  const finish = (commit: boolean) => (e: Event) => {
    if (!pick(e)) return;
    if (source.touch) lastTouchAt = Date.now();
    stop();
    handlers.end(commit);
  };
  const onEnd = finish(true);
  const onCancel = finish(false);

  function stop(): void {
    document.removeEventListener(events.move, onMove);
    document.removeEventListener(events.end, onEnd);
    if (events.cancel) document.removeEventListener(events.cancel, onCancel);
  }

  document.addEventListener(events.move, onMove, { passive: false });
  document.addEventListener(events.end, onEnd);
  if (events.cancel) document.addEventListener(events.cancel, onCancel);
  return { ...source.point, touch: source.touch, stop };
}
