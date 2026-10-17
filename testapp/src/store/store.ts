// A store the size of a test app's needs: a value, its listeners, and a copy
// in AsyncStorage that survives a restart where the store is persisted.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useSyncExternalStore} from 'react';

export interface Store<T> {
  get(): T;
  set(next: T | ((value: T) => T)): void;
  subscribe(listener: () => void): () => void;
  /** Resolves once the saved copy, where there is one, has been read. */
  ready: Promise<void>;
  /** Forgets the saved copy and goes back to the first value. */
  reset(): Promise<void>;
}

export function createStore<T extends object>(key: string, initial: T, options: {persist?: (value: T) => boolean} = {}): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  const save = (next: T) => {
    const keep = options.persist ? options.persist(next) : true;
    void (keep ? AsyncStorage.setItem(key, JSON.stringify(next)) : AsyncStorage.removeItem(key)).catch(() => undefined);
  };
  const ready = AsyncStorage.getItem(key)
    .then(saved => {
      if (saved !== null) {
        value = {...initial, ...(JSON.parse(saved) as T)};
        notify();
      }
    })
    .catch(() => undefined);
  return {
    get: () => value,
    set(next) {
      value = typeof next === 'function' ? (next as (value: T) => T)(value) : next;
      save(value);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    ready,
    async reset() {
      value = initial;
      await AsyncStorage.removeItem(key).catch(() => undefined);
      notify();
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
